// GET /api/me — current session user (used by the client to hydrate state).
import { ok, fail, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id, email, role, credits, emailVerified, referralCode } = auth.user;
  return ok({
    user: { id, email, role, credits, emailVerified: !!emailVerified, referralCode },
  });
}
