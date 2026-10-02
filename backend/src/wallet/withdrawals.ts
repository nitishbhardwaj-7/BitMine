/**
 * Withdrawals (docs/TECHNICAL_SPEC.md §6.5).
 *
 *   request  → funds move available → locked at once (no double-spend window)
 *   review   → admin approves or rejects (rejects unlock the funds)
 *   payout   → payoutJob.ts sends via Speed; paid removes the locked funds,
 *              a definite failure unlocks them, an unknown outcome keeps them
 *              locked until reconciled
 *
 * Every balance change is a pair of ledger entries plus a $inc on the balance,
 * in one transaction, keyed by the withdrawal id so nothing can apply twice.
 */
import mongoose, { Types, type ClientSession } from "mongoose";
import { Balance, Ledger, User, Withdrawal } from "../models/index.js";
import { AppError, notFound } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { getEconomics } from "../settings/economics.js";
import { parseDestination } from "./destination.js";
import { consumeOtp, sendOtp } from "../auth/otp.js";
import type { Mailer } from "../auth/mailer.js";
import { notify } from "../notifications/service.js";

const sats = (n: number) => `${n.toLocaleString("en-US")} sats`;

export const OPEN_STATUSES = ["pending_review", "approved", "sending", "needs_reconcile"] as const;
type WithdrawalStatus = "pending_review" | "approved" | "sending" | "paid" | "failed" | "rejected" | "needs_reconcile";

type Move = "lock" | "unlock" | "paid";

/** Applies one balance movement for a withdrawal inside `tx`. Throws if funds are missing. */
async function move(kind: Move, w: { _id: Types.ObjectId; userId: Types.ObjectId; amountSats: number }, tx: ClientSession) {
  const msat = w.amountSats * 1000;
  const key = `wd-${kind}:${w._id}`;
  const entries =
    kind === "lock"
      ? [
          { type: "withdrawal_lock", bucket: "available", amountMsat: -msat },
          { type: "withdrawal_lock", bucket: "locked", amountMsat: msat },
        ]
      : kind === "unlock"
        ? [
            { type: "withdrawal_unlock", bucket: "locked", amountMsat: -msat },
            { type: "withdrawal_unlock", bucket: "available", amountMsat: msat },
          ]
        : [{ type: "withdrawal_paid", bucket: "locked", amountMsat: -msat }];

  const inc =
    kind === "lock"
      ? { availableMsat: -msat, lockedMsat: msat }
      : kind === "unlock"
        ? { availableMsat: msat, lockedMsat: -msat }
        : { lockedMsat: -msat };
  const guard = kind === "lock" ? { availableMsat: { $gte: msat } } : { lockedMsat: { $gte: msat } };

  const upd = await Balance.updateOne({ userId: w.userId, ...guard }, { $inc: inc }, { session: tx });
  if (upd.modifiedCount !== 1) {
    throw kind === "lock"
      ? new AppError(409, "insufficient_balance", "Your available balance is lower than that amount.")
      : new Error(`locked balance missing for withdrawal ${w._id}`);
  }
  await Ledger.insertMany(
    entries.map((e, i) => ({
      userId: w.userId,
      ...e,
      idempotencyKey: `${key}:${i}`,
      refType: "withdrawal",
      refId: w._id,
    })),
    { session: tx },
  );
}

async function inTx<T>(fn: (tx: ClientSession) => Promise<T>): Promise<T> {
  const tx = await mongoose.startSession();
  try {
    let out!: T;
    await tx.withTransaction(async () => {
      out = await fn(tx);
    });
    return out;
  } finally {
    await tx.endSession();
  }
}

function view(w: {
  _id: Types.ObjectId;
  amountSats: number;
  destinationType: string;
  destination: string;
  status: string;
  rejectReason?: string | null;
  createdAt?: Date;
  paidAt?: Date | null;
}) {
  return {
    id: String(w._id),
    amountSats: w.amountSats,
    destinationType: w.destinationType,
    destination: w.destinationType === "bolt11" ? `${w.destination.slice(0, 16)}…${w.destination.slice(-6)}` : w.destination,
    // The user sees a simple status; internal ones (sending, needs_reconcile) read as "processing".
    status: w.status === "pending_review" || w.status === "approved" ? "pending" : w.status === "sending" || w.status === "needs_reconcile" ? "processing" : w.status,
    rejectReason: w.rejectReason ?? undefined,
    createdAt: w.createdAt?.toISOString(),
    paidAt: w.paidAt?.toISOString(),
  };
}

