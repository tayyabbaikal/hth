// Zod schemas — single source of input validation for the API (guards against
// malformed input and injection at the boundary).
import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  referralCode: z.string().trim().max(40).optional(),
});

export const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

// Only allow http(s) short links; block javascript:, data:, etc.
export const createCampaignSchema = z.object({
  shortUrl: z
    .string()
    .url()
    .max(2048)
    .refine((u) => /^https?:\/\//i.test(u), "URL must be http(s)"),
  title: z.string().trim().max(120).optional(),
  creditsAllocated: z.number().int().positive().max(1_000_000),
  costPerVisit: z.number().int().positive().max(1000).default(1),
});

export const startVisitSchema = z.object({
  campaignId: z.string().min(1).max(40),
  fingerprint: z.string().max(200).optional(),
});

export const callbackSchema = z.object({
  token: z.string().min(10).max(2048),
});
