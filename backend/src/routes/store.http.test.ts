import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Balance, Miner, Purchase } from "../models/index.js";
import { clearTestDb, startTestDb, stopTestDb } from "../test/mongo.js";
import { createUser } from "../test/fixtures.js";
import { makeSsvSigner } from "../test/ssv.js";
import { fakeRevenueCat } from "../test/revenuecat.js";
import { seedAll } from "../db/seed.js";
import { signAccessToken } from "../auth/tokens.js";
import { createApp } from "../app.js";
import { baseAuthOptions } from "../test/auth.js";
import { MS_PER_HOUR } from "../lib/time.js";
import { ensureBalance } from "../wallet/balances.js";
import { runAccrual } from "../mining/accrualJob.js";
import { syncUser } from "../store/service.js";

const SECRET = "test-secret-at-least-32-characters-long!!";
const HOOK_AUTH = "rc-webhook-shared-secret";
const rc = fakeRevenueCat();
let server: Server;
let base: string;

beforeAll(async () => {
  await startTestDb();
  server = createApp({
    ...(await baseAuthOptions()).options,
    corsOrigins: [],
    jwtAccessSecret: SECRET,
    ssv: makeSsvSigner().verifier,
    store: { revenueCat: rc.client, allowSandbox: false },
    revenueCatWebhookAuth: HOOK_AUTH,
  }).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 180_000);
afterAll(async () => {
  server?.close();
  await stopTestDb();
});
beforeEach(async () => {
  await clearTestDb();
  await seedAll();
});

const hook = (event: object, auth: string | null = HOOK_AUTH) =>
  fetch(`${base}/webhooks/revenuecat`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify({ api_version: "1.0", event }),
  });

describe("store over HTTP", () => {
  it("lists the catalog with store product ids", async () => {
    const userId = await createUser();
    const token = await signAccessToken(String(userId), SECRET);
    const res = await fetch(`${base}/v1/store/products`, { headers: { authorization: `Bearer ${token}` } });
    const { products } = (await res.json()) as { products: { sku: string; storeIds: { apple: string } }[] };
    expect(products.map((p) => p.sku)).toEqual([
      "starter_bundle", "miner_mini", "miner_spark", "miner_core", "miner_forge", "miner_titan", "super_basic", "super_pro", "super_max",
    ]);
    expect(products[5]!.storeIds.apple).toBe("bitmine_miner_titan");
  });

  it("POST /v1/store/sync grants what RevenueCat confirms for the signed-in user only", async () => {
    const buyer = await createUser();
    const other = await createUser();
    rc.buy(buyer, "bitmine_miner_forge", Date.now());

    const asOther = await fetch(`${base}/v1/store/sync`, {
      method: "POST",
      headers: { authorization: `Bearer ${await signAccessToken(String(other), SECRET)}` },
    });
    expect(((await asOther.json()) as { granted: unknown[] }).granted).toHaveLength(0);

    const asBuyer = await fetch(`${base}/v1/store/sync`, {
      method: "POST",
      headers: { authorization: `Bearer ${await signAccessToken(String(buyer), SECRET)}` },
    });
    expect(((await asBuyer.json()) as { granted: { sku: string }[] }).granted[0]!.sku).toBe("miner_forge");
    expect(await Miner.countDocuments({ userId: buyer })).toBe(1);
    expect(await Miner.countDocuments({ userId: other })).toBe(0);
  });

  it("webhook needs the shared secret", async () => {
    expect((await hook({ type: "TEST" }, null)).status).toBe(401);
    expect((await hook({ type: "TEST" }, "wrong")).status).toBe(401);
    expect((await hook({ type: "TEST" }, `Bearer ${HOOK_AUTH}`)).status).toBe(200);
  });

  it("purchase webhook grants via RevenueCat's API and records the price", async () => {
    const userId = await createUser();
    const t = rc.buy(userId, "bitmine_super_max", Date.now());
    const res = await hook({
      id: "evt-1", type: "NON_RENEWING_PURCHASE", app_user_id: String(userId),
      transaction_id: t.storeTransactionId, environment: "PRODUCTION", price: 249, currency: "USD",
    });
    expect(await res.json()).toMatchObject({ ok: true, granted: 1 });
    expect(await Purchase.findOne({ userId }).lean()).toMatchObject({ priceUsd: 249, rcEventId: "evt-1" });
  });

  it("a webhook can't grant a purchase RevenueCat doesn't have", async () => {
    const userId = await createUser();
    const res = await hook({ id: "evt-x", type: "INITIAL_PURCHASE", app_user_id: String(userId), transaction_id: "made-up", environment: "PRODUCTION" });
    expect(await res.json()).toMatchObject({ granted: 0 });
    expect(await Purchase.countDocuments({})).toBe(0);
  });

  it("refund webhook revokes the miner", async () => {
    const userId = await createUser();
    const t = rc.buy(userId, "bitmine_miner_core", Date.now());
    await hook({ id: "e1", type: "NON_RENEWING_PURCHASE", app_user_id: String(userId), environment: "PRODUCTION" });

    const res = await hook({ id: "e2", type: "CANCELLATION", cancel_reason: "CUSTOMER_SUPPORT", transaction_id: t.storeTransactionId, environment: "PRODUCTION" });
    expect(await res.json()).toMatchObject({ refund: "refunded" });
    expect((await Miner.findOne({ userId }).lean())!.status).toBe("revoked");
  });

  it("ignores sandbox events and unknown users", async () => {
    const userId = await createUser();
    rc.buy(userId, "bitmine_miner_mini", Date.now());
    expect(await (await hook({ type: "NON_RENEWING_PURCHASE", app_user_id: String(userId), environment: "SANDBOX" })).json()).toMatchObject({ ignored: "sandbox" });
    expect(await (await hook({ type: "NON_RENEWING_PURCHASE", app_user_id: "$RCAnonymousID:abc", environment: "PRODUCTION" })).json()).toMatchObject({ ignored: "unknown_user" });
    expect(await Miner.countDocuments({})).toBe(0);
  });
});

describe("purchases racing the hourly job", () => {
  it("never lose or double-count a late-processed miner's hours", async () => {
    const start = Date.parse("2026-10-01T00:00:00Z");
    for (let i = 0; i < 8; i++) {
      const userId = await createUser();
      await ensureBalance(userId, start);
      // Bought at 00:30, processed at 03:05 while the 03:00 accrual run is in flight.
      rc.buy(userId, "bitmine_miner_titan", start + 30 * 60_000);
      await Promise.all([
        runAccrual({ now: start + 3 * MS_PER_HOUR + 5 * 60_000 }),
        syncUser(userId, { revenueCat: rc.client, allowSandbox: false }, start + 3 * MS_PER_HOUR + 5 * 60_000),
      ]);
      await runAccrual({ now: start + 6 * MS_PER_HOUR });
      // 5.5 hours × 2,000 GH/s × 48 msat/day = 22,000 msat
      expect((await Balance.findOne({ userId }).lean())!.availableMsat).toBe(22_000);
    }
  });
});