export async function requestWithdrawal(userId: Types.ObjectId, input: { amountSats: number; destination: string; code?: string }, now = Date.now()) {
  const settings = await getEconomics(new Date(now));
  const { amountSats } = input;
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
    throw new AppError(400, "invalid_amount", "Enter a whole number of sats.");
  }
  if (amountSats < settings.minWithdrawalSats) {
    throw new AppError(400, "below_minimum", `The minimum withdrawal is ${settings.minWithdrawalSats.toLocaleString("en-US")} sats.`, {
      minWithdrawalSats: settings.minWithdrawalSats,
    });
  }
  const dest = parseDestination(input.destination, amountSats, now);

  const user = await User.findById(userId).select({ status: 1, reviewFlags: 1, email: 1, twoFactor: 1 }).lean();
  if (!user || user.status !== "active") throw new AppError(403, "account_inactive", "This account can't make withdrawals.");
  // Checked again by the unique index inside the transaction; this early check keeps a
  // valid 2FA code from being consumed by a request that is going to be refused.
  if (await Withdrawal.exists({ userId, status: { $in: OPEN_STATUSES } })) {
    throw new AppError(409, "withdrawal_open", "You already have a withdrawal in progress. You can request another once it's done.");
  }
  if (user.twoFactor?.enabled) {
    if (!input.code) throw new AppError(403, "code_required", "Enter the code we emailed you to confirm this withdrawal.");
    await consumeOtp({ email: user.email, purpose: "withdrawal", code: input.code }, now);
  }

  const autoApprove =
    settings.withdrawalAutoApproveMaxSats > 0 && amountSats <= settings.withdrawalAutoApproveMaxSats && (user.reviewFlags?.length ?? 0) === 0;

  try {
    const w = await inTx(async (tx) => {
      const [doc] = await Withdrawal.create(
        [
          {
            userId,
            amountSats,
            destinationType: dest.type,
            destination: dest.value,
            destinationExpiresAt: dest.type === "bolt11" ? new Date(dest.expiresAt) : undefined,
            status: autoApprove ? "approved" : "pending_review",
          },
        ],
        { session: tx },
      );
      await move("lock", { _id: doc!._id, userId, amountSats }, tx);
      return doc!;
    });
    logger.info({ withdrawalId: String(w._id), userId: String(userId), amountSats }, "withdrawal requested");
    return view(w.toObject());
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw new AppError(409, "withdrawal_open", "You already have a withdrawal in progress. You can request another once it's done.");
    }
    throw err;
  }
}

/** Emails a withdrawal confirmation code (only needed with two-step verification on). */
export async function sendWithdrawalCode(mailer: Mailer, userId: Types.ObjectId) {
  const user = await User.findById(userId).select({ email: 1, twoFactor: 1, status: 1 }).lean();
  if (!user || user.status !== "active") throw new AppError(403, "account_inactive", "This account can't make withdrawals.");
  if (!user.twoFactor?.enabled) return { required: false };
  await sendOtp(mailer, { email: user.email, purpose: "withdrawal", userId });
  return { required: true, sent: true };
}

export async function listWithdrawals(userId: Types.ObjectId) {
  const rows = await Withdrawal.find({ userId }).sort({ createdAt: -1 }).limit(100).lean();
  return rows.map(view);
}

// ── admin actions ─────────────────────────────────────────────────────────

export async function approveWithdrawal(id: string, adminId: Types.ObjectId, now = Date.now()) {
  const w = await Withdrawal.findOneAndUpdate(
    { _id: id, status: "pending_review" },
    { $set: { status: "approved", reviewedBy: adminId, reviewedAt: new Date(now) } },
    { returnDocument: "after", lean: true },
  );
  if (!w) throw new AppError(409, "not_pending", "Only withdrawals waiting for review can be approved.");
  return w;
}

