import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { Balance, Ledger, Withdrawal } from "../models/index.js";
import { clearTestDb, startTestDb, stopTestDb } from "../test/mongo.js";
import { createUser } from "../test/fixtures.js";
import { fakeSpeed } from "../test/speed.js";
import { invoiceForSats } from "../test/invoice.js";
import { seedAll } from "../db/seed.js";
import { AppError } from "../lib/errors.js";
import { ensureBalance } from "./balances.js";
import { approveWithdrawal, rejectWithdrawal, requestWithdrawal, resolveReconcile } from "./withdrawals.js";
import { runPayouts } from "./payoutJob.js";

const NOW = Date.parse("2026-10-20T10:00:00Z");
const ADMIN = new Types.ObjectId();
const SPEED = "alice@speed.app";

beforeAll(startTestDb, 180_000);
afterAll(stopTestDb);
beforeEach(async () => {
  await clearTestDb();
  await seedAll();
});

/** A user with `sats` available, recorded in the ledger like a real credit. */
async function userWith(sats: number) {
  const userId = await createUser();
  await ensureBalance(userId, NOW);
  await Balance.updateOne({ userId }, { $inc: { availableMsat: sats * 1000 } });
  await Ledger.create({ userId, type: "adjustment", bucket: "available", amountMsat: sats * 1000, idempotencyKey: `seed:${userId}` });
  return userId;
}

async function bal(userId: Types.ObjectId) {
  const b = (await Balance.findOne({ userId }).lean())!;
  return { available: b.availableMsat / 1000, locked: b.lockedMsat / 1000 };
}

/** The ledger must always add up to the balance. */
async function expectLedgerMatches(userId: Types.ObjectId) {
  const rows = await Ledger.find({ userId }).lean();
  const sum = (bucket: string) => rows.filter((r) => r.bucket === bucket).reduce((s, r) => s + r.amountMsat, 0);
  const b = (await Balance.findOne({ userId }).lean())!;
  expect(sum("available")).toBe(b.availableMsat);
  expect(sum("locked")).toBe(b.lockedMsat);
}

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e) => e instanceof AppError && e.code === code);
}

async function approved(userId: Types.ObjectId, sats: number, destination = SPEED) {
  const w = await requestWithdrawal(userId, { amountSats: sats, destination }, NOW);
  await approveWithdrawal(w.id, ADMIN, NOW);
  return w.id;
}

const status = async (id: string) => (await Withdrawal.findById(id).lean())!.status;

