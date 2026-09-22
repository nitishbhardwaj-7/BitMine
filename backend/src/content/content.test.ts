import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Ledger, Miner, NewsArticle, Product } from "../models/index.js";
import { clearTestDb, startTestDb, stopTestDb } from "../test/mongo.js";
import { createUser } from "../test/fixtures.js";
import { makeSsvSigner } from "../test/ssv.js";
import { baseAuthOptions } from "../test/auth.js";
import { seedAll } from "../db/seed.js";
import { signAccessToken } from "../auth/tokens.js";
import { createApp } from "../app.js";
import { MS_PER_DAY } from "../lib/time.js";
import { ensureBalance } from "../wallet/balances.js";
import { startSession } from "../mining/sessions.js";
import { createClaimIntent } from "../claims/service.js";
import { MarketCache, type Coin } from "./market.js";
import { categorize, parseRss, refreshNews, summarize } from "./news.js";
import { dailyEarnings } from "../wallet/wallet.js";
import { minerDetail } from "../mining/status.js";

const SECRET = "test-secret-at-least-32-characters-long!!";

beforeAll(startTestDb, 180_000);
afterAll(stopTestDb);
beforeEach(async () => {
  await clearTestDb();
  await seedAll();
});

const coin = (id: string, price: number): Coin => ({ id, symbol: id.slice(0, 3).toUpperCase(), name: id, priceUsd: price, change24h: 1.5, sparkline: [1, 2, 3] });

