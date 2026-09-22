# BitMine Technical Spec (v1)

Status: draft for review · 2026-09-22
Inputs: [BITPLAY_BACKEND_ANALYSIS.md](BITPLAY_BACKEND_ANALYSIS.md), [BITPLAY_BUG_AUDIT.md](BITPLAY_BUG_AUDIT.md), [ECONOMICS.md](ECONOMICS.md)

---

## 1. Principles

1. **The server is the only source of truth for money.** The app never sends hashpower, amounts earned, ad counts, dates or balances. It sends *intents* ("start mining", "claim", "withdraw 3,000 sats"), and the server decides.
2. **Every sat is in a ledger.** Balances change only by inserting ledger entries inside a DB transaction. Each entry has a unique idempotency key, so any job can re-run safely.
3. **Integers only.** All amounts are stored as **millisatoshis (msat)** in integer fields. There are no floats and no Decimal128 in money paths.
4. **Time is absolute.** The server stores UTC instants. Each user has a fixed IANA timezone, and "local midnight" is computed on the server from it. The app's clock is never trusted.
5. **Config, not code.** The rate, GH/s per claim, caps, minimum withdrawal and referral percentages all live in `settings` and can be changed from the admin panel. Changes are versioned and take effect from a stated instant.
6. **Fail closed.** If a verification step (AdMob, RevenueCat, Speed) can't be completed, nothing is granted or paid, and the case goes to a retry queue or to admin review.

---

## 2. Product rules (from ECONOMICS.md)

| Rule | Value (default, admin-editable) |
|---|---|
| Mining rate | 0.048 sats per GH/s per day (= 48 msat per GH/s per day) |
| Daily session | The user taps **Start mining** once per local day. The session ends at local midnight. |
| Free claim | Rewarded ad → **+5.5 GH/s** from claim time until local midnight. **60/day.** Available to all users, paid included. |
| Super Miner tiers | Paid unlocks, each adding its **own** daily claim track (GH/s lasts until local midnight). Tiers stack; buying a tier again extends it. |
| · Super Miner | **$4.99 / 30 days**: +30 claims/day × 5.5 GH/s = up to 165 GH/s/day |
| · Super Miner Pro | **$49 / 365 days**: +50 claims/day × 10 GH/s = up to 500 GH/s/day |
| · Super Miner Max | **$99 / 365 days**: +50 claims/day × 20 GH/s = up to 1 TH/s/day |
| Paid miners | 180 days, mine 24/7, **no Start needed**, stack without limit |
| Paid packs | Mini 65 GH/s $1.99 · Spark 170 GH/s $4.99 · Core 360 GH/s $9.99 · Forge 760 GH/s $19.99 · Titan 2,000 GH/s $49.99 |
| Referral | Referrer earns 5% of each referee's *mining* credits, capped at **5 sats/day per referrer** (total across all referees) |
| Min withdrawal | **2,500 sats** |
| 15-day guard | Admin config validation warns if one Titan + all 60 free claims + one Super Miner Max could reach the minimum in under 15 days (owning several paid tiers or packs may be faster, which is intended) |

Claims require an active session for today. Paid miners accrue whether or not a session is active.

---

## 3. Architecture

```
React Native app (TypeScript)
   │  HTTPS, Bearer access token
   ▼
bitmine-api  (Node 22 + TypeScript + Express)       ── one repo, two processes
   ├─ modules: auth · mining · claims · store · wallet · referrals · notifications · support · admin
   ├─ /webhooks/admob-ssv      (AdMob rewarded server-side verification)
   ├─ /webhooks/revenuecat
   └─ /admin/*                 (server-rendered admin panel)
bitmine-worker (same codebase, separate process, single instance)
   ├─ accrual job        every hour     → credits mining earnings to the ledger
   ├─ referral job       daily          → credits referral rewards
   ├─ payout job         every minute   → sends approved withdrawals via Speed, reconciles stuck ones
   ├─ purchase reconcile every 15 min   → catches purchases whose app call and webhook were both missed
   └─ notifications      scheduled pushes (session reminder, miner expiring, withdrawal status)
MongoDB Atlas (replica set, so multi-document transactions work)
Firebase (FCM push only) · AdMob · RevenueCat · Speed · Brevo (email)
```

**Why one service instead of BitPlay's two:** BitPlay's auth and API services share a database anyway and have to keep `JWT_SECRET` identical. Merging them removes a whole class of drift. The auth *code* (register, login, social, OTP, 2FA) is ported from `BitPlay-Auth` with the fixes in §9.

