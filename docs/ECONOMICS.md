# BitMine Economics: launch numbers (v3, 2026-09-22)

Interactive model: https://claude.ai/artifact/QvqW3FY5eBu3y9qiBmsFTM
Assumptions: BTC $100k, blended rewarded eCPM $4, store fee 15%, payout fees 1%, referral 5%.

## Core rule (from user)
Free users and single-pack buyers can't reach the minimum withdrawal of **0.000025 BTC (2,500 sats)** in under **15 days**, even with one Titan + every ad claim + Super Miner (≤ ~166 sats/day).
Stacking several packs **may** reach it faster; that's intended (no paid cap).

## Settings
| Setting | Value |
|---|---|
| Mining rate | **0.048 sats / GH/s / day** (admin-editable) |
| Free ad claims | **5.5 GH/s × 60 claims/day** = max 330 GH/s. Resets at the user's local midnight. Available to paid users too. |
| Super Miner | Paid unlock **$4.99 / 30 days**: +30 claims/day × 5.5 GH/s = up to **165 GH/s**. Resets at midnight. |
| Super Miner Pro | **$49 / 365 days**: +50 claims/day × 10 GH/s = up to **500 GH/s** |
| Super Miner Max | **$249 / 365 days**: +50 claims/day × 20 GH/s = up to **1 TH/s** |
| Super tiers | Each tier is its own claim track; tiers stack; rebuying extends |
| Paid cap | **None.** Packs stack freely |
| Referral | 5% of friend's mining, capped at **5 sats/day** per referrer |
| Min withdrawal | **2,500 sats** (0.000025 BTC) |

## Paid miners (30 days, mine 24/7, renewed by buying again; changed from 180 days on 2026-10-03)
| Pack | Price | GH/s | Sats/day | Total over 30 days | % of price |
|---|---|---|---|---|---|
| Mini Miner | $1.99 | 65 | 3.1 | 94 | 4.7% |
| Spark | $4.99 | 170 | 8.2 | 245 | 4.9% |
| Core | $9.99 | 360 | 17.3 | 518 | 5.2% |
| Forge | $19.99 | 760 | 36.5 | 1,094 | 5.5% |
| Titan | $79.99 | 2,000 | 96 | 2,880 | 3.6% |

## Days to reach 2,500 sats (worst case: every claim mines 24h)
| User | Sats/day | Days |
|---|---|---|
| Titan + 60 claims + Super Miner (fastest) | 160 | **15.6** ✓ |
| Titan only, no ads | 96 | 27 |
| Free + Super Miner ($4.99), maxed | 23.8 | 105 |
| Free + Super Miner Max ($249), maxed | 63.8 | 40 |
| Free, 60 claims/day | 15.8 | 158 |

Real users claim throughout the day, so claimed GH/s mines less than 24h and actual days are longer.

## Perks, bonuses and offers (2026-10-03)

Set in admin → FAQs & app ("Perks & bonuses", "Sale banner"); defaults in `backend/src/settings/growth.ts`.

| Feature | Default | Cost to us |
|---|---|---|
| Paid-miner owners skip the daily start videos | on | A few ad views per paying user per day |
| Streak: every 7th day started in a row adds 55 GH/s until midnight | on | At most ~2.6 sats per user per week |
| Boost video: doubles running hashpower (max 500 GH/s) for 60 min, 3 a day | on | At most 1 sat per video, well under what a rewarded view pays |
| Starter Pack (`starter_bundle`): Mini Miner + Super Miner for 30 days, $3.99, offered for 48 h after sign-up until the first purchase | on | None (a discount) |
| Paid miners (Mini to Titan) are auto-renewing monthly subscriptions; each paid month is a miner for that month. Super Miner tiers and the Starter Pack are one-time | on | None |
| Sale banner with countdown | off | None; the real price is whatever the store charges |

Renewal reminders go out 3 days before, 1 day before and when a paid miner or Super Miner tier ends (a subscribed miner only if it lapses without renewing).
