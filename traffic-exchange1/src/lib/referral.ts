// Referral code generation. Short, URL-safe, collision-checked.
import { customAlphabet } from "nanoid";
import { prisma } from "./prisma";

const gen = customAlphabet("0123456789ABCDEFGHJKLMNPQRSTUVWXYZ", 8);

export async function uniqueReferralCode(): Promise<string> {
  // Practically collision-free; loop guards the vanishingly rare case.
  for (let i = 0; i < 5; i++) {
    const code = gen();
    const exists = await prisma.user.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });
    if (!exists) return code;
  }
  throw new Error("Could not generate a unique referral code");
}
