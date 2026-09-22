import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { Balance, Ledger, Miner } from "../models/index.js";
import { clearTestDb, startTestDb, stopTestDb } from "../test/mongo.js";
import { seedEconomics, publishEconomics } from "../settings/economics.js";
import { DEFAULT_ECONOMICS } from "../config/economics.js";
import { ensureBalance } from "../wallet/balances.js";
import { MS_PER_DAY, MS_PER_HOUR, nextLocalMidnight } from "../lib/time.js";
import { earnedMsat } from "./accrual.js";
import { runAccrual } from "./accrualJob.js";

const T0 = Date.parse("2026-10-01T00:00:00Z");
const RATE = [{ effectiveAt: 0, rateMsatPerGhDay: 48 }];

beforeAll(startTestDb, 180_000);
afterAll(stopTestDb);
beforeEach(async () => {
  await clearTestDb();
  await seedEconomics();
});

async function newUser(at = T0) {
  const userId = new Types.ObjectId();
  await ensureBalance(userId, at);
  return userId;
}

async function balance(userId: Types.ObjectId) {
  return (await Balance.findOne({ userId }).lean())!;
}

async function ledgerSum(userId: Types.ObjectId) {
  const rows = await Ledger.find({ userId, bucket: "available" }).lean();
  return rows.reduce((s, r) => s + r.amountMsat, 0);
}

describe("runAccrual", () => {
  it("credits a Titan hour by hour with no app involvement", async () => {
    const userId = await newUser();
    await Miner.create({ userId, source: "paid", gh: 2000, startAt: new Date(T0 + 30 * 60_000), endAt: new Date(T0 + 180 * MS_PER_DAY) });

    await runAccrual({ now: T0 + 25 * MS_PER_HOUR + 10 * 60_000 });

    const b = await balance(userId);
    expect(b.availableMsat).toBe(98_000); // 2000 GH/s × 48 msat/day × 24.5 h
    expect(b.lifetimeMinedMsat).toBe(98_000);
    expect(b.accruedUntil!.getTime()).toBe(T0 + 25 * MS_PER_HOUR);
    expect(await Ledger.countDocuments({ userId, type: "mining" })).toBe(25);
    expect(await ledgerSum(userId)).toBe(b.availableMsat);
  });

  it("is idempotent: re-running the same hour credits nothing", async () => {
    const userId = await newUser();
    await Miner.create({ userId, source: "paid", gh: 360, startAt: new Date(T0), endAt: new Date(T0 + 180 * MS_PER_DAY) });

    const now = T0 + 10 * MS_PER_HOUR;
    await runAccrual({ now });
    const first = await balance(userId);
    const again = await runAccrual({ now });

    expect(again.usersProcessed).toBe(0);
    expect((await balance(userId)).availableMsat).toBe(first.availableMsat);
    expect(await Ledger.countDocuments({ userId })).toBe(10);
  });

  it("two workers running at once credit each hour exactly once", async () => {
    const users = await Promise.all(Array.from({ length: 20 }, () => newUser()));
    await Miner.insertMany(
      users.map((userId) => ({ userId, source: "paid", gh: 760, startAt: new Date(T0), endAt: new Date(T0 + 180 * MS_PER_DAY) })),
    );

    const now = T0 + 6 * MS_PER_HOUR;
    await Promise.all([runAccrual({ now }), runAccrual({ now }), runAccrual({ now })]);

    for (const userId of users) {
      const b = await balance(userId);
      expect(b.availableMsat).toBe(760 * 48 * 6 / 24); // 9,120 msat
      expect(await Ledger.countDocuments({ userId })).toBe(6);
    }
  });

  it("credits claims up to local midnight even if the app was closed all day", async () => {
    const tz = "Asia/Kolkata";
    const userId = await newUser(T0);
    const claimTimes = [T0 + 2 * MS_PER_HOUR + 123_000, T0 + 9 * MS_PER_HOUR + 45_000, T0 + 17 * MS_PER_HOUR];
    const spans = claimTimes.map((t) => ({ gh: 5.5, startAt: t, endAt: nextLocalMidnight(t, tz) }));
    await Miner.insertMany(
      spans.map((s) => ({ userId, source: "claim", gh: s.gh, startAt: new Date(s.startAt), endAt: new Date(s.endAt) })),
    );

    await runAccrual({ now: T0 + 2 * MS_PER_DAY });

    const exact = earnedMsat(spans, RATE, T0, T0 + 2 * MS_PER_DAY);
    const b = await balance(userId);
    expect(exact - b.availableMsat).toBeGreaterThanOrEqual(0);
    expect(exact - b.availableMsat).toBeLessThan(1);
    expect(b.availableMsat + b.accrualRemainder!).toBeCloseTo(exact, 6);
  });

  it("applies a rate change only from its effective time", async () => {
    const userId = await newUser();
    await Miner.create({ userId, source: "paid", gh: 2000, startAt: new Date(T0), endAt: new Date(T0 + 180 * MS_PER_DAY) });
    await publishEconomics({ ...DEFAULT_ECONOMICS, rateMsatPerGhDay: 24 }, new Date(T0 + 12 * MS_PER_HOUR), undefined, new Date(T0));

    await runAccrual({ now: T0 + MS_PER_DAY });

    expect((await balance(userId)).availableMsat).toBe(48_000 + 24_000);
  });

  it("stops a refunded miner at revokedAt", async () => {
    const userId = await newUser();
    await Miner.create({
      userId, source: "paid", gh: 1000, status: "revoked",
      startAt: new Date(T0), endAt: new Date(T0 + 180 * MS_PER_DAY), revokedAt: new Date(T0 + 3 * MS_PER_HOUR),
    });

    await runAccrual({ now: T0 + MS_PER_DAY });

    expect((await balance(userId)).availableMsat).toBe(1000 * 48 * 3 / 24); // 6,000
  });

  it("advances users with no miners without writing ledger entries", async () => {
    const userId = await newUser();
    await runAccrual({ now: T0 + 5 * MS_PER_HOUR });
    const b = await balance(userId);
    expect(b.accruedUntil!.getTime()).toBe(T0 + 5 * MS_PER_HOUR);
    expect(b.availableMsat).toBe(0);
    expect(await Ledger.countDocuments({ userId })).toBe(0);
  });

  it("catches up after long downtime in bounded runs", async () => {
    const userId = await newUser();
    await Miner.create({ userId, source: "paid", gh: 170, startAt: new Date(T0), endAt: new Date(T0 + 180 * MS_PER_DAY) });

    const now = T0 + 20 * MS_PER_DAY;
    await runAccrual({ now });
    expect((await balance(userId)).accruedUntil!.getTime()).toBe(T0 + 14 * MS_PER_DAY);
    await runAccrual({ now });

    const b = await balance(userId);
    expect(b.accruedUntil!.getTime()).toBe(now);
    expect(b.availableMsat).toBe(170 * 48 * 20); // 163,200
    expect(await ledgerSum(userId)).toBe(b.availableMsat);
  });

  it("fails closed when no economics settings exist", async () => {
    await clearTestDb();
    await expect(runAccrual({ now: T0 })).rejects.toThrow(/No economics settings/);
  });
});
