import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { startTestDb, stopTestDb } from "../test/mongo.js";
import { createUser } from "../test/fixtures.js";
import { makeSsvSigner } from "../test/ssv.js";
import { baseAuthOptions } from "../test/auth.js";
import { seedAll } from "../db/seed.js";
import { signAccessToken } from "../auth/tokens.js";
import { createApp } from "../app.js";
import { adminReply } from "../support/service.js";

const SECRET = "test-secret-at-least-32-characters-long!!";
let server: Server;
let base: string;

beforeAll(async () => {
  await startTestDb();
  await seedAll();
  await seedAll(); // seeding twice must not duplicate anything
  server = createApp({ ...(await baseAuthOptions()).options, corsOrigins: [], jwtAccessSecret: SECRET, ssv: makeSsvSigner().verifier, store: { allowSandbox: false } }).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 180_000);
afterAll(async () => {
  server?.close();
  await stopTestDb();
});

async function as(userToken: string, method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${userToken}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe("public endpoints", () => {
  it("serve FAQs and app config without signing in", async () => {
    const faqs = (await (await fetch(`${base}/v1/public/faqs`)).json()) as { faqs: { question: string }[] };
    expect(faqs.faqs).toHaveLength(8);
    expect(faqs.faqs[0]!.question).toBe("How does mining work in BitMine?");

    const cfg = (await (await fetch(`${base}/v1/public/config`)).json()) as Record<string, any>;
    expect(cfg.adUnits.android.rewarded).toBe("ca-app-pub-3940256099942544/5224354917");
    expect(cfg.economics).toEqual({ rateMsatPerGhDay: 48, claimGh: 5.5, claimsPerDay: 60, minWithdrawalSats: 2500, referralPercent: 5, referralCapSatsPerDay: 5, dailyStartRequired: false, startAds: 0 });
  });
});

describe("signed-in extras", () => {
  it("support: open a request, get a reply, answer back", async () => {
    const userId = await createUser();
    const t = await signAccessToken(String(userId), SECRET);
    const created = await as(t, "POST", "/v1/support/tickets", { category: "withdrawal", subject: "Pending too long", message: "My withdrawal is still pending." });
    expect(created.status).toBe(201);
    await adminReply(created.body.id, "It's approved now.");
    const reply = await as(t, "POST", `/v1/support/tickets/${created.body.id}/messages`, { text: "Got it, thanks!" });
    expect(reply.body.status).toBe("open");
    expect(reply.body.messages.map((m: { from: string }) => m.from)).toEqual(["user", "admin", "user"]);

    const other = await signAccessToken(String(await createUser()), SECRET);
    expect((await as(other, "GET", `/v1/support/tickets/${created.body.id}`)).status).toBe(404);
  });

  it("notification switches, push tokens, notification list and referrals", async () => {
    const userId = await createUser();
    const t = await signAccessToken(String(userId), SECRET);
    expect((await as(t, "PATCH", "/v1/me/notifications", { miningReminder: false })).body.notificationPrefs).toMatchObject({ miningReminder: false, withdrawals: true });
    expect((await as(t, "POST", "/v1/push-tokens", { token: "x".repeat(40), platform: "android" })).status).toBe(200);
    expect((await as(t, "GET", "/v1/notifications")).body).toMatchObject({ notifications: [], unread: 0 });
    expect((await as(t, "GET", "/v1/referrals")).body).toMatchObject({ invitedCount: 0, rewardPercent: 5, dailyCapSats: 5, canAddReferralCode: true });
  });
});
