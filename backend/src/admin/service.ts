/** Data and actions behind the admin pages. */
import { randomUUID } from "node:crypto";
import mongoose, { Types } from "mongoose";
import {
  Balance,
  Claim,
  Ledger,
  Miner,
  Notification,
  Product,
  Purchase,
  Session,
  SupportTicket,
  User,
  Withdrawal,
} from "../models/index.js";
import { AppError, notFound } from "../lib/errors.js";
import { MS_PER_DAY } from "../lib/time.js";
import { revokeAllForUser } from "../auth/refreshTokens.js";

const since = (ms: number) => new Date(Date.now() - ms);
const sum = async (model: mongoose.Model<any>, match: object, field: string) =>
  ((await model.aggregate([{ $match: match }, { $group: { _id: null, t: { $sum: `$${field}` } } }]))[0]?.t as number | undefined) ?? 0;

export async function dashboardStats() {
  const day = since(MS_PER_DAY);
  const month = since(30 * MS_PER_DAY);
  const [
    users, newUsers, activeToday, claims24h, purchases24h, revenue24h, purchases30d, revenue30d,
    pendingReview, pendingSats, reconcile, paid24h, paid30d, liabilities, mined24h, openTickets, flagged,
  ] = await Promise.all([
    User.countDocuments({ status: "active" }),
    User.countDocuments({ createdAt: { $gte: day } }),
    Session.countDocuments({ createdAt: { $gte: day } }),
    Claim.countDocuments({ status: "verified", updatedAt: { $gte: day } }),
    Purchase.countDocuments({ purchasedAt: { $gte: day }, status: "granted" }),
    sum(Purchase, { purchasedAt: { $gte: day }, status: "granted" }, "priceUsd"),
    Purchase.countDocuments({ purchasedAt: { $gte: month }, status: "granted" }),
    sum(Purchase, { purchasedAt: { $gte: month }, status: "granted" }, "priceUsd"),
    Withdrawal.countDocuments({ status: "pending_review" }),
    sum(Withdrawal, { status: { $in: ["pending_review", "approved", "sending", "needs_reconcile"] } }, "amountSats"),
    Withdrawal.countDocuments({ status: "needs_reconcile" }),
    sum(Withdrawal, { status: "paid", paidAt: { $gte: day } }, "amountSats"),
    sum(Withdrawal, { status: "paid", paidAt: { $gte: month } }, "amountSats"),
    Balance.aggregate([{ $group: { _id: null, a: { $sum: "$availableMsat" }, l: { $sum: "$lockedMsat" } } }]),
    sum(Ledger, { type: "mining", createdAt: { $gte: day } }, "amountMsat"),
    SupportTicket.countDocuments({ status: "open" }),
    User.countDocuments({ status: "active", "reviewFlags.0": { $exists: true } }),
  ]);
  const liab = liabilities[0] ?? { a: 0, l: 0 };
  return {
    users, newUsers, activeToday, claims24h,
    purchases24h, revenue24h, purchases30d, revenue30d,
    pendingReview, pendingSats, reconcile, paid24h, paid30d,
    liabilitiesMsat: (liab.a as number) + (liab.l as number),
    mined24hMsat: mined24h,
    openTickets, flagged,
  };
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function searchUsers(q: string) {
  const query = q.trim();
  const filter = Types.ObjectId.isValid(query) && query.length === 24
    ? { _id: new Types.ObjectId(query) }
    : query
      ? { $or: [{ email: { $regex: escapeRegex(query.toLowerCase()) } }, { referralCode: query.toUpperCase() }] }
      : {};
  return User.find(filter).sort({ createdAt: -1 }).limit(50).select({ email: 1, name: 1, status: 1, createdAt: 1, reviewFlags: 1, twoFactor: 1 }).lean();
}

export async function userDetail(id: string) {
  if (!Types.ObjectId.isValid(id)) throw notFound("User");
  const userId = new Types.ObjectId(id);
  const user = await User.findById(userId).lean();
  if (!user) throw notFound("User");
  const [balance, miners, purchases, withdrawals, ledger, referred, referrer] = await Promise.all([
    Balance.findOne({ userId }).lean(),
    Miner.find({ userId, source: { $in: ["paid", "admin_grant"] } }).sort({ startAt: -1 }).limit(50).lean(),
    Purchase.find({ userId }).sort({ purchasedAt: -1 }).limit(50).populate<{ productId: { name: string } | null }>("productId", { name: 1 }).lean(),
    Withdrawal.find({ userId }).sort({ createdAt: -1 }).limit(30).lean(),
    Ledger.find({ userId }).sort({ _id: -1 }).limit(40).lean(),
    User.countDocuments({ referredBy: userId }),
    user.referredBy ? User.findById(user.referredBy).select({ email: 1 }).lean() : null,
  ]);
  return { user, balance, miners, purchases, withdrawals, ledger, referred, referrer };
}

export async function setUserStatus(id: string, status: "active" | "suspended") {
  const r = await User.updateOne({ _id: id, status: { $ne: "deleted" } }, { $set: { status } });
  if (r.matchedCount !== 1) throw notFound("User");
  if (status === "suspended") await revokeAllForUser(new Types.ObjectId(id));
}

export async function clearReviewFlags(id: string) {
  await User.updateOne({ _id: id }, { $set: { reviewFlags: [] } });
}

/**
 * Manual balance correction, always with a reason, recorded in the ledger.
 * A debit can't take the available balance below zero.
 */
export async function adjustBalance(id: string, deltaSats: number, reason: string) {
  if (!Number.isSafeInteger(deltaSats) || deltaSats === 0) throw new AppError(400, "invalid_amount", "Enter a whole number of sats, not zero.");
  if (reason.trim().length < 5) throw new AppError(400, "reason_required", "Give a reason (at least 5 characters).");
  const userId = new Types.ObjectId(id);
  const msat = deltaSats * 1000;
  const tx = await mongoose.startSession();
  try {
    await tx.withTransaction(async () => {
      const guard = msat < 0 ? { availableMsat: { $gte: -msat } } : {};
      const upd = await Balance.updateOne({ userId, ...guard }, { $inc: { availableMsat: msat } }, { session: tx });
      if (upd.modifiedCount !== 1) throw new AppError(409, "insufficient_balance", "The available balance is lower than that debit.");
      await Ledger.create(
        [{ userId, type: "adjustment", bucket: "available", amountMsat: msat, idempotencyKey: `adj:${randomUUID()}`, meta: { reason: reason.trim() } }],
        { session: tx },
      );
    });
  } finally {
    await tx.endSession();
  }
}

export const WITHDRAWAL_STATUSES = ["pending_review", "approved", "sending", "needs_reconcile", "paid", "failed", "rejected"] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

export async function withdrawalQueue(status: WithdrawalStatus) {
  const rows = await Withdrawal.find({ status }).sort({ createdAt: status === "paid" || status === "rejected" || status === "failed" ? -1 : 1 }).limit(200).lean();
  const users = await User.find({ _id: { $in: rows.map((r) => r.userId) } })
    .select({ email: 1, name: 1, createdAt: 1, reviewFlags: 1, status: 1 })
    .lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const paidBefore = await Withdrawal.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { userId: { $in: rows.map((r) => r.userId) }, status: "paid" } },
    { $group: { _id: "$userId", n: { $sum: 1 } } },
  ]);
  const paidCount = new Map(paidBefore.map((p) => [String(p._id), p.n]));
  return rows.map((w) => ({ w, user: byId.get(String(w.userId)), paidCount: paidCount.get(String(w.userId)) ?? 0 }));
}

