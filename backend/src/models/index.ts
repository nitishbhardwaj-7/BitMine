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
    notificationPrefs: {
      miningReminder: { type: Boolean, default: true },
      minerExpiry: { type: Boolean, default: true },
      withdrawals: { type: Boolean, default: true },
      support: { type: Boolean, default: true },
    },
    /** Consecutive local days mining was started (mining/streak.ts). */
    streak: { count: { type: Number, default: 0 }, lastDate: String },
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
    dailyStartRequired: { type: Boolean },
    startAds: { type: Number },
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
    kind: { type: String, enum: ["miner", "super_miner", "bundle"], required: true },
    name: { type: String, required: true },
    priceDisplayUsd: { type: Number, required: true },
    listPriceUsd: Number,
    billing: { type: String, enum: ["one_time", "subscription"], default: "one_time" },
    bundleSuperSku: String,
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
    source: { type: String, enum: ["paid", "claim", "super_claim", "admin_grant", "boost", "streak", "game"], required: true },
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
// Claim miners only live until midnight; keep them 90 days for support, then let MongoDB drop them.
// Paid and admin-granted miners are never expired by TTL.
minerSchema.index(
  { endAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60, partialFilterExpression: { source: { $in: ["claim", "super_claim"] } } },
);

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
    /** A game round was lost: a retry video is needed before the next round. */
    gameLock: Boolean,
    /** Rewarded videos needed to start this day (fixed when the session is opened) and confirmed so far. */
    adsRequired: { type: Number, default: 0 },
    adsWatched: { type: Number, default: 0 },
    /** When the day's mining switched on (the last start video). Unset while the videos are still owed. */
    activatedAt: Date,
  },
  { timestamps: true },
);
sessionSchema.index({ userId: 1, localDate: 1 }, { unique: true });
sessionSchema.index({ userId: 1, endsAt: 1 });
sessionSchema.index({ endsAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// ── claims: one per rewarded ad ──────────────────────────────────────────
const claimSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    /** "start" = a video that counts towards starting the day's mining (no hashpower of its own). */
    /** "game" = the reward for a won game round; "retry" = a video that unlocks the games after a loss. */
    kind: { type: String, enum: ["regular", "super", "start", "boost", "game", "retry"], required: true },
    tierProductId: { type: ObjectId, ref: "Product" },
    roundId: { type: ObjectId, ref: "GameRound" },
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
// One row per ad watched: kept 60 days (the AdMob transaction id guards replays well within that).
claimSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

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

// ── jobState: progress markers for daily jobs ───────────────────────────
const jobStateSchema = new Schema(
  { _id: { type: String }, lastDay: String },
  { timestamps: true },
);

// ── pushTokens: FCM device tokens ────────────────────────────────────────
const pushTokenSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    token: { type: String, required: true, unique: true },
    platform: { type: String, enum: ["android", "ios"], required: true },
  },
  { timestamps: true },
);
pushTokenSchema.index({ userId: 1 });

// ── notifications: outbox + in-app history ───────────────────────────────
const notificationSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    kind: {
      type: String,
      enum: ["mining_reminder", "miner_expiry", "withdrawal_paid", "withdrawal_failed", "withdrawal_rejected", "support_reply", "announcement"],
      required: true,
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    data: { type: Schema.Types.Mixed },
    /** Makes a notification happen at most once (e.g. "mining_reminder:2026-10-01"). */
    dedupeKey: { type: String, required: true },
    push: { type: String, enum: ["pending", "sent", "skipped", "failed"], default: "pending" },
    attempts: { type: Number, default: 0 },
    readAt: Date,
  },
  { timestamps: true },
);
notificationSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true });
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ push: 1, createdAt: 1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

// ── supportTickets ───────────────────────────────────────────────────────
const supportTicketSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    category: { type: String, enum: ["withdrawal", "purchase", "mining", "account", "other"], default: "other" },
    subject: { type: String, required: true, maxlength: 120 },
    status: { type: String, enum: ["open", "answered", "closed"], default: "open" },
    messages: {
      type: [{ from: { type: String, enum: ["user", "admin"], required: true }, text: { type: String, required: true, maxlength: 4000 }, at: { type: Date, required: true }, _id: false }],
      default: [],
    },
  },
  { timestamps: true },
);
supportTicketSchema.index({ userId: 1, updatedAt: -1 });
supportTicketSchema.index({ status: 1, updatedAt: 1 });

// ── faqs ─────────────────────────────────────────────────────────────────
const faqSchema = new Schema(
  {
    question: { type: String, required: true },
    answer: { type: String, required: true },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    seedKey: { type: String, unique: true, sparse: true },
  },
  { timestamps: true },
);

