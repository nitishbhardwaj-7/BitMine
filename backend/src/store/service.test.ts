import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Balance, Ledger, Miner, Purchase, StoreSync, SuperEntitlement, User } from "../models/index.js";
import { clearTestDb, startTestDb, stopTestDb } from "../test/mongo.js";
import { createUser } from "../test/fixtures.js";
import { fakeRevenueCat } from "../test/revenuecat.js";
import { seedAll } from "../db/seed.js";
import { MS_PER_DAY, MS_PER_HOUR } from "../lib/time.js";
import { ensureBalance } from "../wallet/balances.js";
import { runAccrual } from "../mining/accrualJob.js";
import { refundTransaction, runStoreFollowUps, syncFromApp, syncUser } from "./service.js";

const NOW = Date.parse("2026-10-01T06:00:00Z");
const TITAN = "bitmine_miner_titan_monthly";
const PRO = "bitmine_super_pro";
const BASIC = "bitmine_super_basic";

beforeAll(startTestDb, 180_000);
afterAll(stopTestDb);
beforeEach(async () => {
  await clearTestDb();
  await seedAll();
});

describe("store", () => {
  it("a Titan purchase becomes a 2,000 GH/s miner for 30 days", async () => {
    const rc = fakeRevenueCat();
    const userId = await createUser();
    rc.buy(userId, TITAN, NOW - 5000);

    const r = await syncUser(userId, { revenueCat: rc.client, allowSandbox: false }, NOW);

    expect(r.granted).toHaveLength(1);
    const miner = await Miner.findOne({ userId, source: "paid" }).lean();
    expect(miner).toMatchObject({ gh: 2000 });
    expect(miner!.startAt.getTime()).toBe(NOW - 5000);
    expect(miner!.endAt.getTime()).toBe(NOW - 5000 + 30 * MS_PER_DAY);
  });

  it("syncing again, or the webhook and the app racing, grants once", async () => {
    const rc = fakeRevenueCat();
    const deps = { revenueCat: rc.client, allowSandbox: false };
    const userId = await createUser();
    rc.buy(userId, TITAN, NOW);

    await Promise.all([syncUser(userId, deps, NOW), syncUser(userId, deps, NOW), syncUser(userId, deps, NOW)]);
    const again = await syncUser(userId, deps, NOW + 1000);

    expect(again.alreadyGranted).toBe(1);
    expect(await Purchase.countDocuments({ userId })).toBe(1);
    expect(await Miner.countDocuments({ userId })).toBe(1);
  });

  it("packs stack with no cap", async () => {
    const rc = fakeRevenueCat();
    const userId = await createUser();
    rc.buy(userId, TITAN, NOW);
    rc.buy(userId, TITAN, NOW + 1000);
    rc.buy(userId, "bitmine_miner_mini_monthly", NOW + 2000);

    await syncUser(userId, { revenueCat: rc.client, allowSandbox: false }, NOW + 3000);

    const miners = await Miner.find({ userId }).lean();
    expect(miners.map((m) => m.gh).sort((a, b) => a - b)).toEqual([65, 2000, 2000]);
  });

  it("Super Miner tiers extend from the current expiry when bought again", async () => {
    const rc = fakeRevenueCat();
    const deps = { revenueCat: rc.client, allowSandbox: false };
    const userId = await createUser();

    rc.buy(userId, PRO, NOW);
    await syncUser(userId, deps, NOW);
    rc.buy(userId, PRO, NOW + 10 * MS_PER_DAY);
    await syncUser(userId, deps, NOW + 10 * MS_PER_DAY);
    rc.buy(userId, BASIC, NOW + 10 * MS_PER_DAY);
    await syncUser(userId, deps, NOW + 10 * MS_PER_DAY);

    const ents = await SuperEntitlement.find({ userId }).populate<{ productId: { sku: string } }>("productId").lean();
    const until = Object.fromEntries(ents.map((e) => [e.productId.sku, e.activeUntil.getTime()]));
    expect(until.super_pro).toBe(NOW + 2 * 365 * MS_PER_DAY); // 365 + 365, not restarted
    expect(until.super_basic).toBe(NOW + 10 * MS_PER_DAY + 30 * MS_PER_DAY);
  });

  it("refuses sandbox purchases unless ALLOW_SANDBOX is on", async () => {
    const rc = fakeRevenueCat();
    const userId = await createUser();
    rc.buy(userId, TITAN, NOW, { isSandbox: true });

    expect((await syncUser(userId, { revenueCat: rc.client, allowSandbox: false }, NOW)).skipped).toBe(1);
    expect(await Miner.countDocuments({ userId })).toBe(0);
    expect((await syncUser(userId, { revenueCat: rc.client, allowSandbox: true }, NOW)).granted).toHaveLength(1);
  });

  it("ignores products that aren't in the catalog", async () => {
    const rc = fakeRevenueCat();
    const userId = await createUser();
    rc.buy(userId, "com.bitplaypro.super_privilege_10000pct", NOW);
    expect((await syncUser(userId, { revenueCat: rc.client, allowSandbox: false }, NOW)).skipped).toBe(1);
    expect(await Purchase.countDocuments({})).toBe(0);
  });

  it("a late-processed purchase is credited for the hours already closed", async () => {
    const rc = fakeRevenueCat();
    const userId = await createUser();
    await ensureBalance(userId, NOW);
    await runAccrual({ now: NOW + 3 * MS_PER_HOUR }); // hours up to NOW+3h closed with nothing to credit

    // Bought at NOW + 30 min, but RevenueCat/webhook only got to us 3 hours later.
    rc.buy(userId, TITAN, NOW + 30 * 60_000);
    await syncUser(userId, { revenueCat: rc.client, allowSandbox: false }, NOW + 3 * MS_PER_HOUR + 5 * 60_000);
    await runAccrual({ now: NOW + 5 * MS_PER_HOUR });

    // 4.5 hours of a 2,000 GH/s miner = 2000 × 48 × 4.5 / 24 = 18,000 msat
    const b = await Balance.findOne({ userId }).lean();
    expect(b!.availableMsat).toBe(18_000);
    expect(await Ledger.countDocuments({ userId, idempotencyKey: /^mining-backfill:/ })).toBe(1);
  });

  it("a refund revokes the miner from now on and flags the account", async () => {
    const rc = fakeRevenueCat();
    const userId = await createUser();
    const t = rc.buy(userId, TITAN, NOW);
    await syncUser(userId, { revenueCat: rc.client, allowSandbox: false }, NOW);

    const refundAt = NOW + 2 * MS_PER_DAY;
    expect((await refundTransaction(t.storeTransactionId, refundAt)).status).toBe("refunded");
    expect((await refundTransaction(t.storeTransactionId, refundAt)).status).toBe("already_refunded");

    await runAccrual({ now: NOW + 10 * MS_PER_DAY });
    expect((await Balance.findOne({ userId }).lean())!.availableMsat).toBe(2000 * 48 * 2); // only the 2 days before the refund
    expect((await User.findById(userId).lean())!.reviewFlags).toHaveLength(1);
    expect((await Miner.findOne({ userId }).lean())!.status).toBe("revoked");
  });

  it("a refunded Super tier loses that purchase's time, never ending before now", async () => {
    const rc = fakeRevenueCat();
    const deps = { revenueCat: rc.client, allowSandbox: false };
    const userId = await createUser();
    rc.buy(userId, PRO, NOW);
    await syncUser(userId, deps, NOW);
    const second = rc.buy(userId, PRO, NOW + MS_PER_DAY);
    await syncUser(userId, deps, NOW + MS_PER_DAY);

    await refundTransaction(second.storeTransactionId, NOW + 2 * MS_PER_DAY);
    expect((await SuperEntitlement.findOne({ userId }).lean())!.activeUntil.getTime()).toBe(NOW + 365 * MS_PER_DAY);

    const onlyOne = await createUser();
    const t = rc.buy(onlyOne, PRO, NOW);
    await syncUser(onlyOne, deps, NOW);
    await refundTransaction(t.storeTransactionId, NOW + 3 * MS_PER_DAY);
    expect((await SuperEntitlement.findOne({ userId: onlyOne }).lean())!.activeUntil.getTime()).toBe(NOW + 3 * MS_PER_DAY);
  });

  it("schedules follow-up checks when RevenueCat hasn't seen the purchase yet", async () => {
    const rc = fakeRevenueCat();
    const deps = { revenueCat: rc.client, allowSandbox: false };
    const userId = await createUser();

    const first = await syncFromApp(userId, deps, NOW);
    expect(first.granted).toHaveLength(0);
    expect(await StoreSync.countDocuments({ userId })).toBe(3);

    rc.buy(userId, TITAN, NOW); // RevenueCat catches up
    await runStoreFollowUps(deps, NOW + 3 * 60_000);

    expect(await Miner.countDocuments({ userId })).toBe(1);
    expect(await StoreSync.countDocuments({ userId })).toBe(0); // remaining checks cancelled
  });

  it("fails closed without a RevenueCat key", async () => {
    const userId = await createUser();
    await expect(syncUser(userId, { allowSandbox: false }, NOW)).rejects.toMatchObject({ code: "store_unavailable" });
  });
});
