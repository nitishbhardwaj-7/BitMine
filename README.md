# BitMine

Personal Bitcoin mining-rewards app: free ad claims, Super Miner tiers and paid miners, with Lightning withdrawals via Speed.

| Folder | What |
|---|---|
| `backend/` | API + worker (Node 22, TypeScript, Express, MongoDB) |
| `frontend/` | The app: your design (vanilla JS + Vite), wired to the API, packaged with Capacitor (`frontend/android`) |
| `deploy/` | Dockerfile, docker-compose and Caddy config for the API + worker |
| `docs/` | Analysis, bug audit, economics, technical spec |
| `reference/` | Read-only BitPlay clones, git-ignored |

Start with [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md). To put it live: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), then [docs/MOBILE_SETUP.md](docs/MOBILE_SETUP.md).
