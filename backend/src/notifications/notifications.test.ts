import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { Balance, Ledger, Miner, Notification, Product, PushToken, User } from "../models/index.js";
import { clearTestDb, startTestDb, stopTestDb } from "../test/mongo.js";
import { createUser } from "../test/fixtures.js";
import { fakeSpeed } from "../test/speed.js";
import { seedAll } from "../db/seed.js";
import { MS_PER_DAY } from "../lib/time.js";
import { ensureBalance } from "../wallet/balances.js";
import { startSession } from "../mining/sessions.js";
import { approveWithdrawal, rejectWithdrawal, requestWithdrawal } from "../wallet/withdrawals.js";
import { runPayouts } from "../wallet/payoutJob.js";
import { adminReply, createTicket } from "../support/service.js";
import { listNotifications, markRead, notify, registerPushToken } from "./service.js";
import { runOutbox, runReminders } from "./jobs.js";
import type { PushSender } from "./push.js";

beforeAll(startTestDb, 180_000);
afterAll(stopTestDb);
beforeEach(async () => {
  await clearTestDb();
  await seedAll();
});

const TOKEN = "fcm-token-".padEnd(40, "x");

function fakePush(behaviour: (token: string) => "ok" | "invalid_token" | "error" = () => "ok") {
  const sent: { token: string; title: string }[] = [];
  const sender: PushSender = {
    async send(token, msg) {
      const b = behaviour(token);
      if (b === "error") throw new Error("FCM down");
      if (b === "ok") sent.push({ token, title: msg.title });
      return b;
    },
  };
  return { sender, sent };
}

async function userWith(sats: number) {
  const userId = await createUser();
  await ensureBalance(userId);
  await Balance.updateOne({ userId }, { $inc: { availableMsat: sats * 1000 } });
  await Ledger.create({ userId, type: "adjustment", bucket: "available", amountMsat: sats * 1000, idempotencyKey: `seed:${userId}` });
  return userId;
}

describe("outbox", () => {
  it("pushes to every device and marks it sent", async () => {
    const userId = await createUser();
    await registerPushToken(userId, TOKEN, "android");
    await registerPushToken(userId, TOKEN + "2", "ios");
    await notify(userId, { kind: "announcement", title: "Hello", body: "World", dedupeKey: "a1" });

    const push = fakePush();
    expect(await runOutbox(push.sender)).toMatchObject({ sent: 1 });
    expect(push.sent).toHaveLength(2);
    expect((await Notification.findOne({ userId }).lean())!.push).toBe("sent");
  });

  it("a notification happens once per dedupe key", async () => {
    const userId = await createUser();
    expect(await notify(userId, { kind: "announcement", title: "A", body: "B", dedupeKey: "same" })).toBe(true);
    expect(await notify(userId, { kind: "announcement", title: "A", body: "B", dedupeKey: "same" })).toBe(false);
    expect(await Notification.countDocuments({ userId })).toBe(1);
  });

  it("respects the user's switches, deletes dead tokens, retries outages", async () => {
    const quiet = await createUser();
    await User.updateOne({ _id: quiet }, { $set: { "notificationPrefs.withdrawals": false } });
    await registerPushToken(quiet, TOKEN, "android");
    await notify(quiet, { kind: "withdrawal_paid", title: "Sent", body: "x", dedupeKey: "w1" });

    const dead = await createUser();
    await registerPushToken(dead, TOKEN + "dead", "android");
    await notify(dead, { kind: "announcement", title: "Hi", body: "x", dedupeKey: "d1" });

    const flaky = await createUser();
    await registerPushToken(flaky, TOKEN + "flaky", "ios");
    await notify(flaky, { kind: "announcement", title: "Hi", body: "x", dedupeKey: "f1" });

    const push = fakePush((t) => (t.endsWith("dead") ? "invalid_token" : t.endsWith("flaky") ? "error" : "ok"));
    await runOutbox(push.sender);

    expect((await Notification.findOne({ userId: quiet }).lean())!.push).toBe("skipped");
    expect(await PushToken.countDocuments({ userId: dead })).toBe(0);
    const f = (await Notification.findOne({ userId: flaky }).lean())!;
    expect(f).toMatchObject({ push: "pending", attempts: 1 });
    for (let i = 0; i < 5; i++) await runOutbox(push.sender);
    expect((await Notification.findOne({ userId: flaky }).lean())!.push).toBe("failed");
  });

  it("doesn't push day-old news, but keeps it in the in-app list", async () => {
    const userId = await createUser();
    await registerPushToken(userId, TOKEN, "android");
    await notify(userId, { kind: "announcement", title: "Old", body: "x", dedupeKey: "o1" });
    const push = fakePush();
    await runOutbox(push.sender, Date.now() + 2 * MS_PER_DAY);
    expect(push.sent).toHaveLength(0);
    expect((await listNotifications(userId)).notifications).toHaveLength(1);
  });

  it("in-app list shows unread and can mark read", async () => {
    const userId = await createUser();
    for (let i = 0; i < 3; i++) await notify(userId, { kind: "announcement", title: `N${i}`, body: "x", dedupeKey: `n${i}` });
    const list = await listNotifications(userId);
    expect(list.unread).toBe(3);
    await markRead(userId, [list.notifications[0]!.id]);
    expect((await listNotifications(userId)).unread).toBe(2);
    await markRead(userId, "all");
    expect((await listNotifications(userId)).unread).toBe(0);
  });

  it("a device token moves to whoever registered it last", async () => {
    const a = await createUser();
    const b = await createUser();
    await registerPushToken(a, TOKEN, "android");
    await registerPushToken(b, TOKEN, "android");
    expect(String((await PushToken.findOne({ token: TOKEN }).lean())!.userId)).toBe(String(b));
  });
});

