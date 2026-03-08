/**
 * Lead cap enforcement (F-020)
 *
 * Checks the client's current plan cap against leads_used_this_period.
 * Returns true if the cap has been reached (or exceeded).
 */
import { prisma } from './prisma';

export interface CapStatus {
  allowed: boolean;
  used: number;
  cap: number | null; // null = unlimited
  percentUsed: number | null;
}

const PLAN_CAPS: Record<string, number | null> = {
  Starter: 500,
  Growth: 2000,
  Enterprise: null, // unlimited
};

export async function checkLeadCap(clientId: string): Promise<CapStatus> {
  const subscription = await prisma.subscription.findUnique({
    where: { clientId },
  });

  if (!subscription) {
    // No active subscription — block lead creation
    return { allowed: false, used: 0, cap: 0, percentUsed: 100 };
  }

  const user = await prisma.user.findUnique({
    where: { id: clientId },
    select: { customLeadCapOverride: true },
  });

  const planCap = PLAN_CAPS[subscription.planName] ?? null;
  const cap = user?.customLeadCapOverride ?? planCap;
  const used = subscription.leadsUsedThisPeriod;

  if (cap === null) {
    return { allowed: true, used, cap: null, percentUsed: null };
  }

  const percentUsed = Math.round((used / cap) * 100);
  return { allowed: used < cap, used, cap, percentUsed };
}

export async function incrementLeadCount(clientId: string): Promise<void> {
  await prisma.subscription.update({
    where: { clientId },
    data: { leadsUsedThisPeriod: { increment: 1 } },
  });
}
