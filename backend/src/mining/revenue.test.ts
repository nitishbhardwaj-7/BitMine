/**
 * The revenue features around the core economics: the paid-miner perk, daily
 * streaks, boost videos, the starter bundle, subscription periods and the
 * renewal reminders.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Types } from "mongoose";
import { AppConfig, Miner, Notification, Product, Purchase, SuperEntitlement, User } from "../models/index.js";
import { clearTestDb, startTestDb, stopTestDb } from "../test/mongo.js";
import { createUser } from "../test/fixtures.js";
import { fakeRevenueCat } from "../test/revenuecat.js";
import { seedAll } from "../db/seed.js";
import { AppError } from "../lib/errors.js";
import { MS_PER_DAY, MS_PER_HOUR } from "../lib/time.js";
import { DEFAULT_ECONOMICS } from "../config/economics.js";
import { publishEconomics } from "../settings/economics.js";
import { createClaimIntent, verifySsvReward } from "../claims/service.js";
import { refundTransaction, syncUser } from "../store/service.js";
import { runReminders } from "../notifications/jobs.js";
import { getMiningStatus } from "./status.js";
import { sessionView, startSession } from "./sessions.js";

const DAY = Date.parse("2026-10-20T00:00:00Z");
const NOON = DAY + 12 * MS_PER_HOUR;

beforeAll(startTestDb, 180_000);
afterAll(stopTestDb);
beforeEach(async () => {
  await clearTestDb();
  await seedAll();
});

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e) => e instanceof AppError && e.code === code);
}
const enableRule = (startAds: number) =>
  publishEconomics({ ...DEFAULT_ECONOMICS, dailyStartRequired: true, startAds }, new Date(DAY - MS_PER_DAY), undefined, new Date(DAY - MS_PER_DAY - 1000));
let tx = 0;
const confirm = (userId: unknown, claimId: string, now: number) =>
  verifySsvReward({ keyId: "k", customData: claimId, userId: String(userId), transactionId: `rev-${++tx}` }, now);
const paidMiner = (userId: Types.ObjectId, gh = 360) =>
  Miner.create({ userId, source: "paid", gh, startAt: new Date(DAY - MS_PER_DAY), endAt: new Date(DAY + 20 * MS_PER_DAY) });

describe("paid-miner perk", () => {
  it("owners of a paid miner start the day with one tap; everyone else watches", async () => {
    await enableRule(2);
    const free = await createUser("UTC");
    const payer = await createUser("UTC");
    await paidMiner(payer);

    expect((await getMiningStatus(free, NOON)).startAdsRequired).toBe(2);
    expect((await getMiningStatus(payer, NOON)).startAdsRequired).toBe(0);
    expect(sessionView(await startSession(free, NOON), NOON)).toMatchObject({ active: false, adsRequired: 2 });
    expect(sessionView(await startSession(payer, NOON), NOON)).toMatchObject({ active: true, adsRequired: 0 });
  });

  it("can be switched off", async () => {
    await enableRule(2);
    await AppConfig.updateOne({ _id: "app" }, { $set: { "growth.paidSkipStartAds": false } });
    const payer = await createUser("UTC");
    await paidMiner(payer);
    expect(sessionView(await startSession(payer, NOON), NOON)).toMatchObject({ active: false, adsRequired: 2 });
  });
});

describe("daily streak", () => {
  it("counts consecutive days once each and pays the bonus on the 7th", async () => {
    const userId = await createUser("UTC");
    for (let d = 0; d < 7; d++) {
      const now = NOON + d * MS_PER_DAY;
      await startSession(userId, now);
      await startSession(userId, now + 1000); // a second tap the same day changes nothing
      const s = (await getMiningStatus(userId, now + 2000)).streak!;
      expect(s).toMatchObject({ count: d + 1, doneToday: true, target: 7 });
    }
    const bonus = await Miner.find({ userId, source: "streak" }).lean();
    expect(bonus).toHaveLength(1);
    expect(bonus[0]).toMatchObject({ gh: 55 });
    expect(bonus[0]!.endAt.getTime()).toBe(DAY + 7 * MS_PER_DAY); // until that day's midnight
    expect((await getMiningStatus(userId, NOON + 6 * MS_PER_DAY + 5000)).gh.bonus).toBe(55);
  });

  it("a missed day starts the count again", async () => {
    const userId = await createUser("UTC");
    await startSession(userId, NOON);
    await startSession(userId, NOON + MS_PER_DAY);
    expect((await getMiningStatus(userId, NOON + 2 * MS_PER_DAY)).streak).toMatchObject({ count: 2, doneToday: false });
    // Day 3 skipped entirely.
    expect((await getMiningStatus(userId, NOON + 3 * MS_PER_DAY)).streak).toMatchObject({ count: 0 });
    await startSession(userId, NOON + 3 * MS_PER_DAY);
    expect((await User.findById(userId).lean())!.streak).toMatchObject({ count: 1 });
  });

  it("with start videos, the day counts when the last video is confirmed", async () => {
    await enableRule(1);
    const userId = await createUser("UTC");
    await startSession(userId, NOON);
    expect((await getMiningStatus(userId, NOON)).streak).toMatchObject({ count: 0, doneToday: false });
    const c = await createClaimIntent(userId, { kind: "start" }, NOON);
    await confirm(userId, c.claimId, NOON + 30_000);
    expect((await getMiningStatus(userId, NOON + 60_000)).streak).toMatchObject({ count: 1, doneToday: true });
  });
});

describe("boost videos", () => {
  it("doubles what is running for an hour, one at a time, three a day", async () => {
    const userId = await createUser("UTC");
    await startSession(userId, NOON);
    await expectAppError(createClaimIntent(userId, { kind: "boost" }, NOON), "nothing_to_boost");

    await paidMiner(userId, 360);
    expect((await getMiningStatus(userId, NOON)).boost).toMatchObject({ used: 0, cap: 3, minutes: 60, gh: 360, activeUntil: null });

    const a = await createClaimIntent(userId, { kind: "boost" }, NOON);
    expect(a).toMatchObject({ kind: "boost", gh: 360 });
    expect(await confirm(userId, a.claimId, NOON + 20_000)).toMatchObject({ result: "granted" });
    const m = (await Miner.findOne({ userId, source: "boost" }).lean())!;
    expect(m.endAt.getTime() - m.startAt.getTime()).toBe(MS_PER_HOUR);

    const live = await getMiningStatus(userId, NOON + 60_000);
    expect(live.gh).toMatchObject({ paid: 360, bonus: 360, total: 720 });
    expect(live.boost).toMatchObject({ used: 1, gh: 360 }); // a boost never boosts a boost
    expect(Date.parse(live.boost!.activeUntil!)).toBe(NOON + 20_000 + MS_PER_HOUR);
    await expectAppError(createClaimIntent(userId, { kind: "boost" }, NOON + 60_000), "boost_active");

    for (let i = 1; i < 3; i++) {
      const at = NOON + i * 2 * MS_PER_HOUR;
      const c = await createClaimIntent(userId, { kind: "boost" }, at);
      await confirm(userId, c.claimId, at + 1000);
    }
    await expectAppError(createClaimIntent(userId, { kind: "boost" }, NOON + 8 * MS_PER_HOUR), "daily_limit_reached");
  });

  it("is capped, and ends at midnight if the day ends first", async () => {
    const userId = await createUser("UTC");
    const late = DAY + 23.5 * MS_PER_HOUR;
    await startSession(userId, late);
    await paidMiner(userId, 2000);
    const c = await createClaimIntent(userId, { kind: "boost" }, late);
    expect(c.gh).toBe(500);
    await confirm(userId, c.claimId, late + 1000);
    expect((await Miner.findOne({ userId, source: "boost" }).lean())!.endAt.getTime()).toBe(DAY + MS_PER_DAY);
  });
});

describe("starter bundle and subscriptions", () => {
  it("offers the bundle to new accounts only until they buy or the window closes", async () => {
    const userId = await createUser("UTC");
    const created = (await User.findById(userId).lean())!.createdAt!.getTime();
    const offer = (await getMiningStatus(userId, created + MS_PER_HOUR)).offer!;
    expect(offer.sku).toBe("starter_bundle");
    expect(Date.parse(offer.endsAt)).toBe(created + 48 * MS_PER_HOUR);
    expect((await getMiningStatus(userId, created + 49 * MS_PER_HOUR)).offer).toBeNull();

    const rc = fakeRevenueCat();
    rc.buy(userId, "bitmine_miner_mini_monthly", created + 1000);
    await syncUser(userId, { revenueCat: rc.client, allowSandbox: false }, created + 2000);
    expect((await getMiningStatus(userId, created + MS_PER_HOUR)).offer).toBeNull();
  });

  it("the bundle grants its miner and the Super Miner tier, and a refund takes both back", async () => {
    const userId = await createUser("UTC");
    const rc = fakeRevenueCat();
    const t = rc.buy(userId, "bitmine_starter_bundle", NOON - 1000);
    const r = await syncUser(userId, { revenueCat: rc.client, allowSandbox: false }, NOON);
    expect(r.granted).toMatchObject([{ sku: "starter_bundle", kind: "bundle" }]);

    expect(await Miner.findOne({ userId, source: "paid" }).lean()).toMatchObject({ gh: 65 });
    const basic = (await Product.findOne({ sku: "super_basic" }).lean())!;
    const ent = (await SuperEntitlement.findOne({ userId, productId: basic._id }).lean())!;
    expect(ent.activeUntil.getTime()).toBe(NOON + 30 * MS_PER_DAY);
    expect((await getMiningStatus(userId, NOON + 1000)).superTiers.map((x) => x.sku)).toEqual(["super_basic"]);

    await refundTransaction(t.storeTransactionId, NOON + MS_PER_DAY);
    expect((await Miner.findOne({ userId, source: "paid" }).lean())!.status).toBe("revoked");
    expect((await SuperEntitlement.findOne({ userId, productId: basic._id }).lean())!.activeUntil.getTime()).toBe(NOON + MS_PER_DAY);
  });

  it("a miner subscription mines for each paid month; a renewal is the next month's miner", async () => {
    const userId = await createUser("UTC");
    const rc = fakeRevenueCat();
    const deps = { revenueCat: rc.client, allowSandbox: false };
    const month2 = NOON + 31 * MS_PER_DAY;

    rc.buy(userId, "bitmine_miner_core_monthly", NOON, { expiresAt: month2 });
    await syncUser(userId, deps, NOON + 1000);
    await syncUser(userId, deps, NOON + 2000); // syncing again grants nothing new
    let miners = await Miner.find({ userId, source: "paid" }).sort({ startAt: 1 }).lean();
    expect(miners).toHaveLength(1);
    expect(miners[0]).toMatchObject({ gh: 360 });
    expect(miners[0]!.endAt.getTime()).toBe(month2); // the paid period, not a flat 30 days

    // The renewal is a new store transaction covering the next month.
    rc.buy(userId, "bitmine_miner_core_monthly", month2, { expiresAt: month2 + 30 * MS_PER_DAY });
    await syncUser(userId, deps, month2 + 1000);
    miners = await Miner.find({ userId, source: "paid" }).sort({ startAt: 1 }).lean();
    expect(miners).toHaveLength(2);
    expect(miners[1]!.startAt.getTime()).toBe(month2);
    expect(miners[1]!.endAt.getTime()).toBe(month2 + 30 * MS_PER_DAY);
    expect((await getMiningStatus(userId, month2 + MS_PER_HOUR)).gh.paid).toBe(360); // never doubled
    expect(await Purchase.countDocuments({ userId })).toBe(2);
  });

  it("a subscribed miner sends no renewal reminders unless it really lapses", async () => {
    const userId = await createUser("UTC");
    const core = (await Product.findOne({ sku: "miner_core" }).lean())!;
    const end = NOON + 2 * MS_PER_DAY;
    const month = (startAt: number, endAt: number) => Miner.create({ userId, source: "paid", gh: 360, productId: core._id, startAt: new Date(startAt), endAt: new Date(endAt) });
    await month(end - 30 * MS_PER_DAY, end);

    expect((await runReminders(NOON)).expiry).toBe(0);
    expect((await runReminders(end - MS_PER_HOUR)).expiry).toBe(0);
    expect((await runReminders(end + MS_PER_HOUR)).expiry).toBe(0); // the renewal may still be on its way
    expect((await runReminders(end + 7 * MS_PER_HOUR)).expiry).toBe(1); // it never came: lapsed
    expect((await Notification.findOne({ userId }).lean())!.title).toBe("Core has stopped mining");

    // A subscriber whose next month arrived hears nothing.
    const other = await createUser("UTC");
    await Miner.create({ userId: other, source: "paid", gh: 360, productId: core._id, startAt: new Date(end - 30 * MS_PER_DAY), endAt: new Date(end) });
    await Miner.create({ userId: other, source: "paid", gh: 360, productId: core._id, startAt: new Date(end), endAt: new Date(end + 30 * MS_PER_DAY) });
    await runReminders(end + 7 * MS_PER_HOUR);
    expect(await Notification.countDocuments({ userId: other })).toBe(0);
  });
});

describe("renewal reminders", () => {
  it("3 days before, the day before and when a paid miner ends: once each", async () => {
    const userId = await createUser("UTC");
    await Product.updateOne({ sku: "miner_titan" }, { $set: { billing: "one_time" } });
    const titan = (await Product.findOne({ sku: "miner_titan" }).lean())!;
    const end = NOON + 3 * MS_PER_DAY - MS_PER_HOUR;
    await Miner.create({ userId, source: "paid", gh: 2000, productId: titan._id, startAt: new Date(NOON - 27 * MS_PER_DAY), endAt: new Date(end) });

    expect((await runReminders(NOON)).expiry).toBe(1);
    expect((await runReminders(NOON + MS_PER_HOUR)).expiry).toBe(0);
    expect((await runReminders(end - 12 * MS_PER_HOUR)).expiry).toBe(1);
    expect((await runReminders(end + MS_PER_HOUR)).expiry).toBe(1);
    expect((await runReminders(end + 2 * MS_PER_HOUR)).expiry).toBe(0);
    expect((await runReminders(end + 2 * MS_PER_DAY)).expiry).toBe(0);

    const titles = (await Notification.find({ userId }).sort({ _id: 1 }).lean()).map((n) => n.title);
    expect(titles).toEqual(["Titan stops in 3 days", "Titan stops tomorrow", "Titan has stopped mining"]);
    expect((await Notification.findOne({ userId }).lean())!.data).toMatchObject({ go: "store" });
  });

  it("Super Miner tiers get the same reminders", async () => {
    const userId = await createUser("UTC");
    const pro = (await Product.findOne({ sku: "super_pro" }).lean())!;
    const basic = (await Product.findOne({ sku: "super_basic" }).lean())!;
    const end = NOON + 2 * MS_PER_DAY;
    await SuperEntitlement.create({ userId, productId: pro._id, activeUntil: new Date(end) });
    await SuperEntitlement.create({ userId, productId: basic._id, activeUntil: new Date(end) });

    expect((await runReminders(NOON)).expiry).toBe(2); // both, 3-day stage
    expect((await runReminders(end - MS_PER_HOUR)).expiry).toBe(2); // both, the day before
    expect((await runReminders(end + MS_PER_HOUR)).expiry).toBe(2); // both have ended
    const titles = (await Notification.find({ userId }).sort({ _id: 1 }).lean()).map((n) => n.title).sort();
    expect(titles).toEqual(["Super Miner Pro ends in 3 days", "Super Miner Pro ends tomorrow", "Super Miner Pro has ended", "Super Miner ends in 3 days", "Super Miner ends tomorrow", "Super Miner has ended"].sort());
  });
});
