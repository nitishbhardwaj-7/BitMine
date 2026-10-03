/**
 * What the Mine screen shows. All numbers come from the server; the app only
 * animates `displayMsat` forward at `msatPerSecond` between refreshes.
 */
import { Types } from "mongoose";
import { notFound } from "../lib/errors.js";
import { Balance, Miner, Product, Purchase, SuperEntitlement, User } from "../models/index.js";
import { localDate, nextLocalMidnight } from "../lib/time.js";
import { getGrowth, type GrowthSettings } from "../settings/growth.js";
import { BOOST_TRACK, activeBoostUntil, boostGhFor } from "./boost.js";
import { streakView } from "./streak.js";
import { gamesView } from "../games/service.js";
import { getEconomics, getRateSchedule } from "../settings/economics.js";
import { ensureBalance } from "../wallet/balances.js";
import { loadUserTimezone } from "../users/timezone.js";
import { earnedMsat, isGatedAt, msatPerSecondAt, type MinerSpan } from "./accrual.js";
import { claimCount, currentSession, loadWindows, sessionView, startAdsFor } from "./sessions.js";

const iso = (d: Date | number) => new Date(d).toISOString();

/** The first-purchase offer: new accounts that haven't bought anything yet, for a limited time. */
async function starterOffer(userId: Types.ObjectId, createdAt: Date | undefined, g: GrowthSettings, now: number) {
  if (g.offerHours <= 0 || !createdAt) return null;
  const endsAt = createdAt.getTime() + g.offerHours * 3_600_000;
  if (endsAt <= now) return null;
  const p = await Product.findOne({ kind: "bundle", active: true }).sort({ sortOrder: 1 }).select({ sku: 1 }).lean();
  if (!p || (await Purchase.exists({ userId }))) return null;
  return { sku: p.sku, endsAt: iso(endsAt) };
}

export async function getMiningStatus(userId: Types.ObjectId, now = Date.now()) {
  await ensureBalance(userId, now);
  const [bal, schedule, settings, tz, session, growth, user] = await Promise.all([
    Balance.findOne({ userId }).lean(),
    getRateSchedule(),
    getEconomics(new Date(now)),
    loadUserTimezone(userId, now),
    currentSession(userId, now),
    getGrowth(),
    User.findById(userId).select({ streak: 1, createdAt: 1 }).lean(),
  ]);
  const accruedUntil = bal!.accruedUntil!.getTime();

  const minerDocs = await Miner.find({
    userId,
    startAt: { $lte: new Date(now) },
    endAt: { $gt: new Date(Math.min(accruedUntil, now)) },
  })
    .select({ gh: 1, source: 1, productId: 1, startAt: 1, endAt: 1, revokedAt: 1 })
    .lean();
  const spans: MinerSpan[] = minerDocs.map((m) => ({
    gh: m.gh,
    startAt: m.startAt.getTime(),
    endAt: m.endAt.getTime(),
    revokedAt: m.revokedAt?.getTime() ?? null,
  }));

  // With the daily-start rule, hashpower only earns while the day's session is on.
  const windows = await loadWindows(userId, Math.min(accruedUntil, now), now + 1);
  const msatPerSecond = msatPerSecondAt(spans, schedule, now, windows);

  // Earned since the last hourly credit: shown as "mining", not yet withdrawable.
  const unsettledMsat = Math.floor(earnedMsat(spans, schedule, accruedUntil, now, windows) + (bal!.accrualRemainder ?? 0));

  const ghBySource = { paid: 0, claim: 0, super: 0, bonus: 0 };
  for (const m of minerDocs) {
    const active = m.startAt.getTime() <= now && now < Math.min(m.endAt.getTime(), m.revokedAt?.getTime() ?? Infinity);
    if (!active) continue;
    if (m.source === "paid" || m.source === "admin_grant") ghBySource.paid += m.gh;
    else if (m.source === "claim") ghBySource.claim += m.gh;
    else if (m.source === "boost" || m.source === "streak" || m.source === "game") ghBySource.bonus += m.gh;
    else ghBySource.super += m.gh;
  }

  const counts = (key: string): number => claimCount(session, key);

  const entitlements = await SuperEntitlement.find({ userId, activeUntil: { $gt: new Date(now) } }).lean();
  const tierProducts = entitlements.length
    ? await Product.find({ _id: { $in: entitlements.map((e) => e.productId) } }).sort({ sortOrder: 1 }).lean()
    : [];
  const superTiers = tierProducts.map((p) => {
    const e = entitlements.find((x) => String(x.productId) === String(p._id))!;
    return {
      sku: p.sku,
      name: p.name,
      gh: p.claimGh,
      used: counts(String(p._id)),
      cap: p.claimsPerDay,
      activeUntil: iso(e.activeUntil),
    };
  });

  const boostUntil = growth.boostAdsPerDay > 0 ? await activeBoostUntil(userId, now) : null;
  const boost =
    growth.boostAdsPerDay > 0
      ? {
          used: counts(BOOST_TRACK),
          cap: growth.boostAdsPerDay,
          minutes: growth.boostMinutes,
          /** What a boost would add right now. */
          gh: await boostGhFor(userId, now, growth),
          activeUntil: boostUntil ? iso(boostUntil) : null,
        }
      : null;

  return {
    serverTime: iso(now),
    balance: {
      availableMsat: bal!.availableMsat,
      lockedMsat: bal!.lockedMsat,
      lifetimeMinedMsat: bal!.lifetimeMinedMsat,
      unsettledMsat,
      displayMsat: bal!.availableMsat + unsettledMsat,
      accruedUntil: iso(accruedUntil),
    },
    msatPerSecond,
    /** True while sats are actually being earned right now. */
    mining: msatPerSecond > 0,
    /** The daily-start rule is on: mining stops at midnight until today's session is started. */
    dailyStartRequired: isGatedAt(schedule, now),
    gh: { total: ghBySource.paid + ghBySource.claim + ghBySource.super + ghBySource.bonus, ...ghBySource },
    session: sessionView(session, now),
    /** Videos this user must watch to start a day (0 = one tap, e.g. the paid-miner perk). */
    startAdsRequired: session ? (session.adsRequired ?? 0) : await startAdsFor(userId, now, settings),
    /** Owning a paid miner waives the start videos. */
    perks: { paidSkipStartAds: growth.paidSkipStartAds && Boolean(settings.dailyStartRequired) && (settings.startAds ?? 0) > 0 },
    streak: streakView(user?.streak, localDate(now, tz), growth),
    boost,
    games: await gamesView(session),
    offer: await starterOffer(userId, user?.createdAt, growth, now),
    claims: { gh: settings.claimGh, used: counts("regular"), cap: settings.claimsPerDay },
    superTiers,
    nextMidnight: iso(nextLocalMidnight(now, tz)),
    minWithdrawalSats: settings.minWithdrawalSats,
  };
}

