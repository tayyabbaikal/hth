# API Reference

Base URL: `${APP_URL}`. All endpoints return JSON:

```jsonc
{ "ok": true,  "data": { ... } }        // success
{ "ok": false, "error": "CODE", ... }   // failure (HTTP status reflects the error)
```

Authentication is a **`tx_session` httpOnly cookie** issued by `/api/auth/login`.
Send it automatically (browser) or include it on requests. All state-changing
endpoints are same-origin `POST`s (see [SECURITY.md](SECURITY.md) for CSRF posture).

---

## Auth

### `POST /api/auth/register`
Create an account. A verification email is sent (dev mode logs the link).

```jsonc
// body
{ "email": "a@b.com", "password": "min-8-chars", "referralCode": "ABC12345" } // referralCode optional
// 201 -> { "ok": true, "data": { "userId": "...", "message": "..." } }
```
Errors: `INVALID_INPUT` (422), `EMAIL_TAKEN` (409), `RATE_LIMITED` (429).

### `GET /api/auth/verify-email?token=...`
Activates the account, grants the signup bonus, and pays the referral bonus.
Redirects to `/login?verify=success|invalid`.

### `POST /api/auth/login`
```jsonc
{ "email": "a@b.com", "password": "..." }
// 200 -> { "ok": true, "data": { "user": { id, email, role, credits, emailVerified } } }
```
Errors: `INVALID_CREDENTIALS` (401), `BANNED` (403), `RATE_LIMITED` (429).

### `POST /api/auth/logout`
Clears the session cookie. `-> { ok: true, data: { loggedOut: true } }`

---

## Session / dashboard

### `GET /api/me`
Current user: `{ id, email, role, credits, emailVerified, referralCode }`.

### `GET /api/dashboard`
```jsonc
{ "ok": true, "data": {
  "credits": 0, "totalEarned": 0, "totalSpent": 0,
  "activeCampaigns": 0, "completedVisits": 0,
  "remainingCampaignBalance": 0, "referralEarnings": 0,
  "referralLink": "https://.../register?ref=ABC12345",
  "unreadNotifications": 0,
  "recentActivity": [ { "amount": 1, "type": "EARN", "balanceAfter": 11, "createdAt": "..." } ]
} }
```

---

## Campaigns

### `GET /api/campaigns`
Lists the current user's campaigns (excludes deleted).

### `POST /api/campaigns`
Creates a campaign; reserves `creditsAllocated` from the balance into escrow.
Requires a verified email.
```jsonc
{ "shortUrl": "https://shrinkme.io/xyz", "title": "My link",
  "creditsAllocated": 100, "costPerVisit": 1 }
// 201 -> { "ok": true, "data": { "campaign": { ... } } }
```
Errors: `EMAIL_NOT_VERIFIED` (403), `INSUFFICIENT_CREDITS` (402),
`INVALID_INPUT` (422). Only `http(s)` URLs are accepted.

---

## Visit flow (anti-cheat core)

### `GET /api/visit/next`
Returns a random eligible campaign (never your own, never on cooldown, escrow
sufficient), or `{ campaign: null }`.
```jsonc
{ "ok": true, "data": { "campaign": {
  "id": "...", "title": "...", "minTimerSec": 10, "impressionsRemaining": 42 } } }
```

### `POST /api/visit/start`
Issues a single-use token + the short URL to open.
```jsonc
{ "campaignId": "...", "fingerprint": "optional-client-fp" }
// 200 -> { "ok": true, "data": { "token": "<signed>", "redirectUrl": "https://...", "minTimerSec": 10 } }
```
Errors: `SELF_VISIT`, `NOT_ELIGIBLE`, `INSUFFICIENT_ESCROW`, `PENDING_EXISTS`,
`BOT_SUSPECTED` (403), `RATE_LIMITED` (429).

### `POST /api/visit/callback`
Verifies the returning token and awards credits if every gate passes.
```jsonc
{ "token": "<signed>" }
// 200 -> { "ok": true, "data": { "earned": 1, "balance": 12 } }
```
Rejection reasons (400): `MALFORMED`, `BAD_SIGNATURE`, `EXPIRED`, `NOT_FOUND`,
`ALREADY_CONSUMED`, `IDENTITY_MISMATCH`, `TIMER_TOO_FAST`, `DUPLICATE_IP`,
`DAILY_LIMIT`. Every rejection is written to the fraud log.

---

## Rate limits (per user or per IP hash)
| Endpoint | Limit |
|---|---|
| register | 5 / hour / IP |
| login | 10 / 5 min / IP |
| visit/next | 60 / min / user |
| visit/start | 30 / min / user |
| visit/callback | 60 / min / user |
| campaigns POST | 10 / min / user |

Exceeding a limit returns `429 RATE_LIMITED` with a `resetAt` timestamp.

---

## Planned (roadmap) endpoints
`/api/auth/forgot-password`, `/api/auth/reset-password`, `/api/notifications`,
`/api/campaigns/:id` (pause/resume/delete + escrow refund),
`/api/admin/*` (users, ban, credit-adjust, moderation, settings, fraud, analytics).