/** Sends an announcement to every active user (in-app, and pushed by the outbox). */
export async function announce(title: string, body: string) {
  const key = `announcement:${randomUUID()}`;
  let count = 0;
  const cursor = User.find({ status: "active" }).select({ _id: 1 }).lean().cursor({ batchSize: 1000 });
  let batch: { userId: Types.ObjectId; kind: string; title: string; body: string; dedupeKey: string }[] = [];
  const flush = async () => {
    if (!batch.length) return;
    await Notification.insertMany(batch, { ordered: false });
    count += batch.length;
    batch = [];
  };
  for await (const u of cursor) {
    batch.push({ userId: u._id, kind: "announcement", title, body, dedupeKey: key });
    if (batch.length >= 1000) await flush();
  }
  await flush();
  return count;
}

// ── dashboard: revenue and activity by UTC day ──────────────────────────

export interface DayRow {
  date: string;
  newUsers: number;
  /** Users who tapped Start mining that day. */
  active: number;
  /** Rewarded videos confirmed by AdMob. */
  adViews: number;
  /** adViews × eCPM / 1000: an estimate; exact figures are in the AdMob console. */
  adsUsd: number;
  purchases: number;
  /** Store price (RevenueCat's reported price, or the catalog price when missing). Gross, before the store's cut. */
  iapUsd: number;
  paidSats: number;
  minedMsat: number;
}

