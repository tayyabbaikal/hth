// Credit ledger operations. Every balance change goes through here so the
// CreditTransaction table stays the single source of truth and User.credits is
// updated atomically in the same transaction. All functions accept a Prisma
// transaction client so callers can compose them into larger atomic units.
import type { Prisma, TxType } from "@prisma/client";
import { prisma } from "./prisma";

type Tx = Prisma.TransactionClient;

export class InsufficientCreditsError extends Error {
  constructor() {
    super("INSUFFICIENT_CREDITS");
  }
}

// Add (positive) credits and record a ledger entry. Also bumps totalEarned for
// EARN/REFERRAL/SIGNUP_BONUS types.
export async function credit(
  tx: Tx,
  userId: string,
  amount: number,
  type: TxType,
  opts: { referenceId?: string; meta?: Prisma.InputJsonValue } = {},
): Promise<number> {
  if (amount <= 0) throw new Error("credit() amount must be > 0");

  const bumpsEarned =
    type === "EARN" || type === "REFERRAL" || type === "SIGNUP_BONUS";

  const user = await tx.user.update({
    where: { id: userId },
    data: {
      credits: { increment: amount },
      ...(bumpsEarned ? { totalEarned: { increment: amount } } : {}),
    },
    select: { credits: true },
  });

  await tx.creditTransaction.create({
    data: {
      userId,
      amount,
      type,
      balanceAfter: user.credits,
      referenceId: opts.referenceId,
      meta: opts.meta,
    },
  });
  return user.credits;
}

// Deduct credits, guarding against overdraw with an atomic conditional update.
export async function debit(
  tx: Tx,
  userId: string,
  amount: number,
  type: TxType,
  opts: { referenceId?: string; meta?: Prisma.InputJsonValue } = {},
): Promise<number> {
  if (amount <= 0) throw new Error("debit() amount must be > 0");

  // Conditional update: only succeeds if balance is sufficient. count === 0
  // means insufficient funds (or a race lost) — never goes negative.
  const res = await tx.user.updateMany({
    where: { id: userId, credits: { gte: amount } },
    data: {
      credits: { decrement: amount },
      ...(type === "SPEND" ? { totalSpent: { increment: amount } } : {}),
    },
  });
  if (res.count === 0) throw new InsufficientCreditsError();

  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { credits: true },
  });

  await tx.creditTransaction.create({
    data: {
      userId,
      amount: -amount,
      type,
      balanceAfter: user.credits,
      referenceId: opts.referenceId,
      meta: opts.meta,
    },
  });
  return user.credits;
}

// Convenience wrapper for callers that don't already have a transaction.
export function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn);
}