describe("events create notifications", () => {
  it("withdrawal paid, failed and rejected each notify the user", async () => {
    const speed = fakeSpeed();
    const admin = new Types.ObjectId();

    const paidUser = await userWith(10_000);
    const w1 = await requestWithdrawal(paidUser, { amountSats: 3000, destination: "a@speed.app" });
    await approveWithdrawal(w1.id, admin);

    const failedUser = await userWith(10_000);
    const w2 = await requestWithdrawal(failedUser, { amountSats: 2500, destination: "b@speed.app" });
    await approveWithdrawal(w2.id, admin);

    speed.next("paid", "refused");
    await runPayouts(speed.client);

    const rejectedUser = await userWith(10_000);
    const w3 = await requestWithdrawal(rejectedUser, { amountSats: 2500, destination: "c@speed.app" });
    await rejectWithdrawal(w3.id, admin, "Account under review");

    expect(await Notification.findOne({ userId: paidUser }).lean()).toMatchObject({ kind: "withdrawal_paid", body: "3,000 sats are on their way to your wallet." });
    expect((await Notification.findOne({ userId: failedUser }).lean())!.kind).toBe("withdrawal_failed");
    expect((await Notification.findOne({ userId: rejectedUser }).lean())!.body).toContain("Account under review");
  });

  it("a support reply notifies the user", async () => {
    const userId = await createUser();
    const t = await createTicket(userId, { category: "withdrawal", subject: "Where are my sats?", message: "Withdrawal pending for 2 days" });
    await adminReply(t.id, "Approved just now!");
    expect(await Notification.findOne({ userId }).lean()).toMatchObject({ kind: "support_reply", body: "Re: Where are my sats?" });
  });
});

describe("reminders", () => {
  // 10:30 in India (UTC+5:30) on 1 Oct 2026.
  const TEN_IST = Date.parse("2026-10-01T05:00:00Z");

  it("reminds at 10:00 local only if today's session isn't started, once a day", async () => {
    const idle = await createUser("Asia/Kolkata");
    const active = await createUser("Asia/Kolkata");
    const elsewhere = await createUser("America/New_York");
    const noPhone = await createUser("Asia/Kolkata");
    for (const u of [idle, active, elsewhere]) await registerPushToken(u, `${TOKEN}${u}`, "android");
    await startSession(active, TEN_IST - 3600_000);

    expect((await runReminders(TEN_IST)).mining).toBe(1);
    expect((await runReminders(TEN_IST + 60_000)).mining).toBe(0);
    expect(await Notification.countDocuments({ userId: idle, kind: "mining_reminder" })).toBe(1);
    expect(await Notification.countDocuments({ userId: { $in: [active, elsewhere, noPhone] } })).toBe(0);
  });

  it("warns once when a one-time paid miner has 3 days left", async () => {
    const userId = await createUser();
    await Product.updateOne({ sku: "miner_titan" }, { $set: { billing: "one_time" } });
    const titan = await Product.findOne({ sku: "miner_titan" }).lean();
    const now = Date.now();
    await Miner.create({ userId, source: "paid", gh: 2000, productId: titan!._id, startAt: new Date(now - 177 * MS_PER_DAY), endAt: new Date(now + 2.5 * MS_PER_DAY) });
    await Miner.create({ userId, source: "paid", gh: 65, startAt: new Date(now), endAt: new Date(now + 100 * MS_PER_DAY) });

    expect((await runReminders(now)).expiry).toBe(1);
    expect((await runReminders(now + 3600_000)).expiry).toBe(0);
    expect((await Notification.findOne({ userId, kind: "miner_expiry" }).lean())!.body).toBe("Your Titan (2,000 GH/s) stops mining in 3 days. Renew it now and keep earning without a gap.");
  });
});