// ── appConfig: app-wide settings the app reads at start ─────────────────
const appConfigSchema = new Schema(
  {
    _id: { type: String },
    minVersion: { android: String, ios: String },
    latestVersion: { android: String, ios: String },
    updateMessage: String,
    storeUrls: { android: String, ios: String },
    adUnits: {
      android: { rewarded: String, banner: String },
      ios: { rewarded: String, banner: String },
    },
    /**
     * AdMob test device IDs (from the AdMob SDK's logcat line). These phones get
     * test videos even while the app is new / unapproved, and the callbacks still
     * reach the server, so claims can be tested end to end on them.
     */
    admobTestDevices: { type: [String], default: [] },
    /** Estimated rewarded eCPM (USD per 1,000 views) for the dashboard's ad revenue estimate. */
    adEcpmUsd: { type: Number, default: 4 },
    /** Perks, bonuses and offers (settings/growth.ts holds the defaults). */
    growth: {
      paidSkipStartAds: Boolean,
      streakDays: Number,
      streakBonusGh: Number,
      boostAdsPerDay: Number,
      boostMinutes: Number,
      boostMaxGh: Number,
      gameWinsPerDay: Number,
      gameGh: Number,
      offerHours: Number,
    },
    /** A limited-time sale banner shown on Home and in the Store. */
    promo: { active: Boolean, title: String, body: String, badge: String, sku: String, endsAt: Date },
    supportEmail: String,
    termsUrl: String,
    privacyUrl: String,
  },
  { timestamps: true },
);

// ── admin: users, sessions, audit ───────────────────────────────────────
const adminUserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    active: { type: Boolean, default: true },
    lastLoginAt: Date,
  },
  { timestamps: true },
);

const adminSessionSchema = new Schema(
  {
    adminId: { type: ObjectId, ref: "AdminUser", required: true },
    tokenHash: { type: String, required: true, unique: true },
    /** Always "full" now (the authenticator step was removed); kept for older sessions. */
    stage: { type: String, enum: ["password", "full"], required: true },
    csrf: { type: String, required: true },
    ip: String,
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
adminSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const adminAuditSchema = new Schema(
  {
    adminId: { type: ObjectId, ref: "AdminUser", required: true },
    action: { type: String, required: true },
    targetType: String,
    targetId: String,
    details: { type: Schema.Types.Mixed },
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
adminAuditSchema.index({ createdAt: -1 });

// ── newsArticles: headlines from RSS feeds ──────────────────────────────
const newsArticleSchema = new Schema(
  {
    url: { type: String, required: true, unique: true },
    source: { type: String, required: true },
    title: { type: String, required: true },
    summary: { type: String, default: "" },
    imageUrl: String,
    category: { type: String, enum: ["BITCOIN", "MINING", "MARKET", "WEB3"], required: true },
    publishedAt: { type: Date, required: true },
  },
  { timestamps: true },
);
newsArticleSchema.index({ publishedAt: -1 });
newsArticleSchema.index({ category: 1, publishedAt: -1 });

// ── lessons: Academy ─────────────────────────────────────────────────────
const lessonSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    summary: { type: String, required: true },
    body: { type: String, required: true },
    level: { type: String, default: "Beginner" },
    category: { type: String, default: "Mining" },
    minutes: { type: Number, default: 3 },
    image: { type: String, default: "btc_cloud_hero" },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// ── gameRounds: one play of a mini-game (games/service.ts) ──────────────
const gameRoundSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    game: { type: String, enum: ["block", "match"], required: true },
    localDate: { type: String, required: true },
    status: { type: String, enum: ["playing", "won", "lost", "claimed"], default: "playing" },
    startedAt: { type: Date, required: true },
    finishedAt: Date,
  },
  { timestamps: true },
);
gameRoundSchema.index({ userId: 1, localDate: 1 });
gameRoundSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

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
// Follow-ups are consumed within an hour; anything older is a leftover from a failed run.
storeSyncSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

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
// The transactions list pages through a user's rows newest-first by _id.
ledgerSchema.index({ userId: 1, _id: -1 });
// Referral job: a day's mining credits.
ledgerSchema.index({ type: 1, createdAt: 1 });

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
export const GameRound = mongoose.model("GameRound", gameRoundSchema);
export const Otp = mongoose.model("Otp", otpSchema);
export const RefreshToken = mongoose.model("RefreshToken", refreshTokenSchema);
export const RateLimit = mongoose.model("RateLimit", rateLimitSchema);
export const JobState = mongoose.model("JobState", jobStateSchema);
export const PushToken = mongoose.model("PushToken", pushTokenSchema);
export const Notification = mongoose.model("Notification", notificationSchema);
export const SupportTicket = mongoose.model("SupportTicket", supportTicketSchema);
export const Faq = mongoose.model("Faq", faqSchema);
export const AppConfig = mongoose.model("AppConfig", appConfigSchema);
export const AdminUser = mongoose.model("AdminUser", adminUserSchema);
export const NewsArticle = mongoose.model("NewsArticle", newsArticleSchema);
export const Lesson = mongoose.model("Lesson", lessonSchema);
export const AdminSession = mongoose.model("AdminSession", adminSessionSchema);
export const AdminAudit = mongoose.model("AdminAudit", adminAuditSchema);
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