const dayOf = (field: string) => ({ $dateToString: { format: "%Y-%m-%d", date: `$${field}` } });

/** One row per day for the last `days` days (oldest first), all days present. */
export async function dailySeries(days: number, ecpmUsd: number, now = Date.now()): Promise<DayRow[]> {
  const n = Math.min(Math.max(days, 1), 90);
  const start = new Date(Math.floor(now / MS_PER_DAY) * MS_PER_DAY - (n - 1) * MS_PER_DAY);
  const byDay = async <T extends { _id: string }>(model: mongoose.Model<any>, pipeline: mongoose.PipelineStage[]) =>
    new Map((await model.aggregate<T>(pipeline)).map((r) => [r._id, r]));

  const [users, sessions, claims, purchases, paid, mined] = await Promise.all([
    byDay<{ _id: string; n: number }>(User, [{ $match: { createdAt: { $gte: start } } }, { $group: { _id: dayOf("createdAt"), n: { $sum: 1 } } }]),
    byDay<{ _id: string; n: number }>(Session, [{ $match: { createdAt: { $gte: start } } }, { $group: { _id: dayOf("createdAt"), n: { $sum: 1 } } }]),
    byDay<{ _id: string; n: number }>(Claim, [{ $match: { status: "verified", "admob.verifiedAt": { $gte: start } } }, { $group: { _id: dayOf("admob.verifiedAt"), n: { $sum: 1 } } }]),
    byDay<{ _id: string; n: number; usd: number }>(Purchase, [
      { $match: { status: "granted", purchasedAt: { $gte: start } } },
      { $lookup: { from: Product.collection.name, localField: "productId", foreignField: "_id", as: "p", pipeline: [{ $project: { priceDisplayUsd: 1 } }] } },
      { $group: { _id: dayOf("purchasedAt"), n: { $sum: 1 }, usd: { $sum: { $ifNull: ["$priceUsd", { $ifNull: [{ $first: "$p.priceDisplayUsd" }, 0] }] } } } },
    ]),
    byDay<{ _id: string; s: number }>(Withdrawal, [{ $match: { status: "paid", paidAt: { $gte: start } } }, { $group: { _id: dayOf("paidAt"), s: { $sum: "$amountSats" } } }]),
    byDay<{ _id: string; m: number }>(Ledger, [{ $match: { type: "mining", createdAt: { $gte: start } } }, { $group: { _id: dayOf("createdAt"), m: { $sum: "$amountMsat" } } }]),
  ]);

  const rows: DayRow[] = [];
  for (let i = 0; i < n; i++) {
    const date = new Date(start.getTime() + i * MS_PER_DAY).toISOString().slice(0, 10);
    const adViews = claims.get(date)?.n ?? 0;
    rows.push({
      date,
      newUsers: users.get(date)?.n ?? 0,
      active: sessions.get(date)?.n ?? 0,
      adViews,
      adsUsd: (adViews * ecpmUsd) / 1000,
      purchases: purchases.get(date)?.n ?? 0,
      iapUsd: purchases.get(date)?.usd ?? 0,
      paidSats: paid.get(date)?.s ?? 0,
      minedMsat: mined.get(date)?.m ?? 0,
    });
  }
  return rows;
}

// ── purchases list ──────────────────────────────────────────────────────

export const PURCHASE_PAGE = 50;

