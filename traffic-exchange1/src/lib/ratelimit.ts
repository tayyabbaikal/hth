// Sliding-window-ish fixed-window rate limiter backed by Redis. If Redis is not
// configured it falls back to an in-process map (adequate for single-instance
// deployments; use Redis when running multiple app replicas).
import { redis } from "./redis";

const mem = new Map<string, { count: number; resetAt: number }>();

export type RateResult = { allowed: boolean; remaining: number; resetAt: number };

export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateResult> {
  const now = Date.now();
  const resetAt = now + windowSec * 1000;

  if (redis) {
    const redisKey = `rl:${key}`;
    const count = await redis.incr(redisKey);
    if (count === 1) await redis.expire(redisKey, windowSec);
    const ttl = await redis.ttl(redisKey);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAt: now + (ttl > 0 ? ttl * 1000 : windowSec * 1000),
    };
  }

  // In-memory fallback.
  const cur = mem.get(key);
  if (!cur || cur.resetAt < now) {
    mem.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }
  cur.count += 1;
  return {
    allowed: cur.count <= limit,
    remaining: Math.max(0, limit - cur.count),
    resetAt: cur.resetAt,
  };
}
