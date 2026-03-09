/**
 * B-013 — Admin panel endpoints (F-013, S-013).
 * All routes require admin role (requireAdmin middleware).
 *
 * GET /api/admin/clients                  — list all clients with stats
 * GET /api/admin/clients/:id              — single client profile
 * GET /api/admin/clients/:id/api-costs    — D-017 API cost breakdown + revenue comparison
 * GET /api/admin/clay-queue               — leads currently pending Clay fallback
 * GET /api/admin/heyreach/health          — LinkedIn account health + daily action counts
 * GET /api/admin/instantly/domains        — sending domain warmup status per domain
 * GET /api/admin/queues                   — BullMQ queue health (depth, failed, DLQ)
 */
import { Router, Response } from 'express';
import { requireAdmin, AuthRequest } from '../middleware/requireAuth';
import { prisma } from '../lib/prisma';
import { getLinkedInAccountStatus } from '../lib/heyreach';
import { getDomainWarmupStatus } from '../lib/instantly';
import { getQueues, getDlqs, QUEUE_NAMES } from '../queues';

const router = Router();

// ─── GET /api/admin/clients ───────────────────────────────────────────────────

router.get('/admin/clients', requireAdmin, async (_req: AuthRequest, res: Response) => {
  const clients = await prisma.user.findMany({
    where: { role: 'client' },
    orderBy: { createdDate: 'desc' },
    select: {
      id: true,
      name: true,
      email: true,
      companyName: true,
      createdDate: true,
      lastLogin: true,
      customLeadCapOverride: true,
      _count: { select: { leads: true } },
      subscriptions: {
        select: { planName: true, status: true, leadsUsedThisPeriod: true },
        take: 1,
      },
    },
  });

  res.status(200).json({ clients });
});

// ─── GET /api/admin/clients/:id ───────────────────────────────────────────────

router.get('/admin/clients/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  const client = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: {
      subscriptions: true,
      _count: { select: { leads: true, notifications: true } },
    },
  });

  if (!client || client.role !== 'client') {
    res.status(404).json({ error: 'Client not found' });
    return;
  }

  res.status(200).json({ client });
});

// ─── PATCH /api/admin/clients/:id/cap-override ───────────────────────────────

router.patch('/admin/clients/:id/cap-override', requireAdmin, async (req: AuthRequest, res: Response) => {
  const clientId = req.params.id;
  const { capOverride } = req.body as { capOverride?: number | null };

  // null = remove override (revert to plan default)
  if (capOverride !== null && capOverride !== undefined && (typeof capOverride !== 'number' || capOverride < 0)) {
    res.status(400).json({ error: 'capOverride must be a non-negative integer or null' });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: clientId },
    select: { id: true, role: true },
  });

  if (!user || user.role !== 'client') {
    res.status(404).json({ error: 'Client not found' });
    return;
  }

  await prisma.user.update({
    where: { id: clientId },
    data: { customLeadCapOverride: capOverride ?? null },
  });

  res.status(200).json({ ok: true, clientId, capOverride: capOverride ?? null });
});

// ─── GET /api/admin/clients/:id/api-costs ────────────────────────────────────

router.get('/admin/clients/:id/api-costs', requireAdmin, async (req: AuthRequest, res: Response) => {
  const clientId = req.params.id;
  const billingPeriod = (req.query.billingPeriod as string) ?? getCurrentBillingPeriod();

  const [logs, subscription] = await Promise.all([
    prisma.apiUsageLog.findMany({
      where: { clientId, billingPeriod },
      orderBy: { timestamp: 'desc' },
    }),
    prisma.subscription.findUnique({ where: { clientId } }),
  ]);

  // Aggregate cost by service
  const byCostService = logs.reduce<Record<string, { units: number; cost: number }>>((acc, log) => {
    const key = log.serviceName;
    if (!acc[key]) acc[key] = { units: 0, cost: 0 };
    acc[key].units += log.unitCount;
    acc[key].cost += log.approximateUnitCost;
    return acc;
  }, {});

  const totalCostPence = logs.reduce((sum, l) => sum + l.approximateUnitCost, 0);

  // Plan monthly revenue in pence (Starter=£1497, Growth=£2997, Enterprise=0 until confirmed)
  const planRevenuePence: Record<string, number> = {
    Starter: 149_700,
    Growth: 299_700,
    Enterprise: 0,
  };
  const monthlyRevenuePence = subscription
    ? (planRevenuePence[subscription.planName] ?? 0)
    : 0;

  const marginPence = monthlyRevenuePence - totalCostPence;

  res.status(200).json({
    billingPeriod,
    totalCostPence,
    monthlyRevenuePence,
    marginPence,
    isProfitable: marginPence >= 0,
    byCostService,
    logs,
  });
});

