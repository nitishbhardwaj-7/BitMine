import { User } from "../models/index.js";
import { notFound } from "../lib/errors.js";

interface TzFields {
  timezone: string;
  timezonePending?: { tz?: string | null; effectiveAt?: Date | null } | null;
}

/**
 * The timezone that decides the user's "local day" at `now`. A requested
 * change only applies from its effectiveAt (the next local midnight in the old
 * zone), so switching zones can't be used to reset daily claims early.
 */
export function effectiveTimezone(user: TzFields, now: number): string {
  const p = user.timezonePending;
  if (p?.tz && p.effectiveAt && now >= p.effectiveAt.getTime()) return p.tz;
  return user.timezone;
}

export async function loadUserTimezone(userId: unknown, now: number): Promise<string> {
  const user = await User.findById(userId).select({ timezone: 1, timezonePending: 1 }).lean();
  if (!user) throw notFound("User");
  return effectiveTimezone(user, now);
}