export async function listPurchasesAdmin(filter: { status?: "granted" | "refunded"; store?: "app_store" | "play_store"; q?: string }, page = 1) {
  const match: Record<string, unknown> = {};
  if (filter.status) match.status = filter.status;
  if (filter.store) match.store = filter.store;
  if (filter.q) {
    const q = filter.q.trim();
    const users = await User.find({ email: { $regex: escapeRegex(q.toLowerCase()) } }).select({ _id: 1 }).limit(200).lean();
    match.$or = [{ userId: { $in: users.map((u) => u._id) } }, { storeTransactionId: q }, ...(Types.ObjectId.isValid(q) && q.length === 24 ? [{ userId: new Types.ObjectId(q) }] : [])];
  }
  const skip = (Math.max(page, 1) - 1) * PURCHASE_PAGE;
  const [rows, total] = await Promise.all([
    Purchase.find(match).sort({ purchasedAt: -1 }).skip(skip).limit(PURCHASE_PAGE)
      .populate<{ productId: { name: string; sku: string; kind: string; priceDisplayUsd: number } | null }>("productId", { name: 1, sku: 1, kind: 1, priceDisplayUsd: 1 }).lean(),
    Purchase.countDocuments(match),
  ]);
  const users = new Map((await User.find({ _id: { $in: rows.map((r) => r.userId) } }).select({ email: 1, name: 1 }).lean()).map((u) => [String(u._id), u]));
  return {
    total,
    page: Math.max(page, 1),
    pages: Math.max(1, Math.ceil(total / PURCHASE_PAGE)),
    rows: rows.map((p) => ({
      id: String(p._id),
      userId: String(p.userId),
      email: users.get(String(p.userId))?.email ?? "",
      name: users.get(String(p.userId))?.name ?? "",
      product: p.productId?.name ?? "?",
      kind: p.productId?.kind ?? "",
      store: p.store,
      /** Reported by RevenueCat when known; otherwise the catalog price. */
      priceUsd: p.priceUsd ?? p.productId?.priceDisplayUsd ?? null,
      priceIsList: p.priceUsd == null,
      currency: p.currency,
      status: p.status ?? "granted",
      purchasedAt: p.purchasedAt,
      storeTransactionId: p.storeTransactionId,
      superUntil: p.grantedSuperUntil,
    })),
  };
}

/** Totals for the purchases page header. */
export async function purchaseTotals(now = Date.now()) {
  const agg = async (match: object) =>
    (await Purchase.aggregate<{ n: number; usd: number }>([
      { $match: { status: "granted", ...match } },
      { $lookup: { from: Product.collection.name, localField: "productId", foreignField: "_id", as: "p", pipeline: [{ $project: { priceDisplayUsd: 1 } }] } },
      { $group: { _id: null, n: { $sum: 1 }, usd: { $sum: { $ifNull: ["$priceUsd", { $ifNull: [{ $first: "$p.priceDisplayUsd" }, 0] }] } } } },
    ]))[0] ?? { n: 0, usd: 0 };
  const [all, d30, d7, refunded] = await Promise.all([
    agg({}),
    agg({ purchasedAt: { $gte: new Date(now - 30 * MS_PER_DAY) } }),
    agg({ purchasedAt: { $gte: new Date(now - 7 * MS_PER_DAY) } }),
    Purchase.countDocuments({ status: "refunded" }),
  ]);
  return { all, d30, d7, refunded };
}

// ── users list extras ───────────────────────────────────────────────────

/** Balance and currently active hashpower for a set of users. */
export async function userStats(ids: Types.ObjectId[], now = Date.now()) {
  const [balances, gh] = await Promise.all([
    Balance.find({ userId: { $in: ids } }).select({ userId: 1, availableMsat: 1, lockedMsat: 1, lifetimeMinedMsat: 1 }).lean(),
    Miner.aggregate<{ _id: Types.ObjectId; gh: number }>([
      { $match: { userId: { $in: ids }, revokedAt: null, startAt: { $lte: new Date(now) }, endAt: { $gt: new Date(now) } } },
      { $group: { _id: "$userId", gh: { $sum: "$gh" } } },
    ]),
  ]);
  const ghMap = new Map(gh.map((g) => [String(g._id), g.gh]));
  const balMap = new Map(balances.map((b) => [String(b.userId), b]));
  return (id: Types.ObjectId | string) => ({
    availableMsat: balMap.get(String(id))?.availableMsat ?? 0,
    lockedMsat: balMap.get(String(id))?.lockedMsat ?? 0,
    lifetimeMinedMsat: balMap.get(String(id))?.lifetimeMinedMsat ?? 0,
    gh: ghMap.get(String(id)) ?? 0,
  });
}

export async function userTotals() {
  const [total, active, suspended, deleted, withPurchase] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ status: "active" }),
    User.countDocuments({ status: "suspended" }),
    User.countDocuments({ status: "deleted" }),
    Purchase.distinct("userId", { status: "granted" }).then((ids) => ids.length),
  ]);
  return { total, active, suspended, deleted, withPurchase };
}
