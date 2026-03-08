import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/requireAuth';
import { launchScrape, fetchScrapeResults } from '../lib/phantombuster';
import { getQueues } from '../queues';
import { checkLeadCap, incrementLeadCount } from '../lib/leadCap';
import { LeadSource, EnrichmentStage, ScrapeBatchStatus } from '@prisma/client';
import crypto from 'crypto';

const router = Router();

// POST /api/linkedin/scrape — trigger a new Phantombuster scrape
router.post('/linkedin/scrape', requireAuth, async (req: AuthRequest, res: Response) => {
  const { filters } = req.body as {
    filters?: {
      searchUrl?: string;
      keywords?: string;
      location?: string;
      industry?: string;
      jobTitle?: string;
    };
  };

  if (!filters) {
    res.status(400).json({ error: 'filters are required' });
    return;
  }

  const agentId = process.env.PHANTOMBUSTER_AGENT_ID;
  if (!agentId) {
    res.status(503).json({ error: 'Phantombuster agent not configured' });
    return;
  }

  const batchId = crypto.randomUUID();

  const batch = await prisma.linkedInScrapeBatch.create({
    data: {
      batchId,
      filtersUsed: filters,
      status: ScrapeBatchStatus.Running,
    },
  });

  // Launch scrape asynchronously — enqueue a discovery job to poll results
  try {
    const { containerId } = await launchScrape(agentId, filters);

    const queues = getQueues();
    await queues.discovery.add('process-scrape-results', {
      batchId,
      containerId,
      clientId: req.user!.sub,
    }, { delay: 60_000 }); // Poll after 60s
  } catch (err) {
    await prisma.linkedInScrapeBatch.update({
      where: { batchId },
      data: { status: ScrapeBatchStatus.Failed },
    });
    res.status(502).json({ error: 'Failed to launch scrape', details: String(err) });
    return;
  }

  res.status(202).json({ batch });
});

// GET /api/linkedin/batches — list scrape batch history
router.get('/linkedin/batches', requireAuth, async (_req: AuthRequest, res: Response) => {
  const batches = await prisma.linkedInScrapeBatch.findMany({
    orderBy: { dateRun: 'desc' },
    take: 50,
  });
  res.status(200).json({ batches });
});

// GET /api/linkedin/batches/:batchId — single batch status
router.get('/linkedin/batches/:batchId', requireAuth, async (req: AuthRequest, res: Response) => {
  const batch = await prisma.linkedInScrapeBatch.findUnique({
    where: { batchId: req.params.batchId },
  });
  if (!batch) {
    res.status(404).json({ error: 'Batch not found' });
    return;
  }
  res.status(200).json({ batch });
});

// POST /api/linkedin/batches/:batchId/process — manually process results (internal/webhook)
// This is also called by the BullMQ discovery worker
router.post('/linkedin/batches/:batchId/process', requireAuth, async (req: AuthRequest, res: Response) => {
  const { containerId } = req.body as { containerId?: string };
  const { batchId } = req.params;

  const batch = await prisma.linkedInScrapeBatch.findUnique({ where: { batchId } });
  if (!batch) {
    res.status(404).json({ error: 'Batch not found' });
    return;
  }

  let profiles;
  try {
    profiles = await fetchScrapeResults(containerId ?? '');
  } catch (err) {
    await prisma.linkedInScrapeBatch.update({
      where: { batchId },
      data: { status: ScrapeBatchStatus.Failed },
    });
    res.status(502).json({ error: 'Failed to fetch results', details: String(err) });
    return;
  }

  const clientId = req.user!.sub;
  let created = 0;
  let skipped = 0;

  for (const profile of profiles) {
    if (!profile.linkedinUrl || !profile.fullName) { skipped++; continue; }

    // Skip if lead already exists for this client
    const existing = await prisma.lead.findFirst({
      where: { clientId, linkedinUrl: profile.linkedinUrl },
    });
    if (existing) { skipped++; continue; }

    // Check lead cap before each creation
    const capStatus = await checkLeadCap(clientId);
    if (!capStatus.allowed) break;

    await prisma.lead.create({
      data: {
        clientId,
        fullName: profile.fullName,
        jobTitle: profile.jobTitle,
        company: profile.company,
        linkedinUrl: profile.linkedinUrl,
        source: LeadSource.LinkedIn,
        enrichmentStage: EnrichmentStage.Discovered,
      },
    });

    await incrementLeadCount(clientId);

    // Queue enrichment for each new lead
    try {
      const queues = getQueues();
      await queues.enrichment.add('enrich-lead', {
        leadId: 'pending', // will be updated by worker after DB insert
        clientId,
        linkedinUrl: profile.linkedinUrl,
      });
    } catch { /* non-fatal */ }

    created++;
  }

  const averageFitScore = null; // calculated after scoring in B-007d

  await prisma.linkedInScrapeBatch.update({
    where: { batchId },
    data: {
      status: ScrapeBatchStatus.Complete,
      numberOfLeads: created,
      averageFitScore,
    },
  });

  res.status(200).json({ created, skipped, total: profiles.length });
});

export default router;
