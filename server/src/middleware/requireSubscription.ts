/**
 * B-018 — Subscription status enforcement middleware (F-017).
 *
 * Blocks requests with 402 when:
 *   - No subscription exists
 *   - Subscription status is 'cancelled' or 'unpaid'
 *   - Subscription is 'past_due' and the 7-day grace period has expired
 *     (grace period starts at currentPeriodEnd)
 *
 * Admin users bypass this check.
 * The middleware is applied per-router, not globally, so it is only added
 * to routes that require an active subscription.
 */
import { Response, NextFunction } from 'express';
import { AuthRequest } from './requireAuth';
import { prisma } from '../lib/prisma';

const GRACE_PERIOD_DAYS = 7;

export async function requireSubscription(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Admins are never gated
  if (req.user?.role === 'admin') { next(); return; }

  const clientId = req.user?.sub;
  if (!clientId) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const sub = await prisma.subscription.findUnique({
    where: { clientId },
    select: { status: true, currentPeriodEnd: true },
  });

  if (!sub) {
    res.status(402).json({ error: 'no_subscription', message: 'No active subscription found.' });
    return;
  }

  if (sub.status === 'cancelled' || sub.status === 'unpaid') {
    res.status(402).json({ error: 'subscription_cancelled', message: 'Your subscription has ended.' });
    return;
  }

  if (sub.status === 'past_due') {
    const gracePeriodEnd = new Date(sub.currentPeriodEnd.getTime() + GRACE_PERIOD_DAYS * 86400_000);
    if (new Date() > gracePeriodEnd) {
      res.status(402).json({
        error: 'subscription_past_due',
        message: 'Your payment is overdue. Please update your billing details.',
      });
      return;
    }
    // Still within grace period — allow through
  }

  next();
}
