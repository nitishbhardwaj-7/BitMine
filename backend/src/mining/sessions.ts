/**
 * Daily mining sessions.
 *
 * Each local day the user taps "Start mining". With the daily-start rule on
 * (settings: dailyStartRequired), ALL mining stops at local midnight, paid
 * miners included, and the day's session only becomes active once the
 * required number of rewarded videos has been confirmed by AdMob
 * (settings: startAds; see claims/service.ts, claim kind "start"). From that
 * moment until midnight is the day's mining window: the only time hashpower
 * earns. Without the rule (the launch settings), a session starts with one
 * tap and only unlocks claims; paid miners earn around the clock.
 */
import type { ClientSession, Types } from "mongoose";
import { Miner, Session } from "../models/index.js";
import { localDate, nextLocalMidnight } from "../lib/time.js";
import { loadUserTimezone } from "../users/timezone.js";
import { ensureBalance } from "../wallet/balances.js";
import { getEconomics } from "../settings/economics.js";
import { getGrowth } from "../settings/growth.js";
import type { EconomicsSettings } from "../config/economics.js";
import { recordStreak } from "./streak.js";
import type { MiningWindow } from "./accrual.js";

interface SessionLike {
  localDate: string;
  startedAt: Date;
  endsAt: Date;
  activatedAt?: Date | null;
  adsRequired?: number | null;
  adsWatched?: number | null;
}

/** When this session's mining switched on: the last start video, or the tap itself if none were required. */
export function activationTime(s: SessionLike): number | null {
  if (s.activatedAt) return s.activatedAt.getTime();
  return (s.adsRequired ?? 0) === 0 ? s.startedAt.getTime() : null;
}

export function sessionActive(s: SessionLike | null | undefined, now: number): boolean {
  if (!s || s.endsAt.getTime() <= now) return false;
  const at = activationTime(s);
  return at !== null && at <= now;
}

/** What the app shows for today's session. */
export function sessionView(s: SessionLike | null | undefined, now = Date.now()) {
  if (!s) return null;
  const at = activationTime(s);
  return {
    localDate: s.localDate,
    startedAt: s.startedAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    active: sessionActive(s, now),
    activatedAt: at ? new Date(at).toISOString() : null,
    adsRequired: s.adsRequired ?? 0,
    adsWatched: Math.min(s.adsWatched ?? 0, s.adsRequired ?? 0),
  };
}

/**
 * Start videos this user owes for a new day: the daily-start setting, waived
 * for owners of an active paid miner when that perk is on.
 */
export async function startAdsFor(userId: Types.ObjectId, now = Date.now(), settings?: EconomicsSettings): Promise<number> {
  const eco = settings ?? (await getEconomics(new Date(now)));
  const ads = eco.dailyStartRequired ? Math.max(0, Math.floor(eco.startAds ?? 0)) : 0;
  if (ads === 0) return 0;
  if ((await getGrowth()).paidSkipStartAds) {
    const paid = await Miner.exists({ userId, source: "paid", revokedAt: null, startAt: { $lte: new Date(now) }, endAt: { $gt: new Date(now) } });
    if (paid) return 0;
  }
  return ads;
}

/**
 * Opens today's session, or returns it if already opened (idempotent). With
 * start videos required it is created pending and activates when the last
 * video is verified; otherwise it is active at once.
 */
export async function startSession(userId: Types.ObjectId, now = Date.now()) {
  const tz = await loadUserTimezone(userId, now);
  const day = localDate(now, tz);
  await ensureBalance(userId, now);
  const settings = await getEconomics(new Date(now));
  const adsRequired = await startAdsFor(userId, now, settings);
  const s = await Session.findOneAndUpdate(
    { userId, localDate: day },
    {
      $setOnInsert: {
        userId,
        localDate: day,
        tz,
        startedAt: new Date(now),
        endsAt: new Date(nextLocalMidnight(now, tz)),
        claimCounts: {},
        adsRequired,
        adsWatched: 0,
        ...(adsRequired === 0 ? { activatedAt: new Date(now) } : {}),
      },
    },
    { upsert: true, returnDocument: "after", lean: true },
  );
  if (s && sessionActive(s, now)) await recordStreak(userId, s, now);
  return s;
}

/** Today's session if the user has opened one and the day isn't over (it may still be waiting for its start videos). */
export async function currentSession(userId: Types.ObjectId, now = Date.now()) {
  const tz = await loadUserTimezone(userId, now);
  const s = await Session.findOne({ userId, localDate: localDate(now, tz) }).lean();
  return s && s.endsAt.getTime() > now ? s : null;
}

/**
 * The user's mining windows overlapping [from, to): each activated session
 * from its activation until its local midnight. Used by the accrual engine
 * when the daily-start rule is in force.
 */
export async function loadWindows(userId: Types.ObjectId, from: number, to: number, tx?: ClientSession): Promise<MiningWindow[]> {
  if (to <= from) return [];
  const q = Session.find({
    userId,
    endsAt: { $gt: new Date(from) },
    startedAt: { $lt: new Date(to) },
    $or: [{ activatedAt: { $ne: null } }, { adsRequired: { $in: [0, null] } }],
  }).select({ startedAt: 1, endsAt: 1, activatedAt: 1, adsRequired: 1, localDate: 1 });
  const rows = await (tx ? q.session(tx) : q).lean();
  const windows: MiningWindow[] = [];
  for (const s of rows) {
    const start = activationTime(s);
    if (start !== null && start < to) windows.push({ start, end: s.endsAt.getTime() });
  }
  return windows;
}

/** Verified claims today on a track. Lean reads return the Map as a plain object. */
export function claimCount(session: { claimCounts?: unknown } | null | undefined, track: string): number {
  const c = session?.claimCounts;
  if (!c) return 0;
  if (c instanceof Map) return c.get(track) ?? 0;
  return (c as Record<string, number>)[track] ?? 0;
}
