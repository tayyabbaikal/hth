// Optional Redis connection (rate limiting + token de-dupe). If REDIS_URL is
// unset the app still works, falling back to DB-only checks — so local dev and
// tiny deployments don't require a Redis instance.
import Redis from "ioredis";
import { env } from "./env";

const globalForRedis = globalThis as unknown as { redis?: Redis | null };

function create(): Redis | null {
  if (!env.REDIS_URL) return null;
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
  });
}

export const redis: Redis | null = globalForRedis.redis ?? create();
if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;
