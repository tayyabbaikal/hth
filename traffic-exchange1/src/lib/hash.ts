// Small hashing helpers. IPs are never stored raw — only salted SHA-256.
import { createHash, timingSafeEqual } from "crypto";
import { env } from "./env";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// Salted hash of an IP address for duplicate-IP detection without storing PII.
export function hashIp(ip: string): string {
  return sha256(`${env.IP_HASH_SALT}:${ip}`);
}

// Constant-time string comparison (defends against timing attacks on tokens).
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