// ─── GET /api/admin/clay-queue ────────────────────────────────────────────────

router.get('/admin/clay-queue', requireAdmin, async (_req: AuthRequest, res: Response) => {
  const leads = await prisma.lead.findMany({
    where: { enrichmentStage: 'Enriched' }, // Enriched but not yet Validated = pending Clay
    orderBy: { createdDate: 'asc' },
    select: {
      id: true,
      fullName: true,
      company: true,
      enrichmentStage: true,
      createdDate: true,
      clientId: true,
      client: { select: { name: true, companyName: true } },
    },
  });

  // Group by clientId
  const byClient = leads.reduce<Record<string, { clientName: string; leads: typeof leads }>>((acc, lead) => {
    const clientName = `${lead.client.name} (${lead.client.companyName})`;
    if (!acc[lead.clientId]) acc[lead.clientId] = { clientName, leads: [] };
    acc[lead.clientId].leads.push(lead);
    return acc;
  }, {});

  res.status(200).json({
    totalPendingClay: leads.length,
    byClient,
  });
});

// ─── GET /api/admin/heyreach/health ───────────────────────────────────────────

router.get('/admin/heyreach/health', requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const accounts = await getLinkedInAccountStatus();
    res.status(200).json({ accounts });
  } catch (err) {
    console.error('[Admin] Heyreach health check failed:', err);
    res.status(200).json({ accounts: [], error: 'Failed to fetch Heyreach account status' });
  }
});

// ─── GET /api/admin/instantly/domains ─────────────────────────────────────────

router.get('/admin/instantly/domains', requireAdmin, async (req: AuthRequest, res: Response) => {
  const email = req.query.email as string | undefined;

  if (!email) {
    res.status(400).json({ error: 'email query param is required' });
    return;
  }

  try {
    const status = await getDomainWarmupStatus(email);
    res.status(200).json({ email, warmup: status });
  } catch (err) {
    console.error('[Admin] Instantly domain check failed:', err);
    res.status(200).json({ email, warmup: null, error: 'Failed to fetch domain warmup status' });
  }
});

// ─── GET /api/admin/queues ────────────────────────────────────────────────────

router.get('/admin/queues', requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const queues = getQueues();
    const dlqs = getDlqs();

    const healthData = await Promise.all(
      QUEUE_NAMES.map(async (name) => {
        const queue = queues[name as keyof typeof queues];
        const dlq = dlqs?.[name as keyof typeof dlqs];

        const [waiting, active, failed, dlqWaiting] = await Promise.allSettled([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getFailedCount(),
          dlq ? dlq.getWaitingCount() : Promise.resolve(0),
        ]);

        return {
          name,
          waiting: waiting.status === 'fulfilled' ? waiting.value : -1,
          active: active.status === 'fulfilled' ? active.value : -1,
          failed: failed.status === 'fulfilled' ? failed.value : -1,
          dlqDepth: dlqWaiting.status === 'fulfilled' ? dlqWaiting.value : -1,
        };
      })
    );

    res.status(200).json({ queues: healthData });
  } catch (err) {
    console.error('[Admin] Queue health check failed:', err);
    res.status(200).json({ queues: [], error: 'Failed to fetch queue health' });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCurrentBillingPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default router;
