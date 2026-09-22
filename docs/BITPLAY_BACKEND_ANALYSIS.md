# BitPlay → BitMine: Backend Analysis

Source repos (cloned read-only into `D:\BitMine\reference`):

| Folder | Repo | What it is |
|---|---|---|
| `reference/backend` | billionwebsgit/btc-mining-backend @ `tupple_dev` | Main API + admin panel + cron + webhooks |
| `reference/auth` | nitishbhardwaj-7/BitPlay-Auth | Auth service (users, login, JWT) |
| `reference/frontend/btc-mining-frontend-testing/btc-mining-frontend-testing` | nitishbhardwaj-7/BitPlay | React Native app (the other two folders in that repo are stale copies of backend/auth) |

## 1. Architecture

```
React Native app (RN 0.81, TypeScript)
   │  JWT from auth service, + x-app-id / x-app-platform / x-device-id headers
   ├──► /mobile_api/*  ──► Auth service  (Express + Mongo, port 5000)
   └──► /api/*         ──► Main backend  (Express + Mongo, port 3001)
                              ├─ /admin/*            EJS admin dashboard
                              ├─ /webhooks/revenuecat
                              ├─ cronJobs.js         hourly settlement + push reminders
                              ├─ btcWatcher.js       bitcoind ZMQ deposit watcher
                              └─ alchemyWatcher.js   BSC deposit watcher
Both services share ONE MongoDB database (backend reads the auth `users` collection directly).
Production: one host behind nginx (dashboard.bitplaypro.com).
```

## 2. Auth service
- Email/password register and login (bcrypt, JWT HS256, 30d expiry).
- Social login: Google and Apple, with tokens verified server-side (Firebase project ID, Google client IDs, Apple audience).
- Email verification by OTP, forgot/reset password, change email by OTP.
- 2FA by email OTP. A token stays in a "pending 2FA" state until the code is verified.
- Referral code generated per user (6 chars); `referralUsed` is stored at signup.
- Blocks disposable email domains.
- `JWT_SECRET` must be **identical** in the auth service and the main backend.

## 3. Core economics (the "mining" engine)
All mining is virtual. No real mining happens.

| Rule | Value / location |
|---|---|
| BTC per GH/s per second | `7e-15`, in `helpers/miningDaySettlement.js` and `user-mining-handles.js` |
| Session length | 24h max, capped at the user's **local midnight** |
| Settlement | Hourly cron. It credits `min(client-synced BTC, server-computed BTC)` → `Balance.BTC_DEPOSIT`, writes `BalanceHistory`, then resets hashpower to purchased hashpower |
| Rewarded ad (regular track) | +5.5 GH/s per ad, max 60/day |
| Super Ad Miner track | max 30/day, boosted ×50 or ×100 by a Super Privilege |
| Daily free miner | one claim per day (`/claim_daily_miner`) |
| Daily rewards | admin-defined streak rewards (`/daily-rewards`) |
| Games | 25 mini-games; a win gives 10 GH/s (server-side cap), with separate trading/spin/memory claim endpoints |
| Referral | parent gets 5% of the child's daily mined BTC (`REFERRAL_REWARD_PERCENTAGE`) |
| Loss mechanic | 3% daily loss if the daily ad requirement isn't met (`lossTracking`) |
| Stuck-session compensation | scripts and model for sessions that failed to settle |

The user starts mining → the app calls `POST /api/user_mining` and `/mining-sessions/start` → the client shows a live odometer → the cron settles after local midnight → the user starts again the next day.

## 4. Money in: in-app purchases (RevenueCat)
- **Hashpower plans** (`SubscriptionPlan`: GH/s, duration, apple/google product IDs). The app buys through the RevenueCat SDK, then `POST /api/purchases/:userId`. The backend re-verifies with the RevenueCat REST API (`REVENUECAT_SECRET_KEY`) and grants `purchasedHashpower`. Sandbox purchases are refused in production.
- **Super Privileges**: consumables `…super_privilege_5000pct` / `…10000pct`, valid 1 year, re-verified the same way.
- **Webhook** `/webhooks/revenuecat` is a safety net if the app call fails. It handles only `INITIAL_PURCHASE` and `NON_RENEWING_PURCHASE`, and is idempotent on the store transaction ID.
- The RevenueCat subscriber attribute `bitplay_user_id` holds the Mongo user ID.

