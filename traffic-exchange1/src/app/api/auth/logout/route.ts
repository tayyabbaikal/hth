// POST /api/auth/logout — clear the session cookie.
import { ok } from "@/lib/http";
import { clearSessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  clearSessionCookie();
  return ok({ loggedOut: true });
}
