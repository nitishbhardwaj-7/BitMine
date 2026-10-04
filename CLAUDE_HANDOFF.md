# CLAUDE_HANDOFF.md — BitMine

> **Updated state:** read `CLAUDE_MEMORY.md` first (2026-10-04). This file is the 2026-10-02 background and is out of date where the two disagree.

> Context export for a new Claude conversation that has **zero** knowledge of the previous one.
> Written 2026-10-01 at the end of a long build session. Secrets are never included; values are shown as `<REDACTED>`.
> Repository root on the user's PC: `D:\BitMine` (Windows 11, Git Bash + PowerShell, Node 22.20.0).

---

## 1. PROJECT IDENTITY

| Field | Value |
|---|---|
| Name | **BitMine** |
| Owner | sachin (`sachin@adaptsmedia.com`), personal project |
| What it does | A "premium cloud Bitcoin miner" mobile app. Users earn sats from **hashpower (GH/s)**. Hashpower comes from **miners**: free ones (unlocked daily by watching rewarded ads, "claims"), **Super Miner** tiers (paid unlocks that add extra daily ad-claim tracks), and **paid miners** (in-app purchases that mine 24/7 for 180 days). Earnings are credited **hourly** server-side. Users withdraw over **Lightning** (Speed wallet payouts) after an admin reviews each withdrawal. Also has live crypto **Market** prices, **News** (RSS headlines), **Academy** lessons, referrals, support tickets, notifications. |
| Origin | A personal re-do of the user's company app **BitPlay** (same business idea). Instruction: reuse BitPlay's *backend logic/infrastructure ideas*, build a **completely new UI/UX**, **remove all games**, make it a "premium miner, not a kid app". BitPlay "has major bugs, so check everything before doing anything". |
| Main objective (current) | Ship to production: deploy the backend, then test the Android APK, then store release. |
| Target users | Retail crypto-curious mobile users (Android first; iOS later, needs a Mac). |
| Development stage | **Feature-complete v1, pre-deployment.** Backend + admin panel done and tested (161 tests). App (user's own design) fully wired to the backend and wrapped with Capacitor; Android project generated; debug APK builds. Not deployed; no vendor accounts (RevenueCat, AdMob, Firebase, Brevo, Speed, stores, domain, server) created yet. |
| Architecture | Monorepo, no workspaces: `backend/` (Node/TS/Express API + separate worker process, MongoDB Atlas), `frontend/` (vanilla JS + Vite web app = the mobile app UI, packaged with Capacitor 8; `frontend/android` native project), `deploy/` (Docker Compose + Caddy), `docs/`. Server-authoritative economics with an append-only ledger. |
| Branch / version | `main` only, local git, **no remote**. HEAD = `2046626`. App version `1.0.0`, Android `versionCode 1`/`versionName "1.0.0"`, bundle ID `com.bitmine.app`. Large set of **uncommitted** changes (see §9, §12). |

---

## 2. COMPLETE TECH STACK

### Backend (`backend/package.json`)
| Area | Tech (version) |
|---|---|
| Runtime | Node **≥22** (`engines`), ESM (`"type": "module"`) |
| Language | TypeScript **^7.0.2** (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, module `nodenext`, target es2023) |
| HTTP | Express **^5.2.1**, helmet ^8.3.0, cors ^2.8.6 |
| DB | MongoDB **Atlas** (must be a replica set — transactions), Mongoose **^9.10.1** |
| Validation | zod **^4.6.5** |
| Auth/crypto | jose **^6.2.12** (HS256 access JWT; RS256 JWKS verification of Google/Apple ID tokens; RS256 signing for FCM OAuth), Node `crypto` (scrypt passwords, sha256 hashes, ECDSA SSV verify, TOTP HMAC) |
| Logging | pino ^10.3.1, pino-http ^11.0.0, pino-pretty ^13.1.3 (dev only, when `NODE_ENV=development`) |
| Config | dotenv ^18.0.2 |
| Tests | vitest **^5.0.1**, mongodb-memory-server ^11.3.0 (one shared in-memory replica set via `globalSetup`, one DB per test file) |
| Dev runner | tsx ^4.23.15 (`tsx watch`) |
| Build | `tsc -p tsconfig.build.json` → `dist/` |
| Package manager | npm (package-lock.json) |
| No | No Redis, no queue lib, no ORM besides Mongoose, no firebase-admin (FCM via raw HTTP v1), no Sentry wired (env name exists in old docs only) |

### Frontend / app (`frontend/package.json`)
| Area | Tech (version) |
|---|---|
| Language/UI | **Vanilla JavaScript ES modules**, hand-written HTML template strings, **no framework** (no React). This is the user's own design system. |
| Build | Vite **^5.4.14** (`vite.config.js`: port 3000, host true, ignores android/ios/dist in watch, outDir dist) |
| Native wrapper | Capacitor **^8.5.2** (`@capacitor/core`, `/android`, `/ios`, `/cli`) |
| Capacitor plugins | `@capacitor-community/admob` ^8.1.0 (rewarded ads + SSV), `@revenuecat/purchases-capacitor` ^13.6.0, `@capgo/capacitor-social-login` ^8.5.10 (Google/Apple), `@capacitor-firebase/messaging` ^8.5.2 (+ `firebase` ^12.19.0 peer), `@capacitor/app` ^8.1.1, `browser` ^8.0.4, `clipboard` ^8.0.1, `share` ^8.0.2, `splash-screen` ^8.0.2, `status-bar` ^8.0.3 |
| State management | Hand-rolled store (`js/store.js`): a `state` object + loaders + subscribe/notify; polling every 30 s |
| Styling | Plain CSS with CSS custom properties (`css/tokens.css`), font **Plus Jakarta Sans** (Google Fonts import in base.css) |
| Animation | **CSS only** (keyframes, `hero-stagger-*` classes, `animate-fade-up`) + a JS scroll-collapse for the Home hero (`js/heroCollapse.js`). **No GSAP / Framer Motion.** |
| Icons | Inline SVG strings in `js/icons.js` |
| Android | Gradle (wrapper in repo), minSdk 24, compile/target SDK 36, **requires Java 21** (uses Android Studio's bundled JBR at `C:/Program Files/Android/Android Studio/jbr`) |

### External services (planned; **none created yet**)
| Service | Purpose |
|---|---|
| MongoDB Atlas | DB (a dev cluster EXISTS and is seeded; its IP allowlist currently blocks this PC — see §9) |
| RevenueCat | Store purchase verification (REST v1 `/v1/subscribers/{id}`) + webhook |
| Google AdMob | Rewarded ads with server-side verification (SSV) |
| Speed (tryspeed.com) | Lightning payouts, `POST /send` in SATS |
| Brevo | Transactional email (OTP codes) — **required in production** |
| Firebase | FCM push (service account) + `google-services.json`; Google sign-in OAuth client IDs |
| Apple Developer / Google Play Console | Store accounts; Sign in with Apple |
| CoinGecko (free API) | Market prices (no key) |
| RSS: CoinDesk, Cointelegraph, Decrypt, Bitcoin Magazine | News headlines |
| Hosting | **UNKNOWN / not chosen.** Prepared for: Linux VPS (Ubuntu 24.04) + Docker Compose + Caddy (auto-HTTPS). Domain **UNKNOWN** (docs use `bitmine.app` / `api.yourdomain` as placeholders). |
| CI/CD | **None.** |
| Analytics / CMS | **None.** Content (FAQs, lessons, app config, products, economics) is edited in the built-in admin panel. |

---

## 3. CODEBASE STRUCTURE

```
D:\BitMine
├── .claude/launch.json            # untracked; dev servers: bitmine-api (npm run dev:api --prefix backend, port 4000), bitmine-app (npm run dev --prefix frontend, port 3000)
├── .dockerignore                  # NEW (uncommitted)
├── .gitignore                     # ignores reference/, node_modules, dist, coverage, .env, .env.* (!.env.example), *.log
├── README.md                      # root overview (updated: frontend/ + deploy/)
├── CLAUDE_HANDOFF.md              # this file
├── ScreenRecording_09-22-2026 15-33-55_1.mp4   # ~9.8 MB, TRACKED in git (user's design reference recording)
├── WhatsApp Image 2026-09-22 at 5.31.00 PM.jpeg # untracked (user's; presumably logo source)
├── reference/                     # git-ignored BitPlay clones (contain third-party SECRETS, e.g. committed mnemonics) — read-only
├── backend/
│   ├── .env (git-ignored, has real secrets) / .env.example
│   ├── README.md, package.json, tsconfig.json, tsconfig.build.json (excludes *.test.ts), vitest.config.ts
│   ├── data/disposable-email-domains.txt   # ~5,400 domains from BitPlay-Auth
│   └── src/
│       ├── server.ts              # API entry
│       ├── worker.ts              # background jobs entry (exactly ONE worker process)
│       ├── app.ts                 # createApp(opts) — Express app factory used by server + tests
│       ├── hardening.test.ts      # NEW tests for the pre-deploy fixes
│       ├── config/  env.ts, economics.ts, content.ts
│       ├── settings/economics.ts  # versioned economics settings
│       ├── db/  connect.ts, seed.ts
│       ├── lib/  errors.ts, rateLimit.ts, logger.ts, time.ts (+test)
│       ├── models/index.ts        # ALL Mongoose schemas
│       ├── mining/  accrual.ts (pure math), accrualJob.ts, sessions.ts, status.ts (+tests)
│       ├── claims/  admobSsv.ts, service.ts (+tests)
│       ├── store/   revenuecat.ts, service.ts (+test)
│       ├── wallet/  balances.ts, bolt11.ts, destination.ts, speed.ts, withdrawals.ts, payoutJob.ts, wallet.ts (+tests)
│       ├── auth/    tokens.ts, requireUser.ts, password.ts, mailer.ts, otp.ts, refreshTokens.ts, social.ts, disposable.ts, service.ts
│       ├── users/   timezone.ts, profile.ts
│       ├── referrals/referralJob.ts (+test)
│       ├── notifications/ service.ts, push.ts, jobs.ts (+test)
│       ├── support/service.ts
│       ├── content/ market.ts, news.ts, academy.ts (+test)
│       ├── admin/   auth.ts, totp.ts, html.ts, router.ts, configPages.ts, service.ts (+http test)
│       ├── routes/  v1.ts, auth.ts, public.ts, webhooks.ts, dev.ts (+http tests)
│       ├── scripts/ seed.ts, db-status.ts, create-admin.ts, refresh-news.ts
│       └── test/    mongo.ts, globalSetup.ts, fixtures.ts, ssv.ts, revenuecat.ts, speed.ts, invoice.ts, auth.ts
├── frontend/
│   ├── .env (git-ignored; public VITE_* values only) / .env.example
│   ├── index.html                 # shell: device-mode script, simulator toolbar, phone frame, #activeScreenContainer, bottom nav, bottom sheet, toast, gallery
│   ├── vite.config.js             # untracked (user-created)
│   ├── capacitor.config.json      # appId com.bitmine.app, appName BitMine, webDir dist, bg #0B0A18, SplashScreen 800ms, StatusBar overlays
│   ├── css/ tokens.css, base.css, components.css, screens.css (user's design) + simulator.css (desktop frame) + app.css (added by Claude for wiring)
│   ├── js/
│   │   ├── app.js        # router, render, event delegation, live values, gallery, version gate, push registration
│   │   ├── api.js        # fetch client, token storage & refresh rotation, ApiError
│   │   ├── store.js      # state + loaders + polling + live balance math
│   │   ├── native.js     # Capacitor bridge with browser fallbacks
│   │   ├── config.js     # VITE_* → config
│   │   ├── ui.js         # esc, toast, sheets, busy, forms, header/listItem/emptyState/skeleton/errorCard, OTP input
│   │   ├── format.js     # msat/sats/BTC/USD/hash/date formatters
│   │   ├── icons.js      # inline SVGs
│   │   ├── heroCollapse.js # Home hero scroll-collapse
│   │   ├── data.js       # UNUSED leftover dummy data from the prototype (left in place)
│   │   └── screens/ auth.js, home.js, mining.js, wallet.js, content.js, account.js, parts.js
│   ├── assets/images/ academy_cap.jpg, bitcoin_news_hero.jpg, btc_cloud_hero.jpg, miner_rig_3d.jpg, rocket_rewards.jpg, user_profile_avatar.jpg, logo.png & logo.jpeg (logo files untracked, user's)
│   ├── scripts/ android-dev.mjs, android-apk.mjs, release-check.mjs (NEW)
│   └── android/          # Capacitor-generated native project (tracked; build outputs ignored)
│       ├── app/build.gradle               # applicationId com.bitmine.app; release signing from keystore.properties (NEW)
│       ├── app/src/main/AndroidManifest.xml # AdMob TEST app id, POST_NOTIFICATIONS, allowBackup=false, usesCleartextTraffic=false
│       ├── app/src/debug/AndroidManifest.xml # NEW: usesCleartextTraffic=true for debug builds only
│       ├── variables.gradle (minSdk 24, compile/target 36), .gitignore (keystores ignored)
│       └── app/build/outputs/apk/debug/app-debug.apk  # built 2026-10-01, ~16.8 MB, points at http://192.168.1.71:4000
├── deploy/  Dockerfile, docker-compose.yml, Caddyfile   # NEW (uncommitted)
└── docs/
    ├── BITPLAY_BACKEND_ANALYSIS.md  # analysis of BitPlay's backend
    ├── BITPLAY_BUG_AUDIT.md         # bugs BitMine must not inherit (C1–C4, M1–M8...)
    ├── ECONOMICS.md                 # launch numbers + 15-day guard tables
    ├── TECHNICAL_SPEC.md            # v1 spec (some sections stale — see §17)
    ├── MOBILE_SETUP.md              # browser/phone dev, native setup, release build
    └── DEPLOYMENT.md                # NEW: VPS + Docker + Caddy go-live guide
```

### Important backend files (detail)

- **`src/config/env.ts`** — zod schema over `process.env`; `env()` caches. Variables listed in §14. `TRUST_PROXY` (default `"loopback"`) added. `checkProduction()` (NEW): when `NODE_ENV=production`, throws if `BREVO_API_KEY`/`MAIL_FROM` missing or `MONGODB_URI` contains localhost. `FIREBASE_PRIVATE_KEY` has `\\n`→newline transform. `DEV_SHORTCUTS` ignored in production.
- **`src/app.ts`** — `createApp({ corsOrigins, jwtAccessSecret, ssv, store, revenueCatWebhookAuth?, mailer, social, admin?, market?, devShortcuts?, trustProxy? })`. Order: `x-powered-by` off → `trust proxy` = `opts.trustProxy ?? "loopback"` → helmet → cors (allows **no Origin** = mobile app, or listed origins) → `express.json({limit:"100kb"})` → pino-http (ignores `/health`) → `Cache-Control: no-store` on `/v1` and `/webhooks` → `GET /health` (200/503 by mongoose readyState) → `/webhooks` → `/admin` (if opts.admin) → `/v1/public` → `/v1/dev` (only if devShortcuts && NODE_ENV≠production) → `/v1/auth` → `/v1` (requireUser) → 404 JSON → error handler (AppError → its status/code/message/details; ZodError → 400 `invalid_request` with issues; JSON parse → 400 `invalid_json`; else 500 `internal_error`).
- **`src/server.ts`** — connects DB, picks mailer (Brevo if key+from; else `disabledMailer` in prod / `devLogMailer` in dev which **prints OTP codes to the console**), builds `createApp` with real clients (`SsvVerifier(httpKeyFetcher)`, `httpRevenueCatClient`, `socialVerifier`, `MarketCache(coinGeckoFetcher())`, admin `{speed, secureCookies: prod}`), listens on PORT. NEW: graceful shutdown (close server, closeIdleConnections, 10 s max, disconnect DB), `unhandledRejection`/`uncaughtException` → fatal log + exit 1.
- **`src/worker.ts`** — single process. Helpers `hourly(name, job, minuteOffsetMs=2min)` (runs now, then each hour + offset, never overlaps) and `every(name, ms, job)`. Jobs: accrual hourly (NEW: loops up to 50× until `remaining===0`), store follow-ups every 60 s, referral rewards hourly (+10 min), reminders hourly (+5 min), push outbox every 30 s, news every 30 min, payouts every 60 s. Crash handlers added.
- **`src/models/index.ts`** — schemas: `User, Settings, Product, Miner, Session, Claim, Purchase, SuperEntitlement, StoreSync, Otp, RefreshToken, RateLimit, JobState, PushToken, Notification, SupportTicket, Faq, AppConfig, AdminUser, NewsArticle, Lesson, AdminSession, AdminAudit, Ledger, Balance, Withdrawal, ReferralDaily`. Key indexes: miners unique `claimId`/`purchaseId` (partial); sessions unique `{userId, localDate}`; claims unique `admob.transactionId` (partial); purchases unique `storeTransactionId`; superEntitlements unique `{userId, productId}`; ledger unique `idempotencyKey`; balances unique `userId`; **withdrawals unique `{userId}` partial on open statuses** (one open withdrawal per user); referralDaily unique `{referrerId, localDate}`; notifications unique `{userId, dedupeKey}`. NEW TTLs: claim/super_claim miners 90 d after `endAt` (partial filter on source), sessions 90 d after `endsAt`, claims 60 d after `expiresAt`, notifications 180 d, storeSyncs 7 d after `createdAt`. Existing TTLs: otps (1 d after expiresAt), refreshTokens (7 d after expiresAt), rateLimits (expireAt), adminSessions (expiresAt). **Ledger, balances, purchases, paid miners, withdrawals have no TTL — never add one.**
- **`src/config/economics.ts`** — `DEFAULT_ECONOMICS`, `PRODUCT_SEEDS`, `defaultStoreId(sku) = "bitmine_" + sku`, `fastestSinglePackDays()` (15-day guard). See §4 numbers.
- **`src/settings/economics.ts`** — versioned `settings` docs key `"economics"`: `seedEconomics()` (v1 effective epoch 0), `getRateSchedule()` (all versions → `RatePeriod[]`, throws if none), `getEconomics(at)` (version in force), `publishEconomics(values, effectiveAt, by)` (must be future).
- **`src/mining/accrual.ts`** — pure math (see §4 code). **`accrualJob.ts`** — hourly per-user transactional credit. **`sessions.ts`** — `startSession` (idempotent upsert), `currentSession`, `claimCount(session, track)` (handles Map vs plain object from lean reads). **`status.ts`** — `getMiningStatus` (Mine screen payload), `minerDetail`, `listMiners`.
- **`src/claims/`** — `admobSsv.ts` `SsvVerifier` (ECDSA P-256/SHA-256 over raw query before `&signature=`, Google keys cached 24 h, refetch on unknown key id at most 1/min). `service.ts` `createClaimIntent`, `getClaim`, **`cancelClaim` (NEW)**, `verifySsvReward`.
- **`src/store/`** — `revenuecat.ts` (`listOneTimePurchases(appUserId)` reads `subscriber.non_subscriptions`, only `app_store`/`play_store`). `service.ts` `grantTransaction` (idempotent on storeTransactionId, sandbox gate, miner or super-entitlement extension, **backfill** of hours already accrued), `syncUser`, `syncFromApp` (NEW: rate limit 12/10 min per user, replaces follow-ups), `runStoreFollowUps` (2 min, 15 min, 60 min), `refundTransaction` (revoke miner / shorten tier, push `reviewFlags`), `listProducts`, `listPurchases`, `resolveEventUser`.
- **`src/wallet/`** — `bolt11.ts` (bech32 decode: amount, network, expiry), `destination.ts` (`name@speed.app` regex or mainnet BOLT11 with **exact** amount and ≥10 min remaining), `withdrawals.ts` (request/lock, admin approve/reject/reconcile, markPaid/markFailed, `OPEN_STATUSES`), `payoutJob.ts`, `speed.ts` (HTTP Basic with key as username; `SpeedError` kinds `definite | insufficient_funds | unknown`), `wallet.ts` (`getWallet`, `dailyEarnings` per UTC day, `listLedger` paginated 50).
- **`src/auth/`** — see §4 auth flow. `mailer.ts` NEW: Brevo failures and disabled mailer throw `AppError(503,"email_unavailable",…)`.
- **`src/users/profile.ts`** — `getMe`, `updateProfile`, `changePassword` (revokes all sessions), `requestEmailChange` (NEW rate limit 5/h/user), `confirmEmailChange`, 2FA enable/disable via email OTP, `requestTimezoneChange` (once/30 days, effective next local midnight in OLD zone), `addReferral` (within 7 days, not self, not own referee), `deleteAccount` (NEW: refused while a withdrawal is open; soft delete: status deleted, email rewritten to `deleted+{id}@deleted.bitmine.invalid`, providers unset, sessions revoked).
- **`src/admin/`** — server-rendered panel; see §4.
- **`src/routes/`** — endpoint list in §4.

### Important frontend files (detail)
- **`index.html`** — inline script adds `html.device` class when Capacitor native, `?device=1`, or viewport ≤600px (unless `?sim`). Desktop shows a phone **simulator** with toolbar (Single / Gallery modes, `#screenJumperSelect`). Key element ids: `activeScreenContainer`, `mainBottomNav` (`.nav-item[data-screen]`), `phoneStatusBar`, `sheetBackdrop`, `mainBottomSheet`, `sheetTitle`, `sheetBodyContent`, `sheetCloseBtn`, `sheetDragHandle`, `bmToast`, `singleSimulatorStage`, `multiGalleryStage`, `screensGridContainer`, `btnModeSingle`, `btnModeGallery`.
- **Screen module contract** (`js/screens/*.js`): each exports `screens` (map id → `{ tab?, nav?: false, dark?: true, keys?: string[] (store keys that trigger re-render), load?(ctx), render(ctx) → html string, after?(el, ctx), static?: true (don't re-render while user typed) }`), `actions` (map name → `fn(el, ctx)` for `data-act`), `forms` (map name → `fn(form, values, ctx)` for `form[data-form]`).

---

## 4. CURRENT IMPLEMENTATION

### 4.1 Economics (seeded defaults; DB is source of truth, admin-editable & versioned)
```ts
DEFAULT_ECONOMICS = { rateMsatPerGhDay: 48, claimGh: 5.5, claimsPerDay: 60, minWithdrawalSats: 2500,
  referralPercent: 5, referralCapSatsPerDay: 5, withdrawalAutoApproveMaxSats: 0 /* 0 = admin reviews every withdrawal */ };
PRODUCT_SEEDS = [ // paid miners: 180 days, mine 24/7, stack without limit
  { sku:"miner_mini",  name:"Mini Miner", $1.99,  gh:65   }, { sku:"miner_spark", name:"Spark", $4.99, gh:170 },
  { sku:"miner_core",  name:"Core",       $9.99,  gh:360  }, { sku:"miner_forge", name:"Forge", $19.99, gh:760 },
  { sku:"miner_titan", name:"Titan",      $79.99, gh:2000 },
  // Super Miner tiers: each = its own daily claim track, tiers stack, rebuying extends
  { sku:"super_basic", "Super Miner",     $4.99, 30 days,  claimGh:5.5, claimsPerDay:30 },  // up to 165 GH/s/day
  { sku:"super_pro",   "Super Miner Pro", $49,   365 days, claimGh:10,  claimsPerDay:50 },  // up to 500 GH/s/day
  { sku:"super_max",   "Super Miner Max", $99,   365 days, claimGh:20,  claimsPerDay:50 } ]; // up to 1 TH/s/day
// store product IDs default to "bitmine_" + sku in BOTH stores (e.g. bitmine_miner_titan)
```
Rate 48 msat/GH/s/day = 0.048 sats. **15-day guard**: one Titan + all 60 free claims + Super Miner Max must need ≥15 days to reach 2,500 sats (`fastestSinglePackDays`; admin panel warns and requires a checkbox to override). Interactive model artifact: https://claude.ai/artifact/QvqW3FY5eBu3y9qiBmsFTM

### 4.2 Money model
- All money is **integer millisatoshis** (`intMsat` validator `Number.isSafeInteger`). Withdrawals are whole **sats**.
- `ledger` is append-only, each entry has a unique `idempotencyKey` (e.g. `mining:{userId}:{hourISO}`, `mining-backfill:{minerId}`, `wd-lock:{wid}:0`, `referral:{userId}:{day}`, `adj:{uuid}`). Types: `mining, referral, withdrawal_lock, withdrawal_unlock, withdrawal_paid, adjustment`; bucket `available|locked`.
- `balances` is a cache updated **in the same transaction** as ledger inserts: `availableMsat, lockedMsat, lifetimeMinedMsat, accruedUntil, accrualRemainder (0..1), minersRev`. Invariant: Σ ledger per bucket == balance (tests assert this).
- **Every hashpower source is a `miners` doc**: `source: paid | claim | super_claim | admin_grant`, `gh`, `startAt`, `endAt`, `revokedAt?`. Claims end at the user's next local midnight; paid end after `durationDays`.

### 4.3 Accrual engine (`mining/accrual.ts` — pure, keep exactly)
```ts
// Exact fractional msat over [t0,t1): split at every miner start/end and every rate change, integrate each piece.
export function earnedMsat(miners, schedule, t0, t1) { /* cuts = {t0,t1, miner starts/effective ends, rate effectiveAt} inside window;
  for each segment [a,b): gh = Σ m.gh where m.startAt <= a < effectiveEnd(m); total += gh * rateAt(a) * (b-a) / MS_PER_DAY */ }
export function msatPerSecondAt(miners, schedule, t) { return (Σ active gh) * rateAt(t) / 86_400; }
export function toWholeMsat(exact, carried) { const total = exact + carried; const credit = Math.floor(total + 1e-9);
  return { creditMsat: credit, remainder: Math.max(0, total - credit) }; }   // fraction carried in balances.accrualRemainder
```
`accrualJob.runAccrual({now})`: target = start of current UTC hour; cursor over balances with `accruedUntil < target` (sorted, batch 500); per user `accrueUser` inside `session.withTransaction`: re-read balance (conflict if `accruedUntil` changed), read miners overlapping `[from, until)` (until = min(target, from + 14 days)), compute per-hour credits with carry, `Balance.updateOne({userId, accruedUntil: from}, {$set accruedUntil/remainder, $inc available & lifetime})` (must modify 1 else conflict), `Ledger.insertMany` hourly entries. Returns `{usersProcessed, usersCredited, msatCredited, skippedConflicts, remaining}`. A user is credited even if the app is closed (fixes BitPlay M1).
**Late purchase race:** `store.grantTransaction` → `backfill()` always `$inc minersRev` on the balance inside its transaction (forces a write-conflict with a concurrent accrual) and credits `[startAt, accruedUntil)` for that miner once (`mining-backfill:{minerId}`).

### 4.4 Daily session + claims (AdMob SSV)
1. App `POST /v1/mining/start` → `startSession` upserts `{userId, localDate}` with `endsAt = nextLocalMidnight(now, tz)`. Required for claims only; paid miners mine without it.
2. App `POST /v1/claims {kind:"regular"} | {kind:"super", tier: sku}` → `createClaimIntent`: needs current session; super requires active `SuperEntitlement`; max **3 open pending claims** (TTL 10 min) → 429 `too_many_pending`; `used + pendingOnTrack >= cap` → 409 `daily_limit_reached`; creates pending `Claim` → `{claimId, kind, gh, expiresAt, remainingToday}`.
3. App shows rewarded ad with SSV `{ userId: me.id, customData: claimId }`.
4. Google calls `GET /webhooks/admob-ssv?...` → signature verified on the **raw** query string → `verifySsvReward`: checks claim pending, `userId` matches (else rejected), not expired, session not over; then in a transaction: conditional `$inc claimCounts.{track}` only if `< cap` (track = `"regular"` or tier productId) → mark claim verified with `admob.transactionId` (unique → replays = duplicate) → create miner `{source: claim|super_claim, gh, startAt: now, endAt: session.endsAt}`. Every decided outcome returns **200** (Google retries non-2xx); bad signature 403.
5. App polls `GET /v1/claims/:id` (12 × 1 s) then refreshes status.
6. NEW: if the ad fails to load / isn't finished / no ad unit → app calls `POST /v1/claims/:id/cancel` (pending → `expired`), freeing the slot; a late callback then returns `ignored: claim_expired`.
- Dev shortcut: `POST /v1/dev/claims/:id/complete` calls `verifySsvReward` with a fake transaction id (only mounted when `DEV_SHORTCUTS=true` and not production). The **dev phone build** also calls it after a watched test ad because Google's callback can't reach a home PC.

### 4.5 Purchases (RevenueCat)
App buys via RevenueCat SDK (`appUserID` = our user id) → `POST /v1/store/sync` (no body; server asks RevenueCat REST what the user bought) → `grantTransaction` per transaction (idempotent on `storeTransactionId`; sandbox refused unless `ALLOW_SANDBOX`; unknown store product → skipped+logged). Paid miner: starts at purchase time (capped at now), 180 days, backfilled. Super tier: `activeUntil = max(existing, now) + durationDays`. No grant yet → 3 follow-up checks (2/15/60 min) by the worker. Webhook `POST /webhooks/revenuecat` (Authorization must equal `REVENUECAT_WEBHOOK_AUTH`, with or without `Bearer `): `INITIAL_PURCHASE`/`NON_RENEWING_PURCHASE` → `syncUser` + store price; `CANCELLATION` with `cancel_reason: CUSTOMER_SUPPORT` → `refundTransaction` (revoke miner from now / shorten tier, flag user for review); `REFUND_REVERSED` only logged. iOS products = non-renewing subscriptions; Android = consumables. Dev: `POST /v1/dev/purchase {sku}`.

### 4.6 Withdrawals (Speed, Lightning)
- `POST /v1/withdrawals {amountSats, destination, code?}`: ≥ `minWithdrawalSats`; destination = `name@speed.app` (Speed addresses only, decision) or **mainnet BOLT11 for the exact amount** valid ≥10 min; user active; NEW early refusal if a withdrawal is already open (so a 2FA code isn't consumed); if 2FA on, requires emailed `withdrawal` OTP (`POST /v1/withdrawals/code`). Transaction: create withdrawal (unique open-per-user index) + `move("lock")` (guarded `$inc` available→locked + 2 ledger rows). Status `pending_review` (or `approved` if ≤ auto-approve limit and no review flags; limit is 0 = never).
- Admin approves → `approved`. **Payout job (every 60 s)**: (1) follow `sending` with paymentId via `GET /send/{id}`: paid → `markPaid` (locked −, notify), failed → `markFailed` (unlock, notify), unpaid >24 h → `needs_reconcile`; (2) `needs_reconcile` without paymentId → search `GET /send` recent by note `bitmine:{withdrawalId}`; not found after 30 min → ALERT log, admin decides; (3) `approved` oldest first: expired invoice → fail; claim `approved→sending` atomically, then `POST /send {amount, currency:"SATS", target_currency:"SATS", withdraw_method:"lightning", withdraw_request: destination, note}`. Errors: insufficient funds → back to `approved`, pause run; definite 4xx → fail+unlock; unknown (timeout/5xx) → `needs_reconcile`, funds stay locked. **Never re-send blindly** (Speed has no idempotency key).
- User-facing statuses: pending_review/approved → `pending`; sending/needs_reconcile → `processing`; paid/failed/rejected.

### 4.7 Auth
- Email+password: `POST /v1/auth/register {email,password(8–128),name,timezone(IANA),referralCode?}` → disposable-email block, emails 6-digit `verify_email` OTP → `POST /v1/auth/verify-email {email, code, deviceId?}` → session. Login `POST /v1/auth/login` (per-IP 30/15 min; per-account lockout after 10 failures for 15 min; unverified → 403 `email_not_verified` + resends code; dummy scrypt for unknown emails). 2FA (email OTP) → `{twoFactorRequired, challengeId, email}` → `POST /v1/auth/2fa/verify`.
- Social: `POST /v1/auth/social {provider: google|apple, idToken, timezone, name?, referralCode?}` → verify JWT against Google/Apple JWKS with audiences `GOOGLE_CLIENT_IDS` / `APPLE_BUNDLE_ID`; links by provider `sub`, else by verified email, else creates.
- Session = 15-min HS256 access JWT (iss `bitmine`, aud `bitmine-app`, sub = userId) + opaque refresh token `"{id}.{secret}"` (60 days, sha256-hashed, **rotated on each use**, reuse of a rotated token revokes the whole family). `POST /v1/auth/refresh`, `/logout`, `/password/forgot`, `/password/reset` (revokes all sessions).
- OTPs: 6 digits CSPRNG, stored sha256(`id:code`), bound to email + purpose, 10-min expiry, 5 attempts, 60 s resend cooldown, 5 sends/hour/email; only newest code valid; consumed atomically. Purposes: `verify_email, login_2fa, reset_password, change_email, enable_2fa, disable_2fa, withdrawal`.
- `requireUser` checks JWT + user `status === "active"` on every request.
- Passwords: scrypt N=32768 r=8 p=1, stored `scrypt$N$r$p$salt$hash`, NFKC.

### 4.8 Other server features
- Referrals: referrer earns 5% of referees' **mining** ledger credits per **UTC day**, capped 5 sats/day per referrer; processed once the day + 2 h is over; `JobState` marker; `ReferralDaily` unique per day.
- Notifications: outbox = `notifications` collection (also the in-app list), written in the same transaction as the event; push via FCM HTTP v1 with service-account JWT; per-kind prefs (`miningReminder, minerExpiry, withdrawals, support`; announcements always); reminders: "Start mining" at 10:00 local if no session; miner expiry 3 days before; stale (>24 h) pushes skipped; dead tokens deleted.
- Support tickets (user create 5/day, messages 30/h; admin reply notifies). FAQs + app config public. Market (CoinGecko, 9 coins, 60 s cache, stale fallback). News (RSS regex parser, categories BITCOIN/MINING/MARKET/WEB3, 30 per feed, 30-day retention). Academy (6 seeded lessons; seeding never overwrites admin edits).
- Rate limiting: Mongo fixed-window counters (`lib/rateLimit.ts` `hit`/`enforce`), keyed by IP or user.

### 4.9 Endpoint inventory
- Public: `GET /health`; `GET /v1/public/{market,news?category=&limit=,academy,academy/:slug,faqs,config}` (config = minVersion, latestVersion, updateMessage, storeUrls, adUnits, supportEmail, termsUrl, privacyUrl, economics).
- Auth: `POST /v1/auth/{register,verify-email,resend-verification,login,2fa/verify,social,refresh,logout,password/forgot,password/reset}`.
- Signed in (`/v1`, Bearer): `GET|PATCH /me`, `POST /me/password`, `POST /me/email`, `/me/email/confirm`, `/me/2fa/{enable,disable}`, `/me/2fa/{enable,disable}/confirm`, `/me/timezone`, `/me/referral`, `PATCH /me/notifications`, `POST /me/delete {confirm:"DELETE"}`; `GET /mining/status`, `POST /mining/start`, `GET /miners`, `GET /miners/:id`; `POST /claims`, `GET /claims/:id`, `POST /claims/:id/cancel`; `GET /store/products`, `POST /store/sync`, `GET /store/purchases`; `GET /wallet`, `GET /wallet/daily?days=`, `GET /wallet/ledger?before=`; `POST /withdrawals/code`, `POST|GET /withdrawals`; `GET /referrals`; `GET /notifications?before=`, `POST /notifications/read {all:true}|{ids}`; `POST|DELETE /push-tokens`; `GET|POST /support/tickets`, `GET /support/tickets/:id`, `POST /support/tickets/:id/messages`.
- Webhooks: `GET /webhooks/admob-ssv`, `POST /webhooks/revenuecat`.
- Dev only: `POST /v1/dev/claims/:id/complete`, `POST /v1/dev/purchase`.
- Admin (`/admin`, HTML): `login`, `login/totp`, `logout`, dashboard `/`, `withdrawals?status=` (+`/:id/approve|reject|reconcile`), `users?q=`, `users/:id` (+`status`, `clear-flags`, `adjust`), `support` (+`/:id/reply|close`), `settings` (economics versions), `products`, `content` (+`/app`, `/faq`, `/faq/:id`), `announce`, `audit`.

### 4.10 Admin panel
Password + TOTP (RFC 6238, SHA-1, ±1 step, replay-protected via `lastTotpStep`). Session cookie `bm_admin` (HttpOnly, SameSite=Strict, Path=/admin, Secure in prod), stored hashed, 12 h; password stage 5 min. CSRF hidden field `_csrf` per session on every POST. `html` tagged template auto-escapes. Every action → `AdminAudit`. Admin accounts created **only** by the user running `npm run admin:create -- email` (prints password + TOTP secret once). Dashboard shows liabilities, pending withdrawals, Speed balance, revenue etc.

### 4.11 Frontend app flow
- `app.js start()`: bind events → load public config (native + below `minVersion` → `update` screen) → if a session is stored go `home` + `afterSignIn()` (bootstrap: `me, config, status, wallet, market, miners, daily, referrals, notifications, products`; start 30 s status polling; native → push token → `POST /v1/push-tokens`), else `welcome`.
- Router: `ctx = { params, deviceId, go(id, params, {replace, resetHistory}), back(), rerender(), refresh(...keys), ensure(key), ensureKeyed(kind,id), signedIn(res), signOut({remote}) }`. Unauthenticated users can only reach `AUTH_SCREENS = welcome, signin, signup, verify, twofa, forgot, reset, update`. Tabs: `home, wallet, miners, market, profile`.
- `render({fresh})`: toggles `no-enter` class when not fresh (data refresh must not replay entrance animations), preserves scroll on refresh, shows nav only when signed in and `screen.nav !== false`, sets status-bar style from `screen.dark`, runs `screen.load` on fresh navigation.
- Store subscriptions re-render the visible screen when one of its `keys` loads — **skipped while the user is focused in an input**, and for `static` screens once the user typed.
- Live values: a 250 ms interval updates `[data-live="balance"|"balance-sub"|"today"|"countdown"]` text without re-render; after local midnight it refreshes `status, daily`.
- `liveBalanceMsat() = status.balance.displayMsat + ((Date.now() - statusAt)/1000) * status.msatPerSecond` (server values only; app never computes earnings itself beyond this animation).
- Events: global delegation — `.back-btn-circle` → back; `.nav-item[data-screen]` → tab; `[data-act]` → action (button gets spinner via `busy`, errors → toast); `[data-go]` (+`data-id`, `data-replace="1"`) → navigate; `form[data-form]` submit → form handler (errors → inline `.form-error`); `input[data-pref]` change → notification pref toggle.
- API client (`api.js`): session in `localStorage['bitmine.session']` `{accessToken, refreshToken, user, expiresAt}`; refreshes 30 s before expiry; on 401 one shared refresh then retry once; refresh 401 → clear session → app shows sign-in with toast. NEW: 25 s `AbortSignal.timeout` → `ApiError(0,'offline',…)`.
- Native bridge (`native.js`): `showRewardedAd({adUnitId,userId,claimId})` (AdMob prepare with `ssv` then show), `storePrices`, `buyProduct(userId, storeId)` (RevenueCat `NON_SUBSCRIPTION`, cancel → false), `signOutPurchases`, `socialSignIn(provider)`, `pushToken()`, `onPushTap`, `openUrl`, `copyText`, `shareText`, `onBackButton`, `onResume`, `exitApp`, `setStatusBar`, `deviceTimezone()`. Plugins lazy-imported; browser fallbacks.
- Other localStorage keys: `bitmine.device` (random device id sent at sign-in), `bitmine.unit` (sats/usd/btc), `bitmine.hideBalance`, `bitmine.favorites`.
- Screens: auth (`welcome, signin, signup, verify, twofa, forgot, reset`; social buttons only native; Apple only iOS), `home` (collapsing dark hero with live balance, shortcuts Withdraw/Boost/Buy/More, security/start-mining card, ticker, overview, today's claims, promo, active miners, news, academy, referral card, recent earnings), mining.js (`mining` "Boost", `miners`, `miner-details`, `store`), wallet.js (`wallet` + withdraw bottom sheet, `transactions`), content.js (`market`, `rewards`, `news`, `academy`, `lesson`, `faq`), account.js (`profile, settings, account, security, notification-settings, notifications, support, new-ticket, ticket, purchases, delete-account`), plus `update` (in app.js).
- Browser test mode: with `VITE_DEV_SHORTCUTS=true` (frontend) and `DEV_SHORTCUTS=true` (backend), claims show a "Test video" sheet and complete via the dev route; purchases complete via `/v1/dev/purchase`. Email codes appear in the API console.

---

## 5. DESIGN / UI / UX CONTEXT

- **The design is the user's own** (they built the dummy frontend in `frontend/` first, from a prototype; a reference screen recording is in the repo root). Instruction: "make it real time and wire it with backend, add missing screens and features and texts **in same way and same design**". Every screen added by Claude reuses the prototype's classes (`screen-header`, `bm-card`, `grouped-list-section`, `grouped-list-item`, `badge-status`, `btn-primary`, `btn-soft`, `btn-white`, `filter-pill`, `promo-upgrade-card`, `bm-stat-card`, `icon-box-purple`, `miner-card-item`, `settlement-row`, `featured-news-card`, `lesson-list-item`, `segmented-control`, `info-rows`, etc.). New styles live only in `css/app.css`.
- Style: "premium crypto-fintech + liquid glass". Dark deep-navy/purple hero areas, light page and white cards, purple accents.
- Colors (tokens.css): `--bg-deep-navy #0B0A18`, `--bg-dark-purple #25105C`, `--color-primary-purple #6D35F5`, `--color-bright-violet #8B4DFF`, `--color-soft-lavender #F0EAFE`, `--color-lavender-border #E4D8FD`, `--bg-page #F7F7FA`, `--bg-card #FFF`, `--text-primary #171622`, `--text-secondary #858394`, `--text-muted #A3A1B2`, success `#12B76A`, danger `#F04438`, warning `#F79009`; gradients `--gradient-hero` (155deg #0B0A18→#160B30→#25105C), `--gradient-purple` (#5B2BE8→#8B4DFF), `--gradient-progress`; glass tokens (`--glass-bg-*`, blur 14/24/32px).
- Typography: **Plus Jakarta Sans** 300–800; sizes 11/12/14/15/17/20/24/28/32px; weights up to 800 for headings.
- Spacing 4/8/12/16/20/24/32; radii 6/10/14/18/22/28/pill; layered soft shadows; purple glow shadows.
- Motion: spring curves `--spring-bounce`, `--spring-smooth`, `--ease-page`; CSS entrance animations (`animate-fade-up`, `hero-stagger-0..6`); live pulse dot "Mining"/"Idle"; glass reflection sweep on the balance card.
- **Home hero scroll-collapse** (`heroCollapse.js`): hero 430px → 98px over scroll; balance card translates/scales/fades between progress 0.25–0.85; action shortcuts fade 0.15–0.48; security card fades 0–0.26; `navbar-docked` class >0.85; gestures on the hero (wheel/touch/mouse drag) are forwarded to `#homeScrollView`. After 1400 ms the hero gets `.entered`, which disables stagger animations so their `fill-mode` doesn't override the collapse transforms.
- Desktop: simulator phone frame + toolbar + screen jumper + Gallery (renders main screens side by side). Phone/native (`html.device`): simulator chrome hidden, full screen, real safe-area insets via `env()`, bottom sheet padding for home indicator.
- Bottom sheet for quick flows (withdraw, change email, 2FA code, About, More menu); toasts for feedback; skeletons while loading; `errorCard` with "Try again"; `emptyState` blocks.
- Balance display: sats with 3 decimals so it visibly ticks; tap to cycle sats → USD → BTC; eye toggles hidden `••••••••`.
- OTP input: 6 boxes, paste and phone auto-fill of the full code supported (first box `maxlength=6`, `fill()` distributes digits), auto-submit at 6 digits.
- Logo: user replaced the "₿" badge with `./assets/images/logo.png` in auth screens, Home top bar (`.brand-logo-img` 30px), simulator toolbar (`.sim-logo-img`), About sheet, update screen, favicon (uncommitted user edits — keep them).
- **Must visually remain unchanged**: the user's design system files (tokens/base/components/screens CSS), the Home hero/collapse behaviour, bottom nav, card styles. Don't restyle; add to `app.css` only when needed.

---

## 6. CONVERSATION MEMORY (requirements, preferences, decisions, with reasons)

1. **Start (2026-09-22):** "I am making an app BitMine… will work exact same like BitPlay… needs to look different… backend functionality can remain same, frontend completely different." User gave three BitPlay repos (backend `btc-mining-backend` by tupple_dev, frontend `BitPlay`, auth `BitPlay-Auth`); cloned into git-ignored `reference/`. Asked for the list of accounts needed (RevenueCat, Speed, etc.).
2. **No games; premium miner** — "I want this app to be more of a premium miner not a kid app… options to start mining and create miners paid and free (with ads)… creating miners adds to overall GH/s. BitPlay has major bugs, so we need to make sure we check everything before doing anything." → Claude wrote `BITPLAY_BACKEND_ANALYSIS.md` and `BITPLAY_BUG_AUDIT.md`, then decided to **rewrite the economic core** server-authoritatively (BitPlay trusted client-sent hashpower/ad counts/USD amounts, see audit C1–C4, M1–M8) and reuse only infrastructure ideas.
3. **Economics first** ("Yes, model the economics first and suggest numbers"). User's inputs: free claims ~25% of ad revenue, 60 claims × 5.5 GH/s = 330 GH/s/day resetting at 12 am; paid users can also claim; packs; super-miner boost up to 1 TH/s daily via ads "like BitPlay". Then: "refine according to you, I just want users to mine at least **15 days** before reaching min withdrawal **0.000025 BTC** even if they purchased a $50 plan." Then: "**(no need to cap)** if someone is buying packs again and again they can reach in short time, no issues; I just don't want free people or small-plan buyers to reach faster." → numbers in §4.1 (pack GH/s reduced from user's first draft so the guard holds; rate 0.048 sats/GH/s/day).
4. Spec decisions (user answers): withdrawal to **Speed Lightning address only** (`@speed.app`) **or a BOLT11 invoice from any wallet**; **admin reviews every withdrawal**; News tab dropped for v1 (later reversed, see 9); **email OTP 2FA**; Super Miner $4.99 → 30 claims × 5.5 GH/s **plus** "$49 for 500 GH/s per day (10 GH/s per video, 50 videos) and $99 for 1 TH/s per day (20 GH/s per video, 50 videos) like BitPlay"; "**365 days is fine**" for $49/$99.
5. "Go ahead and set up the project", built step by step; user created an Atlas DB and asked Claude to seed ("You seed"). Claude never echoes connection strings/secrets in chat.
6. Commits requested at stages ("commit and go ahead with the store"). User asked where commits go → local repo only, no remote.
7. Order built: foundation/accrual/claims → store → wallet/withdrawals → auth → referrals/notifications/support → admin panel → content (market/news/academy) → app wiring → Android.
8. **Frontend:** "I have done the frontend in frontend folder, but it is dummy. Can we make it real time and wire it with backend? And add missing screens and features and texts in same way and same design." AskUserQuestion answers: **wrap with Capacitor** (not rewrite in React Native, even though TECHNICAL_SPEC §8 had planned RN); **replace fake features with real ones**; **keep Market/News/Academy with real content** (hence CoinGecko, RSS news, seeded lessons).
9. Claude once **overwrote the user's uncommitted `app.js` edits** while restructuring; apologized; design preserved in modules. **Preference: never discard/overwrite the user's uncommitted work.**
10. "**com.bitmine.app is fine, generate the android project**" → done, debug APK built.
11. **Latest request (2026-10-01):** "Analyze everything and make sure nothing is left and no bugs exist and backend is ready to be deployed, make it a production level ready app and ready to deploy, then I will test the APK in Android." → full audit + fixes + deploy setup (see §8, §9).
12. Security constraints throughout: never reuse any BitPlay keys, bundle IDs, product IDs, Firebase/AdMob/RevenueCat accounts, or the **mnemonics committed in BitPlay's readme**; `.env` and `reference/` never committed; admin password created by a script the user runs themselves.

---

## 7. DECISION LOG

| # | Date/context | Decision | Reason | Alternatives | Status |
|---|---|---|---|---|---|
| 1 | 09-22 analysis | Rewrite economics server-authoritatively; reuse BitPlay infra ideas only | BitPlay lets clients mint earnings (C1–C4) and loses honest users' money (M1–M8) | Port BitPlay backend | Done |
| 2 | 09-22 | Money in integer msat, append-only ledger + balance cache in one transaction, idempotency keys | Exactness, re-runnable jobs, auditability | Floats/Decimal128 (BitPlay) | Done |
| 3 | 09-22 | Every hashpower source is a `miners` doc with time span; hourly accrual integrates spans | One model for paid/claims/super/admin grants; closed app still earns | BitPlay's client-sync settlement | Done |
| 4 | 09-22 | Per-user IANA timezone; local midnight computed server-side; tz change once/30 days, effective next midnight in old zone | Prevent claim resets via clock/tz games | Client dates (BitPlay) | Done |
| 5 | 09-22 | Claims only via AdMob SSV, conditional `$inc` cap per track | Ads must be proven; concurrency-safe cap | Trust app (BitPlay C3) | Done |
| 6 | 09-22 user | 60 × 5.5 GH/s free claims; Super tiers $4.99/30d, $49/365d, $99/365d; paid packs no stacking cap; 15-day guard for single pack | User's business rules | Caps on paid stacking — **rejected by user** | Done |
| 7 | 09-22 user | Withdraw to `@speed.app` address or any BOLT11 (exact amount); admin reviews all | User decision; Speed only supports its own LN addresses reliably | Any LN address | Done |
| 8 | 09-22 | Speed payouts: claim before send, note `bitmine:{id}`, unknown outcome → reconcile, never auto re-send | Speed has no idempotency key (BitPlay M7 double-pay risk) | Retry on timeout | Done; **fee behaviour still untested** |
| 9 | 09-22 | RevenueCat REST is source of truth for grants; webhook only triggers sync; refunds revoke + flag | Never trust app's purchase claims | Webhook payload grants | Done |
| 10 | 09-22 user | Email OTP for 2FA | User choice | TOTP for users | Done |
| 11 | 09-22 user | News tab dropped for v1 | User choice | — | **Reversed** by #13 |
| 12 | 09-22 | Admin panel server-rendered in the API (`/admin`), password+TOTP, CSRF, audit | Small, no separate deploy | Separate React admin | Done |
| 13 | 09-22 user | Keep Market/News/Academy with real content (CoinGecko, RSS, seeded lessons) | User wanted their design's tabs real | Remove them | Done |
| 14 | 09-22 user | Wrap the user's vanilla-JS design with **Capacitor** | Preserve their exact design; fastest | React Native rewrite (planned in spec §8) — **not chosen** | Done |
| 15 | 09-22 user | Bundle ID `com.bitmine.app` | User approved | — | Done |
| 16 | 09-22 | Dev-only shortcut routes for claims/purchases (never in production) | Browser and home-network phone can't receive AdMob/RevenueCat | Mock in frontend | Done |
| 17 | 10-01 | Deploy with Docker Compose (api + worker + Caddy auto-HTTPS) on a VPS, Atlas DB | Simple single-server ops; HTTPS automatic | PM2/systemd + nginx (documented as alternative) | Prepared, not deployed |
| 18 | 10-01 | Production refuses to start without Brevo | Sign-up/2FA/reset depend on email; silent failure is worse | Warn only | Done |
| 19 | 10-01 | Retention TTLs for high-volume non-money collections only | Unbounded growth (60 claims/user/day) | Keep forever | Done |
| 20 | 10-01 | Debug-only manifest allows cleartext; release HTTPS only; allowBackup=false | Dev APK must reach PC over HTTP; production security | Global cleartext | Done |

---

## 8. BUGS / PROBLEMS / FIXES

| Problem | Symptoms | Root cause | Solution | Files | Status / risk |
|---|---|---|---|---|---|
| Mongoose TS errors | tsc failures on nested settings, query literals, lean user types | Mongoose 9 typing | subschema `_id:false`, `as const` literals, `SessionUser` interface, `param()` helper | models, auth, admin | Fixed |
| Seed went to `test` DB | data in Atlas `test` db | URI lacked db name | appended `/bitmine` to `MONGODB_URI` | backend/.env | Fixed; stray Atlas `test` db may still exist |
| Accrual vs late purchase race | possible missed/double hours | concurrent transactions | accrual reads miners in-tx; grants `$inc minersRev` to force conflict + backfill | accrualJob, store/service | Fixed (tested) |
| Flaky tests | memory-server crashes | one replica set per file | single replica set in `test/globalSetup.ts`, DB per file | test/* | Fixed |
| OTP test createdAt | couldn't age OTPs | Mongoose ignores createdAt updates | raw collection update | tests | Fixed |
| Prototype `updateCollapse()` undefined | Home threw on render | prototype bug | removed; module `heroCollapse.js` | heroCollapse.js | Fixed |
| Hero collapse fought animations | collapse transforms overridden | stagger animation fill-mode | `.home-hero.entered` disables stagger after 1400 ms | heroCollapse.js, app.css | Fixed; regression risk if animations change |
| Data refresh replayed entrance animations | flicker every 30 s | re-render with animations | `no-enter` class on non-fresh renders | app.js, app.css | Fixed |
| Focus scrolled the phone container | layout jump on OTP focus | overflow on container | `.phone-screen-inner{overflow:clip}` + `focus({preventScroll:true})` | app.css, ui.js | Fixed |
| OTP autofill kept last digit | auto-fill broken | maxlength 1 | first box maxlength 6 + `fill()` | ui.js | Fixed |
| Bottom sheet shadow visible when closed | ghost shadow | not hidden | visibility hidden when closed | app.css | Fixed |
| Orphaned API on port 4000 | EADDRINUSE | earlier tsx process | killed PID | — | Watch for it |
| Capacitor Android build "invalid source release: 21" | gradle fails | JAVA_HOME is Java 17 | `android-apk.mjs` finds Java 21 (Android Studio jbr) | scripts/android-apk.mjs | Fixed |
| Script paths / gradlew.bat not found | build script errors | backslashes eaten; relative path | forward slashes; absolute quoted path + `shell:true` | android-apk.mjs | Fixed |
| **Dev APK couldn't use plain HTTP** (10-01) | phone can't reach `http://192.168.x:4000` | Android blocks cleartext by default; Capacitor `cleartext` doesn't set the manifest flag | `android/app/src/debug/AndroidManifest.xml` `usesCleartextTraffic=true` (debug only); main manifest false | android manifests | Fixed; verified in merged debug manifest |
| **Rate limits behind proxy** (10-01) | all users share one IP | `trust proxy` hard-coded loopback; Docker proxy isn't loopback | `TRUST_PROXY` env (compose sets `uniquelocal`) | env.ts, app.ts, server.ts, compose | Fixed. Risk: wrong value = shared limits or spoofable IPs |
| **Email failure = 500** (10-01) | generic error on sign-up if Brevo fails | mailer threw plain Error | `AppError 503 email_unavailable`; prod startup guard | mailer.ts, env.ts | Fixed |
| **Failed ad blocked claims** (10-01) | after 3 failed ad loads user locked out 10 min | pending claims count toward max 3 | `POST /v1/claims/:id/cancel` + app gives back claim | claims/service.ts, v1.ts, mining.js | Fixed (tested) |
| **Unbounded collections** (10-01) | DB growth | no retention | TTL indexes (§3) | models | Fixed |
| TTL index name clash (10-01) | 14 test files failed: "equivalent index already exists" | second index on `dueAt` | StoreSync TTL on `createdAt` instead | models | Fixed |
| Store sync spam (10-01) | repeated RevenueCat calls/follow-ups | no limit | 12/10 min per user; replace follow-ups | store/service.ts | Fixed (tested) |
| Delete account with withdrawal in flight (10-01) | orphaned payout | no check | refuse while open | profile.ts | Fixed (tested) |
| 2FA code burned on refused withdrawal (10-01) | user must request new code | OTP consumed before open-check | early open-withdrawal check | withdrawals.ts | Fixed (tested) |
| Long API calls hang (10-01) | spinner forever on dead network | no fetch timeout | 25 s AbortSignal | api.js | Fixed |
| **Atlas unreachable from this PC** (10-01) | API crash at start: `MongooseServerSelectionError … tlsv1 alert internal error` | PC's public IP not in Atlas Network Access | **User must add IP in Atlas** | — | **OPEN (blocker for phone test)** |
| Tests run from repo root | 31 "failed" files | vitest picks up BitPlay tests in `reference/` | always run from `backend/` | — | Process note |

---

## 9. CURRENT WORK

**CURRENT TASK:** Production-readiness pass ("analyze everything… backend ready to deploy… then I will test the APK") — **completed**; user then requested this handoff.

**WHAT HAS BEEN DONE (this pass, all uncommitted):** audit of every backend/frontend/Android file; fixes in §8 dated 10-01; new `backend/src/hardening.test.ts` (6 tests); `deploy/` (Dockerfile, docker-compose.yml, Caddyfile), `.dockerignore`, `docs/DEPLOYMENT.md`; `frontend/scripts/release-check.mjs` + `npm run release:check` / `android:release`; Android release signing config, debug manifest, `allowBackup=false`, `versionName 1.0.0`, keystores ignored; cleaned `backend/.env.example`; README updates; MOBILE_SETUP release section. Verified: tsc clean, **161/161 tests pass (18 files)**, `npm run build` OK, `vite build` OK, debug APK rebuilt (BUILD SUCCESSFUL), release-check correctly refuses the dev config, production env guard verified.

**WHAT REMAINS:** user to fix Atlas IP allowlist and test the APK on a phone; commit (user hasn't approved yet); create vendor accounts; deploy.

**LAST SUCCESSFUL STATE:** tests green, builds green, APK at `frontend/android/app/build/outputs/apk/debug/app-debug.apk` (points at `http://192.168.1.71:4000`, dev shortcuts on).

**LAST CHANGE:** StoreSync TTL index moved to `createdAt` (fixed the index-clash); memory file `bitmine-tooling-gotchas.md` written; this handoff.

**NEXT STEP:** (1) Ask user whether to commit — all changes or only Claude's (user's logo/CSS edits are mixed in the working tree). (2) User: add PC IP in Atlas → `cd backend && npm run dev:api` → install APK, same Wi-Fi, allow Node through Windows Firewall (private). (3) Fix whatever the phone test reveals. (4) Deployment when domain/server exist.

**BLOCKERS:** Atlas allowlist (user action); no domain/server/vendor accounts; no Mac for iOS; Docker not installed on this PC (Dockerfile not built locally).

---

## 10. TODO LIST

**CRITICAL**
- Atlas Network Access: add current PC IP (dev) / server IP (prod).
- Phone test of the debug APK (sign-up, email code from API console, Start mining, claim with test ad, store in dev mode, withdraw sheet, all screens).
- Commit the current work (ask the user first; never discard their edits).
- Replace AdMob **test** App ID in `AndroidManifest.xml` and test ad units (admin → FAQs & app) before release.

**HIGH**
- Create accounts: Brevo (+ verified sender), Speed, RevenueCat (Apple+Google apps), AdMob (app + rewarded units with SSV callback), Firebase (service account, `google-services.json`, OAuth client IDs), Play Console, Apple Developer, domain, VPS.
- Deploy per `docs/DEPLOYMENT.md`; seed; `create-admin`; set webhook URLs; `app-ads.txt`; privacy/terms URLs.
- Real small Speed payout to learn whether fees are deducted from `amount` or charged on top; update FAQ.
- Create store products `bitmine_{sku}` (8) as iOS non-renewing / Android consumable; import in RevenueCat.
- Release keystore + `keystore.properties`; production `frontend/.env`; `npm run android:release`; AAB upload.

**MEDIUM**
- Push to a private GitHub repo (user to provide URL).
- iOS: `npx cap add ios` on a Mac; Info.plist (GADApplicationIdentifier, SKAdNetworkItems, NSUserTrackingUsageDescription), push + Sign in with Apple capabilities, APNs key.
- Apple review risk (rewarded ads granting hashpower + BTC withdrawals; guideline 3.1.5; may need organization account).
- Confirm RevenueCat REST fields for non-renewing/consumables and refund event shape in production.
- Monitoring/alerting (worker logs `ALERT:` lines currently only logged).

**LOW**
- Delete test user `e2e-test-miner@example.com` from the dev DB; drop stray Atlas `test` DB.
- Remove unused `frontend/js/data.js`.
- Decide whether to keep the 9.8 MB screen recording tracked in git.
- Update stale TECHNICAL_SPEC sections (§8 React Native, §10 env list, decision #3 News).

**FUTURE IDEAS (from spec)**
- Play Integrity / App Attest verdicts for claims and withdrawals (phase 2).
- Abuse signals (device IDs, referral farms, claim bursts) feeding review flags.
- Nightly ledger-invariant check with alert; Sentry.
- Auto-approve small withdrawals (setting exists, default 0).

---

## 11. DEPLOYMENT / PRODUCTION

- **Hosting:** not provisioned (UNKNOWN provider). Plan: Ubuntu 24.04 VPS, Docker, ports 80/443, `git clone` to `/opt/bitmine`.
- **Domain/DNS:** UNKNOWN. Need `A` record `api.<domain>` → server IP. Root domain also serves `app-ads.txt`, privacy, terms (not built).
- **Stack:** `deploy/docker-compose.yml`: `api` (built from `deploy/Dockerfile`, `node dist/server.js`, `TRUST_PROXY=uniquelocal`, healthcheck `wget /health`), `worker` (same image, `node dist/worker.js` — **exactly one**), `caddy` (2-alpine, `API_DOMAIN` from `deploy/.env`, auto TLS, HSTS, gzip/zstd, reverse_proxy api:4000). Env file: `deploy/.env` (copy of `backend/.env.example` + `API_DOMAIN`); git-ignored because the root `.gitignore` pattern `.env` matches in every folder.
- **Dockerfile:** multi-stage node:22-alpine; `npm ci` → `npm run build` → `npm prune --omit=dev`; runtime copies `node_modules`, `dist`, `package.json`, `data/` (disposable-email list read from `../../data` relative to `dist/auth/`); `USER node`; port 4000. Build context = repo root (`.dockerignore` excludes frontend/docs/reference/media/env).
- **Database:** Atlas replica set (required — `connectDb` refuses standalone). M0 to start, M10+ for backups. DB name `bitmine`.
- **Production config:** `NODE_ENV=production` (pino JSON logs, secure admin cookies, dev routes never mounted, startup guard), `DEV_SHORTCUTS=false`, `ALLOW_SANDBOX=false`, `CORS_ORIGINS=capacitor://localhost,https://localhost,http://localhost`.
- **Commands:** `docker compose -f deploy/docker-compose.yml up -d --build`; logs `… logs -f api|worker|caddy`; `… exec api node dist/scripts/seed.js`; `… exec api node dist/scripts/create-admin.js you@domain`.
- **Vendor URLs:** AdMob SSV `https://api.<domain>/webhooks/admob-ssv`; RevenueCat webhook `https://api.<domain>/webhooks/revenuecat` with Authorization = `REVENUECAT_WEBHOOK_AUTH`; admin `https://api.<domain>/admin/login`.
- **Monitoring:** `/health`; worker log lines `accrual run complete`, `ALERT: Speed balance too low`, `ALERT: … needs admin review`; admin dashboard (liabilities vs Speed balance, reconcile banner).
- **CI/CD:** none. **Known issues:** Docker image never built locally (no Docker on PC); Speed fee semantics untested.

---

## 12. GIT / REPOSITORY CONTEXT

- Local repo at `D:\BitMine`, branch **`main`** only, **no remote** (user may provide a private GitHub URL later). Identity `sachin <sachin@adaptsmedia.com>`.
- Commits (oldest → newest): `81b43f3` foundation/accrual/claims · `950ad0e` store · `98e036f` wallet & withdrawals · `60ca40a` auth · `80ca2d2` referrals/notifications/support/FAQs/config · `623b9de` admin panel · `7ea32ba` market/news/academy/daily earnings/miner detail/dev shortcuts · `b8a0ba7` CORS & DEV_SHORTCUTS docs · `26896fa` app wired to backend, missing screens, Capacitor-ready · `2046626` Android project + phone dev build (**HEAD**).
- **Uncommitted** (at handoff): modified — `README.md`, `backend/.env.example`, `backend/README.md`, `backend/src/{app,server,worker}.ts`, `auth/mailer.ts`, `claims/service.ts`, `config/env.ts`, `mining/accrualJob.ts`, `models/index.ts`, `routes/v1.ts`, `store/service.ts`, `users/profile.ts`, `wallet/withdrawals.ts`, `docs/MOBILE_SETUP.md`, `frontend/android/{.gitignore,app/build.gradle,app/src/main/AndroidManifest.xml}`, `frontend/js/{api.js,screens/mining.js}`, `frontend/package.json`, `frontend/scripts/android-dev.mjs`; **user's own edits**: `frontend/css/{app,screens,simulator}.css`, `frontend/index.html`, `frontend/js/app.js`, `frontend/js/screens/{account,auth,home}.js` (logo). Untracked — `.dockerignore`, `deploy/`, `docs/DEPLOYMENT.md`, `backend/src/hardening.test.ts`, `frontend/android/app/src/debug/`, `frontend/scripts/release-check.mjs`, `CLAUDE_HANDOFF.md`, and user's `frontend/vite.config.js`, `frontend/assets/images/logo.{png,jpeg}`, `WhatsApp Image … .jpeg`, `.claude/`.
- Workflow: commit only when the user asks; descriptive messages; commit trailer currently required by the harness: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (follow whatever the new session's harness says). No migrations framework — schema changes are Mongoose model changes + idempotent `seedAll()`; indexes are created by Mongoose `autoIndex` at startup.

---

## 13. COMMAND REFERENCE

```bash
# Backend (from D:\BitMine\backend)
npm install
npm run dev:api          # tsx watch src/server.ts  (port 4000)
npm run dev:worker       # tsx watch src/worker.ts
npm run typecheck        # tsc --noEmit
npm test                 # vitest run (RUN FROM backend/, ~30-40 s; first run downloads MongoDB binary)
npm run build            # tsc -p tsconfig.build.json → dist/
npm run start:api        # node dist/server.js
npm run start:worker     # node dist/worker.js
npm run seed             # idempotent: economics v1, products, FAQs, lessons, app config
npm run db:status        # print settings + products
npm run admin:create -- you@example.com   # USER runs this; prints password + TOTP secret once
npm run news:refresh     # fetch RSS once

# Frontend (from D:\BitMine\frontend)
npm install
npm run dev              # vite on :3000 (desktop simulator; ?device=1 full-screen)
npm run build            # vite build → dist/
npm run android:dev      # vite build with VITE_API_URL=http://<LAN IP>:4000 + dev shortcuts, cap sync android (DEV_API_HOST overrides IP)
npm run android:apk      # gradlew assembleDebug with Java 21 → android/app/build/outputs/apk/debug/app-debug.apk
npm run release:check    # refuses dev settings
npm run android:release  # release:check && vite build && cap sync android
npx cap open android     # Android Studio
adb install -r android/app/build/outputs/apk/debug/app-debug.apk   # adb at %ANDROID_HOME%\platform-tools

# Deployment (server, repo root)
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml logs -f --tail 200 worker
docker compose -f deploy/docker-compose.yml exec api node dist/scripts/seed.js
docker compose -f deploy/docker-compose.yml exec api node dist/scripts/create-admin.js you@domain

# Release keystore (once)
keytool -genkeypair -v -keystore frontend/android/bitmine-release.jks -alias bitmine -keyalg RSA -keysize 2048 -validity 10000
```
No linter/formatter is configured (UNKNOWN preference; none in package.json).
In the desktop app, `.claude/launch.json` defines preview servers `bitmine-api` and `bitmine-app`.

---

## 14. ENVIRONMENT VARIABLES (names only)

**backend/.env (read by `src/config/env.ts`)**
```
NODE_ENV=
PORT=
LOG_LEVEL=
CORS_ORIGINS=
TRUST_PROXY=
DEV_SHORTCUTS=
MONGODB_URI=
JWT_ACCESS_SECRET=
REVENUECAT_SECRET_KEY=
REVENUECAT_WEBHOOK_AUTH=
ALLOW_SANDBOX=
SPEED_API_KEY=
SPEED_API_BASE=
ADMOB_SSV_KEYS_URL=
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
GOOGLE_CLIENT_IDS=
APPLE_BUNDLE_ID=
BREVO_API_KEY=
MAIL_FROM=
```
The user's current `backend/.env` also contains **unused** names from the old spec: `PUBLIC_BASE_URL, ADMIN_BASE_URL, JWT_REFRESH_SECRET, ADMIN_SESSION_SECRET, SENTRY_DSN` (harmless).
**deploy/.env** = the backend list + `API_DOMAIN=` (Caddy).
**frontend/.env (public, baked into the app)**
```
VITE_API_URL=
VITE_REVENUECAT_APPLE_KEY=
VITE_REVENUECAT_GOOGLE_KEY=
VITE_GOOGLE_WEB_CLIENT_ID=
VITE_DEV_SHORTCUTS=
VITE_APP_VERSION=
```
**frontend/android/keystore.properties (git-ignored, not yet created):** `storeFile=`, `storePassword=`, `keyAlias=`, `keyPassword=`.
Other native config files to add: `frontend/android/app/google-services.json`, iOS `GoogleService-Info.plist`.

---

## 15. IMPORTANT FILES TO TRANSFER

**ESSENTIAL**
- `CLAUDE_HANDOFF.md` — this document.
- Ideally the **whole repo** (minus `node_modules`, `dist`, `reference/`, `.env` files, `android/app/build`). If the new chat has filesystem access to `D:\BitMine`, nothing needs uploading.
- If uploading selectively: `docs/TECHNICAL_SPEC.md`, `docs/ECONOMICS.md`, `docs/DEPLOYMENT.md`, `docs/MOBILE_SETUP.md` (design + ops), `backend/src/models/index.ts`, `backend/src/config/{env,economics}.ts`, `backend/src/app.ts`, `backend/src/routes/v1.ts`, `frontend/js/app.js`, `frontend/js/store.js`, `frontend/js/api.js`.

**USEFUL**
- `docs/BITPLAY_BUG_AUDIT.md` (why the code is shaped this way), `docs/BITPLAY_BACKEND_ANALYSIS.md`.
- `backend/src/mining/{accrual,accrualJob}.ts`, `claims/service.ts`, `store/service.ts`, `wallet/{withdrawals,payoutJob,speed}.ts` (money paths).
- `frontend/js/screens/*.js`, `frontend/js/native.js`, `frontend/css/tokens.css`, `frontend/index.html`.
- `deploy/*`, `frontend/android/app/src/main/AndroidManifest.xml`, `frontend/android/app/build.gradle`, both `.env.example` files.

**OPTIONAL**
- `README.md`, `backend/README.md`, tests (`backend/src/**/*.test.ts`) as behaviour documentation, `ScreenRecording_…mp4` (design reference), `frontend/css/{components,screens}.css`.
- **Never upload:** `backend/.env`, `frontend/.env`, `reference/` (contains BitPlay secrets).

---

## 16. INSTRUCTIONS FOR THE NEXT CLAUDE

- Treat this document as the project's historical context; **inspect the actual code before assuming** anything here is still true.
- Preserve the architecture: server-authoritative economics, msat integers, append-only ledger + balance cache in one transaction, idempotency keys, miners-as-spans, single worker, Capacitor-wrapped vanilla JS app. Don't rewrite working code; don't replace libraries (e.g. no React/RN, no GSAP, no firebase-admin, no Redis) without a concrete reason and the user's OK.
- Follow conventions: backend TS ESM with `.js` import suffixes, zod at route edges, `AppError(status, code, userMessage, details?)` for expected failures, user-facing messages short and plain, comments explaining *why*; frontend screen modules exporting `screens/actions/forms`, `data-act`/`data-go`/`data-form` delegation, `esc()` on every API string inserted into HTML, new CSS only in `css/app.css`.
- **Preserve the user's UI/UX exactly** — it's their design. Reuse existing classes for any new screen.
- Check `package.json` before adding dependencies; prefer none.
- Never change money logic without tests; keep the ledger invariant (Σ ledger == balance) and run `npm test` from `backend/`.
- Debug root causes first; when changing a module, check its consumers (e.g. `OPEN_STATUSES`, `claimCount`, `ensureBalance` are used in several places).
- Keep changes minimal and production-safe. Ask before major architectural changes, deleting data, committing, pushing, or anything outward-facing.
- Project-specific:
  - **Never overwrite or discard the user's uncommitted edits** (it happened once with `app.js`). Check `git status`/`git diff` first.
  - Never print or paste secrets/connection strings; never commit `.env` or `reference/`; never reuse anything from BitPlay's repos (keys, IDs, mnemonics, accounts).
  - Admin accounts are created only by the user running `npm run admin:create`.
  - Dev shortcuts must never be reachable in production.
  - The user writes short, casual instructions ("go ahead", "commit") and expects the full step done end to end; they asked to "check everything" — verify with tests/builds and report honestly what wasn't verified.
  - Windows specifics: some files are CRLF; long bash heredocs with quotes can fail — write scripts to files; backgrounded commands may ignore `cd`.

---

## 17. CONTEXT THAT IS EASY TO FORGET

- **TECHNICAL_SPEC.md is partly stale:** §8 describes a React Native app (superseded by Capacitor + the user's vanilla design); §10 lists env vars the code doesn't read; decision #3 "News dropped" was reversed. `ECONOMICS.md` table says Pro/Max "length to confirm" — user confirmed 365 days.
- `data.js` in the frontend is dead prototype data — not imported anywhere.
- `capacitor.config.json` has **no `server` block**; `android-dev.mjs` temporarily adds `androidScheme:'http', cleartext:true`, runs `cap sync`, then restores the file. So after `android:dev`, `android/app/src/main/assets/capacitor.config.json` (generated, git-ignored) contains the http scheme — a release build must re-run `vite build && cap sync` (i.e. `npm run android:release`) to reset it.
- The debug APK has the PC's LAN IP **baked in** (`192.168.1.71` at build time); if the PC's IP changes, rebuild (`npm run android:dev && npm run android:apk`).
- In the dev phone build, after a watched **test** ad the app calls the dev-complete route itself (`if (config.devShortcuts) await post('/v1/dev/claims/…/complete')`), because Google's SSV callback can't reach a home PC. In production `VITE_DEV_SHORTCUTS=false` and the backend doesn't mount the route.
- AdMob SSV handler must read the **raw** query string from `req.originalUrl` (no decode/re-encode) — don't refactor to `req.query`. A bare request (no query) returns 200 "ok" because AdMob's console pings the URL when saved.
- `claimCount()` exists because lean reads return Mongoose Maps as plain objects.
- Claims are `GET`-verified by Google: all decided outcomes return 200 on purpose (non-2xx makes Google retry).
- RevenueCat webhook returns 5xx on transient failures on purpose (so RevenueCat retries); sandbox events ignored unless `ALLOW_SANDBOX`.
- `backfill()` always bumps `minersRev` even when no backfill is needed — it's the concurrency guard, not dead code.
- `ensureBalance` sets `accruedUntil` to the current hour for new users (nothing earlier to credit).
- `requestWithdrawal` checks for an open withdrawal **twice** (early check + unique partial index) — intentional (early check protects the OTP; index is the real guard).
- Referral rewards use **UTC days**, while claims/sessions use **local days** — intentional.
- Timezone change takes effect at next midnight in the **old** zone (anti-abuse); `effectiveTimezone()` folds pending changes.
- Account deletion is a **soft delete** (records kept for fraud/accounting); email is rewritten so it can be reused.
- Admin TOTP replay protection uses `lastTotpStep`; admin cookie path is `/admin` only.
- `app.set("trust proxy")`: `loopback` for nginx on same host, `uniquelocal` for Docker/Caddy. Wrong value breaks per-IP rate limits.
- In production without Brevo the API **won't start** (by design). In development without Brevo, OTP codes are printed in the API console (`DEV EMAIL (not sent…)`).
- `MONGODB_URI` must include the db name (`/bitmine`), otherwise data goes to `test`.
- `vitest` from repo root picks up BitPlay tests in `reference/` → run from `backend/`.
- `frontend/vite.config.js` was created by the user (untracked); it sets port 3000 and ignores android/ios/dist in watch.
- Store IDs default to `bitmine_{sku}` and must exactly match App Store Connect / Play Console product IDs; changeable in admin → Products.
- Google sign-in on Android needs the **web** OAuth client ID in `VITE_GOOGLE_WEB_CLIENT_ID` and all client IDs in backend `GOOGLE_CLIENT_IDS`; Apple button shows only on iOS.
- Push plugin starts safely without `google-services.json` (gradle applies google-services only if the file exists).
- The 9.8 MB `ScreenRecording_…mp4` **is tracked** in git; the WhatsApp image is not.

---

## 18. FINAL STATE SNAPSHOT

CURRENT PROJECT STATE:
Feature-complete v1 (backend API + worker + admin panel + Capacitor-wrapped app in the user's design + Android project). Production-readiness pass finished on 2026-10-01 with all tests (161/161) and builds green. Large set of changes uncommitted on `main` (no remote). Not deployed; no vendor accounts yet.

WHAT WORKS:
Server-authoritative mining (hourly accrual, sessions, ad claims via SSV with caps, claim cancel), Super Miner tiers, paid miners with backfill, RevenueCat sync/webhook/refunds, withdrawals with locking, admin review, Speed payout job with reconciliation, email/Google/Apple auth with rotating refresh tokens and email-OTP 2FA, referrals, notifications (outbox + FCM), support tickets, FAQs/app config, market/news/academy, admin panel with TOTP/CSRF/audit, all app screens wired with live balance, browser dev mode, debug APK build, release-check script, Docker/Caddy deployment files, production env guard.

WHAT DOESN'T WORK:
Local API can't connect to Atlas until the PC's IP is allowlisted. Google sign-in, push, real purchases and real ads need vendor accounts not yet created. iOS project not generated (needs a Mac). Docker image never built locally. Speed fee behaviour unverified. App not yet tested on a physical phone.

CURRENT TASK:
Handoff after the production-readiness pass; awaiting the user's phone test of the debug APK and a decision on committing.

NEXT ACTION:
Ask the user to (a) add their IP in Atlas Network Access, run `npm run dev:api` in `backend`, install `frontend/android/app/build/outputs/apk/debug/app-debug.apk` on a phone on the same Wi-Fi; (b) confirm whether to commit (all changes, or Claude's only — the user's logo/CSS edits are in the same tree). Then fix phone-test findings, then deploy per `docs/DEPLOYMENT.md` once domain/server/accounts exist.

IMPORTANT CONSTRAINTS:
Keep the user's design exactly; never overwrite their uncommitted work; never expose/commit secrets or reuse anything from BitPlay; money only in integer msat through the ledger in transactions; dev shortcuts never in production; admin accounts only via the user-run script; free/single-pack users must need ≥15 days to reach 2,500 sats, paid stacking uncapped; every withdrawal admin-reviewed; withdrawals only to `@speed.app` addresses or exact-amount BOLT11; ask before commits, pushes, deletions and major architectural changes.

KNOWN RISKS:
Speed has no idempotency key (mitigated by claim-before-send + reconcile; admin must handle `needs_reconcile`); Speed fee semantics unknown; Apple App Review policy for crypto rewards + rewarded ads; AdMob SSV latency in production; RevenueCat REST field shapes for non-renewing/consumables unverified in production; `TRUST_PROXY` misconfiguration would break rate limiting; AdMob test IDs must be replaced before release; losing the release keystore would block app updates; single worker process is a single point of failure for accrual/payouts (it catches up after downtime); Atlas M0 has no continuous backups.
