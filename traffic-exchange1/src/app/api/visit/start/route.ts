// POST /api/visit/start — issue a single-use visit token + redirect URL.
// Body: { campaignId, fingerprint? }
import { NextRequest } from "next/server";
import { ok, fail, requireUser } from "@/lib/http";
import { issueVisitToken } from "@/lib/visit-service";
import { startVisitSchema } from "@/lib/validation";
import { rateLimit } from "@/lib/ratelimit";
import { clientIp, looksLikeBot, logFraud } from "@/lib/fraud";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const ip = clientIp(req.headers);
  const ua = req.headers.get("user-agent");
  if (looksLikeBot(ua)) {
    await logFraud("BOT_SUSPECTED", `Bot UA on start: ${ua ?? "none"}`, {
      userId: auth.user.id,
    });
    return fail("BOT_SUSPECTED", 403);
  }

  const rl = await rateLimit(`start:${auth.user.id}`, 30, 60); // 30/min
  if (!rl.allowed) return fail("RATE_LIMITED", 429, { resetAt: rl.resetAt });

  const parsed = startVisitSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("INVALID_INPUT", 422);

  const result = await issueVisitToken({
    viewerId: auth.user.id,
    campaignId: parsed.data.campaignId,
    ip,
    fingerprint: parsed.data.fingerprint,
  });
  if (!result.ok) return fail(result.reason, 400);

  return ok({
    token: result.token,
    redirectUrl: result.redirectUrl,
    minTimerSec: result.minTimerSec,
  });
}
