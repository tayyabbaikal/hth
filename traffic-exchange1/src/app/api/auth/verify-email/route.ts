// GET /api/auth/verify-email?token=... — activate the account and grant the
// signup bonus (+ referral bonus to the referrer), all atomically & once.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/hash";
import { credit } from "@/lib/credits";
import { getSettings } from "@/lib/settings";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("token");
  const redirect = (status: string) =>
    NextResponse.redirect(`${env.APP_URL}/login?verify=${status}`);

  if (!raw) return redirect("invalid");
  const tokenHash = sha256(raw);
  const s = await getSettings();

  try {
    await prisma.$transaction(async (tx) => {
      const vt = await tx.verificationToken.findUnique({ where: { tokenHash } });
      if (!vt || vt.type !== "EMAIL_VERIFY" || vt.usedAt || vt.expiresAt < new Date()) {
        throw new Error("invalid");
      }
      await tx.verificationToken.update({
        where: { id: vt.id },
        data: { usedAt: new Date() },
      });
      const user = await tx.user.findUniqueOrThrow({ where: { id: vt.userId } });
      if (user.emailVerified) return; // already done — idempotent

      await tx.user.update({
        where: { id: user.id },
        data: { emailVerified: new Date() },
      });

      // Signup bonus for the new user.
      if (s.signupBonus > 0) {
        await credit(tx, user.id, s.signupBonus, "SIGNUP_BONUS");
      }

      // Referral bonus to the referrer (only for a verified referral).
      if (user.referredById && s.referralBonus > 0) {
        await credit(tx, user.referredById, s.referralBonus, "REFERRAL", {
          referenceId: user.id,
        });
        await tx.referral.updateMany({
          where: { referredUserId: user.id },
          data: { bonusAwarded: s.referralBonus },
        });
        await tx.notification.create({
          data: {
            userId: user.referredById,
            type: "REFERRAL_BONUS",
            title: "Referral bonus",
            body: `You earned ${s.referralBonus} credits from a referral.`,
          },
        });
      }
    });
  } catch {
    return redirect("invalid");
  }
  return redirect("success");
}
