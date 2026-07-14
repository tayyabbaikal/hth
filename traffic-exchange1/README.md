# Traffic Exchange (for Short Links)

A credit-based traffic-exchange platform built **specifically for URL shorteners**
(AdFly-style links, ShrinkMe, etc.). Members earn credits by visiting other
members' short links and spend credits to have their own links shown — with a
tamper-proof, single-use visit-verification system at its core.

- **Stack:** Next.js 14 (App Router) · TypeScript · Prisma · PostgreSQL · Redis · JWT · bcrypt · Zod
- **Deploy:** self-hosted with Docker Compose (app + Postgres + Redis + nginx/TLS)
- **Status:** **Foundation build.** The backbone — database, auth, credit ledger,
  and the full anti-cheat visit engine — is complete and runnable. UI polish
  (dashboard/admin screens), notifications delivery, and payout/monetization are
  the documented next phases (see [Roadmap](#roadmap)).

---

## Table of contents
1. [How it works](#how-it-works)
2. [Quick start (local)](#quick-start-local)
3. [Production deploy (Docker)](#production-deploy-docker)
4. [Can I run this on free tiers? (Vercel / Neon)](#can-i-run-this-on-free-tiers)
5. [Configuration](#configuration)
6. [Project structure](#project-structure)
7. [API](#api) · [docs/API.md](docs/API.md)
8. [Security](#security) · [docs/SECURITY.md](docs/SECURITY.md)
9. [Testing](#testing)
10. [Roadmap](#roadmap)

---

## How it works

### Credit model (escrow)
- When a member creates a campaign, the chosen credit amount is **spent upfront
  from their balance into the campaign's escrow pool**. This means a campaign can
  never spend credits the owner doesn't have, even under concurrency.
- Each completed visit consumes `costPerVisit` from that pool and pays the
  **viewer** `pointsPerVisit` (subject to the daily earning limit).
- When the pool is drained the campaign auto-completes.

### Secret visit verification (the anti-cheat core)
Every visit is gated by a **single-use, HMAC-signed token** bound to a database
`Visit` row:

```
 1. Viewer requests a link      GET  /api/visit/next
 2. Server issues a token       POST /api/visit/start
      → creates a PENDING Visit {jti, viewerId, campaignId, ipHash, expiresAt}
      → returns token = base64url(payload).HMAC(payload) + the short URL
 3. Viewer opens the short link and dwells for the required timer
 4. Viewer returns the token    POST /api/visit/callback
      → verify signature (not tampered)
      → verify expiry
      → verify session identity == token viewer
      → look up Visit by jti; must be PENDING & not consumed  (replay guard)
      → enforce min dwell time server-side
      → enforce duplicate-IP cap + daily earn limit
      → ATOMICALLY: mark Visit consumed+COMPLETED, charge escrow, credit viewer
```

Because the consume + credit movement happens inside **one database
transaction** keyed on the unique `jti`, two concurrent callbacks with the same
token can never both succeed — **no replay, no double-reward**. Signature is
checked with a constant-time compare before the payload is even parsed.

---

## Quick start (local)

Requirements: Node 20+, and a Postgres instance (Docker or local). Redis is
optional locally (rate limiting falls back to in-process).

```bash
cp .env.example .env         # then edit AUTH_JWT_SECRET / VISIT_TOKEN_SECRET / IP_HASH_SALT
npm install
npx prisma migrate dev --name init   # creates tables + the migration
npm run db:seed              # creates admin (from ADMIN_EMAIL/PASSWORD) + default settings
npm run dev                  # http://localhost:3000
```

Generate strong secrets:
```bash
openssl rand -base64 48   # run three times, one per secret
```

Try the loop: register two accounts, verify email (dev mode prints the verify
link to the server console), create a campaign on account A, then surf on
account B at `/surf`.

---

## Production deploy (Docker)

The included stack runs the app, Postgres, Redis, and nginx (TLS) together.

```bash
cp .env.example .env
# Edit .env: set APP_URL to your https domain, strong secrets, POSTGRES_PASSWORD,
# RESEND_API_KEY (for real emails), ADMIN_EMAIL/PASSWORD.

# TLS certs: put fullchain.pem + privkey.pem in deploy/certs/
#   (use certbot / Let's Encrypt — free). Set your domain in deploy/nginx.conf.

docker compose up -d --build
docker compose run --rm app npx prisma migrate deploy   # apply migrations
docker compose run --rm app npm run db:seed             # settings + admin
```

Schedule the token-cleanup job (host crontab):
```cron
*/5 * * * * cd /path/to/traffic-exchange && docker compose run --rm app npx tsx scripts/expire-tokens.ts
```

**Backups** (nightly Postgres dump, keep 14 days):
```cron
0 3 * * * docker compose exec -T db pg_dump -U tx traffic_exchange | gzip > /backups/tx_$(date +\%F).sql.gz
```

### Deploy onto your existing website
Point a subdomain (e.g. `exchange.yourdomain.com`) at this server and put the
nginx service in front, **or** if you already run nginx on the host, proxy that
subdomain to the app container's port and skip the bundled nginx service.

---

## Can I run this on free tiers?

Short answer: **yes to start, with caveats.** You chose self-hosted Docker,
which avoids the biggest one — but here's the full picture you asked about:

### Neon (Postgres) — "does it allow only one web?"
- Neon **free = 1 project**, but inside that one project you can create
  **multiple databases and multiple schemas**. So one free Neon project can back
  several apps — give this one its own database (or a `traffic_exchange` schema).
- Free limits: 0.5 GB storage and auto-suspend on idle (first query after idle
  is slow). Fine to launch; upgrade when you grow.
- To use Neon instead of the bundled Postgres, just set `DATABASE_URL` to your
  Neon connection string and **remove/ignore the `db` service** in compose.

### Vercel (app host) — the catch
- Vercel's **Hobby (free) plan forbids commercial use.** An earn-credits traffic
  exchange is commercial in spirit, so compliant hosting there needs **Pro ($20/mo)**.
- Serverless functions have short timeouts and **no long-running workers**, so
  the token-cleanup job must run as a **Vercel Cron**, and rate limiting needs an
  **external Redis (Upstash free)** because Vercel has none built in.
- The code is serverless-compatible (all handlers are stateless), so it *can*
  run there — but for a commercial exchange, **self-hosting (your choice) is the
  cleaner, cheaper path.**

### Recommended free/cheap add-ons
| Need | Free option |
|---|---|
| Redis (rate limit) | Upstash free (10k cmds/day) — set `REDIS_URL` |
| Email | Resend free (3k/mo) — set `RESEND_API_KEY` |
| TLS certs | Let's Encrypt / certbot |
| Proxy/VPN check | proxycheck.io free tier — set `PROXY_CHECK_API_KEY` |

---

## Configuration

All runtime knobs live in the `AdminSetting` table (seeded with defaults) and are
editable by an admin — no redeploy needed:

| Setting | Default | Meaning |
|---|---|---|
| `pointsPerVisit` | 1 | Credits a viewer earns per completed visit |
| `defaultCostPerVisit` | 1 | Credits a campaign spends per visit |
| `minTimerSec` | 10 | Required dwell time before a callback is accepted |
| `tokenTtlSec` | 600 | Visit-token lifetime |
| `dailyEarnLimit` | 500 | Max credits a user can earn per day |
| `referralBonus` | 50 | Credits to referrer per verified referral |
| `signupBonus` | 10 | Starter credits on email verification |
| `revisitCooldownHours` | 24 | How long before the same link can reappear |
| `requireCampaignApproval` | false | New campaigns start `PENDING` for admin review |
| `maxDuplicateIpVisits` | 3 | Reward cap per campaign from one network |

Secrets and infra come from environment variables — see `.env.example`.

---

## Project structure

```
prisma/schema.prisma        # normalized data model (9 core tables)
prisma/seed.ts              # admin + default settings
src/lib/
  env.ts                    # validated env (fails fast on misconfig)
  prisma.ts  redis.ts       # singletons
  auth.ts                   # bcrypt + JWT session cookies
  tokens.ts                 # ★ HMAC single-use visit tokens
  visit-service.ts          # ★ queue, issue, callback (anti-cheat rules)
  credits.ts                # atomic ledger (credit/debit)
  settings.ts               # cached admin settings
  ratelimit.ts fraud.ts     # abuse controls + fraud logging
  validation.ts             # zod input schemas
  email.ts referral.ts http.ts
src/app/api/
  auth/{register,login,logout,verify-email}
  visit/{next,start,callback}
  campaigns  dashboard  me
src/app/{page,surf}         # landing + working surf loop
src/middleware.ts           # security headers + route auth gate
Dockerfile docker-compose.yml deploy/nginx.conf
scripts/expire-tokens.ts    # background maintenance
docs/API.md docs/SECURITY.md
```

---

## API

Full reference in [docs/API.md](docs/API.md). All responses are
`{ ok: true, data }` or `{ ok: false, error }`. Auth is a `tx_session` httpOnly
cookie set on login.

Core visit flow: `GET /api/visit/next` → `POST /api/visit/start` →
`POST /api/visit/callback`.

---

## Security

Covered in depth in [docs/SECURITY.md](docs/SECURITY.md): single-use signed
tokens, replay/timing defenses, CSRF posture (SameSite cookies + same-origin
API), XSS (CSP + React escaping), SQL-injection safety (Prisma parameterization),
rate limiting, duplicate-IP/daily caps, bot filtering, IP hashing (no raw PII),
and fraud logging.

---

## Testing

```bash
npm run typecheck   # strict TS across the project
npm test            # vitest — token engine unit tests included
```

The token test suite exercises round-trip, tamper rejection, expiry, and
malformed input. Add integration tests against a disposable Postgres for the
visit/callback transaction (see roadmap).

---

## Roadmap

Foundation done. Next phases (each additive — no architectural change needed):

1. **UI screens** — login/register/dashboard/campaign-manager/admin panel
   (all APIs already exist; these are React pages over them).
2. **Admin actions API** — user list/ban, credit adjust, campaign moderation,
   settings editor, fraud-log viewer, analytics.
3. **Notifications delivery** — in-app center (rows exist) + email digests.
4. **Password reset** flow endpoints (schema + email helper already present).
5. **Proxy/VPN detection** integration (env hook present).
6. **Optional CAPTCHA** on register/surf.
7. **Monetization** — premium memberships, paid credit packs, URL analytics,
   ad slots. The credit **ledger** already supports arbitrary transaction types,
   so paid credits are a new `TxType` + payment webhook, not a rewrite.
```
