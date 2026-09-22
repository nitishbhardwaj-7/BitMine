import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { Balance, Claim, Miner, Session } from "../models/index.js";
import { clearTestDb, startTestDb, stopTestDb } from "../test/mongo.js";
import { createUser, grantSuperTier } from "../test/fixtures.js";
import { seedAll } from "../db/seed.js";
import { MS_PER_DAY, MS_PER_HOUR, localDate, nextLocalMidnight } from "../lib/time.js";
import { startSession } from "../mining/sessions.js";
import { runAccrual } from "../mining/accrualJob.js";
import { AppError } from "../lib/errors.js";
import { createClaimIntent, verifySsvReward } from "./service.js";
import type { SsvReward } from "./admobSsv.js";

// 10:00 IST on 1 Oct 2026. Midnight IST is 18:30 UTC.
const NOW = Date.parse("2026-10-01T04:30:00Z");
const TZ = "Asia/Kolkata";

beforeAll(startTestDb, 180_000);
afterAll(stopTestDb);
beforeEach(async () => {
  await clearTestDb();
  await seedAll();
});

let tx = 0;
const reward = (claimId: string, userId: Types.ObjectId, extra: Partial<SsvReward> = {}): SsvReward => ({
  keyId: "k",
  customData: claimId,
  userId: String(userId),
  transactionId: `tx-${++tx}`,
  ...extra,
});

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e) => e instanceof AppError && e.code === code);
}

