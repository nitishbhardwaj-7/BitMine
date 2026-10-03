import { Types } from "mongoose";
import { Balance, Ledger, Withdrawal } from "../models/index.js";
import { getEconomics } from "../settings/economics.js";
import { ensureBalance } from "./balances.js";
import { localDate } from "../lib/time.js";
import { loadUserTimezone } from "../users/timezone.js";

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
 * Earnings per UTC day (mining and referral credits), newest first, for the
 * "Recent settlements" list and charts. Days with nothing credited are omitted.
 */
export async function dailyEarnings(userId: Types.ObjectId, days = 14, now = Date.now()) {
  const n = Math.min(Math.max(days, 1), 90);
  const from = new Date(Math.floor(now / 86_400_000) * 86_400_000 - (n - 1) * 86_400_000);
  const rows = await Ledger.aggregate<{ _id: { day: string; type: string }; msat: number }>([
    { $match: { userId, type: { $in: ["mining", "referral"] }, createdAt: { $gte: from } } },
    { $group: { _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, type: "$type" }, msat: { $sum: "$amountMsat" } } },
  ]);
  const byDay = new Map<string, { date: string; miningMsat: number; referralMsat: number }>();
  for (const r of rows) {
    const d = byDay.get(r._id.day) ?? { date: r._id.day, miningMsat: 0, referralMsat: 0 };
    if (r._id.type === "mining") d.miningMsat += r.msat;
    else d.referralMsat += r.msat;
    byDay.set(r._id.day, d);
  }
  return { days: [...byDay.values()].sort((a, b) => (a.date < b.date ? 1 : -1)) };
}

/** Raw ledger rows read per page: enough for a month of hourly mining credits. */
const LEDGER_PAGE_ROWS = 800;

interface LedgerLine {
  id: string;
  type: string;
  label: string;
  amountMsat: number;
  createdAt?: string;
  /** Set on a day's mining total: the local day (YYYY-MM-DD) it adds up. */
  day?: string;
}

/**
 * The user's transactions, newest first. Mining is credited every hour, but a
 * day of it is shown as one line: the hourly credits are added up per local
 * day (the day the hour was mined, in the user's time zone). Everything else
 * (withdrawals, referral rewards, adjustments) is listed as it happened.
 */
export async function listLedger(userId: Types.ObjectId, before?: string, now = Date.now()) {
  const filter: Record<string, unknown> = { userId, bucket: "available" };
  if (before && Types.ObjectId.isValid(before)) filter._id = { $lt: new Types.ObjectId(before) };
  const [found, tz] = await Promise.all([
    Ledger.find(filter).sort({ _id: -1 }).limit(LEDGER_PAGE_ROWS + 1).lean(),
    loadUserTimezone(userId, now),
  ]);
  const hasMore = found.length > LEDGER_PAGE_ROWS;
  let rows = found.slice(0, LEDGER_PAGE_ROWS);
  let nextCursor: string | null = hasMore ? String(rows[rows.length - 1]!._id) : null;
  if (hasMore) {
    // The oldest mining day on this page may be cut in half by the page limit:
    // stop before it, so the next page reads that day in full.
    const lastMining = [...rows].reverse().find((e) => e.type === "mining");
    const cutDay = lastMining ? dayOf(lastMining, tz, now) : null;
    const cutAt = cutDay ? rows.findIndex((e) => e.type === "mining" && dayOf(e, tz, now) === cutDay) : -1;
    if (cutAt > 0) {
      rows = rows.slice(0, cutAt);
      nextCursor = String(rows[rows.length - 1]!._id);
    }
  }

  const lines: LedgerLine[] = [];
  const days = new Map<string, LedgerLine>();
  for (const e of rows) {
    if (e.type !== "mining") {
      lines.push({ id: String(e._id), type: e.type, label: LEDGER_LABEL[e.type] ?? e.type, amountMsat: e.amountMsat, createdAt: e.createdAt?.toISOString() });
      continue;
    }
    const day = dayOf(e, tz, now);
    const line = days.get(day);
    if (line) {
      line.amountMsat += e.amountMsat;
    } else {
      const fresh: LedgerLine = { id: "mining:" + day, type: "mining", label: LEDGER_LABEL.mining ?? "Mining", amountMsat: e.amountMsat, createdAt: e.createdAt?.toISOString(), day };
      days.set(day, fresh);
      lines.push(fresh);
    }
  }
  return { entries: lines, nextCursor };
}

/** The local day an hourly mining credit was mined on. */
function dayOf(e: { meta?: unknown; createdAt?: Date | null }, tz: string, now: number): string {
  const meta = e.meta as { hourStart?: Date; from?: Date } | undefined;
  return localDate(new Date(meta?.hourStart ?? meta?.from ?? e.createdAt ?? new Date(now)).getTime(), tz);
}
