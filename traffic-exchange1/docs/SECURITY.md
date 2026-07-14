# Security Documentation

This document maps each threat to the concrete control implemented in the code.

## 1. Visit verification & anti-cheat (the crown jewel)

**Single-use signed tokens** (`src/lib/tokens.ts`). A visit token is
`base64url(payload).HMAC_SHA256(payload)` signed with `VISIT_TOKEN_SECRET`. The
payload binds `{ jti, campaignId, viewerId, exp }`.

- **Tampering** → the HMAC won't match. Signature is verified with a
  **constant-time compare** (`safeEqual`) *before* the payload is parsed, so a
  forged payload never influences control flow, and timing can't leak the secret.
- **Replay / reuse** → the matching `Visit` row (unique `jti`) must be `PENDING`
  and `consumed = false`. Consuming it and moving credits happens in **one
  Prisma transaction**; a second concurrent callback finds it already consumed
  and is rejected `ALREADY_CONSUMED`. No double-reward is possible.
- **Expiry** → `exp` is checked statelessly, and the DB row has `expiresAt`; a
  cron job (`scripts/expire-tokens.ts`) sweeps stale PENDING rows.
- **Identity binding** → callback's authenticated session `sub` must equal the
  token's `viewerId`, else `IDENTITY_MISMATCH` (logged).
- **Timer gaming** → dwell time is enforced **server-side** (`now - startedAt >=
  minTimerSec`). The client countdown is UX only; a fast callback is rejected
  `TIMER_TOO_FAST`.
- **Two secrets** → auth JWTs and visit tokens use **different** secrets
  (enforced at boot in `env.ts`), so compromise of one doesn't forge the other.

## 2. Authentication
- Passwords hashed with **bcrypt (cost 12)** — never stored or logged in plaintext.
- Sessions are **stateless JWTs (jose, HS256)** in an **httpOnly, Secure,
  SameSite=Lax** cookie — not readable by JS, mitigating XSS token theft.
- Login returns a **uniform error** whether or not the email exists (no user
  enumeration) and is rate-limited.
- Email verification and password-reset tokens are random 32-byte values;
  **only their SHA-256 hash is stored**, single-use, and time-boxed.

## 3. CSRF
- The API is **same-origin JSON** with a **SameSite=Lax** session cookie, so a
  cross-site form/GET can't ride the session for state changes.
- CSP `form-action 'self'` and `frame-ancestors 'none'` block cross-origin form
  posts and framing. For extra defense you can add an origin check or CSRF token
  to mutations (roadmap).

## 4. XSS
- React escapes all rendered output by default; no `dangerouslySetInnerHTML`.
- A strict **Content-Security-Policy** is set in `middleware.ts`
  (`default-src 'self'`, no external scripts).
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`.

## 5. SQL injection
- **Prisma ORM** parameterizes every query; no string-built SQL anywhere.
- All external input is validated/normalized by **Zod** schemas at the boundary
  (`src/lib/validation.ts`) before it reaches the data layer.
- Submitted short URLs are restricted to `http(s)` (blocks `javascript:` / `data:`).

## 6. Rate limiting & abuse
- Redis-backed fixed-window limiter (`src/lib/ratelimit.ts`) with an in-process
  fallback; per-endpoint limits in [API.md](API.md).
- **Duplicate-IP cap** (`maxDuplicateIpVisits`) limits rewards for one campaign
  from a single network.
- **Daily earn limit** caps credits earned per user per day.
- **Self-visit** prevention and **one live token per (viewer, campaign)**.
- **Bot filter** on User-Agent at `start`; the JS-driven callback + server timer
  defeat naive scripted farming.
- Optional **proxy/VPN detection** hook (`PROXY_CHECK_API_KEY`).

## 7. Privacy of PII
- **Raw IPs are never stored.** Only salted **SHA-256** hashes
  (`IP_HASH_SALT`) are persisted, used solely for duplicate detection.

## 8. Fraud logging
- Every rejection (tampered token, replay, fast timer, duplicate IP, daily
  limit, self-visit, bot, identity mismatch) is written to `FraudLog` with type,
  detail, IP hash, and metadata — feeding the admin fraud view (roadmap) and
  enabling auto-ban rules.

## 9. Transport & infra
- nginx terminates **TLS 1.2/1.3**, redirects HTTP→HTTPS, sets **HSTS**, and adds
  an **edge rate-limit** zone on `/api/`.
- App runs as a **non-root** user in the container; `poweredByHeader` disabled.
- Secrets come only from environment variables; `.env` is git/docker-ignored;
  `env.ts` **fails fast** if a required secret is missing or the two signing
  secrets are equal.

## Operational recommendations
- Rotate `AUTH_JWT_SECRET` / `VISIT_TOKEN_SECRET` periodically (invalidates live
  sessions/tokens by design).
- Run `scripts/expire-tokens.ts` on a schedule and take nightly DB backups.
- Put Redis in front of rate limiting when running more than one app replica so
  limits are shared across instances.