describe("market prices", () => {
  it("caches for a minute and serves the last good prices when the feed fails", async () => {
    let calls = 0;
    let fail = false;
    const cache = new MarketCache(async () => {
      calls++;
      if (fail) throw new Error("down");
      return [coin("bitcoin", 100_000 + calls), coin("ethereum", 3000)];
    });
    const t = Date.now();
    expect((await cache.get(t)).btcUsd).toBe(100_001);
    expect((await cache.get(t + 30_000)).btcUsd).toBe(100_001);
    expect(calls).toBe(1);
    fail = true;
    const stale = await cache.get(t + 120_000);
    expect(stale).toMatchObject({ btcUsd: 100_001, stale: true });
  });

  it("shares one fetch between concurrent requests", async () => {
    let calls = 0;
    const cache = new MarketCache(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return [coin("bitcoin", 1)];
    });
    await Promise.all([cache.get(), cache.get(), cache.get()]);
    expect(calls).toBe(1);
  });
});

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Bitcoin miners boost hashrate to record]]></title><link>https://example.com/a</link>
<description><![CDATA[<p>Miners added <b>capacity</b> &amp; more.</p><img src="https://img.example.com/a.jpg">]]></description>
<pubDate>Tue, 22 Sep 2026 10:00:00 GMT</pubDate><category>Mining</category></item>
<item><title>ETF inflows lift crypto market</title><link>https://example.com/b</link><description>Short.</description>
<media:content url="https://img.example.com/b.jpg" medium="image"/><pubDate>Tue, 22 Sep 2026 09:00:00 GMT</pubDate></item>
<item><title>No link here</title></item>
</channel></rss>`;

describe("news", () => {
  it("parses RSS items, images and plain-text summaries", () => {
    const items = parseRss(RSS);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: "Bitcoin miners boost hashrate to record", url: "https://example.com/a", summary: "Miners added capacity & more.", imageUrl: "https://img.example.com/a.jpg" });
    expect(items[1]!.imageUrl).toBe("https://img.example.com/b.jpg");
    expect(categorize(items[0]!)).toBe("MINING");
    expect(categorize(items[1]!)).toBe("MARKET");
  });

  it("keeps summaries short", () => {
    expect(summarize("word ".repeat(100)).length).toBeLessThanOrEqual(201);
  });

  it("stores each article once, and one broken feed doesn't stop the others", async () => {
    const feeds = [{ source: "Good", url: "good" }, { source: "Broken", url: "broken" }];
    const fetcher = async (url: string) => {
      if (url === "broken") throw new Error("500");
      return RSS;
    };
    expect(await refreshNews(fetcher, feeds)).toBe(2);
    expect(await refreshNews(fetcher, feeds)).toBe(0);
    expect(await NewsArticle.countDocuments()).toBe(2);
  });
});

describe("earnings and miner detail", () => {
  it("groups credits by day", async () => {
    const userId = await createUser();
    const today = Date.now();
    const insert = (type: string, msat: number, at: number, i: number) =>
      Ledger.collection.insertOne({ userId, type, bucket: "available", amountMsat: msat, idempotencyKey: `t${i}`, createdAt: new Date(at) });
    await insert("mining", 1000, today, 1);
    await insert("mining", 500, today, 2);
    await insert("referral", 200, today, 3);
    await insert("mining", 700, today - MS_PER_DAY, 4);
    await insert("withdrawal_lock", -9000, today, 5);
    const { days } = await dailyEarnings(userId, 14, today);
    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({ miningMsat: 1500, referralMsat: 200 });
    expect(days[1]).toMatchObject({ miningMsat: 700 });
  });

  it("shows a paid miner's earnings and time left", async () => {
    const userId = await createUser();
    const titan = await Product.findOne({ sku: "miner_titan" }).lean();
    const start = Date.now() - 10 * MS_PER_DAY;
    const m = await Miner.create({ userId, source: "paid", gh: 2000, productId: titan!._id, startAt: new Date(start), endAt: new Date(start + 180 * MS_PER_DAY) });
    const d = await minerDetail(userId, String(m._id), start + 10 * MS_PER_DAY);
    expect(d).toMatchObject({ gh: 2000, status: "active", daysLeft: 170, earnedMsat: 960_000, expectedTotalMsat: 17_280_000, msatPerDay: 96_000 });
    expect(d.product?.name).toBe("Titan");
    const other = await createUser();
    await expect(minerDetail(other, String(m._id))).rejects.toMatchObject({ status: 404 });
  });
});

describe("public content and dev shortcuts over HTTP", () => {
  async function serve(devShortcuts: boolean) {
    const market = new MarketCache(async () => [coin("bitcoin", 100_000)]);
    const server = createApp({ ...(await baseAuthOptions()).options, corsOrigins: [], jwtAccessSecret: SECRET, ssv: makeSsvSigner().verifier, store: { allowSandbox: false }, market, devShortcuts }).listen(0);
    return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
  }
  let s: { server: Server; base: string };
  afterAll(() => s?.server.close());

  it("serves market, news and academy without signing in", async () => {
    s = await serve(false);
    expect(((await (await fetch(`${s.base}/v1/public/market`)).json()) as any).btcUsd).toBe(100_000);
    expect(((await (await fetch(`${s.base}/v1/public/news`)).json()) as any).articles).toEqual([]);
    const lessons = ((await (await fetch(`${s.base}/v1/public/academy`)).json()) as any).lessons;
    expect(lessons).toHaveLength(6);
    const lesson = (await (await fetch(`${s.base}/v1/public/academy/how-bitmine-works`)).json()) as any;
    expect(lesson.paragraphs.length).toBeGreaterThan(2);
    expect((await fetch(`${s.base}/v1/public/academy/nope`)).status).toBe(404);
    s.server.close();
  });

  it("dev shortcuts exist only when switched on", async () => {
    const userId = await createUser();
    await ensureBalance(userId);
    const token = await signAccessToken(String(userId), SECRET);
    const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };

    const off = await serve(false);
    expect((await fetch(`${off.base}/v1/dev/purchase`, { method: "POST", headers: auth, body: '{"sku":"miner_titan"}' })).status).toBe(404); // no such route
    off.server.close();

    s = await serve(true);
    const bought = (await (await fetch(`${s.base}/v1/dev/purchase`, { method: "POST", headers: auth, body: '{"sku":"miner_titan"}' })).json()) as any;
    expect(bought.status).toBe("granted");
    await startSession(userId);
    const { claimId } = await createClaimIntent(userId, { kind: "regular" });
    const done = (await (await fetch(`${s.base}/v1/dev/claims/${claimId}/complete`, { method: "POST", headers: auth })).json()) as any;
    expect(done.result).toBe("granted");
  });
});
