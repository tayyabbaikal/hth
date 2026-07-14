// Centralized, validated environment access. Fails fast at boot if a required
// secret is missing, so misconfiguration never reaches a request handler.
import { z } from "zod";

const schema = z.object({
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).optional(),
  AUTH_JWT_SECRET: z.string().min(24, "AUTH_JWT_SECRET must be long"),
  VISIT_TOKEN_SECRET: z.string().min(24, "VISIT_TOKEN_SECRET must be long"),
  IP_HASH_SALT: z.string().min(8),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Traffic Exchange <no-reply@example.com>"),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  PROXY_CHECK_API_KEY: z.string().optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

// Guard against the two signing secrets accidentally being equal.
const parsed = schema.parse(process.env);
if (parsed.AUTH_JWT_SECRET === parsed.VISIT_TOKEN_SECRET) {
  throw new Error("AUTH_JWT_SECRET and VISIT_TOKEN_SECRET must differ");
}

export const env = parsed;
