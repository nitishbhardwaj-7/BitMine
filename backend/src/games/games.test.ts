/** Mini-games: a won round becomes hashpower after a video; a lost one locks the games until a retry video. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppConfig, GameRound, Miner } from "../models/index.js";
import { clearTestDb, startTestDb, stopTestDb } from "../test/mongo.js";
import { createUser } from "../test/fixtures.js";
import { seedAll } from "../db/seed.js";
import { AppError } from "../lib/errors.js";
import { MS_PER_DAY, MS_PER_HOUR } from "../lib/time.js";
import { createClaimIntent, verifySsvReward } from "../claims/service.js";
import { getMiningStatus } from "../mining/status.js";
import { startSession } from "../mining/sessions.js";
import { finishRound, startRound } from "./service.js";

const DAY = Date.parse("2026-10-20T00:00:00Z");
const NOON = DAY + 12 * MS_PER_HOUR;

beforeAll(startTestDb, 180_000);
afterAll(stopTestDb);
beforeEach(async () => {
  await clearTestDb();
  await seedAll();
});

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e) => e instanceof AppError && e.code === code);
}
let tx = 0;
const confirm = (userId: unknown, claimId: string, now: number) =>
  verifySsvReward({ keyId: "k", customData: claimId, userId: String(userId), transactionId: `game-${++tx}` }, now);

describe("mini-games", () => {
  it("needs today's mining to be started", async () => {
    const userId = await createUser("UTC");
    await expectAppError(startRound(userId, "block", NOON), "session_not_started");
  });

  it("a won round pays +5.5 GH/s until midnight after its video, once", async () => {
    const userId = await createUser("UTC");
    await startSession(userId, NOON);
    const { roundId, rewardGh } = await startRound(userId, "block", NOON);
    expect(rewardGh).toBe(5.5);

    // Nothing to claim until the round is reported won.
    await expectAppError(createClaimIntent(userId, { kind: "game", roundId }, NOON + 1000), "round_not_won");
    expect(await finishRound(userId, roundId, true, NOON + 8000)).toMatchObject({ status: "won" });

    const a = await createClaimIntent(userId, { kind: "game", roundId }, NOON + 9000);
    const b = await createClaimIntent(userId, { kind: "game", roundId }, NOON + 9000);
    expect(a).toMatchObject({ kind: "game", gh: 5.5 });
    expect(await confirm(userId, a.claimId, NOON + 30_000)).toMatchObject({ result: "granted" });
    // A second video for the same round grants nothing.
    expect(await confirm(userId, b.claimId, NOON + 31_000)).toEqual({ result: "ignored", reason: "round_claimed" });

    const miner = (await Miner.findOne({ userId, source: "game" }).lean())!;
    expect(miner).toMatchObject({ gh: 5.5 });
    expect(miner.endAt.getTime()).toBe(DAY + MS_PER_DAY);
    expect(await Miner.countDocuments({ userId, source: "game" })).toBe(1);
    const s = await getMiningStatus(userId, NOON + 60_000);
    expect(s.games).toEqual({ used: 1, cap: 10, gh: 5.5, locked: false });
    expect(s.gh.bonus).toBe(5.5);
    await expectAppError(createClaimIntent(userId, { kind: "game", roundId }, NOON + 70_000), "round_not_won");
  });

  it("a lost round locks the games until a retry video is watched", async () => {
    const userId = await createUser("UTC");
    await startSession(userId, NOON);
    await expectAppError(createClaimIntent(userId, { kind: "retry" }, NOON), "retry_not_needed");

    const { roundId } = await startRound(userId, "match", NOON);
    expect(await finishRound(userId, roundId, false, NOON + 20_000)).toMatchObject({ status: "lost" });
    expect((await getMiningStatus(userId, NOON + 21_000)).games).toMatchObject({ locked: true });
    await expectAppError(startRound(userId, "match", NOON + 22_000), "retry_required");
    await expectAppError(startRound(userId, "block", NOON + 22_000), "retry_required");
    // A lost round can't be claimed, and its result can't be changed afterwards.
    await expectAppError(createClaimIntent(userId, { kind: "game", roundId }, NOON + 23_000), "round_not_won");
    expect(await finishRound(userId, roundId, true, NOON + 24_000)).toMatchObject({ status: "lost" });

    const retry = await createClaimIntent(userId, { kind: "retry" }, NOON + 25_000);
    expect(retry).toMatchObject({ kind: "retry", gh: 0 });
    expect(await confirm(userId, retry.claimId, NOON + 50_000)).toEqual({ result: "counted", active: true });
    expect((await getMiningStatus(userId, NOON + 51_000)).games).toMatchObject({ locked: false });
    expect(await Miner.countDocuments({ userId })).toBe(0); // a retry video adds no hashpower
    await startRound(userId, "match", NOON + 52_000);
  });

  it("a win reported faster than the game can be played is refused", async () => {
    const userId = await createUser("UTC");
    await startSession(userId, NOON);
    const block = await startRound(userId, "block", NOON);
    await expectAppError(finishRound(userId, block.roundId, true, NOON + 500), "invalid_result");
    const match = await startRound(userId, "match", NOON);
    await expectAppError(finishRound(userId, match.roundId, true, NOON + 3000), "invalid_result");
    // And a round left open far too long is a loss.
    expect(await finishRound(userId, match.roundId, true, NOON + 30 * 60_000)).toMatchObject({ status: "lost" });
  });

  it("only the day's limit of rewards can be claimed, and games can be switched off", async () => {
    await AppConfig.updateOne({ _id: "app" }, { $set: { "growth.gameWinsPerDay": 2 } });
    const userId = await createUser("UTC");
    await startSession(userId, NOON);
    for (let i = 0; i < 2; i++) {
      const at = NOON + i * 60_000;
      const { roundId } = await startRound(userId, "block", at);
      await finishRound(userId, roundId, true, at + 5000);
      const c = await createClaimIntent(userId, { kind: "game", roundId }, at + 6000);
      await confirm(userId, c.claimId, at + 20_000);
    }
    await expectAppError(startRound(userId, "block", NOON + 5 * 60_000), "daily_limit_reached");
    expect(await GameRound.countDocuments({ userId, status: "claimed" })).toBe(2);

    await AppConfig.updateOne({ _id: "app" }, { $set: { "growth.gameWinsPerDay": 0 } });
    await expectAppError(startRound(userId, "block", NOON + 6 * 60_000), "not_found");
    expect((await getMiningStatus(userId, NOON + 6 * 60_000)).games).toBeNull();
  });
});
