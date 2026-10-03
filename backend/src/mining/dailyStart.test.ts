/**
 * The daily-start rule: all mining stops at local midnight and earns again
 * only after the day's session is started by watching rewarded videos.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Balance, Ledger, Miner, Session } from "../models/index.js";
import { clearTestDb, startTestDb, stopTestDb } from "../test/mongo.js";
import { createUser } from "../test/fixtures.js";
import { seedAll } from "../db/seed.js";
import { AppError } from "../lib/errors.js";
import { MS_PER_DAY, MS_PER_HOUR } from "../lib/time.js";
import { DEFAULT_ECONOMICS } from "../config/economics.js";
import { publishEconomics } from "../settings/economics.js";
import { ensureBalance } from "../wallet/balances.js";
import { cancelClaim, createClaimIntent, verifySsvReward } from "../claims/service.js";
import { earnedMsat, msatPerSecondAt, type MinerSpan, type RatePeriod } from "./accrual.js";
import { runAccrual } from "./accrualJob.js";
import { getMiningStatus } from "./status.js";
import { sessionView, startSession } from "./sessions.js";

// 2026-10-20 00:00 UTC; test users are in UTC so local midnight = UTC midnight.
const DAY = Date.parse("2026-10-20T00:00:00Z");

beforeAll(startTestDb, 180_000);
afterAll(stopTestDb);
beforeEach(async () => {
  await clearTestDb();
  await seedAll();
});

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e) => e instanceof AppError && e.code === code);
}

/** Switches the rule on from \`at\`, with \`startAds\` videos to start. */
async function enableRule(at: number, startAds: number) {
  await publishEconomics({ ...DEFAULT_ECONOMICS, dailyStartRequired: true, startAds }, new Date(at), undefined, new Date(at - 1000));
}

let tx = 0;
/** Plays AdMob: confirms a claim's video. */
const confirm = (userId: unknown, claimId: string, now: number) =>
  verifySsvReward({ keyId: "k", customData: claimId, userId: String(userId), transactionId: `tx-${++tx}` }, now);

describe("accrual maths with the rule", () => {
  const titan: MinerSpan = { gh: 2000, startAt: DAY - 5 * MS_PER_DAY, endAt: DAY + 25 * MS_PER_DAY };
  const gated: RatePeriod[] = [{ effectiveAt: 0, rateMsatPerGhDay: 48, gated: true }];

  it("a paid miner earns nothing outside a mining window", () => {
    expect(earnedMsat([titan], gated, DAY, DAY + MS_PER_DAY)).toBe(0);
    expect(msatPerSecondAt([titan], gated, DAY + MS_PER_HOUR)).toBe(0);
  });

  it("and exactly its rate inside one (started 09:00 → midnight = 15 h)", () => {
    const windows = [{ start: DAY + 9 * MS_PER_HOUR, end: DAY + MS_PER_DAY }];
    expect(earnedMsat([titan], gated, DAY, DAY + MS_PER_DAY, windows)).toBeCloseTo((2000 * 48 * 15) / 24, 6);
    expect(msatPerSecondAt([titan], gated, DAY + 10 * MS_PER_HOUR, windows)).toBeCloseTo((2000 * 48) / 86_400, 9);
    expect(msatPerSecondAt([titan], gated, DAY + 8 * MS_PER_HOUR, windows)).toBe(0);
  });

  it("hours before the rule took effect keep the old around-the-clock rule", () => {
    const schedule: RatePeriod[] = [
      { effectiveAt: 0, rateMsatPerGhDay: 48 },
      { effectiveAt: DAY + 12 * MS_PER_HOUR, rateMsatPerGhDay: 48, gated: true },
    ];
    // No windows at all: the first 12 hours still pay, the rest don't.
    expect(earnedMsat([titan], schedule, DAY, DAY + MS_PER_DAY)).toBeCloseTo((2000 * 48 * 12) / 24, 6);
  });
});

