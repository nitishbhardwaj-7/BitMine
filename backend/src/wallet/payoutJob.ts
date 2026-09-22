/**
 * Payout job (every minute). Sends approved withdrawals through Speed and
 * follows each send to a final outcome.
 *
 * The one rule: never send the same withdrawal twice. Speed has no
 * idempotency key, so:
 *   - a withdrawal is claimed (approved → sending) before the send call;
 *   - if Speed clearly refuses, the funds are unlocked;
 *   - if the result is unknown (timeout, 5xx), the withdrawal goes to
 *     needs_reconcile with funds still locked. We then look for the send in
 *     Speed's recent sends by its note; if it can't be found, an admin decides.
 */
import { Withdrawal } from "../models/index.js";
import { logger } from "../lib/logger.js";
import { markFailed, markPaid } from "./withdrawals.js";
import { SpeedError, type SpeedClient, type SpeedSend } from "./speed.js";

const BATCH = 20;
/** A send still "unpaid" after this long needs a human to look at it. */
const STUCK_SENDING_MS = 24 * 60 * 60 * 1000;
/** How long to keep looking for an unknown-outcome send before alerting. */
const RECONCILE_ALERT_MS = 30 * 60 * 1000;

export const noteFor = (withdrawalId: unknown) => `bitmine:${withdrawalId}`;

export interface PayoutResult {
  sent: number;
  paid: number;
  failed: number;
  reconcile: number;
  paused?: "no_client" | "insufficient_funds";
}

async function applySendStatus(id: unknown, s: SpeedSend, now: number, r: PayoutResult) {
  if (s.status === "paid") {
    if (await markPaid(id as never, { feeSats: s.feesSats, paymentId: s.id }, now)) r.paid++;
  } else if (s.status === "failed") {
    // Speed credits a failed Lightning send back to our account, so the user's funds unlock.
    if (await markFailed(id as never, `speed: ${s.failureReason ?? "failed"}`, {}, now)) r.failed++;
  } else {
    await Withdrawal.updateOne({ _id: id, status: "sending" }, { $set: { "speed.rawStatus": s.status } });
  }
}

export async function runPayouts(speed: SpeedClient | undefined, now = Date.now()): Promise<PayoutResult> {
  const r: PayoutResult = { sent: 0, paid: 0, failed: 0, reconcile: 0 };
  if (!speed) return { ...r, paused: "no_client" };

  // 1. Follow sends that are in flight.
  const inFlight = await Withdrawal.find({ status: "sending", "speed.paymentId": { $exists: true } }).limit(200).lean();
  for (const w of inFlight) {
    try {
      const s = await speed.get(w.speed!.paymentId!);
      await applySendStatus(w._id, s, now, r);
      if (s.status === "unpaid" && w.sendingAt && now - w.sendingAt.getTime() > STUCK_SENDING_MS) {
        await Withdrawal.updateOne({ _id: w._id, status: "sending" }, { $set: { status: "needs_reconcile", lastError: "still unpaid after 24 h" } });
        logger.error({ withdrawalId: String(w._id) }, "ALERT: Speed send unpaid for 24 h, needs admin review");
        r.reconcile++;
      }
    } catch (err) {
      logger.warn({ err, withdrawalId: String(w._id) }, "could not check Speed send status; will retry");
    }
  }

  // 2. Look for sends whose create call had an unknown outcome.
  const unknown = await Withdrawal.find({ status: "needs_reconcile", "speed.paymentId": { $exists: false } }).limit(50).lean();
  if (unknown.length) {
    try {
      const recent = await speed.listRecent();
      for (const w of unknown) {
        const found = recent.find((s) => s.note === noteFor(w._id));
        if (found) {
          await Withdrawal.updateOne(
            { _id: w._id, status: "needs_reconcile" },
            { $set: { status: "sending", "speed.paymentId": found.id, "speed.rawStatus": found.status } },
          );
          await applySendStatus(w._id, found, now, r);
          logger.info({ withdrawalId: String(w._id), paymentId: found.id }, "reconciled Speed send by note");
        } else if (w.sendingAt && now - w.sendingAt.getTime() > RECONCILE_ALERT_MS) {
          logger.error({ withdrawalId: String(w._id) }, "ALERT: Speed send not found after 30 min, admin must check the Speed dashboard");
        }
      }
    } catch (err) {
      logger.warn({ err }, "could not list Speed sends for reconciliation");
    }
  }

  // 3. Send newly approved withdrawals, oldest first.
  const approved = await Withdrawal.find({ status: "approved" }).sort({ reviewedAt: 1, createdAt: 1 }).limit(BATCH).lean();
  for (const candidate of approved) {
    // Expired invoices can't be paid: fail before sending so the user can submit a new one.
    if (candidate.destinationExpiresAt && candidate.destinationExpiresAt.getTime() <= now + 60_000) {
      if (await markFailed(candidate._id, "invoice expired before payout", {}, now, ["approved"])) r.failed++;
      continue;
    }
    const w = await Withdrawal.findOneAndUpdate(
      { _id: candidate._id, status: "approved" },
      { $set: { status: "sending", sendingAt: new Date(now), "speed.note": noteFor(candidate._id) }, $inc: { attempts: 1 } },
      { returnDocument: "after", lean: true },
    );
    if (!w) continue; // another worker claimed it

    try {
      const s = await speed.send({ amountSats: w.amountSats, destination: w.destination, note: noteFor(w._id) });
      await Withdrawal.updateOne({ _id: w._id }, { $set: { "speed.paymentId": s.id, "speed.rawStatus": s.status } });
      r.sent++;
      await applySendStatus(w._id, s, now, r);
    } catch (err) {
      const kind = err instanceof SpeedError ? err.kind : "unknown";
      if (kind === "insufficient_funds") {
        // Nothing was sent. Put it back in the queue and stop: the Speed account needs topping up.
        await Withdrawal.updateOne({ _id: w._id, status: "sending" }, { $set: { status: "approved", lastError: "Speed balance too low" } });
        logger.error("ALERT: Speed balance too low, payouts paused until topped up");
        return { ...r, paused: "insufficient_funds" };
      }
      if (kind === "definite") {
        if (await markFailed(w._id, (err as Error).message, {}, now, ["sending"])) r.failed++;
      } else {
        await Withdrawal.updateOne({ _id: w._id, status: "sending" }, { $set: { status: "needs_reconcile", lastError: (err as Error).message } });
        logger.error({ withdrawalId: String(w._id), err }, "Speed send outcome unknown; funds stay locked pending reconciliation");
        r.reconcile++;
      }
    }
  }
  return r;
}
