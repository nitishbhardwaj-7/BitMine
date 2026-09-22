/**
 * Daily referral rewards (docs/ECONOMICS.md): a referrer earns 5% of what the
 * people they referred *mined* each UTC day, capped at 5 sats/day per
 * referrer across all referees. Only "mining" credits count, never referral
 * credits, so rewards can't chain.
 *
 * A UTC day's mining = mining ledger entries created that day (the hourly job
 * credits each hour a couple of minutes after it ends). A day is processed
 * once it's over plus a 2-hour margin, and each referrer's credit is unique
 * per day, so re-runs and crashes can't pay twice.
 */
import mongoose, { type Types } from "mongoose";
import { Balance, JobState, Ledger, ReferralDaily, User } from "../models/index.js";
import { logger } from "../lib/logger.js";
import { MS_PER_DAY, MS_PER_HOUR } from "../lib/time.js";
import { getEconomics } from "../settings/economics.js";

const JOB = "referral-rewards";
const SETTLE_MARGIN_MS = 2 * MS_PER_HOUR;
/** First run with no marker looks back this far. */
const FIRST_RUN_LOOKBACK_DAYS = 2;

const dayStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayStart = (d: string) => Date.parse(`${d}T00:00:00Z`);

export async function runReferralRewards(now = Date.now()) {
  const state = await JobState.findById(JOB).lean();
  const lastEligible = dayStr(now - SETTLE_MARGIN_MS - MS_PER_DAY);
  let next = state?.lastDay ? dayStr(dayStart(state.lastDay) + MS_PER_DAY) : dayStr(now - FIRST_RUN_LOOKBACK_DAYS * MS_PER_DAY);

  const results: { day: string; referrers: number; msat: number }[] = [];
  while (next <= lastEligible) {
    results.push(await processDay(next));
    await JobState.updateOne({ _id: JOB }, { $set: { lastDay: next } }, { upsert: true });
    next = dayStr(dayStart(next) + MS_PER_DAY);
  }
  if (results.length) logger.info({ results }, "referral rewards processed");
  return results;
}

/** Credits every referrer for one UTC day. Safe to re-run. */
export async function processDay(day: string) {
  const from = new Date(dayStart(day));
  const to = new Date(dayStart(day) + MS_PER_DAY);
  const settings = await getEconomics(from);
  const capMsat = settings.referralCapSatsPerDay * 1000;

  // Σ mining per referee that day, then grouped by who referred them.
  const rows = await Ledger.aggregate<{ _id: Types.ObjectId; minedMsat: number }>([
    { $match: { type: "mining", createdAt: { $gte: from, $lt: to } } },
    { $group: { _id: "$userId", minedMsat: { $sum: "$amountMsat" } } },
    { $lookup: { from: User.collection.name, localField: "_id", foreignField: "_id", as: "u", pipeline: [{ $project: { referredBy: 1 } }] } },
    { $unwind: "$u" },
    { $match: { "u.referredBy": { $ne: null } } },
    { $group: { _id: "$u.referredBy", minedMsat: { $sum: "$minedMsat" } } },
  ]);

  let referrers = 0;
  let total = 0;
  for (const row of rows) {
    const credit = Math.min(Math.floor((row.minedMsat * settings.referralPercent) / 100), capMsat);
    if (credit <= 0) continue;
    const referrer = await User.findOne({ _id: row._id, status: "active" }).select({ _id: 1 }).lean();
    if (!referrer) continue;

    const tx = await mongoose.startSession();
    try {
      await tx.withTransaction(async () => {
        await ReferralDaily.create([{ referrerId: row._id, localDate: day, creditedMsat: credit }], { session: tx });
        await Ledger.create(
          [
            {
              userId: row._id,
              type: "referral",
              amountMsat: credit,
              bucket: "available",
              idempotencyKey: `referral:${row._id}:${day}`,
              meta: { day, refereesMinedMsat: row.minedMsat, capped: credit === capMsat },
            },
          ],
          { session: tx },
        );
        await Balance.updateOne({ userId: row._id }, { $inc: { availableMsat: credit } }, { session: tx, upsert: false });
      });
      referrers++;
      total += credit;
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err; // 11000: already credited for this day
    } finally {
      await tx.endSession();
    }
  }
  return { day, referrers, msat: total };
}

/** What the Referrals screen shows. */
export async function getReferralSummary(userId: Types.ObjectId, now = Date.now()) {
  const [user, invited, earned, today, settings] = await Promise.all([
    User.findById(userId).select({ referralCode: 1, referredBy: 1, createdAt: 1 }).lean(),
    User.countDocuments({ referredBy: userId, status: "active" }),
    Ledger.aggregate<{ total: number }>([{ $match: { userId, type: "referral" } }, { $group: { _id: null, total: { $sum: "$amountMsat" } } }]),
    ReferralDaily.findOne({ referrerId: userId, localDate: dayStr(now - MS_PER_DAY) }).lean(),
    getEconomics(new Date(now)),
  ]);
  return {
    referralCode: user?.referralCode,
    invitedCount: invited,
    totalEarnedMsat: earned[0]?.total ?? 0,
    yesterdayEarnedMsat: today?.creditedMsat ?? 0,
    rewardPercent: settings.referralPercent,
    dailyCapSats: settings.referralCapSatsPerDay,
    canAddReferralCode: !user?.referredBy && !!user?.createdAt && now - user.createdAt.getTime() < 7 * MS_PER_DAY,
  };
}