**Why a separate worker process:** BitPlay runs its cron jobs inside the web server, so two web instances meant double settlement (audit M8). Here the worker is a single process, and every job is idempotent anyway.

**Hosting:** one VPS (2 vCPU / 4 GB) running both processes under pm2 or Docker, behind nginx with HTTPS, plus MongoDB Atlas (M10 once live; M0/M2 for development).

---

## 4. Data model (MongoDB)

All `_id`s are ObjectIds. All times are UTC `Date`. All money fields are integer msat.

### users
```
_id, email (unique, lowercase), passwordHash?, name, photoUrl?
emailVerified: bool
providers: { google?: { sub }, apple?: { sub } }
timezone: IANA string (e.g. "Asia/Kolkata")           // set at signup from device, see §6.1
timezonePending?: { tz, effectiveAt }                  // change applies from next local midnight
timezoneChangedAt?: Date                               // max 1 change / 30 days
referralCode: string (unique, 8 chars, no ambiguous chars)
referredBy?: userId                                    // set once at signup or within 7 days
twoFactor: { enabled: bool }
status: "active" | "suspended" | "deleted"
deviceIds: [string]                                    // for abuse signals, not auth
createdAt, updatedAt
```

### settings (versioned)
```
_id, key: "economics", version: int, effectiveAt: Date, createdBy: adminId
values: {
  rateMsatPerGhDay: 48,
  claimGh: 5.5, claimsPerDay: 60,
  minWithdrawalSats: 2500,
  referralPercent: 5, referralCapSatsPerDay: 5,
  withdrawalAutoApproveMaxSats: 0            // 0 = every withdrawal needs admin approval
}
```
The accrual engine reads the version that was effective **at each instant it integrates over**, so a rate change never reprices past mining.

### products (store catalog, admin-managed)
```
_id, sku: "miner_titan" | "super_basic" | "super_pro" | "super_max", kind: "miner" | "super_miner"
name, priceDisplayUsd, durationDays
gh                                   // miner: GH/s for the pack
claimGh, claimsPerDay                // super_miner: per-claim GH/s and daily claims of this tier's track
storeIds: { apple: "bitmine_miner_titan", google: "bitmine_miner_titan" }   // default: bitmine_{sku}, same in both stores
active: bool, sortOrder
```

### miners (every source of hashpower is a miner)
```
_id, userId
source: "paid" | "claim" | "super_claim" | "admin_grant"
gh: number
startAt: Date
endAt: Date                     // paid: start + durationDays; claims: next local midnight after startAt
status: "active" | "expired" | "revoked"
productId?, purchaseId?         // paid
claimId?                        // claim / super_claim
revokedAt?, revokeReason?
createdAt
index: { userId, endAt }, { userId, status }
```
Total GH/s for a user at instant *t* = the sum of `gh` over miners where `startAt ≤ t < min(endAt, revokedAt)`, **plus** the rule that `claim` and `super_claim` miners only count while the day's session is active (they're created only when it is, and end at the same midnight).

### sessions (daily Start mining)
```
_id, userId, localDate: "2026-09-22", tz, startedAt, endsAt (local midnight, UTC)
unique: { userId, localDate }
```

### claims (one per rewarded ad)
```
_id, userId, kind: "regular" | "super", tierProductId? (super only), gh (fixed at intent time), localDate
status: "pending" | "verified" | "expired" | "rejected"
admob: { transactionId?, adUnit?, rewardItem?, verifiedAt? }
createdAt, expiresAt (createdAt + 10 min)
unique: { "admob.transactionId" } (partial, when set)
index: { userId, localDate, kind, tierProductId, status }
```

### purchases
```
_id, userId, productId
store: "app_store" | "play_store"
storeTransactionId (unique)
rcAppUserId, rcEventId?
purchasedAt, priceUsd?, currency?
status: "granted" | "refunded"
grantedMinerId? / grantedSuperUntil?
createdAt
```

### superEntitlements (one per user per tier)
```
userId, productId (tier), activeUntil: Date, lastPurchaseId
unique: { userId, productId }
```
The tier's `claimGh` / `claimsPerDay` are read from `products` at claim time.

