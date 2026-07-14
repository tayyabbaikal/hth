// POST /api/auth/register — create an account, link referral, email a
// verification token. Credits (signup + referral bonus) are granted on verify.
import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { ok, fail } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { registerSchema } from "@/lib/validation";
import { hashPassword } from "@/lib/auth";
import { uniqueReferralCode } from "@/lib/referral";
import { sha256, hashIp } from "@/lib/hash";
import { sendEmail, verifyEmailHtml } from "@/lib/email";
import { clientIp } from "@/lib/fraud";
import { rateLimit } from "@/lib/ratelimit";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  const rl = await rateLimit(`register:${hashIp(ip)}`, 5, 3600); // 5/hour/IP
  if (!rl.allowed) return fail("RATE_LIMITED", 429, { resetAt: rl.resetAt });

  const parsed = registerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("INVALID_INPUT", 422);
  const { email, password, referralCode } = parsed.data;

  const existing = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true },
  });
  if (existing) return fail("EMAIL_TAKEN", 409);

  const referrer = referralCode
    ? await prisma.user.findUnique({
        where: { referralCode: referralCode.toUpperCase() },
        select: { id: true },
      })
    : null;

  const passwordHash = await hashPassword(password);
  const code = await uniqueReferralCode();

  // Raw token is emailed; only its hash is stored.
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = sha256(rawToken);

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        referralCode: code,
        referredById: referrer?.id,
        signupIpHash: hashIp(ip),
      },
      select: { id: true },
    });
    if (referrer) {
      await tx.referral.create({
        data: { referrerId: referrer.id, referredUserId: u.id },
      });
    }
    await tx.verificationToken.create({
      data: {
        userId: u.id,
        tokenHash,
        type: "EMAIL_VERIFY",
        expiresAt: new Date(Date.now() + 24 * 3600_000),
      },
    });
    return u;
  });

  const link = `${env.APP_URL}/api/auth/verify-email?token=${rawToken}`;
  await sendEmail(email, "Verify your email", verifyEmailHtml(link));

  return ok({ userId: user.id, message: "Check your email to verify your account." }, {
    status: 201,
  });
}