describe("starting the day", () => {
  it("needs the required videos; claims and mining wait for them", async () => {
    await enableRule(DAY - MS_PER_DAY, 2);
    const userId = await createUser("UTC");
    const now = DAY + 9 * MS_PER_HOUR;

    const s = sessionView(await startSession(userId, now), now)!;
    expect(s).toMatchObject({ active: false, adsRequired: 2, adsWatched: 0, activatedAt: null });
    await expectAppError(createClaimIntent(userId, { kind: "regular" }, now), "session_not_started");

    const first = await createClaimIntent(userId, { kind: "start" }, now);
    expect(first).toMatchObject({ kind: "start", gh: 0, remainingToday: 1 });
    expect(await confirm(userId, first.claimId, now + 30_000)).toEqual({ result: "counted", active: false });

    const second = await createClaimIntent(userId, { kind: "start" }, now + 40_000);
    expect(await confirm(userId, second.claimId, now + 70_000)).toEqual({ result: "counted", active: true });

    const after = sessionView((await Session.findOne({ userId }).lean())!, now + 80_000)!;
    expect(after).toMatchObject({ active: true, adsWatched: 2 });
    expect(Date.parse(after.activatedAt!)).toBe(now + 70_000);
    // Start videos add no hashpower of their own.
    expect(await Miner.countDocuments({ userId })).toBe(0);

    // Now the day is on: no more start videos, normal claims work.
    await expectAppError(createClaimIntent(userId, { kind: "start" }, now + 90_000), "already_started");
    const claim = await createClaimIntent(userId, { kind: "regular" }, now + 90_000);
    expect(await confirm(userId, claim.claimId, now + 120_000)).toMatchObject({ result: "granted" });
  });

  it("a replayed or extra start video doesn't count twice", async () => {
    await enableRule(DAY - MS_PER_DAY, 1);
    const userId = await createUser("UTC");
    const now = DAY + 9 * MS_PER_HOUR;
    await startSession(userId, now);
    const a = await createClaimIntent(userId, { kind: "start" }, now);
    const b = await createClaimIntent(userId, { kind: "start" }, now);
    expect(await verifySsvReward({ keyId: "k", customData: a.claimId, userId: String(userId), transactionId: "same" }, now + 1000)).toEqual({ result: "counted", active: true });
    expect(await verifySsvReward({ keyId: "k", customData: a.claimId, userId: String(userId), transactionId: "same" }, now + 2000)).toEqual({ result: "duplicate" });
    expect(await confirm(userId, b.claimId, now + 3000)).toEqual({ result: "ignored", reason: "already_started" });
    expect((await Session.findOne({ userId }).lean())!.adsWatched).toBe(1);
  });

  it("with zero videos required, one tap starts the day", async () => {
    await enableRule(DAY - MS_PER_DAY, 0);
    const userId = await createUser("UTC");
    const s = sessionView(await startSession(userId, DAY + MS_PER_HOUR), DAY + MS_PER_HOUR)!;
    expect(s).toMatchObject({ active: true, adsRequired: 0 });
  });

  it("a cancelled start video frees its slot", async () => {
    await enableRule(DAY - MS_PER_DAY, 2);
    const userId = await createUser("UTC");
    const now = DAY + 9 * MS_PER_HOUR;
    await startSession(userId, now);
    const c = await createClaimIntent(userId, { kind: "start" }, now);
    expect((await cancelClaim(userId, c.claimId)).cancelled).toBe(true);
    expect(await confirm(userId, c.claimId, now + 1000)).toEqual({ result: "ignored", reason: "claim_expired" });
    expect((await Session.findOne({ userId }).lean())!.adsWatched).toBe(0);
  });
});

describe("hourly credits with the rule", () => {
  async function titanOwner() {
    const userId = await createUser("UTC");
    await ensureBalance(userId, DAY);
    await Miner.create({ userId, source: "paid", gh: 2000, startAt: new Date(DAY - 5 * MS_PER_DAY), endAt: new Date(DAY + 25 * MS_PER_DAY) });
    return userId;
  }

  it("a paid miner earns nothing on a day that was never started", async () => {
    await enableRule(DAY - MS_PER_DAY, 2);
    const userId = await titanOwner();
    await runAccrual({ now: DAY + MS_PER_DAY });
    expect((await Balance.findOne({ userId }).lean())!.availableMsat).toBe(0);
    expect(await Ledger.countDocuments({ userId })).toBe(0);
  });

  it("and earns from the moment the day is started until midnight, then stops", async () => {
    await enableRule(DAY - MS_PER_DAY, 1);
    const userId = await titanOwner();
    const tap = DAY + 9 * MS_PER_HOUR;
    await startSession(userId, tap);
    const c = await createClaimIntent(userId, { kind: "start" }, tap);
    await confirm(userId, c.claimId, tap); // mining on from 09:00

    const live = await getMiningStatus(userId, tap + 30 * 60_000);
    expect(live.mining).toBe(true);
    expect(live.dailyStartRequired).toBe(true);
    expect(live.session).toMatchObject({ active: true });

    // Two days later: only 09:00 → 24:00 of the started day was paid (15 h).
    await runAccrual({ now: DAY + 2 * MS_PER_DAY });
    const bal = (await Balance.findOne({ userId }).lean())!;
    expect(bal.availableMsat).toBe((2000 * 48 * 15) / 24);
    expect(await Ledger.countDocuments({ userId, type: "mining" })).toBe(15);

    // After midnight nothing is running until the next start.
    const next = await getMiningStatus(userId, DAY + MS_PER_DAY + MS_PER_HOUR);
    expect(next.mining).toBe(false);
    expect(next.msatPerSecond).toBe(0);
    expect(next.session).toBeNull();
    expect(next.gh.paid).toBe(2000); // still owned, just not earning
  });

  it("hours mined before the rule was switched on are still paid in full", async () => {
    const userId = await titanOwner();
    await enableRule(DAY + 12 * MS_PER_HOUR, 2); // rule starts at noon
    await runAccrual({ now: DAY + MS_PER_DAY });
    // 00:00 → 12:00 under the old rule, nothing after (never started).
    expect((await Balance.findOne({ userId }).lean())!.availableMsat).toBe((2000 * 48 * 12) / 24);
  });
});
