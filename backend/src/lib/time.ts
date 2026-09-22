/**
 * Timezone helpers. All instants are epoch milliseconds (UTC). A user's
 * "local day" and "local midnight" are always derived here from their stored
 * IANA timezone, never from a client-supplied clock or date string (BitPlay
 * parsed "DD/MM/YYYY, hh:mm AM" strings from the app, see BITPLAY_BUG_AUDIT).
 */

export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(instant: number, timeZone: string): LocalParts {
  const out: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(instant))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour!,
    minute: out.minute!,
    second: out.second!,
  };
}

/** Local calendar date as "YYYY-MM-DD". */
export function localDate(instant: number, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Offset of local wall-clock time from UTC at `instant`, in ms (IST = +19,800,000). */
function offsetAt(instant: number, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * First instant of the next local calendar day after `instant`. Handles DST,
 * half-hour zones and zones where midnight itself is skipped (the day then
 * starts at the first instant that exists).
 */
export function nextLocalMidnight(instant: number, timeZone: string): number {
  const today = localDate(instant, timeZone);
  const p = localParts(instant, timeZone);
  const wallMidnight = Date.UTC(p.year, p.month - 1, p.day + 1);

  // Convert the wall-clock midnight to UTC; refine once in case the offset
  // differs on the other side of a DST change.
  let guess = wallMidnight - offsetAt(instant, timeZone);
  guess = wallMidnight - offsetAt(guess, timeZone);

  if (localDate(guess, timeZone) !== today && localDate(guess - 1, timeZone) === today) {
    return guess;
  }

  // Fallback: binary search the first ms whose local date is not `today`.
  let lo = instant + 1;
  let hi = instant + 2 * MS_PER_DAY;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDate(mid, timeZone) === today) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Start of the UTC hour containing `instant`. */
export function floorHour(instant: number): number {
  return Math.floor(instant / MS_PER_HOUR) * MS_PER_HOUR;
}
