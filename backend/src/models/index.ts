/**
 * MongoDB models (docs/TECHNICAL_SPEC.md §4). Times are Date (UTC); money is
 * integer millisatoshis stored as Number (exact up to 2^53 msat ≈ 90,000 BTC).
 */
import mongoose, { Schema, type InferSchemaType, type Types } from "mongoose";

const { ObjectId } = Schema.Types;

const intMsat = {
  type: Number,
  required: true,
  default: 0,
  validate: { validator: Number.isSafeInteger, message: "amounts must be whole msat" },
};

// ── users ────────────────────────────────────────────────────────────────
const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, select: false },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    photoUrl: String,
    emailVerified: { type: Boolean, default: false },
    providers: {
      google: { sub: String },
      apple: { sub: String },
    },
    timezone: { type: String, required: true },
    timezonePending: { tz: String, effectiveAt: Date },
    timezoneChangedAt: Date,
    referralCode: { type: String, required: true, unique: true },
    referredBy: { type: ObjectId, ref: "User" },
    twoFactor: { enabled: { type: Boolean, default: false } },
    status: { type: String, enum: ["active", "suspended", "deleted"], default: "active" },
    deviceIds: { type: [String], default: [] },
    /** Failed password attempts in the current 15-minute window (login lockout). */
    failedLogins: { count: { type: Number, default: 0 }, windowStart: Date },
    lockUntil: Date,
    deletedAt: Date,
    /** Reasons an admin should look before paying this user (e.g. a refunded purchase). */
    reviewFlags: {
      type: [{ reason: String, refType: String, refId: ObjectId, createdAt: Date, _id: false }],
      default: [],
    },
  },
  { timestamps: true },
);
userSchema.index({ "providers.google.sub": 1 }, { unique: true, partialFilterExpression: { "providers.google.sub": { $type: "string" } } });
userSchema.index({ "providers.apple.sub": 1 }, { unique: true, partialFilterExpression: { "providers.apple.sub": { $type: "string" } } });
userSchema.index({ referredBy: 1 });

// ── settings (versioned) ─────────────────────────────────────────────────
const economicsValuesSchema = new Schema(
  {
    rateMsatPerGhDay: { type: Number, required: true },
    claimGh: { type: Number, required: true },
    claimsPerDay: { type: Number, required: true },
    minWithdrawalSats: { type: Number, required: true },
    referralPercent: { type: Number, required: true },
    referralCapSatsPerDay: { type: Number, required: true },
    withdrawalAutoApproveMaxSats: { type: Number, required: true },
  },
  { _id: false },
);
const settingsSchema = new Schema(
  {
    key: { type: String, required: true },
    version: { type: Number, required: true },
    effectiveAt: { type: Date, required: true },
    createdBy: { type: ObjectId },
    values: { type: economicsValuesSchema, required: true },
  },
  { timestamps: true },
);
settingsSchema.index({ key: 1, version: 1 }, { unique: true });
settingsSchema.index({ key: 1, effectiveAt: 1 });

// ── products ─────────────────────────────────────────────────────────────
const productSchema = new Schema(
  {
    sku: { type: String, required: true, unique: true },
    kind: { type: String, enum: ["miner", "super_miner"], required: true },
    name: { type: String, required: true },
    priceDisplayUsd: { type: Number, required: true },
    durationDays: { type: Number, required: true },
    gh: Number,
    claimGh: Number,
    claimsPerDay: Number,
    storeIds: { apple: String, google: String },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// ── miners: every source of hashpower ───────────────────────────────────
const minerSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    source: { type: String, enum: ["paid", "claim", "super_claim", "admin_grant"], required: true },
    gh: { type: Number, required: true, min: 0 },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    status: { type: String, enum: ["active", "expired", "revoked"], default: "active" },
    productId: { type: ObjectId, ref: "Product" },
    purchaseId: { type: ObjectId, ref: "Purchase" },
    claimId: { type: ObjectId, ref: "Claim" },
    revokedAt: Date,
    revokeReason: String,
  },
  { timestamps: true },
);
minerSchema.index({ userId: 1, endAt: 1 });
minerSchema.index({ userId: 1, status: 1 });
minerSchema.index({ claimId: 1 }, { unique: true, partialFilterExpression: { claimId: { $exists: true } } });
minerSchema.index({ purchaseId: 1 }, { unique: true, partialFilterExpression: { purchaseId: { $exists: true } } });

