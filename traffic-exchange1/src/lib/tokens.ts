// ===========================================================================
// VISIT TOKENS — the anti-cheat core.
//
// A visit token is a compact, HMAC-signed, single-use credential:
//
//     base64url(payload) + "." + base64url(HMAC_SHA256(payload))
//
// The payload binds the token to (jti, campaign, viewer, expiry). The matching
// Visit row is created in the DB *before* the token is handed out. A reward is
// only ever granted when a callback presents a token whose:
//   - signature verifies (not tampered)
//   - jti matches a PENDING, un-consumed Visit row
//   - expiry has not passed
//   - viewer identity matches the authenticated session
//   - dwell time (now - startedAt) >= campaign.minTimerSec
// and the Visit is flipped to consumed inside a single DB transaction, so
// concurrent callbacks with the same token cannot double-reward (replay-safe).
// ===========================================================================
import { createHmac, randomBytes } from "crypto";
import { env } from "./env";
import { safeEqual } from "./hash";

export type VisitTokenPayload = {
  jti: string; // unique token id (also the Visit.jti)
  c: string; // campaignId
  v: string; // viewerId
  exp: number; // unix seconds
};

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(payloadB64: string): string {
  return createHmac("sha256", env.VISIT_TOKEN_SECRET)
    .update(payloadB64)
    .digest("base64url");
}

export function newJti(): string {
  return randomBytes(18).toString("base64url");
}

export function signVisitToken(payload: VisitTokenPayload): string {
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
  return `${payloadB64}.${sign(payloadB64)}`;
}

export type VerifyResult =
  | { ok: true; payload: VisitTokenPayload }
  | { ok: false; reason: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" };

// Stateless verification: signature + structural + expiry only. The caller
// still MUST atomically consume the matching Visit row in the DB — see
// consumeVisit() in credits.ts. Signature is checked before parsing so a
// tampered payload can never influence control flow.
export function verifyVisitToken(token: string): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "MALFORMED" };
  const [payloadB64, sig] = parts;

  const expected = sign(payloadB64);
  if (!safeEqual(sig, expected)) return { ok: false, reason: "BAD_SIGNATURE" };

  let payload: VisitTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }
  if (
    typeof payload.jti !== "string" ||
    typeof payload.c !== "string" ||
    typeof payload.v !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, reason: "MALFORMED" };
  }
  if (Date.now() / 1000 > payload.exp) return { ok: false, reason: "EXPIRED" };

  return { ok: true, payload };
}
