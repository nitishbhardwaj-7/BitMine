import { describe, expect, it } from "vitest";
import { earnedMsat, msatPerSecondAt, toWholeMsat, type MinerSpan, type RatePeriod } from "./accrual.js";
import { MS_PER_DAY, MS_PER_HOUR, nextLocalMidnight } from "../lib/time.js";
import { DEFAULT_ECONOMICS, PRODUCT_SEEDS, fastestSinglePackDays } from "../config/economics.js";

const RATE: RatePeriod[] = [{ effectiveAt: 0, rateMsatPerGhDay: 48 }];
const T0 = Date.parse("2026-10-01T00:00:00Z");

describe("earnedMsat", () => {
  it("Titan over its full 180 days pays exactly 17,280 sats", () => {
    const titan: MinerSpan = { gh: 2000, startAt: T0, endAt: T0 + 180 * MS_PER_DAY };
    // Window wider than the miner on both sides: nothing before start or after end.
    expect(earnedMsat([titan], RATE, T0 - MS_PER_DAY, T0 + 200 * MS_PER_DAY)).toBeCloseTo(17_280_000, 6);
  });

  it("a claim made at 23:30 IST mines exactly 30 minutes", () => {
    const claimAt = Date.parse("2026-09-22T18:00:00Z"); // 23:30 IST
    const claim: MinerSpan = { gh: 5.5, startAt: claimAt, endAt: nextLocalMidnight(claimAt, "Asia/Kolkata") };
    const expected = (5.5 * 48 * 30) / (24 * 60); // 5.5 msat
    expect(earnedMsat([claim], RATE, claimAt - MS_PER_HOUR, claimAt + 2 * MS_PER_HOUR)).toBeCloseTo(expected, 9);
  });

  it("claims on the 23-hour DST day mine 23 hours at most", () => {
    const start = Date.parse("2026-03-08T05:00:00Z"); // 00:00 EST
    const claim: MinerSpan = { gh: 10, startAt: start, endAt: nextLocalMidnight(start, "America/New_York") };
    expect(earnedMsat([claim], RATE, start, start + 2 * MS_PER_DAY)).toBeCloseTo((10 * 48 * 23) / 24, 9);
  });

  it("splits a mid-hour rate change", () => {
    const miner: MinerSpan = { gh: 1000, startAt: T0, endAt: T0 + MS_PER_DAY };
    const schedule: RatePeriod[] = [
      { effectiveAt: 0, rateMsatPerGhDay: 48 },
      { effectiveAt: T0 + 30 * 60_000, rateMsatPerGhDay: 24 },
    ];
    const expected = (1000 * 48 * 0.5) / 24 + (1000 * 24 * 0.5) / 24;
    expect(earnedMsat([miner], schedule, T0, T0 + MS_PER_HOUR)).toBeCloseTo(expected, 9);
  });

  it("a revoked (refunded) miner stops earning at revokedAt", () => {
    const miner: MinerSpan = { gh: 760, startAt: T0, endAt: T0 + 180 * MS_PER_DAY, revokedAt: T0 + 10 * MS_PER_DAY };
    expect(earnedMsat([miner], RATE, T0, T0 + 180 * MS_PER_DAY)).toBeCloseTo(760 * 48 * 10, 6);
  });

  it("stacked miners add up", () => {
    const a: MinerSpan = { gh: 2000, startAt: T0, endAt: T0 + 180 * MS_PER_DAY };
    const b: MinerSpan = { gh: 2000, startAt: T0, endAt: T0 + 180 * MS_PER_DAY };
    expect(earnedMsat([a, b], RATE, T0, T0 + MS_PER_DAY)).toBeCloseTo(2 * 2000 * 48, 6);
  });

  it("returns 0 for empty or inverted windows", () => {
    const m: MinerSpan = { gh: 100, startAt: T0, endAt: T0 + MS_PER_DAY };
    expect(earnedMsat([m], RATE, T0 + 5, T0 + 5)).toBe(0);
    expect(earnedMsat([m], RATE, T0 + 10, T0)).toBe(0);
    expect(earnedMsat([], RATE, T0, T0 + MS_PER_DAY)).toBe(0);
  });
});

describe("hourly crediting", () => {
  it("summing whole-msat hourly credits over 30 days matches the exact total within 1 msat", () => {
    // Messy mix: a paid miner, claims at odd times, a refund, a rate change.
    const tz = "Asia/Kolkata";
    const miners: MinerSpan[] = [{ gh: 170, startAt: T0 + 1234567, endAt: T0 + 180 * MS_PER_DAY }];
    for (let d = 0; d < 30; d++) {
      for (let k = 0; k < 60; k++) {
        const at = T0 + d * MS_PER_DAY + k * 1_370_000 + 7_777;
        miners.push({ gh: 5.5, startAt: at, endAt: nextLocalMidnight(at, tz) });
      }
    }
    miners.push({ gh: 360, startAt: T0 + 3 * MS_PER_DAY, endAt: T0 + 183 * MS_PER_DAY, revokedAt: T0 + 9.3 * MS_PER_DAY });
    const schedule: RatePeriod[] = [
      { effectiveAt: 0, rateMsatPerGhDay: 48 },
      { effectiveAt: T0 + 17.4 * MS_PER_DAY, rateMsatPerGhDay: 40 },
    ];

    const end = T0 + 30 * MS_PER_DAY;
    let credited = 0;
    let remainder = 0;
    for (let h = T0; h < end; h += MS_PER_HOUR) {
      const r = toWholeMsat(earnedMsat(miners, schedule, h, h + MS_PER_HOUR), remainder);
      credited += r.creditMsat;
      remainder = r.remainder;
      expect(Number.isInteger(r.creditMsat)).toBe(true);
    }
    const exact = earnedMsat(miners, schedule, T0, end);
    expect(Math.abs(credited + remainder - exact)).toBeLessThan(1e-3);
    expect(exact - credited).toBeGreaterThanOrEqual(0);
    expect(exact - credited).toBeLessThan(1);
  });
});

describe("msatPerSecondAt", () => {
  it("matches the daily rate", () => {
    const m: MinerSpan = { gh: 2000, startAt: T0, endAt: T0 + MS_PER_DAY };
    expect(msatPerSecondAt([m], RATE, T0 + 1000) * 86_400).toBeCloseTo(96_000, 6);
    expect(msatPerSecondAt([m], RATE, T0 + MS_PER_DAY)).toBe(0);
  });
});

describe("15-day guard", () => {
  it("the launch catalog keeps a single Titan + all claims + Super Miner Max at 15 days or more", () => {
    const days = fastestSinglePackDays(DEFAULT_ECONOMICS, PRODUCT_SEEDS);
    expect(days).toBeGreaterThanOrEqual(15);
    expect(days).toBeCloseTo(15.64, 2);
  });
});
