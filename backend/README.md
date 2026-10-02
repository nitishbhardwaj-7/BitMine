# BitMine backend

API and background worker for BitMine (see [../docs/TECHNICAL_SPEC.md](../docs/TECHNICAL_SPEC.md)).

## Requirements
- Node 22+
- A MongoDB **replica set** (MongoDB Atlas always is). The ledger uses transactions, so the app refuses to start on a standalone server.

## Setup
1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env` and set `MONGODB_URI` (see *MongoDB Atlas* below).
3. Seed the economics settings and product catalog (safe to re-run):
   ```
   npm run seed
   ```
4. Run the API and the worker in two terminals:
   ```
   npm run dev:api
   npm run dev:worker
   ```

## Admin panel
The admin panel is served by the API at `/admin` (email + password; 10 attempts per 15 minutes).
Create the admin account once, in your own terminal (the password is printed only once):
```
npm run admin:create                        # admin@bitmine.com
npm run admin:create -- admin@bitmine.com --reset-password   # new password later
```
Then sign in at `http://localhost:4000/admin/login`.

## Production
`npm run build` compiles to `dist/`; `npm run start:api` and `npm run start:worker` run it. The step-by-step server setup (Docker Compose + Caddy for HTTPS) is in [../docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md). With `NODE_ENV=production` the API refuses to start without the email provider configured, because sign-up depends on it.

## Tests
```
npm test
```
The tests start one throwaway MongoDB replica set and give each test file its own database. The first run downloads a MongoDB binary (~100 MB), and later runs reuse it. No `.env` is needed for tests.

## MongoDB Atlas (development database)
1. Sign up at https://www.mongodb.com/cloud/atlas and create a free **M0** cluster.
2. *Database Access* → add a database user with a strong password.
3. *Network Access* → add your current IP address.
4. *Connect* → *Drivers* → copy the connection string, add a database name (e.g. `/bitmine`), and put it in `.env` as `MONGODB_URI`.

## Layout
| Path | What |
|---|---|
| `src/server.ts` | API entry |
| `src/worker.ts` | Worker: accrual, referrals, reminders, push, store follow-ups, payouts |
| `src/mining/accrual.ts` | Pure earnings maths |
| `src/mining/accrualJob.ts` | Hourly job that credits earnings to the ledger |
| `src/settings/economics.ts` | Versioned economics settings |
| `src/mining/sessions.ts` | Daily Start mining |
| `src/mining/status.ts` | Mine screen data and miners list |
| `src/claims/service.ts` | Ad claims, daily caps, Super Miner tiers |
| `src/claims/admobSsv.ts` | AdMob callback signature verification |
| `src/routes/` | `/v1` API and `/webhooks` |
| `src/auth/` | Sign-up, sign-in (email, Google, Apple), email codes, 2FA, tokens |
| `src/users/profile.ts` | Account settings: password, email, 2FA, timezone, referral, deletion |
| `src/store/service.ts` | Purchases: grants, stacking, Super Miner extensions, backfill, refunds |
| `src/store/revenuecat.ts` | RevenueCat REST client |
| `src/wallet/withdrawals.ts` | Withdrawal requests, locking, admin approve/reject/reconcile |
| `src/wallet/payoutJob.ts` | Sends approved withdrawals via Speed and tracks them to paid/failed |
| `src/wallet/speed.ts` | Speed instant-send client |
| `src/wallet/bolt11.ts` | Lightning invoice reader (amount, network, expiry) |
| `src/referrals/referralJob.ts` | Daily referral rewards (5%, capped 5 sats/day) and referral summary |
| `src/notifications/` | Outbox + in-app list, FCM push sender, reminders |
| `src/support/service.ts` | Support tickets |
| `src/routes/public.ts` | FAQs and app config (no sign-in) |
| `src/config/content.ts` | FAQ and app config seed content |
| `src/admin/` | Admin panel: sign-in, dashboard, withdrawals, purchases, users, support, economics, products, content, announcements, audit log |
| `src/config/economics.ts` | Launch numbers and product seeds |
| `src/models/` | MongoDB models |
| `src/lib/time.ts` | Timezone and local-midnight helpers |