### ledger (append-only)
```
_id, userId
type: "mining" | "referral" | "withdrawal_lock" | "withdrawal_unlock" | "withdrawal_paid" | "adjustment"
amountMsat: int64 (signed)
bucket: "available" | "locked"
idempotencyKey (unique)     // e.g. "mining:{userId}:{hourStartISO}", "wd-lock:{withdrawalId}"
refType?, refId?
meta?: { hourStart, ghSeconds, settingsVersion, ... }
createdAt
```

### balances (cache of ledger sums, updated in the same transaction)
```
userId (unique), availableMsat: int64, lockedMsat: int64, lifetimeMinedMsat: int64
accruedUntil: Date          // mining credited up to this instant
updatedAt
```
Invariant (checked nightly): `available + locked == SUM(ledger.amountMsat)` per user.

### withdrawals
```
_id, userId, amountSats (int), destination (Lightning address or BOLT11)
status: "pending_review" | "approved" | "sending" | "paid" | "failed" | "rejected" | "needs_reconcile"
speed: { paymentId?, requestRef, feeSats?, rawStatus? }
reviewedBy?, reviewedAt?, rejectReason?
attempts: int, lastError?
createdAt, paidAt?
index: one open withdrawal per user (partial unique on userId where status in open states)
```

### referralDaily
```
referrerId, localDate, creditedMsat   unique { referrerId, localDate }
```

Also ported with little change: `supportTickets`, `faqs`, `notificationPrefs`, `pushTokens`, `deleteRequests`, `adminUsers`, `appVersionPolicy`.

---

## 5. The accrual engine (heart of the system)

**Earned msat over [t0, t1)** = Σ over each piece of [t0, t1) where settings are constant: `rateMsatPerGhDay × (Σ active gh) × seconds / 86,400`

**Implementation:**
- The worker runs hourly. For each user with any miner overlapping `[accruedUntil, nowFloorHour)`, it processes each whole hour `h` in order:
  1. It computes exact earnings for `[h, h+1h)` from miners and settings as a float, adds the stored fractional remainder, credits `floor(total)` msat and keeps the new remainder.
  2. It inserts the ledger entry `mining:{userId}:{h}` and advances `balances.accruedUntil = h+1h` with `$inc`, **in one transaction**. A duplicate key means the hour was already done, so it skips.
- Users are processed in batches with a cursor on `balances.accruedUntil`, so a crash just resumes.
- **The app is never involved.** A user who starts mining, claims and closes the app is credited in full (fixes audit M1). There's no daily cap other than the hashpower itself (fixes M2).

**Live display:** `GET /mining/status` returns `availableMsat`, `accruedUntil`, `currentMsatPerSecond` and `serverTime`. The app animates `available + (now − accruedUntil) × msatPerSecond` locally and never sends it back. The worst-case drift until the next accrual is under an hour, and it's shown as "mining…" rather than as available balance.

**Claims and midnight:** a claim miner's `endAt` is the user's next local midnight at claim time, computed on the server from `users.timezone`. There's no reset job: the next day's counters come from counting claims with the new `localDate`.

**Unit tests (required before any UI work):**
- Paid miner only, 180 days: total = gh × rate × 180 (±1 msat).
- Claim at 23:30 local → exactly 30 minutes of accrual. DST-change days in `America/New_York`, and `Asia/Kolkata` (UTC+5:30).
- A rate change mid-hour splits correctly.
- Re-running an hour credits nothing.
- A revoked miner stops at `revokedAt`.
- Property test: summing hourly credits over N days equals closed-form integration within N×24 msat.

---

## 6. Flows

### 6.1 Signup and timezone
1. Signup (email+password, Google or Apple). The device sends its IANA timezone, which the server validates against `Intl.supportedValuesOf('timeZone')`.
2. A timezone change request (e.g. after travel) is allowed **once per 30 days** and applies from the **next local midnight in the old timezone**. This stops users changing timezone to reset claims early.
3. An optional referral code at signup (or within 7 days) sets `referredBy`. Self-referral and referral cycles are refused.

### 6.2 Start mining (daily)
`POST /mining/start` → `session(userId, localDate)` is created idempotently. It returns the session and `endsAt`. There's nothing to claim yet; paid miners already accrue.

