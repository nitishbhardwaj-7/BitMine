/**
 * Boost videos: one rewarded video doubles the hashpower the user has running
 * right now (capped) for a short while; a video watched while a boost is
 * running adds the same time on after it. It is granted like any ad claim
 * (claims/service.ts, kind "boost") as a miner that ends when the boost does.
 */
import type { Types } from "mongoose";
import { Miner } from "../models/index.js";
import type { GrowthSettings } from "../settings/growth.js";

export const BOOST_TRACK = "boost";

/** Hashpower a boost started now would add: what is running (boosts excluded), up to the limit. */
export async function boostGhFor(userId: Types.ObjectId, now: number, g: GrowthSettings): Promise<number> {
  const rows = await Miner.find({ userId, source: { $ne: "boost" }, revokedAt: null, startAt: { $lte: new Date(now) }, endAt: { $gt: new Date(now) } })
    .select({ gh: 1 })
    .lean();
  const running = rows.reduce((sum, m) => sum + m.gh, 0);
  return Math.round(Math.min(g.boostMaxGh, running) * 10) / 10;
}

/** When the user's running boost ends, or null if none is running. */
export async function activeBoostUntil(userId: Types.ObjectId, now: number): Promise<number | null> {
  const m = await Miner.findOne({ userId, source: "boost", revokedAt: null, endAt: { $gt: new Date(now) } }).sort({ endAt: -1 }).select({ endAt: 1 }).lean();
  return m ? m.endAt.getTime() : null;
}
