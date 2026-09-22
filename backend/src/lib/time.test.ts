import { describe, expect, it } from "vitest";
import { isValidTimeZone, localDate, nextLocalMidnight } from "./time.js";

const iso = (s: string) => Date.parse(s);

describe("localDate", () => {
  it("uses the user's zone, not UTC", () => {
    // 20:00 UTC on the 22nd is already the 23rd in India.
    expect(localDate(iso("2026-09-22T20:00:00Z"), "Asia/Kolkata")).toBe("2026-09-23");
    expect(localDate(iso("2026-09-22T20:00:00Z"), "America/Los_Angeles")).toBe("2026-09-22");
  });
});

describe("nextLocalMidnight", () => {
  it("handles half-hour offsets (IST, UTC+5:30)", () => {
    // 23:30 IST on 22 Sep = 18:00 UTC; midnight IST = 18:30 UTC.
    expect(nextLocalMidnight(iso("2026-09-22T18:00:00Z"), "Asia/Kolkata")).toBe(iso("2026-09-22T18:30:00Z"));
  });

  it("returns the next day when called exactly at midnight", () => {
    const midnight = iso("2026-09-22T18:30:00Z"); // 00:00 IST on the 23rd
    expect(nextLocalMidnight(midnight, "Asia/Kolkata")).toBe(iso("2026-09-23T18:30:00Z"));
  });

  it("handles the US spring-forward day (23-hour day)", () => {
    // 2026-03-08 is DST start in New York: midnight EST = 05:00Z, next midnight EDT = 04:00Z on the 9th.
    const t = iso("2026-03-08T06:00:00Z"); // 01:00 EST
    expect(nextLocalMidnight(t, "America/New_York")).toBe(iso("2026-03-09T04:00:00Z"));
  });

  it("handles the US fall-back day (25-hour day)", () => {
    // 2026-11-01 is DST end: the day runs 04:00Z (EDT midnight) to 05:00Z on the 2nd (EST midnight).
    const t = iso("2026-11-01T12:00:00Z");
    expect(nextLocalMidnight(t, "America/New_York")).toBe(iso("2026-11-02T05:00:00Z"));
  });

  it("handles zones where midnight itself is skipped", () => {
    // Chile springs forward at 00:00 -> 01:00 local on 2026-09-06, so that day starts at 01:00 (-03:00).
    const t = iso("2026-09-05T20:00:00Z"); // 16:00 on the 5th, -04:00
    const m = nextLocalMidnight(t, "America/Santiago");
    expect(localDate(m, "America/Santiago")).toBe("2026-09-06");
    expect(localDate(m - 1, "America/Santiago")).toBe("2026-09-05");
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA names and rejects junk", () => {
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});
