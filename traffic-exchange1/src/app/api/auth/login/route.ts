// POST /api/auth/login — verify credentials, issue a session cookie.
import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validation";
import { verifyPassword, createSessionToken, setSessionCookie } from "@/lib/auth";
import { clientIp } from "@/lib/fraud";
import { hashIp } from "@/lib/hash";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  const rl = await rateLimit(`login:${hashIp(ip)}`, 10, 300); // 10 / 5min / IP
  if (!rl.allowed) return fail("RATE_LIMITED", 429, { resetAt: rl.resetAt });

  const parsed = loginSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("INVALID_INPUT", 422);
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });
  // Uniform failure response — don't reveal whether the email exists.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return fail("INVALID_CREDENTIALS", 401);
  }
  if (user.banned) return fail("BANNED", 403);

  const token = await createSessionToken({
    sub: user.id,
    role: user.role,
    email: user.email,
  });
  await setSessionCookie(token);

  return ok({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      credits: user.credits,
      emailVerified: !!user.emailVerified,
    },
  });
}
