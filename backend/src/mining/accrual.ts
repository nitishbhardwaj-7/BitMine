/**
 * The accrual engine: how much a user earned over a time window.
 *
 * Pure functions only: no database, no clock. The worker feeds in the user's
 * miners, the rate schedule and (when the daily-start rule is on) the windows
 * in which the user's mining was switched on, and persists the result (see
 * docs/TECHNICAL_SPEC.md §5). Everything is epoch milliseconds; amounts are
 * millisatoshis.
 *
 * Unlike BitPlay, nothing here depends on the app having been open or on any
 * value the app sent: earnings are a function of hashpower over time alone.
 */

import { MS_PER_DAY } from "../lib/time.js";

export interface MinerSpan {
  gh: number;
  startAt: number;
  endAt: number;
  /** A refunded miner stops earning here, even if endAt is later. */
  revokedAt?: number | null;
}

export interface RatePeriod {
  effectiveAt: number;
  rateMsatPerGhDay: number;
  /**
   * Daily-start rule: from this period on, hashpower earns only inside a
   * mining window (a day's session, from the moment it was started until
   * local midnight). Periods without it earn around the clock.
   */
  gated?: boolean;
}

/** A stretch of time in which the user's mining is switched on: [start, end). */
export interface MiningWindow {
  start: number;
  end: number;
}

function effectiveEnd(m: MinerSpan): number {
  return m.revokedAt != null ? Math.min(m.endAt, m.revokedAt) : m.endAt;
}

/** Period in force at instant t (latest period with effectiveAt <= t). `schedule` must be sorted. */
function periodAt(schedule: RatePeriod[], t: number): RatePeriod | undefined {
  let found: RatePeriod | undefined;
  for (const p of schedule) {
    if (p.effectiveAt <= t) found = p;
    else break;
  }
  return found;
}

const inWindow = (windows: MiningWindow[], t: number) => windows.some((w) => w.start <= t && t < w.end);

const sorted = (schedule: RatePeriod[]) => [...schedule].sort((a, b) => a.effectiveAt - b.effectiveAt);

/** Whether the daily-start rule is in force at t. */
export function isGatedAt(schedule: RatePeriod[], t: number): boolean {
  return Boolean(periodAt(sorted(schedule), t)?.gated);
}

/**
 * Exact (fractional) msat earned over [t0, t1). The window is split at every
 * point where total hashpower, the rate or the on/off state changes, and each
 * piece is integrated as constant.
 */
export function earnedMsat(miners: MinerSpan[], schedule: RatePeriod[], t0: number, t1: number, windows: MiningWindow[] = []): number {
  if (t1 <= t0) return 0;
  const rates = sorted(schedule);

  const cuts = new Set<number>([t0, t1]);
  const add = (t: number) => {
    if (t > t0 && t < t1) cuts.add(t);
  };
  for (const m of miners) {
    add(m.startAt);
    add(effectiveEnd(m));
  }
  for (const p of rates) add(p.effectiveAt);
  for (const w of windows) {
    add(w.start);
    add(w.end);
  }
  const points = [...cuts].sort((a, b) => a - b);

  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const period = periodAt(rates, a);
    if (!period || (period.gated && !inWindow(windows, a))) continue;
    let gh = 0;
    for (const m of miners) {
      if (m.startAt <= a && a < effectiveEnd(m)) gh += m.gh;
    }
    if (gh > 0) total += (gh * period.rateMsatPerGhDay * (b - a)) / MS_PER_DAY;
  }
  return total;
}

/** Instantaneous earning speed at t, in msat per second (for the live counter). */
export function msatPerSecondAt(miners: MinerSpan[], schedule: RatePeriod[], t: number, windows: MiningWindow[] = []): number {
  const period = periodAt(sorted(schedule), t);
  if (!period || (period.gated && !inWindow(windows, t))) return 0;
  let gh = 0;
  for (const m of miners) if (m.startAt <= t && t < effectiveEnd(m)) gh += m.gh;
  return (gh * period.rateMsatPerGhDay) / 86_400;
}

/**
 * Turns a fractional amount into a whole-msat credit, carrying the leftover
 * fraction forward so nothing is lost or invented across many small credits.
 */
export function toWholeMsat(exact: number, carriedRemainder: number): { creditMsat: number; remainder: number } {
  const total = exact + carriedRemainder;
  const creditMsat = Math.floor(total + 1e-9);
  return { creditMsat, remainder: Math.max(0, total - creditMsat) };
}
