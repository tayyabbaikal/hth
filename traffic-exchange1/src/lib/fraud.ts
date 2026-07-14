// Fraud logging + lightweight signal helpers. Every rejected visit or abuse
// signal is recorded so the admin panel can surface patterns and auto-ban.
import type { FraudType, Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export async function logFraud(
  type: FraudType,
  detail: string,
  opts: { userId?: string; ipHash?: string; meta?: Prisma.InputJsonValue } = {},
): Promise<void> {
  await prisma.fraudLog.create({
    data: {
      type,
      detail,
      userId: opts.userId,
      ipHash: opts.ipHash,
      meta: opts.meta,
    },
  });
}

// Extract the client IP from proxy headers (nginx sets X-Forwarded-For).
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "0.0.0.0";
}

// Heuristic bot check on the User-Agent. Real bot defense also relies on the
// JS-issued callback + min timer; this just adds a cheap first filter.
export function looksLikeBot(userAgent: string | null): boolean {
  if (!userAgent) return true;
  return /(bot|crawler|spider|curl|wget|python-requests|headless|phantom)/i.test(
    userAgent,
  );
}
