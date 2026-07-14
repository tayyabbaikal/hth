// Edge-safe session token logic (jose only — no bcrypt, no next/headers), so it
// can be imported from middleware.ts which runs in the Edge runtime.
import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";
import type { Role } from "@prisma/client";

const SECRET = new TextEncoder().encode(env.AUTH_JWT_SECRET);
export const SESSION_COOKIE = "tx_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export type SessionClaims = { sub: string; role: Role; email: string };

export async function createSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ role: claims.role, email: claims.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(SECRET);
}

export async function verifySessionToken(
  token: string,
): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return {
      sub: String(payload.sub),
      role: payload.role as Role,
      email: String(payload.email),
    };
  } catch {
    return null;
  }
}
