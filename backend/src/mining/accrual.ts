/**
 * The accrual engine: how much a user earned over a time window.
 *
 * Pure functions only: no database, no clock. The worker feeds in the user's
 * miners and the rate schedule, and persists the result (see
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
}

function effectiveEnd(m: MinerSpan): number {
  return m.revokedAt != null ? Math.min(m.endAt, m.revokedAt) : m.endAt;
}

/** Rate in force at instant t (latest period with effectiveAt <= t). */
function rateAt(schedule: RatePeriod[], t: number): number {
  let rate = 0;
  for (const p of schedule) {
    if (p.effectiveAt <= t) rate = p.rateMsatPerGhDay;
    else break;
  }
  return rate;
}

/**
 * Exact (fractional) msat earned over [t0, t1). The window is split at every
 * point where either total hashpower or the rate changes, and each piece is
 * integrated as constant.
 */
export function earnedMsat(miners: MinerSpan[], schedule: RatePeriod[], t0: number, t1: number): number {
  if (t1 <= t0) return 0;
  const rates = [...schedule].sort((a, b) => a.effectiveAt - b.effectiveAt);

  const cuts = new Set<number>([t0, t1]);
  for (const m of miners) {
    for (const t of [m.startAt, effectiveEnd(m)]) if (t > t0 && t < t1) cuts.add(t);
  }
  for (const p of rates) if (p.effectiveAt > t0 && p.effectiveAt < t1) cuts.add(p.effectiveAt);
  const points = [...cuts].sort((a, b) => a - b);

  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    let gh = 0;
    for (const m of miners) {
      if (m.startAt <= a && a < effectiveEnd(m)) gh += m.gh;
    }
    if (gh > 0) total += (gh * rateAt(rates, a) * (b - a)) / MS_PER_DAY;
  }
  return total;
}

/** Instantaneous earning speed at t, in msat per second (for the live counter). */
export function msatPerSecondAt(miners: MinerSpan[], schedule: RatePeriod[], t: number): number {
  const rates = [...schedule].sort((a, b) => a.effectiveAt - b.effectiveAt);
  let gh = 0;
  for (const m of miners) if (m.startAt <= t && t < effectiveEnd(m)) gh += m.gh;
  return (gh * rateAt(rates, t)) / 86_400;
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
