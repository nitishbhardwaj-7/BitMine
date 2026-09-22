import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { Balance, JobState, Ledger, User } from "../models/index.js";
import { clearTestDb, startTestDb, stopTestDb } from "../test/mongo.js";
import { createUser } from "../test/fixtures.js";
import { seedAll } from "../db/seed.js";
import { ensureBalance } from "../wallet/balances.js";
import { MS_PER_HOUR } from "../lib/time.js";
import { getReferralSummary, processDay, runReferralRewards } from "./referralJob.js";

const DAY = "2026-10-01";
const T = Date.parse(`${DAY}T00:00:00Z`);

beforeAll(startTestDb, 180_000);
afterAll(stopTestDb);
beforeEach(async () => {
  await clearTestDb();
  await seedAll();
});

let n = 0;
/** Records a mining credit for `userId` at `at`, like the hourly job would. */
async function mined(userId: Types.ObjectId, msat: number, at: number) {
  await Ledger.collection.insertOne({
    userId, type: "mining", bucket: "available", amountMsat: msat, idempotencyKey: `test-mining:${++n}`, createdAt: new Date(at),
  });
}

async function referredBy(referrer: Types.ObjectId) {
  const id = await createUser();
  await User.updateOne({ _id: id }, { $set: { referredBy: referrer } });
  return id;
}

async function available(userId: Types.ObjectId) {
  return (await Balance.findOne({ userId }).lean())!.availableMsat;
}

describe("referral rewards", () => {
  it("pays 5% of what referees mined that day", async () => {
    const ref = await createUser();
    await ensureBalance(ref, T);
    const a = await referredBy(ref);
    const b = await referredBy(ref);
    await mined(a, 20_000, T + 5 * MS_PER_HOUR);
    await mined(b, 10_000, T + 20 * MS_PER_HOUR);
    await mined(a, 99_999, T + 25 * MS_PER_HOUR); // next day: not counted

    await processDay(DAY);
    expect(await available(ref)).toBe(1_500); // 5% of 30,000
  });

  it("caps the reward at 5 sats a day across all referees", async () => {
    const ref = await createUser();
    await ensureBalance(ref, T);
    for (let i = 0; i < 3; i++) await mined(await referredBy(ref), 1_000_000, T + MS_PER_HOUR);
    await processDay(DAY);
    expect(await available(ref)).toBe(5_000);
  });

  it("only mining counts: referral rewards don't chain", async () => {
    const top = await createUser();
    const mid = await referredBy(top);
    const leaf = await referredBy(mid);
    await ensureBalance(top, T);
    await ensureBalance(mid, T);
    await mined(leaf, 40_000, T + MS_PER_HOUR);

    await processDay(DAY);
    expect(await available(mid)).toBe(2_000);
    expect(await available(top)).toBe(0); // mid's referral credit isn't mining
  });

  it("re-running a day pays nothing extra", async () => {
    const ref = await createUser();
    await ensureBalance(ref, T);
    await mined(await referredBy(ref), 20_000, T + MS_PER_HOUR);
    await processDay(DAY);
    await processDay(DAY);
    expect(await available(ref)).toBe(1_000);
    expect(await Ledger.countDocuments({ userId: ref, type: "referral" })).toBe(1);
  });

  it("skips deleted referrers", async () => {
    const ref = await createUser();
    await ensureBalance(ref, T);
    await mined(await referredBy(ref), 20_000, T + MS_PER_HOUR);
    await User.updateOne({ _id: ref }, { $set: { status: "deleted" } });
    await processDay(DAY);
    expect(await available(ref)).toBe(0);
  });

  it("the scheduled run waits for the day to settle, then catches up day by day", async () => {
    const ref = await createUser();
    await ensureBalance(ref, T);
    const a = await referredBy(ref);
    await JobState.create({ _id: "referral-rewards", lastDay: "2026-09-30" });
    await mined(a, 20_000, T + MS_PER_HOUR);
    await mined(a, 40_000, T + 30 * MS_PER_HOUR); // 2 Oct

    expect(await runReferralRewards(Date.parse("2026-10-02T01:00:00Z"))).toEqual([]); // 1 Oct not settled yet
    await runReferralRewards(Date.parse("2026-10-03T03:00:00Z"));
    expect(await available(ref)).toBe(1_000 + 2_000);
    expect((await JobState.findById("referral-rewards").lean())!.lastDay).toBe("2026-10-02");
  });

  it("summarises referrals for the app", async () => {
    const ref = await createUser();
    await ensureBalance(ref, T);
    await mined(await referredBy(ref), 20_000, T + MS_PER_HOUR);
    await referredBy(ref);
    await processDay(DAY);
    const s = await getReferralSummary(ref, T + 30 * MS_PER_HOUR);
    expect(s).toMatchObject({ invitedCount: 2, totalEarnedMsat: 1_000, yesterdayEarnedMsat: 1_000, rewardPercent: 5, dailyCapSats: 5 });
  });
});