export async function rejectWithdrawal(id: string, adminId: Types.ObjectId, reason: string, now = Date.now()) {
  return inTx(async (tx) => {
    const w = await Withdrawal.findOneAndUpdate(
      { _id: id, status: { $in: ["pending_review", "approved"] } },
      { $set: { status: "rejected", rejectReason: reason, reviewedBy: adminId, reviewedAt: new Date(now) } },
      { returnDocument: "after", session: tx, lean: true },
    );
    if (!w) throw new AppError(409, "not_rejectable", "Only withdrawals that haven't been sent can be rejected.");
    await move("unlock", w, tx);
    await notify(
      w.userId,
      {
        kind: "withdrawal_rejected",
        title: "Withdrawal not approved",
        body: `Your withdrawal of ${sats(w.amountSats)} wasn't approved: ${reason}. The sats are back in your balance.`,
        dedupeKey: `withdrawal:${w._id}:rejected`,
        data: { withdrawalId: String(w._id) },
      },
      tx,
    );
    return w;
  });
}

/**
 * Admin decision for a withdrawal whose outcome was unknown, after checking the
 * Speed dashboard: "paid" (it went out) or "failed" (it didn't: funds unlock).
 */
export async function resolveReconcile(id: string, adminId: Types.ObjectId, outcome: "paid" | "failed", note: string, now = Date.now()) {
  const w = await Withdrawal.findById(id).lean();
  if (!w || w.status !== "needs_reconcile") throw new AppError(409, "not_reconcilable", "Only withdrawals marked for reconciliation can be resolved.");
  return outcome === "paid"
    ? markPaid(w._id, { adminId, note }, now)
    : markFailed(w._id, `admin: ${note}`, { adminId }, now, ["needs_reconcile"]);
}

// ── payout outcomes (used by the payout job) ─────────────────────────────

export async function markPaid(
  id: Types.ObjectId,
  info: { feeSats?: number; paymentId?: string; adminId?: Types.ObjectId; note?: string } = {},
  now = Date.now(),
) {
  return inTx(async (tx) => {
    const w = await Withdrawal.findOneAndUpdate(
      { _id: id, status: { $in: ["sending", "needs_reconcile"] } },
      {
        $set: {
          status: "paid",
          paidAt: new Date(now),
          ...(info.feeSats != null ? { "speed.feeSats": info.feeSats } : {}),
          ...(info.paymentId ? { "speed.paymentId": info.paymentId } : {}),
          ...(info.adminId ? { reviewedBy: info.adminId, lastError: info.note } : {}),
        },
      },
      { returnDocument: "after", session: tx, lean: true },
    );
    if (!w) return null;
    await move("paid", w, tx);
    await notify(
      w.userId,
      {
        kind: "withdrawal_paid",
        title: "Withdrawal sent",
        body: `${sats(w.amountSats)} are on their way to your wallet.`,
        dedupeKey: `withdrawal:${w._id}:paid`,
        data: { withdrawalId: String(w._id) },
      },
      tx,
    );
    logger.info({ withdrawalId: String(id), amountSats: w.amountSats }, "withdrawal paid");
    return w;
  });
}

export async function markFailed(
  id: Types.ObjectId,
  reason: string,
  info: { adminId?: Types.ObjectId } = {},
  _now = Date.now(),
  from: WithdrawalStatus[] = ["approved", "sending", "needs_reconcile"],
) {
  return inTx(async (tx) => {
    const w = await Withdrawal.findOneAndUpdate(
      { _id: id, status: { $in: from } },
      { $set: { status: "failed", lastError: reason, ...(info.adminId ? { reviewedBy: info.adminId } : {}) } },
      { returnDocument: "after", session: tx, lean: true },
    );
    if (!w) return null;
    await move("unlock", w, tx);
    await notify(
      w.userId,
      {
        kind: "withdrawal_failed",
        title: "Withdrawal didn't go through",
        body: `We couldn't send your ${sats(w.amountSats)}. They're back in your balance, so you can try again.`,
        dedupeKey: `withdrawal:${w._id}:failed`,
        data: { withdrawalId: String(w._id) },
      },
      tx,
    );
    logger.warn({ withdrawalId: String(id), reason }, "withdrawal failed, funds unlocked");
    return w;
  });
}

export async function getWithdrawalForAdmin(id: string) {
  if (!Types.ObjectId.isValid(id)) throw notFound("Withdrawal");
  const w = await Withdrawal.findById(id).lean();
  if (!w) throw notFound("Withdrawal");
  return w;
}
