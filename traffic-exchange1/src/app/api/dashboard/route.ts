// GET /api/dashboard — aggregate stats for the user dashboard.
import { ok, requireUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const userId = auth.user.id;

  const [user, activeCampaigns, completedVisits, referralAgg, recent, unread] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { credits: true, totalEarned: true, totalSpent: true, referralCode: true },
      }),
      prisma.campaign.count({ where: { userId, status: "ACTIVE" } }),
      prisma.visit.count({ where: { viewerId: userId, status: "COMPLETED" } }),
      prisma.creditTransaction.aggregate({
        where: { userId, type: "REFERRAL" },
        _sum: { amount: true },
      }),
      prisma.creditTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { amount: true, type: true, balanceAfter: true, createdAt: true },
      }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

  // Sum of remaining escrow across the user's active campaigns.
  const campaigns = await prisma.campaign.findMany({
    where: { userId, status: "ACTIVE" },
    select: { creditsAllocated: true, creditsSpent: true },
  });
  const remainingCampaignBalance = campaigns.reduce(
    (n, c) => n + (c.creditsAllocated - c.creditsSpent),
    0,
  );

  return ok({
    credits: user.credits,
    totalEarned: user.totalEarned,
    totalSpent: user.totalSpent,
    activeCampaigns,
    completedVisits,
    remainingCampaignBalance,
    referralEarnings: referralAgg._sum.amount ?? 0,
    referralLink: `${env.APP_URL}/register?ref=${user.referralCode}`,
    unreadNotifications: unread,
    recentActivity: recent,
  });
}
