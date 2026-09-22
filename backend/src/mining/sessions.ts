/**
 * Daily mining sessions: the user taps "Start mining" once per local day.
 * Claims need today's session; paid miners earn without one.
 */
import type { Types } from "mongoose";
import { Session } from "../models/index.js";
import { localDate, nextLocalMidnight } from "../lib/time.js";
import { loadUserTimezone } from "../users/timezone.js";
import { ensureBalance } from "../wallet/balances.js";

/** Starts today's session, or returns it if already started (idempotent). */
export async function startSession(userId: Types.ObjectId, now = Date.now()) {
  const tz = await loadUserTimezone(userId, now);
  const day = localDate(now, tz);
  await ensureBalance(userId, now);
  return Session.findOneAndUpdate(
    { userId, localDate: day },
    {
      $setOnInsert: {
        userId,
        localDate: day,
        tz,
        startedAt: new Date(now),
        endsAt: new Date(nextLocalMidnight(now, tz)),
        claimCounts: {},
      },
    },
    { upsert: true, returnDocument: "after", lean: true },
  );
}

/** Today's session if the user has started one and it hasn't ended. */
export async function currentSession(userId: Types.ObjectId, now = Date.now()) {
  const tz = await loadUserTimezone(userId, now);
  const s = await Session.findOne({ userId, localDate: localDate(now, tz) }).lean();
  return s && s.endsAt.getTime() > now ? s : null;
}

/** Verified claims today on a track. Lean reads return the Map as a plain object. */
export function claimCount(session: { claimCounts?: unknown } | null | undefined, track: string): number {
  const c = session?.claimCounts;
  if (!c) return 0;
  if (c instanceof Map) return c.get(track) ?? 0;
  return (c as Record<string, number>)[track] ?? 0;
}
