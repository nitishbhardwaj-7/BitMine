/**
 * Production-hardening behaviours added in the pre-deploy audit:
 *  - the app can cancel a pending claim, and a late AdMob callback grants nothing
 *  - account deletion waits for an open withdrawal
 *  - a withdrawal refused for an open one doesn't consume the 2FA code
 *  - repeated store syncs keep one set of follow-ups and are rate-limited
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Balance, Claim, Ledger, Miner, Otp, StoreSync, User } from "./models/index.js";
import { clearTestDb, startTestDb, stopTestDb } from "./test/mongo.js";
import { createUser } from "./test/fixtures.js";
import { memoryMailer } from "./test/auth.js";
import { fakeRevenueCat } from "./test/revenuecat.js";
import { seedAll } from "./db/seed.js";
import { AppError } from "./lib/errors.js";
import { startSession } from "./mining/sessions.js";
import { cancelClaim, createClaimIntent, verifySsvReward } from "./claims/service.js";
import { ensureBalance } from "./wallet/balances.js";
import { requestWithdrawal } from "./wallet/withdrawals.js";
import { sendOtp } from "./auth/otp.js";
import { deleteAccount } from "./users/profile.js";
import { syncFromApp } from "./store/service.js";

const NOW = Date.parse("2026-10-20T10:00:00Z");

beforeAll(startTestDb, 180_000);
afterAll(stopTestDb);
beforeEach(async () => {
  await clearTestDb();
  await seedAll();
});

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e) => e instanceof AppError && e.code === code);
}

async function userWithSats(sats: number) {
  const userId = await createUser();
  await ensureBalance(userId, NOW);
  await Balance.updateOne({ userId }, { $inc: { availableMsat: sats * 1000 } });
  await Ledger.create({ userId, type: "adjustment", bucket: "available", amountMsat: sats * 1000, idempotencyKey: `seed:${userId}` });
  return userId;
}

describe("cancelling a claim", () => {
  it("frees the slot, and a callback that arrives afterwards grants nothing", async () => {
    const userId = await createUser();
    await startSession(userId, NOW);
    const intent = await createClaimIntent(userId, { kind: "regular" }, NOW);

    const r = await cancelClaim(userId, intent.claimId);
    expect(r).toMatchObject({ status: "expired", cancelled: true });
    // Second cancel is a harmless no-op.
    expect((await cancelClaim(userId, intent.claimId)).cancelled).toBe(false);

    const late = await verifySsvReward({ keyId: "k", customData: intent.claimId, userId: String(userId), transactionId: "tx-late" }, NOW + 1000);
    expect(late).toEqual({ result: "ignored", reason: "claim_expired" });
    expect(await Miner.countDocuments({ userId })).toBe(0);

    // The cancelled claim no longer counts towards the open-claims limit.
    for (let i = 0; i < 3; i++) await createClaimIntent(userId, { kind: "regular" }, NOW);
    await expectAppError(createClaimIntent(userId, { kind: "regular" }, NOW), "too_many_pending");
  });

  it("only touches the caller's own claims", async () => {
    const a = await createUser();
    const b = await createUser();
    await startSession(a, NOW);
    const intent = await createClaimIntent(a, { kind: "regular" }, NOW);
    await expectAppError(cancelClaim(b, intent.claimId), "not_found");
    expect((await Claim.findById(intent.claimId).lean())!.status).toBe("pending");
  });
});

describe("withdrawals and account deletion", () => {
  it("deleting an account waits for an open withdrawal", async () => {
    const userId = await userWithSats(5000);
    await requestWithdrawal(userId, { amountSats: 2500, destination: "alice@speed.app" }, NOW);
    await expectAppError(deleteAccount(userId, NOW), "withdrawal_open");
    expect((await User.findById(userId).lean())!.status).toBe("active");
  });

  it("a request refused for an open withdrawal leaves the 2FA code usable", async () => {
    const userId = await userWithSats(10_000);
    await User.updateOne({ _id: userId }, { $set: { "twoFactor.enabled": true } });
    const email = (await User.findById(userId).lean())!.email;
    const { mailer, lastCode } = memoryMailer();

    await sendOtp(mailer, { email, purpose: "withdrawal", userId }, NOW);
    await requestWithdrawal(userId, { amountSats: 2500, destination: "alice@speed.app", code: lastCode(email) }, NOW);

    await sendOtp(mailer, { email, purpose: "withdrawal", userId }, NOW + 61_000);
    const code = lastCode(email);
    await expectAppError(requestWithdrawal(userId, { amountSats: 2500, destination: "alice@speed.app", code }, NOW + 62_000), "withdrawal_open");
    const otp = await Otp.findOne({ email, purpose: "withdrawal" }).sort({ createdAt: -1 }).lean();
    expect(otp!.consumedAt).toBeFalsy();
  });
});

describe("store sync from the app", () => {
  it("keeps one set of follow-up checks per user and rate-limits repeated syncs", async () => {
    const rc = fakeRevenueCat();
    const deps = { revenueCat: rc.client, allowSandbox: false };
    const userId = await createUser();

    await syncFromApp(userId, deps, NOW);
    await syncFromApp(userId, deps, NOW + 1000);
    await syncFromApp(userId, deps, NOW + 2000);
    expect(await StoreSync.countDocuments({ userId })).toBe(3);

    for (let i = 3; i < 12; i++) await syncFromApp(userId, deps, NOW + i * 1000);
    await expectAppError(syncFromApp(userId, deps, NOW + 20_000), "rate_limited");
  });
});