### 6.3 Free claim / Super claim (AdMob SSV)
```
App                          API                              AdMob
 │ POST /claims {kind,  ───►  checks: session active today,
 │   tier?}                   today's verified+pending < that track's cap,
 │                            kind=super → that tier's entitlement active
 │ ◄── {claimId, gh}          creates claim(pending, 10-min expiry)
 │ load rewarded ad with serverSideVerificationOptions
 │   { userId, customData: claimId }
 │ user watches ad ─────────────────────────────────────────► AdMob
 │                            GET /webhooks/admob-ssv?...&signature&key_id ◄──
 │                            1. verify ECDSA signature with Google's published keys (cached, refreshed daily)
 │                            2. transaction_id unused (unique index)
 │                            3. claim pending, not expired, user matches
 │                            4. re-check the cap, create miner(gh, now → local midnight)
 │ GET /claims/{id} (poll ≤10s) or push ◄── status verified
```
- The cap counts `verified + pending` claims, so users can't open 100 intents at once. Expired pendings free their slot.
- A claim whose SSV never arrives expires after 10 minutes and the app shows "Ad couldn't be verified." No hashpower is granted without SSV (fixes audit C3).
- Pending intents are rate-limited per user (max 3 open).

### 6.4 Purchases (RevenueCat)
**Store product types:**
- iOS: paid miners and Super Miner are **non-renewing subscriptions** (a time-limited product that can be bought repeatedly).
- Android: **consumable one-time products**.
- RevenueCat handles both.

1. The app calls `Purchases.logIn(userId)` after login, so RevenueCat's `app_user_id` is our userId.
2. After purchase, the app calls `POST /store/sync` with no body. The server fetches the subscriber from the RevenueCat REST API, lists non-subscription transactions and non-renewing purchases, and grants any `store_transaction_id` not yet in `purchases`:
   - miner product → `miners(source:"paid", startAt: purchasedAt, endAt: +durationDays)`
   - super_miner → that tier's `superEntitlements.activeUntil = max(now, activeUntil) + durationDays`
3. The RevenueCat webhook (`INITIAL_PURCHASE`, `NON_RENEWING_PURCHASE`) triggers the same grant function. The unique `storeTransactionId` makes it a no-op for whichever arrives second. The 15-minute reconcile job catches both being missed.
4. **Refunds:** on the RevenueCat `CANCELLATION` event with a refund reason (or the store refund notification) → `purchases.status = refunded`, miner `revokedAt = now`, that tier's Super Miner entitlement shortened accordingly, and the account is flagged for review. Already-credited sats stay. If a withdrawal is open, it's put on hold for admin review (fixes audit M4).
5. Sandbox and test purchases grant only when `ALLOW_SANDBOX=true` (dev/staging).

### 6.5 Withdrawal (Speed, Lightning)
1. `POST /withdrawals {amountSats, destination}`:
   - `amountSats ≥ minWithdrawalSats`, integer, ≤ available.
   - The destination is either a **Speed Lightning address** (`name@speed.app` only) or a **BOLT11 invoice from any wallet** for exactly that amount, not expired, mainnet.
   - There's no other open withdrawal.
   - 2FA code required if the user has 2FA enabled.
2. In **one transaction**: insert ledger entries `withdrawal_lock` (−available, +locked) and create the withdrawal as `pending_review` (or `approved` if ≤ `withdrawalAutoApproveMaxSats`). The balance is reserved immediately, so there's no window to double-spend (fixes M5 and M8).
3. The admin approves or rejects in the panel. A rejection unlocks the funds (ledger `withdrawal_unlock`).
4. The payout job picks up `approved` withdrawals:
   - It sets `sending` and stores `requestRef = withdrawalId` **before** calling Speed.
   - It calls Speed send in **BTC/sats** (not USDT), for exactly `amountSats` (fixes M6).
   - **Success** → `paid`, ledger `withdrawal_paid` (−locked).
   - **Definite failure** (4xx with a clear reason) → `failed` + `withdrawal_unlock`.
   - **Timeout or unknown** → `needs_reconcile`. **The funds stay locked and there's no automatic retry.** The job queries Speed by reference or payment ID until it knows the real outcome, and after 30 minutes it alerts the admin (fixes M7).
5. Speed account balance low → payouts pause, the admin is alerted, and users see "Processing".

### 6.6 Referral rewards
The daily worker job runs per referrer for each local date: `min(5% × Σ referees' mining msat that day, 5,000 msat)`. The ledger key `referral:{referrerId}:{localDate}` makes it idempotent. Only `mining` entries count, never referral entries, so there are no chains.

---

## 7. API (all under `/v1`, JSON, Bearer token)

The user is **always** taken from the token. There's no `userId` in paths or bodies (fixes C4).

