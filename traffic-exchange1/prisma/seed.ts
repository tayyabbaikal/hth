// Seed: create the bootstrap admin + default AdminSettings. Idempotent.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { customAlphabet } from "nanoid";

const prisma = new PrismaClient();
const code = customAlphabet("0123456789ABCDEFGHJKLMNPQRSTUVWXYZ", 8);

const DEFAULT_SETTINGS: Record<string, string> = {
  pointsPerVisit: "1",
  defaultCostPerVisit: "1",
  minTimerSec: "10",
  tokenTtlSec: "600",
  dailyEarnLimit: "500",
  referralBonus: "50",
  signupBonus: "10",
  revisitCooldownHours: "24",
  minWithdrawalThreshold: "1000",
  requireCampaignApproval: "false",
  maxDuplicateIpVisits: "3",
};

async function main() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.adminSetting.upsert({
      where: { key },
      update: {},
      create: { key, value },
    });
  }

  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (email && password) {
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.upsert({
      where: { email },
      update: { role: "ADMIN" },
      create: {
        email,
        passwordHash,
        role: "ADMIN",
        emailVerified: new Date(),
        referralCode: code(),
        credits: 0,
      },
    });
    console.log(`Admin ready: ${email}`);
  } else {
    console.log("ADMIN_EMAIL/ADMIN_PASSWORD not set — skipped admin creation.");
  }
  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
