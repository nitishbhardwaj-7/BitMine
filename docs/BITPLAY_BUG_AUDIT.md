# BitPlay Bug Audit (what BitMine must NOT inherit)

Scope: backend `tupple_dev` (commit of 2026-09-22), auth service, RN app. Focus is on money paths: hashpower → mined BTC → balance → withdrawal, plus purchases.
Paths are relative to `reference/backend` unless noted.

## Critical: anyone can mint earnings

| # | Bug | Where | Effect |
|---|---|---|---|
| C1 | **Client-supplied `hashpower` is added to the user's GH/s with no validation.** The only check blocks values of 5–6 once the ad cap is hit. Any other number (1,000,000 or a negative) is accepted. | `routes/api_routes/user-mining-handles.js` POST `/` (~L494–L513) | Free unlimited hashpower. |
| C2 | **`stock_game_bonus` is set by the client** and added to mining power in settlement. | same file (~L604); `helpers/miningDaySettlement.js` `computeMinedBtcOnDayRollover` | Inflates the server-computed BTC. |
| C3 | **Ad rewards are never verified server-side.** There is no AdMob SSV callback. Ad counters (`rewarded_ads_watched`, `random_ads_watched`) come from the client, so sending a lower number resets the daily cap. | user-mining POST | Unlimited "ad" rewards with no ads watched. |
| C4 | **API auth is off unless `ENFORCE_API_AUTH=true`.** Without a token, any caller can act as any `userId`. `GET /api/referrals/rewards/:userId` isn't in the user-path list, so it's readable for anyone. | `middleware/appUserAuth.js`, `routes/api.js` | Account takeover of game state and data leaks. |

C1 + C2 combined with the client-synced balance mean the only thing limiting payouts is M2 (a cap that also hurts honest users).

## Major: honest users lose money

| # | Bug | Where | Effect |
|---|---|---|---|
| M1 | **Settlement credits `min(client-synced BTC, server-computed BTC)`.** The client only syncs every 30s while the Home screen is open. | `cronJobs.js` L53+, `src/screens/HomeScreen.tsx` L437–L462 (app) | A user who starts mining and closes the app is credited only what was synced before closing, which is often close to 0. |
| M2 | **The sync endpoint rejects any amount above 0.0000009 BTC**, which caps daily credit at 90 sats. At `7e-15` BTC/GH/s/s that's about **1,490 GH/s**. | `routes/api_routes/balance.js` L57 | Paid users are capped. The top plan (4,700 GH/s → 13,630 effective after the 2× and +45% bonus) earns about **11%** of what was sold. |
| M3 | **The "3% daily loss" is still active for paying users** even though the comments say it's disabled. GET applies `checkAndApplyDailyLoss()` whenever `purchasedHashpower > 0`, and `getEffectiveHashpower()` applies `cumulative_loss`. It's unbounded, so it can reach 100%. | `user-mining-handles.js` L243–L249, `models/UserMiningDetails.js` | Paying users' mining silently decays toward zero. |
| M4 | **Purchased hashpower never expires** (plans have `duration` in months, but nothing enforces it), and **refunds aren't revoked** (the webhook ignores CANCELLATION/REFUND). | `helpers/grantPlanPurchase.js`, `routes/revenuecat_webhook.js` | Refund-and-keep abuse and permanent liability. |
| M5 | **A withdrawal needs `Balance.BTC > 0`**, meaning a synced balance from the current session. | `withdrawal_routes.js` ~L455 | Users can't withdraw unless they're actively mining with the app open. |
| M6 | **The payout is in USDT, calculated from a USD figure the client sends, with 15% tolerance.** The BTC price also moves between the request and the admin's approval. | `withdrawal_routes.js` L472–L512, approve L591+ | Users can take up to 15% extra, and payouts drift from the BTC actually deducted. |
| M7 | **If the Speed call times out, the balance is restored**, but the payment may already have gone out. There's no idempotency key. | `withdrawal_routes.js` approve ~L706 | Possible double payout. |
| M8 | **Settlement uses read-modify-`save()` on `BTC_DEPOSIT`**, which races with the `$inc` deduction in withdrawals. The cron runs inside the web process, so two instances mean double settlement. | `cronJobs.js` ~L128 | Lost updates, and withdrawn BTC can reappear. |

## Medium
- **Timezone bug in the live display.** The client's local wall-clock time is parsed in the server's timezone, then compared with a UTC epoch, so the displayed mined amount is off by the user's UTC offset. It also crashes (500) if `local_time` is missing. (`user-mining-handles.js` GET)
- **Dates are passed around as locale strings** (`"DD/MM/YYYY, hh:mm:ss AM/PM"`) and regex-parsed everywhere. The day-rollover logic comes from the client's date, so it can be spoofed.
- **Streak:** +5 GH/s even at 0 days (tier `minDays: 0`). The logic is duplicated in two routes and based on the client's date.
- **Email OTP verification** looks the user up by OTP only (it ignores the email), uses a 4-digit code and has no attempt limit, so it can be brute-forced. (`auth/controllers/authController.js` `verifyEmailOTP`)
- **GET endpoints write to the DB** (migrations, loss application).
- **Mining state is split across three places** (`UserMiningDetail`, `MiningSession`, `Balance.BTC`) that can drift apart.

## Code health
- `HomeScreen.tsx` is 4,574 lines and holds the mining logic in UI code.
- The frontend repo contains stale copies of the backend and auth services.
- Wallet mnemonics are committed in `readme.md`, and keystores and a provisioning profile are committed in the app repo.
- Unused dependencies: `pg`, `zeromq`, `lightning-client`, `bullmq`/`ioredis`.

## Worth keeping
- RevenueCat server-side verification with a unique `store_transaction_id` index, plus the webhook safety net.
- The atomic guarded `$inc` for withdrawal deduction.
- The JWT `appUserAuth` design (turned on from day one), rate limiter, and admin approval flow.
- The Speed integration shape, and the auth service (after fixing the OTP bug).

## Conclusion
Reuse the **infrastructure** (auth, RevenueCat verification, Speed client, admin panel, notifications, support). **Rewrite the economic core** (miners, hashpower, accrual, ledger, withdrawal amounts) so it's server-authoritative. The app should never send amounts, hashpower or counters, only intents ("start mining", "claim ad reward" backed by an SSV proof, "withdraw X sats").
