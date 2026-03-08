import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/requireAuth';

const router = Router();

// GET /api/icp — load the authenticated client's ICP settings
router.get('/icp', requireAuth, async (req: AuthRequest, res: Response) => {
  const settings = await prisma.icpSettings.findUnique({
    where: { clientId: req.user!.sub },
  });

  if (!settings) {
    res.status(200).json({ settings: null });
    return;
  }

  res.status(200).json({ settings });
});

// PUT /api/icp — create or update the authenticated client's ICP settings
router.put('/icp', requireAuth, async (req: AuthRequest, res: Response) => {
  const {
    industries,
    geography,
    jobTitles,
    revenueRange,
    employeeRange,
    buyingSignals,
    descriptionText,
    exclusions,
  } = req.body as {
    industries?: string[];
    geography?: string[];
    jobTitles?: string[];
    revenueRange?: string;
    employeeRange?: string;
    buyingSignals?: string;
    descriptionText?: string;
    exclusions?: string;
  };

  const clientId = req.user!.sub;

  const settings = await prisma.icpSettings.upsert({
    where: { clientId },
    create: {
      clientId,
      industries: industries ?? [],
      geography: geography ?? [],
      jobTitles: jobTitles ?? [],
      revenueRange,
      employeeRange,
      buyingSignals,
      descriptionText,
      exclusions,
    },
    update: {
      ...(industries !== undefined && { industries }),
      ...(geography !== undefined && { geography }),
      ...(jobTitles !== undefined && { jobTitles }),
      ...(revenueRange !== undefined && { revenueRange }),
      ...(employeeRange !== undefined && { employeeRange }),
      ...(buyingSignals !== undefined && { buyingSignals }),
      ...(descriptionText !== undefined && { descriptionText }),
      ...(exclusions !== undefined && { exclusions }),
    },
  });

  res.status(200).json({ settings });
});

export default router;
