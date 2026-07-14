// Admin-configurable settings with safe defaults. Values live in the
// AdminSetting key/value table and are cached in-process for 30s to avoid a DB
// read on every visit. Admin panel writes should call `invalidateSettings()`.
import { prisma } from "./prisma";

export type Settings = {
  pointsPerVisit: number; // credits a viewer earns per completed visit
  defaultCostPerVisit: number; // credits a campaign spends per visit
  minTimerSec: number; // default dwell time before callback accepted
  tokenTtlSec: number; // visit token lifetime
  dailyEarnLimit: number; // max credits a user can earn per day
  referralBonus: number; // credits to referrer per verified referral
  signupBonus: number; // starter credits on email verification
  revisitCooldownHours: number; // how long before the same link can be re-shown
  minWithdrawalThreshold: number; // reserved for future payout/monetization
  requireCampaignApproval: boolean; // if true, new campaigns start PENDING
  maxDuplicateIpVisits: number; // reward cap per campaign from one IP hash
};

const DEFAULTS: Settings = {
  pointsPerVisit: 1,
  defaultCostPerVisit: 1,
  minTimerSec: 10,
  tokenTtlSec: 600,
  dailyEarnLimit: 500,
  referralBonus: 50,
  signupBonus: 10,
  revisitCooldownHours: 24,
  minWithdrawalThreshold: 1000,
  requireCampaignApproval: false,
  maxDuplicateIpVisits: 3,
};

let cache: { value: Settings; at: number } | null = null;
const TTL_MS = 30_000;

export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  const rows = await prisma.adminSetting.findMany();
  const overrides: Record<string, string> = {};
  for (const r of rows) overrides[r.key] = r.value;

  const merged = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    if (overrides[key] === undefined) continue;
    const def = DEFAULTS[key];
    merged[key] = (
      typeof def === "boolean"
        ? overrides[key] === "true"
        : Number(overrides[key])
    ) as never;
  }

  cache = { value: merged, at: Date.now() };
  return merged;
}

export function invalidateSettings() {
  cache = null;
}
