// GET /api/visit/next — return a random eligible campaign for the viewer.
import { NextRequest } from "next/server";
import { ok, fail, requireUser } from "@/lib/http";
import { pickNextCampaign } from "@/lib/visit-service";
import { rateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/fraud";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const ip = clientIp(req.headers);
  const rl = await rateLimit(`next:${auth.user.id}`, 60, 60); // 60/min
  if (!rl.allowed) return fail("RATE_LIMITED", 429, { resetAt: rl.resetAt });

  const campaign = await pickNextCampaign(auth.user.id);
  if (!campaign) return ok({ campaign: null });

  // Do not leak internal escrow figures beyond what's useful.
  return ok({
    campaign: {
      id: campaign.id,
      title: campaign.title,
      minTimerSec: campaign.minTimerSec,
      impressionsRemaining: Math.floor(
        (campaign.creditsAllocated - campaign.creditsSpent) / campaign.costPerVisit,
      ),
    },
  });
}
