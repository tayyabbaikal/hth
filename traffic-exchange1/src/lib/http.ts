// Small helpers for JSON route handlers: consistent responses + auth guard.
import { NextResponse } from "next/server";
import { getSession, type SessionClaims } from "./auth";
import { prisma } from "./prisma";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(code: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: code, ...extra }, { status });
}

// Require an authenticated, non-banned user. Returns the session + fresh user
// row, or a NextResponse to return early.
export async function requireUser(): Promise<
  | { session: SessionClaims; user: NonNullable<Awaited<ReturnType<typeof loadUser>>> }
  | { response: NextResponse }
> {
  const session = await getSession();
  if (!session) return { response: fail("UNAUTHENTICATED", 401) };
  const user = await loadUser(session.sub);
  if (!user) return { response: fail("UNAUTHENTICATED", 401) };
  if (user.banned) return { response: fail("BANNED", 403) };
  return { session, user };
}

export async function requireAdmin() {
  const res = await requireUser();
  if ("response" in res) return res;
  if (res.user.role !== "ADMIN") return { response: fail("FORBIDDEN", 403) };
  return res;
}

function loadUser(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      role: true,
      banned: true,
      credits: true,
      emailVerified: true,
      referralCode: true,
    },
  });
}
