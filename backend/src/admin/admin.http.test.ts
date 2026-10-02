import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { AdminAudit, AdminUser, Balance, Ledger, Notification, Product, Settings, SupportTicket, User, Withdrawal } from "../models/index.js";
import { clearTestDb, startTestDb, stopTestDb } from "../test/mongo.js";
import { createUser } from "../test/fixtures.js";
import { makeSsvSigner } from "../test/ssv.js";
import { baseAuthOptions } from "../test/auth.js";
import { seedAll } from "../db/seed.js";
import { signAccessToken } from "../auth/tokens.js";
import { ensureBalance } from "../wallet/balances.js";
import { requestWithdrawal } from "../wallet/withdrawals.js";
import { createApp } from "../app.js";
import { createAdmin } from "./auth.js";
import { base32Encode, totpCode, verifyTotp } from "./totp.js";

const SECRET = "test-secret-at-least-32-characters-long!!";
let server: Server;
let base: string;

beforeAll(async () => {
  await startTestDb();
  server = createApp({
    ...(await baseAuthOptions()).options,
    corsOrigins: [], jwtAccessSecret: SECRET, ssv: makeSsvSigner().verifier, store: { allowSandbox: false },
    admin: { secureCookies: false },
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

describe("TOTP", () => {
  it("matches the RFC 6238 SHA-1 test vector", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpCode(secret, 59_000)).toBe("287082");
    expect(totpCode(secret, 1_111_111_109_000)).toBe("081804");
    expect(verifyTotp(secret, "287082", 59_000 + 30_000)).not.toBeNull(); // one step of drift allowed
    expect(verifyTotp(secret, "287082", 59_000 + 90_000)).toBeNull();
  });
});

/** A tiny cookie-keeping browser. */
class Browser {
  cookie = "";
  async req(method: string, path: string, form?: Record<string, string>) {
    const res = await fetch(base + path, {
      method,
      redirect: "manual",
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0]!.endsWith("=") ? "" : set.split(";")[0]!;
    return { status: res.status, location: res.headers.get("location"), text: await res.text() };
  }
  csrf(htmlText: string) {
    return /name="_csrf" value="([^"]+)"/.exec(htmlText)![1]!;
  }
}

async function signedIn() {
  const { secret } = await createAdmin("boss@example.com", "admin password 123");
  const b = new Browser();
  await b.req("POST", "/admin/login", { email: "boss@example.com", password: "admin password 123" });
  const r = await b.req("POST", "/admin/login/totp", { code: totpCode(secret) });
  expect(r.status).toBe(303);
  const dash = await b.req("GET", "/admin");
  return { b, csrf: b.csrf(dash.text), secret };
}

async function userWith(sats: number) {
  const userId = await createUser();
  await ensureBalance(userId);
  await Balance.updateOne({ userId }, { $inc: { availableMsat: sats * 1000 } });
  await Ledger.create({ userId, type: "adjustment", bucket: "available", amountMsat: sats * 1000, idempotencyKey: `seed:${userId}` });
  return userId;
}

describe("admin sign-in", () => {
  it("sends strangers to the login page", async () => {
    const r = await new Browser().req("GET", "/admin");
    expect(r.status).toBe(303);
    expect(r.location).toBe("/admin/login");
  });

  it("needs the password and then the authenticator code", async () => {
    const { secret } = await createAdmin("boss@example.com", "admin password 123");
    const b = new Browser();
    expect((await b.req("POST", "/admin/login", { email: "boss@example.com", password: "wrong" })).status).toBe(401);
    const step1 = await b.req("POST", "/admin/login", { email: "boss@example.com", password: "admin password 123" });
    expect(step1.text).toContain("Authenticator code");
    expect((await b.req("GET", "/admin")).status).toBe(303); // half-signed-in isn't signed in
    expect((await b.req("POST", "/admin/login/totp", { code: "000000" === totpCode(secret) ? "111111" : "000000" })).status).toBe(401);
    expect((await b.req("POST", "/admin/login/totp", { code: totpCode(secret) })).status).toBe(303);
    const dash = await b.req("GET", "/admin");
    expect(dash.status).toBe(200);
    expect(dash.text).toContain("Owed to all users");
    expect(dash.text).toContain("Revenue by day");
    expect(dash.text).toContain("<svg class=\"chart\"");
    expect(await AdminAudit.countDocuments({ action: "admin.login" })).toBe(1);
  });

  it("an authenticator code can't be used twice", async () => {
    const { secret } = await signedIn();
    const b2 = new Browser();
    await b2.req("POST", "/admin/login", { email: "boss@example.com", password: "admin password 123" });
    expect((await b2.req("POST", "/admin/login/totp", { code: totpCode(secret) })).status).toBe(401);
  });

  it("forms without the CSRF token are refused", async () => {
    const { b } = await signedIn();
    expect((await b.req("POST", "/admin/users/000000000000000000000000/adjust", { sats: "100", reason: "no token here" })).status).toBe(403);
  });

  it("sign out ends the session", async () => {
    const { b, csrf } = await signedIn();
    const cookie = b.cookie;
    await b.req("POST", "/admin/logout", { _csrf: csrf });
    const stale = new Browser();
    stale.cookie = cookie;
    expect((await stale.req("GET", "/admin")).status).toBe(303);
  });

  it("deactivated admins are signed out", async () => {
    const { b } = await signedIn();
    await AdminUser.updateOne({ email: "boss@example.com" }, { $set: { active: false } });
    expect((await b.req("GET", "/admin")).status).toBe(303);
  });
});

describe("admin actions", () => {
  it("approve and reject withdrawals from the queue", async () => {
    const { b, csrf } = await signedIn();
    const a = await userWith(10_000);
    const c = await userWith(10_000);
    const wa = await requestWithdrawal(a, { amountSats: 3000, destination: "a@speed.app" });
    const wc = await requestWithdrawal(c, { amountSats: 2500, destination: "c@speed.app" });

    const queue = await b.req("GET", "/admin/withdrawals");
    expect(queue.text).toContain("3,000 sats");
    expect(queue.text).toContain("a@speed.app");

    expect((await b.req("POST", `/admin/withdrawals/${wa.id}/approve`, { _csrf: csrf })).location).toContain("ok=");
    expect((await Withdrawal.findById(wa.id).lean())!.status).toBe("approved");

    expect((await b.req("POST", `/admin/withdrawals/${wc.id}/reject`, { _csrf: csrf, reason: "Please verify your email first" })).location).toContain("ok=");
    expect((await Balance.findOne({ userId: c }).lean())!.availableMsat).toBe(10_000_000);
    expect((await Notification.findOne({ userId: c }).lean())!.body).toContain("Please verify your email first");
    expect(await AdminAudit.countDocuments({ action: { $in: ["withdrawal.approve", "withdrawal.reject"] } })).toBe(2);

    // Approving twice is refused with a message, not a crash.
    const again = await b.req("POST", `/admin/withdrawals/${wa.id}/approve`, { _csrf: csrf });
    expect(decodeURIComponent(again.location!)).toContain("Only withdrawals waiting for review");
  });

  it("adjust a balance (with a reason) and suspend a user", async () => {
    const { b, csrf } = await signedIn();
    const userId = await userWith(1000);
    const token = await signAccessToken(String(userId), SECRET);

    await b.req("POST", `/admin/users/${userId}/adjust`, { _csrf: csrf, sats: "-400", reason: "duplicate credit fix" });
    expect((await Balance.findOne({ userId }).lean())!.availableMsat).toBe(600_000);
    const tooMuch = await b.req("POST", `/admin/users/${userId}/adjust`, { _csrf: csrf, sats: "-5000", reason: "should fail" });
    expect(decodeURIComponent(tooMuch.location!)).toContain("lower than that debit");
    expect((await Ledger.findOne({ userId, type: "adjustment", amountMsat: -400_000 }).lean())!.meta).toMatchObject({ reason: "duplicate credit fix" });

    await b.req("POST", `/admin/users/${userId}/status`, { _csrf: csrf, status: "suspended" });
    expect((await fetch(`${base}/v1/me`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  it("escapes user content in pages", async () => {
    const { b } = await signedIn();
    const userId = await createUser();
    await User.updateOne({ _id: userId }, { $set: { name: '<script>alert("x")</script>' } });
    const page = await b.req("GET", "/admin/users");
    expect(page.text).not.toContain('<script>alert("x")</script>');
    expect(page.text).toContain("&lt;script&gt;");
  });

  it("schedules economics changes and enforces the 15-day check", async () => {
    const { b, csrf } = await signedIn();
    const base = { _csrf: csrf, rateMsatPerGhDay: "48", claimGh: "5.5", claimsPerDay: "60", minWithdrawalSats: "2500", referralPercent: "5", referralCapSatsPerDay: "5", withdrawalAutoApproveMaxSats: "0" };
    const when = new Date(Date.now() + 86_400_000).toISOString().slice(0, 16);

    const tooGenerous = await b.req("POST", "/admin/settings", { ...base, rateMsatPerGhDay: "200", effectiveAt: when });
    expect(decodeURIComponent(tooGenerous.location!)).toContain("under 15");
    const past = await b.req("POST", "/admin/settings", { ...base, effectiveAt: "2020-01-01T00:00" });
    expect(decodeURIComponent(past.location!)).toContain("5 minutes from now");

    const ok = await b.req("POST", "/admin/settings", { ...base, rateMsatPerGhDay: "40", effectiveAt: when });
    expect(ok.location).toContain("ok=");
    expect((await Settings.findOne({ version: 2 }).lean())!.values.rateMsatPerGhDay).toBe(40);
  });

  it("edits products and refuses duplicate store ids", async () => {
    const { b, csrf } = await signedIn();
    const form = { _csrf: csrf, name: "Titan X", priceDisplayUsd: "49.99", durationDays: "180", gh: "2100", apple: "bitmine_miner_titan", google: "bitmine_miner_titan", sortOrder: "50", active: "yes" };
    await b.req("POST", "/admin/products/miner_titan", form);
    expect(await Product.findOne({ sku: "miner_titan" }).lean()).toMatchObject({ name: "Titan X", gh: 2100 });
    const dup = await b.req("POST", "/admin/products/miner_titan", { ...form, apple: "bitmine_miner_core" });
    expect(decodeURIComponent(dup.location!)).toContain("already uses");
  });

  it("replies to support requests", async () => {
    const { b, csrf } = await signedIn();
    const userId = await createUser();
    const t = await SupportTicket.create({ userId, subject: "Help", messages: [{ from: "user", text: "Where are my sats?", at: new Date() }] });
    expect((await b.req("GET", "/admin/support")).text).toContain("Help");
    await b.req("POST", `/admin/support/${t._id}/reply`, { _csrf: csrf, text: "Sent them just now." });
    expect((await SupportTicket.findById(t._id).lean())!.status).toBe("answered");
    expect(await Notification.countDocuments({ userId, kind: "support_reply" })).toBe(1);
  });

  it("every page renders", async () => {
    const { b } = await signedIn();
    for (const p of ["/admin", "/admin/withdrawals?status=needs_reconcile", "/admin/users", "/admin/users?q=example.com", "/admin/purchases", "/admin/purchases?status=granted&store=play_store&q=example", "/admin/support", "/admin/settings", "/admin/products", "/admin/content", "/admin/announce", "/admin/audit"]) {
      const r = await b.req("GET", p);
      expect(r.status, p).toBe(200);
    }
  });
});