## 5. Money out: withdrawals (Speed)
- The destination must be a **Speed Lightning address** (`name@speed.app`, regex-enforced).
- Limits: min 0.0005 BTC, max 0.009 BTC (admin-editable in `AppSettings`). One pending withdrawal per user at a time. Rate limited.
- Flow: the user requests (`POST /api/withdrawals`) → status PENDING → **an admin approves** in the dashboard → the backend calls `https://api.tryspeed.com/send` with the `SPEED_API_KEY` (Basic auth) → the balance is deducted before sending.
- The Speed account must hold enough funded balance to pay users.
- `/withdrawals/speed-account` shows the Speed balance in the admin panel.

## 6. Crypto deposits (optional, heavy)
- A BTC deposit address per user is derived from `BTC_XPUB`/`XPRV`. This needs a **bitcoind full node** with ZMQ.
- BSC deposits (BNB/USDT/USDC) are derived from `EVM_MNEMONIC`/`EVM_XPUB`, with an Alchemy websocket watcher.
- **Recommendation: drop this for BitMine v1.** It needs a node, hot-wallet keys on the server, and sweeping. It is a big security and ops burden and isn't part of the core earn-and-withdraw loop.

## 7. Other backend features
- Push notifications: FCM via firebase-admin (mining expiring or stopped, video reminder, daily reward reminder, admin broadcast) and notification preferences.
- Email: Brevo API or SMTP (support replies and similar).
- Support tickets, FAQs, delete-account requests.
- News feed: RSS from CoinTelegraph, Decrypt, CoinDesk and Bitcoin.com. BTC price from CoinGecko, with Binance as fallback.
- Ad unit IDs are served from the DB (`/api/google-ads/ids`). The AdMob API is used for revenue stats in the dashboard.
- App version policy / force update (`/api/app-version-policy`).
- Admin panel: users, balances, withdrawals approve/reject, plans, purchases, privileges, daily rewards, FAQs, support, push broadcast, withdrawal limits, dashboard stats.

## 8. Frontend (logic we reuse, UI we replace)
Reusable, non-UI code:
- `src/config/api.ts`, `attachBackendAuth.ts` (axios + auth headers)
- `src/auth/*`, `src/services/*`, `src/hooks/*`, `src/utils/*`, `src/stores/HashPowerStore.tsx`, `src/config/revenuecat.ts`

Screens to redesign: auth (login, signup, OTP, 2FA, forgot password), Home/mining, Wallet, Withdraw, Balance history, Store/plans, Super Privileges, Game Zone plus 25 games, News, Profile, Referral, Notifications, Support/FAQ, Settings.

SDKs: Firebase (auth, messaging, analytics), Google Sign-In, Apple Sign-In, RevenueCat, Google Mobile Ads, Notifee, MMKV, Reanimated, Lottie, Apptrove plus a custom MMP lib (attribution).

## 9. Everything hard-coded to BitPlay (must change)
- Bundle IDs `com.bitplay.app` (Android) and `com.bitplaypro.bitplaypro` (iOS)
- `x-app-id: bitplay-mobile` / `MOBILE_ALLOWED_APP_IDS`
- API host `dashboard.bitplaypro.com`, CORS origins
- RevenueCat public keys in `src/config/revenuecat.ts`; attribute `bitplay_user_id`
- Product IDs in `routes/api_routes/privileges.js` (TIER_CATALOG) and the plan documents
- Firebase project `bitplay-3fbe7`, `google-services.json`, `GoogleService-Info.plist`
- AdMob app IDs in `app.json`, ad units in the DB, `app-ads.txt`
- Apple audience and Google client IDs in the auth service
- Keystores and provisioning profiles, Codemagic/GitHub CI

## 10. Security notes
- **Wallet mnemonics and keys are committed in `backend/readme.md`** (testnet and "main master wallet"). Never reuse any of them. BitMine needs freshly generated keys that live only in the server `.env`.
- The frontend repo commits debug keystores and a base64 provisioning profile. Don't carry them over.
- API auth enforcement is behind `ENFORCE_API_AUTH`. BitMine starts fresh, so this should be `true` from day one (there are no legacy app builds to support).
