/**
 * B-015a — Post-signup onboarding checklist (F-030).
 *
 * GET  /api/onboarding          — checklist completion state
 * POST /api/onboarding/dismiss  — set onboardingDismissed = true
 *
 * Steps:
 *  1. account_created   — always true once the route is reached
 *  2. icp_saved         — IcpSettings row exists for the client
 *  3. calendar_linked   — IntegrationConnection with status=active exists
 *  4. first_lead_added  — at least one Lead exists for the client
 */
import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/requireAuth';
import { prisma } from '../lib/prisma';

const router = Router();

// ─── GET /api/onboarding ──────────────────────────────────────────────────────

router.get('/onboarding', requireAuth, async (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;

  const [user, icpSettings, calendarIntegration, leadCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: clientId },
      select: { onboardingDismissed: true },
    }),
    prisma.icpSettings.findUnique({ where: { clientId } }),
    prisma.integrationConnection.findFirst({
      where: { clientId, status: 'active' },
      select: { service: true },
    }),
    prisma.lead.count({ where: { clientId } }),
  ]);

  const steps = [
    { key: 'account_created', label: 'Account created', complete: true },
    { key: 'icp_saved',       label: 'ICP criteria saved', complete: icpSettings !== null },
    { key: 'calendar_linked', label: 'Calendar connected', complete: calendarIntegration !== null },
    { key: 'first_lead_added',label: 'First lead added', complete: leadCount > 0 },
  ];

  const allComplete = steps.every((s) => s.complete);
  const dismissed = user?.onboardingDismissed ?? false;

  res.status(200).json({ steps, allComplete, dismissed });
});

// ─── POST /api/onboarding/dismiss ────────────────────────────────────────────

router.post('/onboarding/dismiss', requireAuth, async (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;

  await prisma.user.update({
    where: { id: clientId },
    data: { onboardingDismissed: true },
  });

  res.status(200).json({ ok: true });
});

export default router;
