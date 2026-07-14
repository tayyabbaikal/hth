// ===========================================================================
// Visit engine: queue selection, token issuance, and callback verification.
// This is where the anti-cheat rules are enforced end-to-end.
// ===========================================================================
import type { Campaign } from "@prisma/client";
import { prisma } from "./prisma";
import { getSettings } from "./settings";
import { credit, debit } from "./credits";
import { newJti, signVisitToken, verifyVisitToken } from "./tokens";
import { hashIp } from "./hash";
import { logFraud } from "./fraud";

// ---------------------------------------------------------------------------
// Queue: pick a random eligible campaign for a viewer.
// Excludes: own campaigns, non-active, empty escrow, and links completed within
// the revisit cooldown window.
// ---------------------------------------------------------------------------
export async function pickNextCampaign(viewerId: string): Promise<Campaign | null> {
  const s = await getSettings();
  const cooldownSince = new Date(Date.now() - s.revisitCooldownHours * 3600_000);

  // Campaign ids this viewer completed recently (cooldown) — exclude them.
  const recent = await prisma.visit.findMany({
    where: {
      viewerId,
      status: "COMPLETED",
      completedAt: { gte: cooldownSince },
    },
    select: { campaignId: true },
  });
  const excludeIds = recent.map((r) => r.campaignId);

  const eligible = await prisma.campaign.findMany({
    where: {
      status: "ACTIVE",
      userId: { not: viewerId }, // never show own links
      id: { notIn: excludeIds.length ? excludeIds : undefined },
      // escrow must still cover at least one visit
      creditsSpent: { lt: prisma.campaign.fields.creditsAllocated },
    },
    take: 50,
  });

  // Prisma can't compare two columns in `where` directly on all versions, so
  // filter the pool defensively then pick at random.
  const pool = eligible.filter(
    (c) => c.creditsAllocated - c.creditsSpent >= c.costPerVisit,
  );
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---------------------------------------------------------------------------
// Issue a visit token: creates a PENDING Visit row, then signs a token bound
// to it. The returned redirectUrl is the campaign's short link.
// ---------------------------------------------------------------------------
export type IssueResult =
  | { ok: true; token: string; redirectUrl: string; minTimerSec: number; visitId: string }
  | { ok: false; reason: "NOT_ELIGIBLE" | "SELF_VISIT" | "INSUFFICIENT_ESCROW" | "PENDING_EXISTS" };

export async function issueVisitToken(params: {
  viewerId: string;
  campaignId: string;
  ip: string;
  fingerprint?: string;
}): Promise<IssueResult> {
  const s = await getSettings();
  const ipHash = hashIp(params.ip);

  const campaign = await prisma.campaign.findUnique({
    where: { id: params.campaignId },
  });
  if (!campaign || campaign.status !== "ACTIVE") return { ok: false, reason: "NOT_ELIGIBLE" };
  if (campaign.userId === params.viewerId) {
    await logFraud("SELF_VISIT", "Attempted to visit own campaign", {
      userId: params.viewerId,
      ipHash,
      meta: { campaignId: campaign.id },
    });
    return { ok: false, reason: "SELF_VISIT" };
  }
  if (campaign.creditsAllocated - campaign.creditsSpent < campaign.costPerVisit) {
    return { ok: false, reason: "INSUFFICIENT_ESCROW" };
  }

  // Reject a second live token for the same (viewer, campaign) pair — stops a
  // user from opening many tabs to farm one campaign.
  const existing = await prisma.visit.findFirst({
    where: {
      viewerId: params.viewerId,
      campaignId: campaign.id,
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (existing) return { ok: false, reason: "PENDING_EXISTS" };

  const jti = newJti();
  const exp = Math.floor(Date.now() / 1000) + s.tokenTtlSec;
  const expiresAt = new Date(exp * 1000);

  const visit = await prisma.visit.create({
    data: {
      jti,
      campaignId: campaign.id,
      viewerId: params.viewerId,
      ipHash,
      fingerprint: params.fingerprint,
      expiresAt,
      status: "PENDING",
    },
    select: { id: true },
  });

  const token = signVisitToken({ jti, c: campaign.id, v: params.viewerId, exp });
  return {
    ok: true,
    token,
    redirectUrl: campaign.shortUrl,
    minTimerSec: campaign.minTimerSec || s.minTimerSec,
    visitId: visit.id,
  };
}

// ---------------------------------------------------------------------------
// Process a callback: verify token + all anti-cheat gates, then atomically
// consume the visit and move credits. Idempotent & replay-safe.
// ---------------------------------------------------------------------------
export type CallbackResult =
  | { ok: true; earned: number; newBalance: number }
  | {
      ok: false;
      reason:
        | "MALFORMED"
        | "BAD_SIGNATURE"
        | "EXPIRED"
        | "NOT_FOUND"
        | "ALREADY_CONSUMED"
        | "IDENTITY_MISMATCH"
        | "TIMER_TOO_FAST"
        | "DAILY_LIMIT"
        | "DUPLICATE_IP";
    };

export async function processCallback(params: {
  viewerId: string;
  token: string;
  ip: string;
}): Promise<CallbackResult> {
  const s = await getSettings();
  const ipHash = hashIp(params.ip);

  // 1) Stateless checks: signature, structure, expiry.
  const verified = verifyVisitToken(params.token);
  if (!verified.ok) {
    await logFraud(
      verified.reason === "BAD_SIGNATURE" ? "TOKEN_TAMPERED" : "REPLAY_TOKEN",
      `Token verify failed: ${verified.reason}`,
      { userId: params.viewerId, ipHash },
    );
    return { ok: false, reason: verified.reason };
  }
  const { payload } = verified;

  // 2) Identity: the caller's session must match the token's viewer.
  if (payload.v !== params.viewerId) {
    await logFraud("IDENTITY_MISMATCH", "Callback viewer != token viewer", {
      userId: params.viewerId,
      ipHash,
      meta: { tokenViewer: payload.v },
    });
    return { ok: false, reason: "IDENTITY_MISMATCH" };
  }

  // 3) Atomic consume + credit movement. All reads/writes inside one tx so two
  // concurrent callbacks with the same token can't both succeed.
  try {
    return await prisma.$transaction(async (tx) => {
      const visit = await tx.visit.findUnique({ where: { jti: payload.jti } });
      if (!visit) return { ok: false, reason: "NOT_FOUND" } as const;

      // Replay guard: only a still-PENDING, un-consumed visit can reward.
      if (visit.consumed || visit.status !== "PENDING") {
        await logFraud("REPLAY_TOKEN", "Token reuse attempt", {
          userId: params.viewerId,
          ipHash,
          meta: { jti: payload.jti },
        });
        return { ok: false, reason: "ALREADY_CONSUMED" } as const;
      }

      // Min-timer gate: dwell time must meet the campaign requirement.
      const campaign = await tx.campaign.findUniqueOrThrow({
        where: { id: visit.campaignId },
      });
      const dwellSec = (Date.now() - visit.startedAt.getTime()) / 1000;
      const required = campaign.minTimerSec || s.minTimerSec;
      if (dwellSec < required) {
        await tx.visit.update({
          where: { id: visit.id },
          data: { status: "REJECTED", consumed: true },
        });
        await logFraud("TIMER_TOO_FAST", `Dwell ${dwellSec.toFixed(1)}s < ${required}s`, {
          userId: params.viewerId,
          ipHash,
          meta: { jti: payload.jti },
        });
        return { ok: false, reason: "TIMER_TOO_FAST" } as const;
      }

      // Duplicate-IP cap: limit rewards for one campaign from one network.
      const dupCount = await tx.visit.count({
        where: {
          campaignId: campaign.id,
          ipHash,
          status: "COMPLETED",
          NOT: { viewerId: params.viewerId },
        },
      });
      if (dupCount >= s.maxDuplicateIpVisits) {
        await tx.visit.update({
          where: { id: visit.id },
          data: { status: "REJECTED", consumed: true },
        });
        await logFraud("DUPLICATE_IP", `IP exceeded ${s.maxDuplicateIpVisits} rewards`, {
          userId: params.viewerId,
          ipHash,
        });
        return { ok: false, reason: "DUPLICATE_IP" } as const;
      }

      // Daily earning limit.
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const agg = await tx.creditTransaction.aggregate({
        where: { userId: params.viewerId, type: "EARN", createdAt: { gte: since } },
        _sum: { amount: true },
      });
      const earnedToday = agg._sum.amount ?? 0;
      if (earnedToday + s.pointsPerVisit > s.dailyEarnLimit) {
        await tx.visit.update({
          where: { id: visit.id },
          data: { status: "REJECTED", consumed: true },
        });
        await logFraud("DAILY_LIMIT", `Daily earn limit ${s.dailyEarnLimit} reached`, {
          userId: params.viewerId,
          ipHash,
        });
        return { ok: false, reason: "DAILY_LIMIT" } as const;
      }

      // ---- All gates passed: consume + move credits atomically. ----
      await tx.visit.update({
        where: { id: visit.id },
        data: {
          status: "COMPLETED",
          consumed: true,
          completedAt: new Date(),
          rewardAmount: s.pointsPerVisit,
        },
      });

      // Charge the campaign escrow (owner already paid at creation, so we only
      // move the pool counter and complete it if drained).
      const spent = campaign.creditsSpent + campaign.costPerVisit;
      await tx.campaign.update({
        where: { id: campaign.id },
        data: {
          creditsSpent: spent,
          ...(spent + campaign.costPerVisit > campaign.creditsAllocated
            ? { status: "COMPLETED" }
            : {}),
        },
      });

      // Reward the viewer.
      const newBalance = await credit(tx, params.viewerId, s.pointsPerVisit, "EARN", {
        referenceId: visit.id,
        meta: { campaignId: campaign.id },
      });

      // Notify the viewer + (if drained) the campaign owner.
      await tx.notification.create({
        data: {
          userId: params.viewerId,
          type: "CREDITS_EARNED",
          title: "Credits earned",
          body: `You earned ${s.pointsPerVisit} credit(s) for a completed visit.`,
        },
      });
      if (spent + campaign.costPerVisit > campaign.creditsAllocated) {
        await tx.notification.create({
          data: {
            userId: campaign.userId,
            type: "CAMPAIGN_COMPLETED",
            title: "Campaign completed",
            body: `Your campaign "${campaign.title ?? campaign.shortUrl}" used all its credits.`,
          },
        });
      }

      return { ok: true, earned: s.pointsPerVisit, newBalance } as const;
    });
  } catch (err) {
    // Unique/consistency failures collapse to a safe "already consumed".
    return { ok: false, reason: "ALREADY_CONSUMED" };
  }
}

// Reserve credits from the owner into a new campaign's escrow. Used by the
// campaign-create route.
export async function createCampaignWithEscrow(params: {
  userId: string;
  shortUrl: string;
  title?: string;
  creditsAllocated: number;
  costPerVisit: number;
}) {
  const s = await getSettings();
  return prisma.$transaction(async (tx) => {
    // Spend owner credits upfront (throws InsufficientCreditsError if broke).
    await debit(tx, params.userId, params.creditsAllocated, "SPEND", {
      meta: { reason: "campaign_escrow", shortUrl: params.shortUrl },
    });
    return tx.campaign.create({
      data: {
        userId: params.userId,
        shortUrl: params.shortUrl,
        title: params.title,
        creditsAllocated: params.creditsAllocated,
        costPerVisit: params.costPerVisit,
        minTimerSec: s.minTimerSec,
        status: s.requireCampaignApproval ? "PENDING" : "ACTIVE",
      },
    });
  });
}