describe("requesting a withdrawal", () => {
  it("validates amount and destination", async () => {
    const userId = await userWith(10_000);
    await expectAppError(requestWithdrawal(userId, { amountSats: 2499, destination: SPEED }, NOW), "below_minimum");
    await expectAppError(requestWithdrawal(userId, { amountSats: 3000, destination: "bob@walletofsatoshi.com" }, NOW), "invalid_destination");
    await expectAppError(requestWithdrawal(userId, { amountSats: 3000, destination: invoiceForSats(2999, NOW) }, NOW), "invoice_amount_mismatch");
    await expectAppError(requestWithdrawal(userId, { amountSats: 3000, destination: invoiceForSats(3000, NOW, 300) }, NOW), "invoice_expiring");
    await expectAppError(requestWithdrawal(userId, { amountSats: 3000, destination: "not an invoice" }, NOW), "invalid_destination");
  });

  it("locks the funds immediately", async () => {
    const userId = await userWith(10_000);
    const w = await requestWithdrawal(userId, { amountSats: 3000, destination: "Alice@Speed.app" }, NOW);
    expect(w).toMatchObject({ status: "pending", amountSats: 3000, destination: "alice@speed.app" });
    expect(await bal(userId)).toEqual({ available: 7000, locked: 3000 });
    await expectLedgerMatches(userId);
  });

  it("accepts an exact-amount invoice from any wallet", async () => {
    const userId = await userWith(10_000);
    const w = await requestWithdrawal(userId, { amountSats: 2500, destination: invoiceForSats(2500, NOW) }, NOW);
    expect(w.destinationType).toBe("bolt11");
  });

  it("refuses more than the available balance and leaves nothing behind", async () => {
    const userId = await userWith(2600);
    await expectAppError(requestWithdrawal(userId, { amountSats: 3000, destination: SPEED }, NOW), "insufficient_balance");
    expect(await Withdrawal.countDocuments({ userId })).toBe(0);
    expect(await bal(userId)).toEqual({ available: 2600, locked: 0 });
  });

  it("allows only one open withdrawal at a time, even when requests race", async () => {
    const userId = await userWith(20_000);
    const results = await Promise.allSettled([
      requestWithdrawal(userId, { amountSats: 3000, destination: SPEED }, NOW),
      requestWithdrawal(userId, { amountSats: 3000, destination: SPEED }, NOW),
      requestWithdrawal(userId, { amountSats: 3000, destination: SPEED }, NOW),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await bal(userId)).toEqual({ available: 17_000, locked: 3000 });
    await expectLedgerMatches(userId);
  });

  it("rejecting returns the funds", async () => {
    const userId = await userWith(10_000);
    const w = await requestWithdrawal(userId, { amountSats: 3000, destination: SPEED }, NOW);
    await rejectWithdrawal(w.id, ADMIN, "suspicious activity", NOW);
    expect(await bal(userId)).toEqual({ available: 10_000, locked: 0 });
    await expectLedgerMatches(userId);
    // and a new one can be requested
    await requestWithdrawal(userId, { amountSats: 3000, destination: SPEED }, NOW);
  });
});

describe("payouts", () => {
  it("nothing is sent before an admin approves", async () => {
    const speed = fakeSpeed();
    const userId = await userWith(10_000);
    await requestWithdrawal(userId, { amountSats: 3000, destination: SPEED }, NOW);
    await runPayouts(speed.client, NOW);
    expect(speed.client.sendCalls).toBe(0);
  });

  it("an approved withdrawal is sent in sats and completes", async () => {
    const speed = fakeSpeed();
    const userId = await userWith(10_000);
    const id = await approved(userId, 3000);

    const r = await runPayouts(speed.client, NOW);

    expect(r).toMatchObject({ sent: 1, paid: 1 });
    expect([...speed.sends.values()][0]).toMatchObject({ amountSats: 3000, destination: SPEED, note: `bitmine:${id}` });
    expect(await status(id)).toBe("paid");
    expect(await bal(userId)).toEqual({ available: 7000, locked: 0 });
    await expectLedgerMatches(userId);
  });

  it("follows an unpaid send until Speed settles it", async () => {
    const speed = fakeSpeed();
    const userId = await userWith(10_000);
    const id = await approved(userId, 3000);
    speed.next("unpaid");

    await runPayouts(speed.client, NOW);
    expect(await status(id)).toBe("sending");
    speed.settle("is_1", "paid");
    await runPayouts(speed.client, NOW + 60_000);

    expect(await status(id)).toBe("paid");
    expect(speed.client.sendCalls).toBe(1);
  });

  it("a send Speed later fails returns the funds", async () => {
    const speed = fakeSpeed();
    const userId = await userWith(10_000);
    const id = await approved(userId, 3000);
    speed.next("unpaid");
    await runPayouts(speed.client, NOW);
    speed.settle("is_1", "failed");
    await runPayouts(speed.client, NOW + 60_000);

    expect(await status(id)).toBe("failed");
    expect(await bal(userId)).toEqual({ available: 10_000, locked: 0 });
    await expectLedgerMatches(userId);
  });

  it("a clear refusal from Speed returns the funds", async () => {
    const speed = fakeSpeed();
    const userId = await userWith(10_000);
    const id = await approved(userId, 3000);
    speed.next("refused");
    await runPayouts(speed.client, NOW);
    expect(await status(id)).toBe("failed");
    expect(await bal(userId)).toEqual({ available: 10_000, locked: 0 });
  });

  it("a timeout never causes a second send: the payment is found by its note", async () => {
    const speed = fakeSpeed();
    const userId = await userWith(10_000);
    const id = await approved(userId, 3000);
    speed.next("timeout_sent");

    await runPayouts(speed.client, NOW);
    expect(await status(id)).toBe("needs_reconcile");
    expect(await bal(userId)).toEqual({ available: 7000, locked: 3000 }); // still locked

    speed.settle("is_1", "paid");
    await runPayouts(speed.client, NOW + 60_000);
    await runPayouts(speed.client, NOW + 120_000);

    expect(await status(id)).toBe("paid");
    expect(speed.client.sendCalls).toBe(1);
    expect(await bal(userId)).toEqual({ available: 7000, locked: 0 });
    await expectLedgerMatches(userId);
  });

  it("a timeout where nothing reached Speed waits for an admin decision", async () => {
    const speed = fakeSpeed();
    const userId = await userWith(10_000);
    const id = await approved(userId, 3000);
    speed.next("timeout_lost");

    await runPayouts(speed.client, NOW);
    await runPayouts(speed.client, NOW + 40 * 60_000);
    expect(await status(id)).toBe("needs_reconcile");
    expect(speed.client.sendCalls).toBe(1);

    await resolveReconcile(id, ADMIN, "failed", "not in Speed dashboard", NOW + 50 * 60_000);
    expect(await status(id)).toBe("failed");
    expect(await bal(userId)).toEqual({ available: 10_000, locked: 0 });
    await expectLedgerMatches(userId);
  });

  it("pauses without sending anything when the Speed balance is too low", async () => {
    const speed = fakeSpeed();
    const a = await userWith(10_000);
    const b = await userWith(10_000);
    const idA = await approved(a, 3000);
    const idB = await approved(b, 3000);
    speed.next("insufficient");

    const r = await runPayouts(speed.client, NOW);

    expect(r.paused).toBe("insufficient_funds");
    expect(speed.client.sendCalls).toBe(1);
    expect(await status(idA)).toBe("approved");
    expect(await status(idB)).toBe("approved");

    const later = await runPayouts(speed.client, NOW + 60_000); // topped up
    expect(later.paid).toBe(2);
  });

  it("fails an invoice that expired before payout, without sending", async () => {
    const speed = fakeSpeed();
    const userId = await userWith(10_000);
    const id = await approved(userId, 2500, invoiceForSats(2500, NOW, 3600));
    await runPayouts(speed.client, NOW + 2 * 60 * 60_000);
    expect(speed.client.sendCalls).toBe(0);
    expect(await status(id)).toBe("failed");
    expect(await bal(userId)).toEqual({ available: 10_000, locked: 0 });
  });

  it("two payout workers at once send each withdrawal exactly once", async () => {
    const speed = fakeSpeed();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await approved(await userWith(10_000), 3000));

    await Promise.all([runPayouts(speed.client, NOW), runPayouts(speed.client, NOW), runPayouts(speed.client, NOW)]);

    expect(speed.client.sendCalls).toBe(6);
    for (const id of ids) expect(await status(id)).toBe("paid");
  });

  it("payouts pause when Speed isn't configured", async () => {
    const userId = await userWith(10_000);
    const id = await approved(userId, 3000);
    expect((await runPayouts(undefined, NOW)).paused).toBe("no_client");
    expect(await status(id)).toBe("approved");
  });
});