// ── sessions: daily "Start mining" ──────────────────────────────────────
const sessionSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    localDate: { type: String, required: true },
    tz: { type: String, required: true },
    startedAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    /**
     * Verified claims today per track: "regular" or a Super Miner tier's
     * productId. Incremented with a conditional $inc so the daily cap holds
     * even when two ad verifications arrive at the same moment.
     */
    claimCounts: { type: Map, of: Number, default: {} },
  },
  { timestamps: true },
);
sessionSchema.index({ userId: 1, localDate: 1 }, { unique: true });

// ── claims: one per rewarded ad ──────────────────────────────────────────
const claimSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["regular", "super"], required: true },
    tierProductId: { type: ObjectId, ref: "Product" },
    gh: { type: Number, required: true },
    localDate: { type: String, required: true },
    status: { type: String, enum: ["pending", "verified", "expired", "rejected"], default: "pending" },
    admob: { transactionId: String, adUnit: String, rewardItem: String, verifiedAt: Date },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
claimSchema.index({ "admob.transactionId": 1 }, { unique: true, partialFilterExpression: { "admob.transactionId": { $type: "string" } } });
claimSchema.index({ userId: 1, localDate: 1, kind: 1, tierProductId: 1, status: 1 });

// ── purchases ────────────────────────────────────────────────────────────
const purchaseSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    productId: { type: ObjectId, ref: "Product", required: true },
    store: { type: String, enum: ["app_store", "play_store"], required: true },
    storeTransactionId: { type: String, required: true, unique: true },
    rcAppUserId: { type: String, required: true },
    rcEventId: String,
    purchasedAt: { type: Date, required: true },
    priceUsd: Number,
    currency: String,
    status: { type: String, enum: ["granted", "refunded"], default: "granted" },
    grantedMinerId: { type: ObjectId, ref: "Miner" },
    grantedSuperUntil: Date,
  },
  { timestamps: true },
);
purchaseSchema.index({ userId: 1, purchasedAt: -1 });

// ── superEntitlements: one per user per Super Miner tier ────────────────
const superEntitlementSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    productId: { type: ObjectId, ref: "Product", required: true },
    activeUntil: { type: Date, required: true },
    lastPurchaseId: { type: ObjectId, ref: "Purchase" },
  },
  { timestamps: true },
);
superEntitlementSchema.index({ userId: 1, productId: 1 }, { unique: true });

// ── otps: one-time email codes ───────────────────────────────────────────
const otpSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User" },
    email: { type: String, required: true, lowercase: true },
    purpose: {
      type: String,
      enum: ["verify_email", "login_2fa", "reset_password", "change_email", "enable_2fa", "disable_2fa", "withdrawal"],
      required: true,
    },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    consumedAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
otpSchema.index({ email: 1, purpose: 1, createdAt: -1 });
// MongoDB deletes codes a day after they expire.
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

// ── refreshTokens: rotated, stored hashed ────────────────────────────────
const refreshTokenSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    familyId: { type: String, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    replacedBy: { type: ObjectId },
    deviceId: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
refreshTokenSchema.index({ userId: 1 });
refreshTokenSchema.index({ familyId: 1 });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

// ── rateLimits: fixed-window counters ───────────────────────────────────
const rateLimitSchema = new Schema({
  _id: { type: String },
  count: { type: Number, default: 0 },
  expireAt: { type: Date, required: true },
});
rateLimitSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

// ── storeSyncs: follow-up RevenueCat checks after a purchase ────────────
const storeSyncSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    dueAt: { type: Date, required: true },
    attempt: { type: Number, default: 0 },
  },
  { timestamps: true },
);
storeSyncSchema.index({ dueAt: 1 });

// ── ledger: append-only ──────────────────────────────────────────────────
const ledgerSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["mining", "referral", "withdrawal_lock", "withdrawal_unlock", "withdrawal_paid", "adjustment"],
      required: true,
    },
    amountMsat: { ...intMsat, default: undefined },
    bucket: { type: String, enum: ["available", "locked"], required: true },
    idempotencyKey: { type: String, required: true, unique: true },
    refType: String,
    refId: { type: ObjectId },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
