# BitMine: putting the backend live

One small server (2 GB RAM is plenty to start), MongoDB Atlas for the database, Docker Compose for the API + worker, Caddy for HTTPS. Everything below is done once; updates are two commands.

## What you need before starting
| Item | Why |
|---|---|
| A domain, e.g. `bitmine.app` | `api.bitmine.app` for the API and admin panel; the root for `app-ads.txt`, privacy policy and terms |
| A Linux VPS (Ubuntu 24.04) with ports 80 and 443 open | Runs the API, the worker and Caddy |
| MongoDB Atlas cluster (M0 is fine to launch; M10 when there are real users) | Database. Atlas is a replica set, which the ledger's transactions need |
| Brevo account + verified sender | Email codes. **Required**: the API refuses to start in production without it |
| Speed account + API key | Lightning payouts (payouts stay paused until the key is set) |
| RevenueCat project (Apple + Google apps) | Purchases |
| AdMob app + rewarded ad units | Claims |
| Firebase project (service account + `google-services.json`) | Push notifications and Google sign-in |

## 1. DNS
Create an **A record** `api` → your server's IP. Wait until `ping api.yourdomain` answers from your PC.

## 2. Server
```bash
ssh root@YOUR_SERVER_IP
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
git clone YOUR_PRIVATE_REPO_URL /opt/bitmine
cd /opt/bitmine
```

## 3. Configuration
```bash
cp backend/.env.example deploy/.env
nano deploy/.env
```
Set, at minimum:
- `NODE_ENV=production`
- `MONGODB_URI` — Atlas connection string **with the database name** (`/bitmine`). In Atlas → Network Access, allow the server's IP.
- `JWT_ACCESS_SECRET` — 48+ random characters (`openssl rand -base64 48`). Changing it later signs everyone out.
- `BREVO_API_KEY`, `MAIL_FROM` (a sender verified in Brevo, e.g. `no-reply@yourdomain`)
- `CORS_ORIGINS=capacitor://localhost,https://localhost,http://localhost` (the app's WebView origins; the admin panel is same-origin)
- `API_DOMAIN=api.yourdomain` (used by Caddy for the certificate)
- `APPLE_BUNDLE_ID=com.bitmine.app`, `GOOGLE_CLIENT_IDS` (web, Android and iOS OAuth client IDs, comma-separated)
- `REVENUECAT_SECRET_KEY`, `REVENUECAT_WEBHOOK_AUTH` (any long random string; paste the same into RevenueCat's webhook settings)
- `SPEED_API_KEY`
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (from the service-account JSON; keep the key on one line with `\n`)

Leave `DEV_SHORTCUTS=false` and `ALLOW_SANDBOX=false`. `TRUST_PROXY` is set to `uniquelocal` by docker-compose (Caddy is on the Docker network).

## 4. Start
```bash
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml logs -f api
```
You should see `MongoDB connected` and `BitMine API listening`. Then `https://api.yourdomain/health` returns `{"ok":true}` (Caddy fetches the certificate on the first request; give it a few seconds).

Seed the database and create your admin account (the admin details are printed **once**; store them in a password manager):
```bash
docker compose -f deploy/docker-compose.yml exec api node dist/scripts/seed.js
docker compose -f deploy/docker-compose.yml exec api node dist/scripts/create-admin.js you@yourdomain
```
Sign in at `https://api.yourdomain/admin/login` with that email and password.

## 5. Connect the vendors
| Vendor | Setting | Value |
|---|---|---|
| AdMob | Rewarded ad unit → Server-side verification → callback URL | `https://api.yourdomain/webhooks/admob-ssv` |
| RevenueCat | Project → Integrations → Webhooks | URL `https://api.yourdomain/webhooks/revenuecat`, Authorization header = `REVENUECAT_WEBHOOK_AUTH` |
| RevenueCat | Products | Create `bitmine_miner_mini`, `bitmine_miner_spark`, `bitmine_miner_core`, `bitmine_miner_forge`, `bitmine_miner_titan`, `bitmine_super_pro`, `bitmine_super_max`, `bitmine_starter_bundle` in App Store Connect / Play Console (non-renewing / consumable), plus `bitmine_super_basic_monthly` as an **auto-renewing monthly subscription** (one base plan), and import them all. In the webhook, keep RENEWAL events enabled: each renewal extends Super Miner by that paid month |
| AdMob | `app-ads.txt` | Serve the line AdMob gives you at `https://yourdomain/app-ads.txt` |
| Admin panel → FAQs & app | Ad units, store URLs, support email, privacy and terms URLs | Replace the Google test ad units with your real ones before release |

## 6. Check before the first users
- `https://api.yourdomain/health` → `{"ok":true}`
- Sign up from the app with a real email: the code arrives (Brevo)
- Admin → Dashboard shows the Speed balance (Speed key works)
- Buy the cheapest pack with a store **sandbox** account on a staging copy with `ALLOW_SANDBOX=true`, or with a real purchase that you refund
- Request and approve one small withdrawal to your own Speed address; confirm whether Speed deducted the fee from the amount or from your balance, and note it in the FAQ
- Worker logs show `accrual run complete` a few minutes past each hour

## Day-to-day
- **Logs:** `docker compose -f deploy/docker-compose.yml logs -f --tail 200 worker` (or `api`, `caddy`)
- **Update after a `git pull`:** `docker compose -f deploy/docker-compose.yml up -d --build` (the API drains in-flight requests, the worker finishes its current job)
- **Alerts to watch in the worker log:** `ALERT: Speed balance too low` (top up Speed; payouts resume on their own), `needs admin review` (admin → Withdrawals → *needs reconcile*)
- **Backups:** Atlas M10+ has continuous backups; on M0 take a `mongodump` before changing economics or products
- **Secrets:** rotate `JWT_ACCESS_SECRET` only if leaked (signs everyone out); reset the admin password with `create-admin.js admin@bitmine.com --reset-password`

## Server that already runs Traefik / Dokploy (the current production server)
If ports 80/443 already belong to Traefik (Dokploy), do **not** start Caddy. Use `deploy/docker-compose.traefik.yml`: the API joins the `dokploy-network` and Traefik routes `API_DOMAIN` to it with its `letsencrypt` resolver.
```bash
cd /opt/bitmine
docker compose -f deploy/docker-compose.traefik.yml --env-file deploy/.env up -d --build
docker exec bitmine-api node dist/scripts/seed.js
docker logs -f bitmine-api        # and bitmine-worker
```
Until Brevo is configured, `MAIL_LOG_ONLY=true` lets production start and writes email codes to `docker logs bitmine-api` (only for private testing; remove it once `BREVO_API_KEY` and `MAIL_FROM` are set).

## Running without Docker (alternative)
On the server with Node 22: `cd backend && npm ci && npm run build`, then run `node dist/server.js` and `node dist/worker.js` under systemd or PM2 with the same `.env` (`TRUST_PROXY=loopback`), and put nginx or Caddy in front on port 443 proxying to `127.0.0.1:4000`. Both processes must run; there is exactly one worker.
