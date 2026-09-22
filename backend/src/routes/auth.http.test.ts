import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Balance, Ledger, Otp, User } from "../models/index.js";
import { clearTestDb, startTestDb, stopTestDb } from "../test/mongo.js";
import { makeSsvSigner } from "../test/ssv.js";
import { memoryMailer, fakeSocial } from "../test/auth.js";
import { seedAll } from "../db/seed.js";
import { createApp } from "../app.js";
import { nextLocalMidnight } from "../lib/time.js";

const SECRET = "test-secret-at-least-32-characters-long!!";
const mail = memoryMailer();
let social: Awaited<ReturnType<typeof fakeSocial>>;
let server: Server;
let base: string;

beforeAll(async () => {
  await startTestDb();
  social = await fakeSocial();
  server = createApp({
    corsOrigins: [],
    jwtAccessSecret: SECRET,
    ssv: makeSsvSigner().verifier,
    store: { allowSandbox: false },
    mailer: mail.mailer,
    social: social.verifier,
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
  mail.sent.length = 0;
});

type Json = Record<string, any>;
async function post(path: string, body: unknown, token?: string): Promise<{ status: number; body: Json }> {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Json };
}
async function get(path: string, token: string) {
  const res = await fetch(base + path, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: (await res.json()) as Json };
}

const PASSWORD = "correct horse battery";
async function signUp(email: string, extra: Json = {}) {
  const r = await post("/v1/auth/register", { email, password: PASSWORD, name: "Satoshi", timezone: "Asia/Kolkata", ...extra });
  expect(r.status).toBe(201);
  const v = await post("/v1/auth/verify-email", { email, code: mail.lastCode(email) });
  expect(v.status).toBe(200);
  return v.body as { accessToken: string; refreshToken: string; user: Json };
}

/** Lets a new code be requested without waiting out the 1-minute resend cooldown. */
async function skipCooldown() {
  // Raw collection: Mongoose ignores updates to createdAt (timestamps are immutable).
  await Otp.collection.updateMany({}, { $set: { createdAt: new Date(Date.now() - 2 * 60_000) } });
}

describe("email sign-up", () => {
  it("register → emailed code → verified session that works", async () => {
    const s = await signUp("Miner@Example.com");
    expect(s.user).toMatchObject({ email: "miner@example.com", emailVerified: true, timezone: "Asia/Kolkata", twoFactorEnabled: false });
    expect(s.user.referralCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect((await get("/v1/me", s.accessToken)).body.email).toBe("miner@example.com");
    expect(await Balance.exists({ userId: s.user.id })).toBeTruthy();
  });

  it("rejects bad sign-ups", async () => {
    const base = { password: PASSWORD, name: "A", timezone: "UTC" };
    expect((await post("/v1/auth/register", { ...base, email: "x@mailinator.com" })).body.error).toBe("disposable_email");
    expect((await post("/v1/auth/register", { ...base, email: "x@sub.mailinator.com" })).body.error).toBe("disposable_email");
    expect((await post("/v1/auth/register", { ...base, email: "x@example.com", password: "short" })).body.error).toBe("weak_password");
    expect((await post("/v1/auth/register", { ...base, email: "x@example.com", timezone: "Mars/Base" })).body.error).toBe("invalid_timezone");
    expect((await post("/v1/auth/register", { ...base, email: "x@example.com", referralCode: "NOPE2345" })).body.error).toBe("invalid_referral");
    expect((await post("/v1/auth/register", { ...base, email: "not-an-email" })).status).toBe(400);
    await signUp("taken@example.com");
    expect((await post("/v1/auth/register", { ...base, email: "taken@example.com" })).status).toBe(409);
  });

  it("records who referred the new user", async () => {
    const referrer = await signUp("ref@example.com");
    const friend = await signUp("friend@example.com", { referralCode: referrer.user.referralCode.toLowerCase() });
    expect(String((await User.findById(friend.user.id).lean())!.referredBy)).toBe(referrer.user.id);
  });
});

describe("codes (fixing BitPlay's OTP bugs)", () => {
  it("a code only works for the email it was sent to", async () => {
    await post("/v1/auth/register", { email: "a@example.com", password: PASSWORD, name: "A", timezone: "UTC" });
    await post("/v1/auth/register", { email: "b@example.com", password: PASSWORD, name: "B", timezone: "UTC" });
    const r = await post("/v1/auth/verify-email", { email: "b@example.com", code: mail.lastCode("a@example.com") });
    expect(r.body.error).toBe("otp_invalid");
  });

  it("a code only works for its purpose", async () => {
    await post("/v1/auth/register", { email: "a@example.com", password: PASSWORD, name: "A", timezone: "UTC" });
    const r = await post("/v1/auth/password/reset", { email: "a@example.com", code: mail.lastCode("a@example.com"), newPassword: "another password" });
    expect(r.body.error).toBe("otp_invalid");
  });

  it("5 wrong tries kill the code", async () => {
    await post("/v1/auth/register", { email: "a@example.com", password: PASSWORD, name: "A", timezone: "UTC" });
    const right = mail.lastCode("a@example.com");
    const wrong = right === "000000" ? "111111" : "000000";
    const errors = [];
    for (let i = 0; i < 5; i++) errors.push((await post("/v1/auth/verify-email", { email: "a@example.com", code: wrong })).body.error);
    expect(errors.at(-1)).toBe("otp_locked");
    expect((await post("/v1/auth/verify-email", { email: "a@example.com", code: right })).body.error).toBe("otp_invalid");
  });

  it("a code works once, and asking again too quickly is refused", async () => {
    await post("/v1/auth/register", { email: "a@example.com", password: PASSWORD, name: "A", timezone: "UTC" });
    expect((await post("/v1/auth/resend-verification", { email: "a@example.com" })).body.error).toBe("otp_cooldown");
    const code = mail.lastCode("a@example.com");
    expect((await post("/v1/auth/verify-email", { email: "a@example.com", code })).status).toBe(200);
    expect((await post("/v1/auth/verify-email", { email: "a@example.com", code })).status).toBe(400);
  });

  it("codes are stored hashed", async () => {
    await post("/v1/auth/register", { email: "a@example.com", password: PASSWORD, name: "A", timezone: "UTC" });
    const doc = await Otp.findOne({ email: "a@example.com" }).lean();
    expect(doc!.codeHash).not.toContain(mail.lastCode("a@example.com"));
  });
});

describe("sign-in", () => {
  it("unverified accounts get a fresh code instead of a session", async () => {
    await post("/v1/auth/register", { email: "a@example.com", password: PASSWORD, name: "A", timezone: "UTC" });
    await skipCooldown();
    const r = await post("/v1/auth/login", { email: "a@example.com", password: PASSWORD });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("email_not_verified");
    expect(mail.sent.filter((m) => m.to === "a@example.com")).toHaveLength(2);
  });

  it("wrong password and unknown email look the same; 10 failures lock the account", async () => {
    await signUp("a@example.com");
    const unknown = await post("/v1/auth/login", { email: "nobody@example.com", password: PASSWORD });
    const wrong = await post("/v1/auth/login", { email: "a@example.com", password: "wrong password" });
    expect(unknown.body).toEqual(wrong.body);

    for (let i = 0; i < 9; i++) await post("/v1/auth/login", { email: "a@example.com", password: "wrong password" });
    const locked = await post("/v1/auth/login", { email: "a@example.com", password: PASSWORD });
    expect(locked.body.error).toBe("account_locked");
  });

  it("refresh tokens rotate, and reusing an old one signs that login out", async () => {
    const s = await signUp("a@example.com");
    const r1 = await post("/v1/auth/refresh", { refreshToken: s.refreshToken });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(s.refreshToken);

    // Someone replays the first token: the whole chain is revoked, including the new one.
    expect((await post("/v1/auth/refresh", { refreshToken: s.refreshToken })).body.error).toBe("session_expired");
    expect((await post("/v1/auth/refresh", { refreshToken: r1.body.refreshToken })).body.error).toBe("session_expired");
  });

  it("logout ends the session", async () => {
    const s = await signUp("a@example.com");
    await post("/v1/auth/logout", { refreshToken: s.refreshToken });
    expect((await post("/v1/auth/refresh", { refreshToken: s.refreshToken })).status).toBe(401);
  });

  it("password reset works, says nothing about unknown emails, and signs out every device", async () => {
    const s = await signUp("a@example.com");
    expect((await post("/v1/auth/password/forgot", { email: "ghost@example.com" })).body).toEqual({ ok: true });
    expect((await post("/v1/auth/password/forgot", { email: "a@example.com" })).body).toEqual({ ok: true });

    const reset = await post("/v1/auth/password/reset", { email: "a@example.com", code: mail.lastCode("a@example.com"), newPassword: "brand new password" });
    expect(reset.status).toBe(200);
    expect((await post("/v1/auth/refresh", { refreshToken: s.refreshToken })).status).toBe(401);
    expect((await post("/v1/auth/login", { email: "a@example.com", password: PASSWORD })).status).toBe(401);
    expect((await post("/v1/auth/login", { email: "a@example.com", password: "brand new password" })).status).toBe(200);
  });
});

describe("two-step verification", () => {
  it("turning it on makes sign-in ask for an emailed code", async () => {
    const s = await signUp("a@example.com");
    await skipCooldown();
    await post("/v1/me/2fa/enable", {}, s.accessToken);
    const on = await post("/v1/me/2fa/enable/confirm", { code: mail.lastCode("a@example.com") }, s.accessToken);
    expect(on.body.twoFactorEnabled).toBe(true);

    const login = await post("/v1/auth/login", { email: "a@example.com", password: PASSWORD });
    expect(login.body).toMatchObject({ twoFactorRequired: true });
    expect(login.body.accessToken).toBeUndefined();

    const bad = await post("/v1/auth/2fa/verify", { email: "a@example.com", challengeId: "0".repeat(24), code: mail.lastCode("a@example.com") });
    expect(bad.status).toBe(400);
    const ok = await post("/v1/auth/2fa/verify", { email: "a@example.com", challengeId: login.body.challengeId, code: mail.lastCode("a@example.com") });
    expect(ok.body.accessToken).toBeTruthy();
  });

  it("withdrawals need an emailed code when it's on", async () => {
    const s = await signUp("a@example.com");
    await User.updateOne({ _id: s.user.id }, { $set: { "twoFactor.enabled": true } });
    await Balance.updateOne({ userId: s.user.id }, { $inc: { availableMsat: 5_000_000 } });
    await Ledger.create({ userId: s.user.id, type: "adjustment", bucket: "available", amountMsat: 5_000_000, idempotencyKey: "seed" });
    const w = { amountSats: 3000, destination: "a@speed.app" };

    expect((await post("/v1/withdrawals", w, s.accessToken)).body.error).toBe("code_required");
    await skipCooldown();
    expect((await post("/v1/withdrawals/code", {}, s.accessToken)).body).toMatchObject({ required: true, sent: true });
    expect((await post("/v1/withdrawals", { ...w, code: "123456" === mail.lastCode("a@example.com") ? "654321" : "123456" }, s.accessToken)).body.error).toBe("otp_invalid");
    expect((await post("/v1/withdrawals", { ...w, code: mail.lastCode("a@example.com") }, s.accessToken)).status).toBe(201);
  });
});

describe("Google and Apple", () => {
  it("creates a verified account on first Google sign-in and reuses it after", async () => {
    const idToken = await social.googleToken({ sub: "g-123", email: "G@Gmail.com", email_verified: true, name: "Gee" });
    const first = await post("/v1/auth/social", { provider: "google", idToken, timezone: "Europe/London" });
    expect(first.body.user).toMatchObject({ email: "g@gmail.com", emailVerified: true, linkedProviders: ["google"] });
    const again = await post("/v1/auth/social", { provider: "google", idToken, timezone: "Europe/London" });
    expect(again.body.user.id).toBe(first.body.user.id);
  });

  it("links Google to an existing email account instead of making a second one", async () => {
    const s = await signUp("same@gmail.com");
    const idToken = await social.googleToken({ sub: "g-9", email: "same@gmail.com", email_verified: true });
    const r = await post("/v1/auth/social", { provider: "google", idToken, timezone: "UTC" });
    expect(r.body.user.id).toBe(s.user.id);
    expect(await User.countDocuments({})).toBe(1);
  });

  it("refuses forged tokens, other apps' tokens and unverified emails", async () => {
    const claims = { sub: "g-1", email: "x@gmail.com", email_verified: true };
    expect((await post("/v1/auth/social", { provider: "google", idToken: await social.forgedGoogleToken(claims), timezone: "UTC" })).body.error).toBe("social_token_invalid");
    expect((await post("/v1/auth/social", { provider: "google", idToken: await social.googleToken(claims, "someone-elses-app"), timezone: "UTC" })).body.error).toBe("social_token_invalid");
    const unverified = await social.googleToken({ sub: "g-2", email: "y@gmail.com", email_verified: false });
    expect((await post("/v1/auth/social", { provider: "google", idToken: unverified, timezone: "UTC" })).body.error).toBe("email_required");
    expect(await User.countDocuments({})).toBe(0);
  });

  it("signs in with Apple (email_verified as a string, private relay email)", async () => {
    const idToken = await social.appleToken({ sub: "001234.abc", email: "abc123@privaterelay.appleid.com", email_verified: "true" });
    const r = await post("/v1/auth/social", { provider: "apple", idToken, timezone: "America/New_York", name: "Apple User" });
    expect(r.body.user).toMatchObject({ email: "abc123@privaterelay.appleid.com", name: "Apple User", linkedProviders: ["apple"] });
  });
});

describe("account settings", () => {
  it("a timezone change waits until midnight and can't be repeated within 30 days", async () => {
    const s = await signUp("a@example.com");
    const before = Date.now();
    const r = await post("/v1/me/timezone", { timezone: "America/Los_Angeles" }, s.accessToken);
    expect(r.body.timezone).toBe("Asia/Kolkata");
    expect(r.body.timezonePending.timezone).toBe("America/Los_Angeles");
    expect(Date.parse(r.body.timezonePending.effectiveAt)).toBe(nextLocalMidnight(before, "Asia/Kolkata"));
    expect((await post("/v1/me/timezone", { timezone: "Europe/Paris" }, s.accessToken)).body.error).toBe("timezone_cooldown");
  });

  it("a referral code can be added later, but not your own", async () => {
    const referrer = await signUp("ref@example.com");
    const s = await signUp("late@example.com");
    expect((await post("/v1/me/referral", { code: s.user.referralCode }, s.accessToken)).body.error).toBe("invalid_referral");
    expect((await post("/v1/me/referral", { code: referrer.user.referralCode }, s.accessToken)).status).toBe(200);
    expect((await post("/v1/me/referral", { code: referrer.user.referralCode }, s.accessToken)).body.error).toBe("referral_already_set");
  });

  it("deleting the account signs out everywhere and frees the email", async () => {
    const s = await signUp("gone@example.com");
    expect((await post("/v1/me/delete", { confirm: "yes" }, s.accessToken)).status).toBe(400);
    expect((await post("/v1/me/delete", { confirm: "DELETE" }, s.accessToken)).status).toBe(200);
    expect((await get("/v1/me", s.accessToken)).status).toBe(401);
    expect((await post("/v1/auth/refresh", { refreshToken: s.refreshToken })).status).toBe(401);
    await signUp("gone@example.com");
  });
});
