import { Types } from "mongoose";
import { Balance, Ledger, Withdrawal } from "../models/index.js";
import { getEconomics } from "../settings/economics.js";
import { ensureBalance } from "./balances.js";

const LEDGER_LABEL: Record<string, string> = {
  mining: "Mining",
  referral: "Referral bonus",
  withdrawal_lock: "Withdrawal requested",
  withdrawal_unlock: "Withdrawal returned",
  withdrawal_paid: "Withdrawal sent",
  adjustment: "Adjustment",
};

export async function getWallet(userId: Types.ObjectId, now = Date.now()) {
  await ensureBalance(userId, now);
  const [bal, settings, open] = await Promise.all([
    Balance.findOne({ userId }).lean(),
    getEconomics(new Date(now)),
    Withdrawal.findOne({ userId, status: { $in: ["pending_review", "approved", "sending", "needs_reconcile"] } })
      .select({ amountSats: 1, status: 1, createdAt: 1 })
      .lean(),
  ]);
  const availableSats = Math.floor(bal!.availableMsat / 1000);
  return {
    availableMsat: bal!.availableMsat,
    lockedMsat: bal!.lockedMsat,
    lifetimeMinedMsat: bal!.lifetimeMinedMsat,
    availableSats,
    minWithdrawalSats: settings.minWithdrawalSats,
    canWithdraw: !open && availableSats >= settings.minWithdrawalSats,
    openWithdrawal: open ? { id: String(open._id), amountSats: open.amountSats, createdAt: open.createdAt?.toISOString() } : null,
  };
}

/**
 * The user's transactions, newest first, 50 per page. Hourly mining credits
 * are shown as they are; the app can group them by day.
 */
export async function listLedger(userId: Types.ObjectId, before?: string) {
  const filter: Record<string, unknown> = { userId, bucket: "available" };
  if (before && Types.ObjectId.isValid(before)) filter._id = { $lt: new Types.ObjectId(before) };
  const rows = await Ledger.find(filter).sort({ _id: -1 }).limit(51).lean();
  const page = rows.slice(0, 50);
  return {
    entries: page.map((e) => ({
      id: String(e._id),
      type: e.type,
      label: LEDGER_LABEL[e.type] ?? e.type,
      amountMsat: e.amountMsat,
      createdAt: e.createdAt?.toISOString(),
    })),
    nextCursor: rows.length > 50 ? String(page[page.length - 1]!._id) : null,
  };
}
