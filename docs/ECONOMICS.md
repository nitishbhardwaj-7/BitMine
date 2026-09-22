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
| Super Miner Pro | **$49 / 365 days** (length to confirm): +50 claims/day × 10 GH/s = up to **500 GH/s** |
| Super Miner Max | **$99 / 365 days** (length to confirm): +50 claims/day × 20 GH/s = up to **1 TH/s** |
| Super tiers | Each tier is its own claim track; tiers stack; rebuying extends |
| Paid cap | **None.** Packs stack freely |
| Referral | 5% of friend's mining, capped at **5 sats/day** per referrer |
| Min withdrawal | **2,500 sats** (0.000025 BTC) |

## Paid miners (180 days, mine 24/7)
| Pack | Price | GH/s | Sats/day | Total over 180 days | % of price |
|---|---|---|---|---|---|
| Mini Miner | $1.99 | 65 | 3.1 | 562 | 28% |
| Spark | $4.99 | 170 | 8.2 | 1,469 | 29% |
| Core | $9.99 | 360 | 17.3 | 3,110 | 31% |
| Forge | $19.99 | 760 | 36.5 | 6,566 | 33% |
| Titan | $49.99 | 2,000 | 96 | 17,280 | 35% |

## Days to reach 2,500 sats (worst case: every claim mines 24h)
| User | Sats/day | Days |
|---|---|---|
| Titan + 60 claims + Super Miner (fastest) | 160 | **15.6** ✓ |
| Titan only, no ads | 96 | 27 |
| Free + Super Miner ($4.99), maxed | 23.8 | 105 |
| Free + Super Miner Max ($99), maxed | 63.8 | 40 |
| Free, 60 claims/day | 15.8 | 158 |

Real users claim throughout the day, so claimed GH/s mines less than 24h and actual days are longer.
