// POST /api/visit/callback — verify the returning visit token and, if every
// anti-cheat gate passes, award credits. Idempotent + replay-safe.
// Body: { token }
import { NextRequest } from "next/server";
import { ok, fail, requireUser } from "@/lib/http";
import { processCallback } from "@/lib/visit-service";
import { callbackSchema } from "@/lib/validation";
import { rateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/fraud";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const ip = clientIp(req.headers);
  const rl = await rateLimit(`callback:${auth.user.id}`, 60, 60);
  if (!rl.allowed) return fail("RATE_LIMITED", 429, { resetAt: rl.resetAt });

  const parsed = callbackSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("INVALID_INPUT", 422);

  const result = await processCallback({
    viewerId: auth.user.id,
    token: parsed.data.token,
    ip,
  });
  if (!result.ok) return fail(result.reason, 400);

  return ok({ earned: result.earned, balance: result.newBalance });
}