describe("claims", () => {
  it("requires today's session before claiming", async () => {
    const userId = await createUser(TZ);
    await expectAppError(createClaimIntent(userId, { kind: "regular" }, NOW), "session_not_started");
  });

  it("Start mining is idempotent and ends at local midnight", async () => {
    const userId = await createUser(TZ);
    const a = await startSession(userId, NOW);
    const b = await startSession(userId, NOW + MS_PER_HOUR);
    expect(String(a!._id)).toBe(String(b!._id));
    expect(a!.endsAt.getTime()).toBe(nextLocalMidnight(NOW, TZ));
    expect(await Balance.exists({ userId })).toBeTruthy();
  });

  it("a verified ad becomes a 5.5 GH/s miner until local midnight", async () => {
    const userId = await createUser(TZ);
    await startSession(userId, NOW);
    const intent = await createClaimIntent(userId, { kind: "regular" }, NOW);
    expect(intent).toMatchObject({ gh: 5.5, remainingToday: 59 });

    const out = await verifySsvReward(reward(intent.claimId, userId), NOW + 30_000);
    expect(out.result).toBe("granted");

    const miner = await Miner.findOne({ userId }).lean();
    expect(miner).toMatchObject({ source: "claim", gh: 5.5 });
    expect(miner!.startAt.getTime()).toBe(NOW + 30_000);
    expect(miner!.endAt.getTime()).toBe(nextLocalMidnight(NOW, TZ));
  });

  it("Google retrying the same callback grants only once", async () => {
    const userId = await createUser(TZ);
    await startSession(userId, NOW);
    const { claimId } = await createClaimIntent(userId, { kind: "regular" }, NOW);
    const r = reward(claimId, userId);
    expect((await verifySsvReward(r, NOW + 1000)).result).toBe("granted");
    expect((await verifySsvReward(r, NOW + 2000)).result).toBe("duplicate");
    expect(await Miner.countDocuments({ userId })).toBe(1);
  });

  it("a reused AdMob transaction id on another claim grants nothing", async () => {
    const userId = await createUser(TZ);
    await startSession(userId, NOW);
    const a = await createClaimIntent(userId, { kind: "regular" }, NOW);
    const b = await createClaimIntent(userId, { kind: "regular" }, NOW);
    await verifySsvReward(reward(a.claimId, userId, { transactionId: "same" }), NOW + 1000);
    expect((await verifySsvReward(reward(b.claimId, userId, { transactionId: "same" }), NOW + 2000)).result).toBe("duplicate");
    expect(await Miner.countDocuments({ userId })).toBe(1);
  });

  it("rejects a callback for someone else's claim", async () => {
    const userId = await createUser(TZ);
    const other = await createUser(TZ);
    await startSession(userId, NOW);
    const { claimId } = await createClaimIntent(userId, { kind: "regular" }, NOW);
    const out = await verifySsvReward(reward(claimId, other), NOW + 1000);
    expect(out).toEqual({ result: "ignored", reason: "user_mismatch" });
    expect((await Claim.findById(claimId).lean())!.status).toBe("rejected");
    expect(await Miner.countDocuments({})).toBe(0);
  });

  it("ignores callbacks after the claim expired or the day ended", async () => {
    const userId = await createUser(TZ);
    await startSession(userId, NOW);
    const late = await createClaimIntent(userId, { kind: "regular" }, NOW);
    expect(await verifySsvReward(reward(late.claimId, userId), NOW + 11 * 60_000)).toEqual({ result: "ignored", reason: "claim_expired" });

    // Intent at 23:58 IST, ad finished at 00:01: the day is over.
    const nearMidnight = nextLocalMidnight(NOW, TZ) - 2 * 60_000;
    const c = await createClaimIntent(userId, { kind: "regular" }, nearMidnight);
    expect(await verifySsvReward(reward(c.claimId, userId), nearMidnight + 3 * 60_000)).toEqual({ result: "ignored", reason: "day_over" });
    expect(await Miner.countDocuments({ userId })).toBe(0);
  });

  it("enforces 60 claims a day, even when callbacks race", async () => {
    const userId = await createUser(TZ);
    const s = await startSession(userId, NOW);
    await Session.updateOne({ _id: s!._id }, { $set: { "claimCounts.regular": 58 } });

    const a = await createClaimIntent(userId, { kind: "regular" }, NOW);
    const b = await createClaimIntent(userId, { kind: "regular" }, NOW);
    await expectAppError(createClaimIntent(userId, { kind: "regular" }, NOW), "daily_limit_reached");

    // Sneak a third pending claim past the intent check, then verify all three at once.
    const c = await Claim.create({ userId, kind: "regular", gh: 5.5, localDate: localDate(NOW, TZ), expiresAt: new Date(NOW + 600_000) });
    const outs = await Promise.all([a.claimId, b.claimId, String(c._id)].map((id) => verifySsvReward(reward(id, userId), NOW + 5000)));

    expect(outs.filter((o) => o.result === "granted")).toHaveLength(2);
    expect(outs.filter((o) => o.result === "ignored" && o.reason === "daily_limit")).toHaveLength(1);
    expect(await Miner.countDocuments({ userId })).toBe(2);
    expect((await Session.findById(s!._id).lean())!.claimCounts).toMatchObject({ regular: 60 });
  });

  it("limits open ad intents to 3 at a time", async () => {
    const userId = await createUser(TZ);
    await startSession(userId, NOW);
    for (let i = 0; i < 3; i++) await createClaimIntent(userId, { kind: "regular" }, NOW);
    await expectAppError(createClaimIntent(userId, { kind: "regular" }, NOW), "too_many_pending");
  });

  it("Super claims need the tier, use its GH/s and cap, and count separately", async () => {
    const userId = await createUser(TZ);
    await startSession(userId, NOW);
    await expectAppError(createClaimIntent(userId, { kind: "super", tier: "super_pro" }, NOW), "super_not_owned");

    const pro = await grantSuperTier(userId, "super_pro", NOW + 365 * MS_PER_DAY);
    const intent = await createClaimIntent(userId, { kind: "super", tier: "super_pro" }, NOW);
    expect(intent).toMatchObject({ gh: 10, remainingToday: 49 });
    expect((await verifySsvReward(reward(intent.claimId, userId), NOW + 1000)).result).toBe("granted");

    const regular = await createClaimIntent(userId, { kind: "regular" }, NOW);
    expect(regular.remainingToday).toBe(59);

    const s = await Session.findOne({ userId }).lean();
    expect(s!.claimCounts).toMatchObject({ [String(pro._id)]: 1 });
    expect(await Miner.findOne({ userId, source: "super_claim" }).lean()).toMatchObject({ gh: 10 });
  });

  it("an expired Super Miner tier can't be claimed", async () => {
    const userId = await createUser(TZ);
    await startSession(userId, NOW);
    await grantSuperTier(userId, "super_max", NOW - 1000);
    await expectAppError(createClaimIntent(userId, { kind: "super", tier: "super_max" }, NOW), "super_not_owned");
  });

  it("claimed GH/s is credited up to midnight by the hourly job", async () => {
    const userId = await createUser(TZ);
    await startSession(userId, NOW);
    const { claimId } = await createClaimIntent(userId, { kind: "regular" }, NOW);
    await verifySsvReward(reward(claimId, userId), NOW);

    await runAccrual({ now: NOW + MS_PER_DAY });

    // 10:00 → 24:00 IST = 14 h × 5.5 GH/s × 2 msat per GH/s-hour = 154 msat
    expect((await Balance.findOne({ userId }).lean())!.availableMsat).toBe(154);
  });
});
