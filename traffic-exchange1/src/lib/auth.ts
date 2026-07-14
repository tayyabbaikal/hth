// Node-runtime auth helpers: password hashing (bcrypt) + session cookie
// management (next/headers). Edge-safe token signing/verifying lives in
// session.ts and is re-exported here for convenience.
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { env } from "./env";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  createSessionToken,
  verifySessionToken,
  type SessionClaims,
} from "./session";

export {
  SESSION_COOKIE,
  createSessionToken,
  verifySessionToken,
  type SessionClaims,
};

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 12);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export async function setSessionCookie(token: string) {
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export function clearSessionCookie() {
  cookies().delete(SESSION_COOKIE);
}

// Read + verify the current session from the request cookie (route handlers).
export async function getSession(): Promise<SessionClaims | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