/** One paid miner with what it has earned so far (credited hours plus the current hour). */
export async function minerDetail(userId: Types.ObjectId, id: string, now = Date.now()) {
  if (!Types.ObjectId.isValid(id)) throw notFound("Miner");
  const m = await Miner.findOne({ _id: id, userId }).populate<{ productId: { sku: string; name: string; durationDays: number } | null }>("productId", { sku: 1, name: 1, durationDays: 1 }).lean();
  if (!m) throw notFound("Miner");
  const schedule = await getRateSchedule();
  const span: MinerSpan = { gh: m.gh, startAt: m.startAt.getTime(), endAt: m.endAt.getTime(), revokedAt: m.revokedAt?.getTime() ?? null };
  const end = Math.min(span.endAt, span.revokedAt ?? Infinity);
  // "Mined so far" follows the days the user actually started; the totals are the
  // most this miner can earn (mining every day from midnight).
  const always = [{ start: span.startAt, end }];
  const windows = await loadWindows(userId, span.startAt, Math.min(now, end) + 1);
  const earned = earnedMsat([span], schedule, span.startAt, Math.min(now, end), windows);
  const total = earnedMsat([span], schedule, span.startAt, end, always);
  return {
    id: String(m._id),
    source: m.source,
    product: m.productId ? { sku: m.productId.sku, name: m.productId.name } : null,
    gh: m.gh,
    startAt: iso(m.startAt),
    endAt: iso(m.endAt),
    status: m.revokedAt ? "revoked" : now < end ? "active" : "expired",
    progress: Math.min(1, Math.max(0, (now - span.startAt) / (span.endAt - span.startAt))),
    daysLeft: Math.max(0, Math.ceil((end - now) / 86_400_000)),
    earnedMsat: Math.floor(earned),
    expectedTotalMsat: Math.floor(total),
    msatPerDay: Math.floor(msatPerSecondAt([span], schedule, Math.min(now, end - 1), always) * 86_400),
  };
}

/** Paid and granted miners, newest first. */
export async function listMiners(userId: Types.ObjectId, now = Date.now()) {
  const docs = await Miner.find({ userId, source: { $in: ["paid", "admin_grant"] } })
    .sort({ startAt: -1 })
    .limit(200)
    .populate<{ productId: { sku: string; name: string } | null }>("productId", { sku: 1, name: 1 })
    .lean();
  return docs.map((m) => {
    const end = Math.min(m.endAt.getTime(), m.revokedAt?.getTime() ?? Infinity);
    return {
      id: String(m._id),
      source: m.source,
      product: m.productId ? { sku: m.productId.sku, name: m.productId.name } : null,
      gh: m.gh,
      startAt: iso(m.startAt),
      endAt: iso(m.endAt),
      status: m.revokedAt ? "revoked" : now < end ? "active" : "expired",
    };
  });
}