ledgerSchema.index({ userId: 1, createdAt: -1 });

// ── balances: cache of ledger sums, updated in the same transaction ─────
const balanceSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true, unique: true },
    availableMsat: intMsat,
    lockedMsat: intMsat,
    lifetimeMinedMsat: intMsat,
    /** Mining has been credited up to (not including) this instant. */
    accruedUntil: { type: Date },
    /** Fraction of a msat carried between hourly credits (see mining/accrual.ts toWholeMsat). */
    accrualRemainder: { type: Number, default: 0, min: 0, max: 1 },
    /**
     * Bumped whenever a miner is added that may start before accruedUntil
     * (late-processed purchases). The accrual transaction reads this document,
     * so the two always conflict and one retries with fresh data.
     */
    minersRev: { type: Number, default: 0 },
  },
  { timestamps: true },
);
balanceSchema.index({ accruedUntil: 1 });

// ── withdrawals ──────────────────────────────────────────────────────────
const OPEN_WITHDRAWAL = ["pending_review", "approved", "sending", "needs_reconcile"];
const withdrawalSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    amountSats: { type: Number, required: true, validate: { validator: Number.isSafeInteger, message: "whole sats only" } },
    destinationType: { type: String, enum: ["speed_address", "bolt11"], required: true },
    destination: { type: String, required: true },
    /** BOLT11 only: the invoice can't be paid after this. */
    destinationExpiresAt: Date,
    status: {
      type: String,
      enum: ["pending_review", "approved", "sending", "paid", "failed", "rejected", "needs_reconcile"],
      default: "pending_review",
    },
    speed: { paymentId: String, note: String, feeSats: Number, rawStatus: String, failureReason: String },
    sendingAt: Date,
    reviewedBy: { type: ObjectId },
    reviewedAt: Date,
    rejectReason: String,
    attempts: { type: Number, default: 0 },
    lastError: String,
    paidAt: Date,
  },
  { timestamps: true },
);
// At most one open withdrawal per user.
withdrawalSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { status: { $in: OPEN_WITHDRAWAL } } });
withdrawalSchema.index({ status: 1, createdAt: 1 });

// ── referralDaily ────────────────────────────────────────────────────────
const referralDailySchema = new Schema(
  {
    referrerId: { type: ObjectId, ref: "User", required: true },
    localDate: { type: String, required: true },
    creditedMsat: intMsat,
  },
  { timestamps: true },
);
referralDailySchema.index({ referrerId: 1, localDate: 1 }, { unique: true });

export const User = mongoose.model("User", userSchema);
export const Settings = mongoose.model("Settings", settingsSchema);
export const Product = mongoose.model("Product", productSchema);
export const Miner = mongoose.model("Miner", minerSchema);
export const Session = mongoose.model("Session", sessionSchema);
export const Claim = mongoose.model("Claim", claimSchema);
export const Purchase = mongoose.model("Purchase", purchaseSchema);
export const SuperEntitlement = mongoose.model("SuperEntitlement", superEntitlementSchema);
export const StoreSync = mongoose.model("StoreSync", storeSyncSchema);
export const Otp = mongoose.model("Otp", otpSchema);
export const RefreshToken = mongoose.model("RefreshToken", refreshTokenSchema);
export const RateLimit = mongoose.model("RateLimit", rateLimitSchema);
export const Ledger = mongoose.model("Ledger", ledgerSchema);
export const Balance = mongoose.model("Balance", balanceSchema);
export const Withdrawal = mongoose.model("Withdrawal", withdrawalSchema);
export const ReferralDaily = mongoose.model("ReferralDaily", referralDailySchema);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };
export type MinerDoc = InferSchemaType<typeof minerSchema> & { _id: Types.ObjectId };
export type SessionDoc = InferSchemaType<typeof sessionSchema> & { _id: Types.ObjectId };
export type ClaimDoc = InferSchemaType<typeof claimSchema> & { _id: Types.ObjectId };
export type WithdrawalDoc = InferSchemaType<typeof withdrawalSchema> & { _id: Types.ObjectId };
export type BalanceDoc = InferSchemaType<typeof balanceSchema> & { _id: Types.ObjectId };
