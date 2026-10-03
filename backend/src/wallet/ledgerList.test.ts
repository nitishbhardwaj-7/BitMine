/** The transactions list shows mining as one total per local day. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Types } from "mongoose";
import { Ledger } from "../models/index.js";
import { clearTestDb, startTestDb, stopTestDb } from "../test/mongo.js";
import { createUser } from "../test/fixtures.js";
import { seedAll } from "../db/seed.js";
import { MS_PER_DAY, MS_PER_HOUR } from "../lib/time.js";
import { listLedger } from "./wallet.js";

// 2026-10-20 00:00 in India (UTC+5:30).
const IST_MIDNIGHT = Date.parse("2026-10-19T18:30:00Z");

beforeAll(startTestDb, 180_000);
afterAll(stopTestDb);
beforeEach(async () => {
  await clearTestDb();
  await seedAll();
});

let n = 0;
const hour = (userId: Types.ObjectId, hourStart: number, msat: number) =>
  Ledger.create({ userId, type: "mining", amountMsat: msat, bucket: "available", idempotencyKey: `t-${++n}`, meta: { hourStart: new Date(hourStart) }, createdAt: new Date(hourStart + MS_PER_HOUR + 60_000) });

describe("transactions list", () => {
  it("adds a day's hourly mining into one line, by the user's local day", async () => {
    const userId = await createUser("Asia/Kolkata");
    // Three hours on the 19th (the last one credited after midnight), two on the 20th.
    await hour(userId, IST_MIDNIGHT - 3 * MS_PER_HOUR, 4000);
    await hour(userId, IST_MIDNIGHT - 2 * MS_PER_HOUR, 4000);
    await hour(userId, IST_MIDNIGHT - MS_PER_HOUR, 4500);
    await Ledger.create({ userId, type: "withdrawal_lock", amountMsat: -3_000_000, bucket: "available", idempotencyKey: `t-${++n}` });
    await hour(userId, IST_MIDNIGHT + 9 * MS_PER_HOUR, 5000);
    await hour(userId, IST_MIDNIGHT + 10 * MS_PER_HOUR, 5500);

    const { entries, nextCursor } = await listLedger(userId, undefined, IST_MIDNIGHT + 12 * MS_PER_HOUR);
    expect(nextCursor).toBeNull();
    expect(entries.map((e) => [e.label, e.day ?? null, e.amountMsat])).toEqual([
      ["Mining", "2026-10-20", 10_500],
      ["Withdrawal requested", null, -3_000_000],
      ["Mining", "2026-10-19", 12_500],
    ]);
  });

  it("never splits a day across pages", async () => {
    const userId = await createUser("UTC");
    const start = Date.parse("2026-09-01T00:00:00Z");
    // 40 days × 24 hours = 960 hourly credits: more than one page of raw rows.
    await Ledger.insertMany(
      Array.from({ length: 960 }, (_, i) => ({ userId, type: "mining", amountMsat: 1000, bucket: "available", idempotencyKey: `bulk-${i}`, meta: { hourStart: new Date(start + i * MS_PER_HOUR) } })),
    );
    const now = start + 41 * MS_PER_DAY;
    const first = await listLedger(userId, undefined, now);
    const second = await listLedger(userId, first.nextCursor!, now);
    expect(second.nextCursor).toBeNull();
    const all = [...first.entries, ...second.entries];
    expect(all).toHaveLength(40);
    expect(new Set(all.map((e) => e.day)).size).toBe(40);
    expect(all.every((e) => e.amountMsat === 24_000)).toBe(true);
  });
});