**Auth**
| Method | Path | Notes |
|---|---|---|
| POST | /auth/register | email, password, name, timezone, referralCode? → sends 6-digit OTP |
| POST | /auth/verify-email | email + otp |
| POST | /auth/login | email, password → tokens, or `{twoFactorRequired, challengeId}` |
| POST | /auth/2fa/verify | challengeId + otp → tokens |
| POST | /auth/social | provider, idToken, timezone, referralCode? |
| POST | /auth/refresh | refreshToken → rotated pair |
| POST | /auth/logout | revokes the refresh token |
| POST | /auth/password/forgot · /auth/password/reset | OTP-based |
| GET/PATCH | /me | profile, notification prefs |
| POST | /me/timezone | change request (§6.1) |
| POST | /me/2fa/enable · /me/2fa/disable | OTP-confirmed |
| POST | /me/delete | deletion request |

**Mining and claims**
| Method | Path | Notes |
|---|---|---|
| GET | /mining/status | balances, current GH/s by source, msat/sec, session, claim counts per track, owned Super Miner tiers and expiry, next midnight |
| POST | /mining/start | idempotent per local day |
| GET | /miners | active and recent miners (paid, with expiry) |
| POST | /claims | {kind: regular\|super, tier?: super_basic\|super_pro\|super_max} → {claimId, gh, expiresAt, remainingToday}. Ad unit IDs come from `/app/config` |
| GET | /claims/:id | status |
| GET | /history/earnings?from&to | daily totals from the ledger |

**Store**
| Method | Path | Notes |
|---|---|---|
| GET | /store/products | active catalog with store IDs |
| POST | /store/sync | reconcile with RevenueCat |
| GET | /store/purchases | the user's purchases |

**Wallet**
| Method | Path | Notes |
|---|---|---|
| GET | /wallet | available, locked, lifetime, min withdrawal |
| GET | /wallet/ledger?cursor | transactions |
| POST | /withdrawals | §6.5 |
| GET | /withdrawals | the user's withdrawals |

**Other:** `GET /referrals` (code, count, earnings), `GET /faqs`, `POST/GET /support/tickets`, `POST /push-tokens`, `GET /app/config` (version policy, ad unit IDs, feature flags), `GET /news` (optional, kept from BitPlay).

**Webhooks:** `GET /webhooks/admob-ssv`, `POST /webhooks/revenuecat` (Authorization header secret).

**Admin (session auth + TOTP):** users (view, suspend, ledger, adjustment with a required reason), withdrawals queue (approve, reject, reconcile), settings (versioned edit with the 15-day guard preview), products, purchases and refunds, support replies, push broadcast, dashboard (users, DAU, claims/day, revenue, payouts, liabilities = Σ available + locked), Speed balance.

---

## 8. Mobile app

**Stack:** React Native (latest stable) + TypeScript, React Navigation, TanStack Query (server state), Zustand (UI state), MMKV (tokens and prefs), Reanimated + Skia (premium mining visuals), `react-native-purchases`, `react-native-google-mobile-ads`, Firebase Messaging, Google and Apple sign-in, Sentry.

**Screens:**
- Onboarding (3 slides) · Sign in / up · OTP · 2FA · Forgot password
- **Mine** (home): live BTC counter, total GH/s ring broken down by source (paid / claims / Super), Start mining, Claim +5.5 GH/s (n/60), one claim button per owned Super Miner tier (e.g. Pro +10 GH/s n/50), time to midnight
- **Miners**: owned paid miners with expiry progress, plus today's claims
- **Store**: paid miners, Super Miner tiers ($4.99 / $49 / $99), restore purchases
- **Wallet**: balance, progress to 2,500 sats, withdraw, transaction history
- **Withdraw** · Withdrawal status
- **Profile**: referral, notifications, security (2FA, change password/email), timezone, support/FAQ, delete account, legal

Removed from BitPlay: all 25 games, trading, spin, news tab (optional), deposits, loss mechanic, streak gimmicks.

