/**
 * Hourly accrual job (docs/TECHNICAL_SPEC.md §5). Credits every user's mining
 * earnings, hour by hour, up to the start of the current hour.
 *
 * Safety properties:
 *  - Each hour becomes at most one ledger entry, keyed `mining:{userId}:{hourISO}`.
 *  - The balance update is conditional on `accruedUntil` still being the value
 *    this run read, inside the same transaction as the ledger inserts. A second
 *    worker (or a re-run) working on the same user either sees the advanced
 *    `accruedUntil` and skips, or its transaction aborts. Nothing is credited twice.
 *  - The app is never consulted: a user who closed the app is credited in full.
 *
 * Miners that start before a user's `accruedUntil` would miss those hours.
 * Claims and revocations always happen "now" (after accruedUntil). A purchase
 * processed late can start earlier; the store's grant credits that gap itself
 * (backfill) and bumps `balances.minersRev` so it can't race this job.
 */
import mongoose, { type Types } from "mongoose";
import { Balance, Ledger, Miner } from "../models/index.js";
import { floorHour, MS_PER_HOUR } from "../lib/time.js";
import { logger } from "../lib/logger.js";
import { getRateSchedule } from "../settings/economics.js";
import { earnedMsat, toWholeMsat, type MinerSpan, type RatePeriod } from "./accrual.js";
import { loadWindows } from "./sessions.js";

/** Upper bound on hours credited for one user per run (keeps a run bounded after downtime). */
const MAX_HOURS_PER_RUN = 24 * 14;
const BATCH_SIZE = 500;

export interface AccrualResult {
  usersProcessed: number;
  usersCredited: number;
  msatCredited: number;
  skippedConflicts: number;
  /** Users still behind the target hour after this run (capped at MAX_HOURS_PER_RUN per run). */
  remaining: number;
}

export async function runAccrual(opts: { now?: number } = {}): Promise<AccrualResult> {
  const target = floorHour(opts.now ?? Date.now());
  const schedule = await getRateSchedule();
  const result: AccrualResult = { usersProcessed: 0, usersCredited: 0, msatCredited: 0, skippedConflicts: 0, remaining: 0 };

  // Balances behind the target hour. Processed in batches; each user is independent.
  const cursor = Balance.find({ accruedUntil: { $lt: new Date(target) } })
    .select({ userId: 1, accruedUntil: 1 })
    .sort({ accruedUntil: 1 })
    .lean()
    .cursor({ batchSize: BATCH_SIZE });

  for await (const bal of cursor) {
    result.usersProcessed++;
    try {
      const r = await accrueUser(bal.userId, bal.accruedUntil!.getTime(), target, schedule);
      if (r === "conflict") result.skippedConflicts++;
      else if (r > 0) {
        result.usersCredited++;
        result.msatCredited += r;
      }
    } catch (err) {
      // One user's failure must not stop everyone else's credits; the next run retries.
      logger.error({ err, userId: String(bal.userId) }, "accrual failed for user");
    }
  }

  result.remaining = await Balance.countDocuments({ accruedUntil: { $lt: new Date(target) } });
  logger.info({ target: new Date(target).toISOString(), ...result }, "accrual run complete");
  return result;
}

/**
 * Credits one user from `from` to `target` (both hour-aligned).
 * Returns msat credited, or "conflict" if another run got there first.
 */
async function accrueUser(
  userId: Types.ObjectId,
  from: number,
  target: number,
  schedule: RatePeriod[],
): Promise<number | "conflict"> {
  const until = Math.min(target, from + MAX_HOURS_PER_RUN * MS_PER_HOUR);
  const session = await mongoose.startSession();
  try {
    let outcome: number | "conflict" = 0;
    // Everything (balance read, miners read, writes) happens inside one
    // transaction snapshot. A miner added concurrently by a late purchase also
    // writes this balance, so the two transactions conflict and this one is
    // retried by withTransaction with the new miner visible.
    await session.withTransaction(async () => {
      const bal = await Balance.findOne({ userId }).session(session).lean();
      if (!bal || bal.accruedUntil?.getTime() !== from) {
        outcome = "conflict";
        return;
      }

      const minerDocs = await Miner.find({
        userId,
        startAt: { $lt: new Date(until) },
        endAt: { $gt: new Date(from) },
        $or: [{ revokedAt: null }, { revokedAt: { $gt: new Date(from) } }],
      })
        .select({ gh: 1, startAt: 1, endAt: 1, revokedAt: 1 })
        .session(session)
        .lean();
      const miners: MinerSpan[] = minerDocs.map((m) => ({
        gh: m.gh,
        startAt: m.startAt.getTime(),
        endAt: m.endAt.getTime(),
        revokedAt: m.revokedAt ? m.revokedAt.getTime() : null,
      }));

      // Daily-start rule: hashpower only earns while the day's session is on.
      const windows = miners.length && schedule.some((p) => p.gated) ? await loadWindows(userId, from, until, session) : [];

      const entries: { hour: number; creditMsat: number }[] = [];
      let carry = bal.accrualRemainder ?? 0;
      for (let h = from; h < until; h += MS_PER_HOUR) {
        const exact = miners.length ? earnedMsat(miners, schedule, h, h + MS_PER_HOUR, windows) : 0;
        const { creditMsat, remainder: next } = toWholeMsat(exact, carry);
        carry = next;
        if (creditMsat > 0) entries.push({ hour: h, creditMsat });
      }
      const total = entries.reduce((sum, e) => sum + e.creditMsat, 0);

      const upd = await Balance.updateOne(
        { userId, accruedUntil: new Date(from) },
        {
          $set: { accruedUntil: new Date(until), accrualRemainder: carry },
          $inc: { availableMsat: total, lifetimeMinedMsat: total },
        },
        { session },
      );
      if (upd.modifiedCount !== 1) {
        outcome = "conflict";
        return;
      }
      if (entries.length) {
        await Ledger.insertMany(
          entries.map((e) => ({
            userId,
            type: "mining",
            amountMsat: e.creditMsat,
            bucket: "available",
            idempotencyKey: `mining:${userId}:${new Date(e.hour).toISOString()}`,
            meta: { hourStart: new Date(e.hour) },
          })),
          { session },
        );
      }
      outcome = total;
    });
    return outcome;
  } finally {
    await session.endSession();
  }
}
