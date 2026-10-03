/**
 * Daily streak: consecutive local days on which the user started mining.
 * Every `streakDays`-th day in a row adds bonus hashpower until midnight
 * (settings/growth.ts). Recording is idempotent per local day.
 */
import type { Types } from "mongoose";
import { Miner, User } from "../models/index.js";
import { getGrowth, type GrowthSettings } from "../settings/growth.js";

/** The calendar day before a YYYY-MM-DD date. */
export function previousDate(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** Called when a day's session becomes active. Counts the day once and grants the bonus when due. */
export async function recordStreak(userId: Types.ObjectId, session: { localDate: string; endsAt: Date }, now = Date.now()) {
  const g = await getGrowth();
  if (g.streakDays <= 0) return null;
  const user = await User.findOneAndUpdate(
    { _id: userId, "streak.lastDate": { $ne: session.localDate } },
    [
      {
        $set: {
          "streak.count": {
            $cond: [{ $eq: ["$streak.lastDate", previousDate(session.localDate)] }, { $add: [{ $ifNull: ["$streak.count", 0] }, 1] }, 1],
          },
          "streak.lastDate": session.localDate,
        },
      },
    ],
    { returnDocument: "after", updatePipeline: true },
  )
    .select({ streak: 1 })
    .lean();
  if (!user) return null; // already counted today
  const count = user.streak?.count ?? 1;
  const bonus = count % g.streakDays === 0 && g.streakBonusGh > 0 && session.endsAt.getTime() > now;
  if (bonus) {
    await Miner.create({ userId, source: "streak", gh: g.streakBonusGh, startAt: new Date(now), endAt: session.endsAt });
  }
  return { count, bonus };
}

/** What the app shows. A streak not continued yesterday or today counts as broken. */
export function streakView(streak: { count?: number | null; lastDate?: string | null } | null | undefined, today: string, g: GrowthSettings) {
  if (g.streakDays <= 0) return null;
  const alive = streak?.lastDate === today || streak?.lastDate === previousDate(today);
  const count = alive ? (streak?.count ?? 0) : 0;
  const doneToday = streak?.lastDate === today;
  // Days in the current cycle, counting today once it is started.
  const inCycle = count % g.streakDays === 0 && count > 0 && doneToday ? g.streakDays : count % g.streakDays;
  return { count, doneToday, target: g.streakDays, progress: inCycle, bonusGh: g.streakBonusGh, bonusToday: doneToday && count > 0 && count % g.streakDays === 0 };
}