**Rules for the app code:**
- Screens never compute money. They render server values and animate between them.
- Every API call goes through one typed client. Business logic lives in hooks and services, not screens (BitPlay's `HomeScreen.tsx` was 4,574 lines).
- Ads load only after `POST /claims` returns a `claimId`, and the SSV `customData` is set.

---

## 9. Security and abuse

- **Auth tokens:** access token JWT (15 min) plus a refresh token (60 days, rotated, stored hashed, revocable). HS256 secret in env, or RS256 later.
- **OTP fixes from the audit:** 6 digits, bound to the email and purpose, 5 attempts then invalidated, 10-minute expiry, stored hashed, rate-limited per email and per IP. Disposable-email block kept.
- **Rate limits:** per user and per IP on auth, claims, withdrawals and store sync.
- **App integrity (phase 2):** Play Integrity and App Attest verdicts required for claims and withdrawals.
- **Abuse signals:** many accounts per device ID, referral farms (same device or IP cluster), sudden claim bursts. These flag an account for withdrawal review; they don't auto-ban.
- **Secrets:** only in server env or a secret manager. **Nothing** from BitPlay's repos is reused: new wallet keys, keystores, API keys, Firebase project, RevenueCat project and AdMob account.
- **Admin:** separate login with TOTP, IP allowlist optional, and every admin action written to an `adminAudit` collection.
- **CORS** locked to the admin domain. **Helmet** on.
- **Backups:** Atlas daily snapshots, plus the nightly ledger invariant check with an alert.

---

## 10. Environment variables
```
NODE_ENV, PORT, PUBLIC_BASE_URL, ADMIN_BASE_URL, CORS_ORIGINS
MONGODB_URI
JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
ADMIN_SESSION_SECRET
REVENUECAT_SECRET_KEY, REVENUECAT_WEBHOOK_AUTH, ALLOW_SANDBOX
SPEED_API_KEY, SPEED_API_BASE=https://api.tryspeed.com
ADMOB_SSV_KEYS_URL=https://www.gstatic.com/admob/reward/verifier-keys.json
FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
GOOGLE_CLIENT_IDS, APPLE_BUNDLE_ID
BREVO_API_KEY, MAIL_FROM
SENTRY_DSN
```

---

## 11. To verify with vendors before building those parts

| Item | Why |
|---|---|
| ~~Speed `send` API in SATS~~ **Confirmed** (2026-09-22): `POST /send` with `currency`/`target_currency` `SATS`, `withdraw_method: lightning`, `withdraw_request` = LN address or invoice; status `unpaid → paid/failed`; `GET /send/{id}`. **Still to test with a small real payment:** whether Speed's fee is deducted from `amount` or charged on top | §6.5 |
| ~~Speed idempotency key~~ **None exists.** Handled by claiming each withdrawal before sending, putting `bitmine:{withdrawalId}` in `note`, and on an unknown outcome searching recent sends by note instead of retrying; if not found, an admin decides | Prevents double payouts |
| RevenueCat: non-renewing subscription (iOS) and consumable (Android) transaction fields in the REST API, and refund event shape | §6.4 |
| AdMob SSV: `customData` delivery and callback latency in production | §6.3 |
| Apple review: rewarded ads granting hashpower plus BTC withdrawal (guideline 3.1.5 and the crypto rules), and whether an organization account is required | Launch risk |

---

## 12. Build order

1. **Backend foundation:** repo, TypeScript, config, Mongo models, auth module (ported and fixed), test harness.
2. **Accrual engine and ledger**, with the full test suite from §5. *Nothing else starts until this passes.*
3. Sessions, claims and AdMob SSV (test with AdMob test units).
4. Store: RevenueCat sync, webhook, refunds (sandbox).
5. Wallet and withdrawals: Speed integration on small real amounts, reconciliation.
6. Referrals, notifications, support, FAQs, app config.
7. Admin panel.
8. **Mobile app:** design system from your references → auth → Mine → Store → Wallet → Profile.
9. End-to-end test on real devices (TestFlight and Play internal testing), load-test the accrual job with 100k simulated users.
10. Store submission.

---

## 13. Decisions (confirmed 2026-09-22)

| # | Decision | Confirmed |
|---|---|---|
| 1 | Withdrawal destination | **Speed Lightning address (`@speed.app`) or a BOLT11 invoice from any wallet** |
| 2 | Withdrawal approval | **Every withdrawal reviewed by admin** at launch |
| 3 | News tab | **Dropped** for v1 |
| 4 | 2FA method | **Email OTP** |
| 5 | Super Miner | **Three tiers**: $4.99 / 30 days (30 × 5.5 GH/s), $49 / 365 days (50 × 10 GH/s), $99 / 365 days (50 × 20 GH/s). Tiers stack. The 365-day length for $49 and $99 follows BitPlay's 1-year privileges and is **still to be confirmed**. |
