// GET  /api/campaigns  — list the current user's campaigns.
// POST /api/campaigns  — create a campaign (reserves credits into escrow).
import { NextRequest } from "next/server";
import { ok, fail, requireUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { createCampaignSchema } from "@/lib/validation";
import { createCampaignWithEscrow } from "@/lib/visit-service";
import { InsufficientCreditsError } from "@/lib/credits";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const campaigns = await prisma.campaign.findMany({
    where: { userId: auth.user.id, status: { not: "DELETED" } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      shortUrl: true,
      title: true,
      status: true,
      creditsAllocated: true,
      creditsSpent: true,
      costPerVisit: true,
      createdAt: true,
    },
  });
  return ok({ campaigns });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  if (!auth.user.emailVerified) return fail("EMAIL_NOT_VERIFIED", 403);

  const rl = await rateLimit(`campaign:create:${auth.user.id}`, 10, 60);
  if (!rl.allowed) return fail("RATE_LIMITED", 429, { resetAt: rl.resetAt });

  const parsed = createCampaignSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("INVALID_INPUT", 422);

  try {
    const campaign = await createCampaignWithEscrow({
      userId: auth.user.id,
      shortUrl: parsed.data.shortUrl,
      title: parsed.data.title,
      creditsAllocated: parsed.data.creditsAllocated,
      costPerVisit: parsed.data.costPerVisit,
    });
    return ok({ campaign }, { status: 201 });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) return fail("INSUFFICIENT_CREDITS", 402);
    throw err;
  }
}
