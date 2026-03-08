import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/requireAuth';
import { getQueues } from '../queues';
import { checkLeadCap, incrementLeadCount } from '../lib/leadCap';
import {
  EnrichmentStage,
  OutreachStage,
  TerminalOutcome,
  LeadSource,
} from '@prisma/client';

const router = Router();

// ─── POST /api/leads — manual lead entry (B-006a) ────────────────────────────

router.post('/leads', requireAuth, async (req: AuthRequest, res: Response) => {
  const {
    fullName, jobTitle, company, linkedinUrl,
    emailAddress, phoneNumber, notes,
  } = req.body as {
    fullName?: string;
    jobTitle?: string;
    company?: string;
    linkedinUrl?: string;
    emailAddress?: string;
    phoneNumber?: string;
    notes?: string;
  };

  if (!fullName || !company) {
    res.status(400).json({ error: 'fullName and company are required' });
    return;
  }

  const clientId = req.user!.sub;

  // Duplicate detection: same LinkedIn URL or email already exists for this client
  if (linkedinUrl || emailAddress) {
    const duplicate = await prisma.lead.findFirst({
      where: {
        clientId,
        OR: [
          ...(linkedinUrl ? [{ linkedinUrl }] : []),
          ...(emailAddress ? [{ emailAddress }] : []),
        ],
      },
    });
    if (duplicate) {
      res.status(409).json({
        error: 'A lead with this LinkedIn URL or email already exists in your pipeline',
        existingLeadId: duplicate.id,
      });
      return;
    }
  }

  // Lead cap check
  const capStatus = await checkLeadCap(clientId);
  if (!capStatus.allowed) {
    res.status(402).json({
      error: 'Monthly lead cap reached. Upgrade your plan or wait for next billing period.',
      used: capStatus.used,
      cap: capStatus.cap,
    });
    return;
  }

  const lead = await prisma.lead.create({
    data: {
      clientId,
      fullName,
      jobTitle: jobTitle ?? '',
      company,
      linkedinUrl,
      emailAddress,
      phoneNumber,
      source: LeadSource.Manual,
      enrichmentStage: EnrichmentStage.Discovered,
    },
  });

  await incrementLeadCount(clientId);

  // Queue enrichment job, skipping steps for fields already provided
  try {
    const queues = getQueues();
    await queues.enrichment.add('enrich-lead', {
      leadId: lead.id,
      clientId,
      skipLinkedin: !!linkedinUrl,
      skipEmail: !!emailAddress,
      notes,
    });
  } catch (err) {
    console.error('[ManualLead] Failed to queue enrichment job:', err);
    // Don't fail the request — lead was created successfully
  }

  res.status(201).json({ lead });
});

// ─── GET /api/leads — list with filtering ────────────────────────────────────

router.get('/leads', requireAuth, async (req: AuthRequest, res: Response) => {
  const {
    enrichmentStage,
    outreachStage,
    terminalOutcome,
    source,
    campaignId,
    search,
    page = '1',
    limit = '50',
  } = req.query as Record<string, string>;

  const pageNum = parseInt(page, 10);
  const limitNum = Math.min(parseInt(limit, 10), 200);
  const skip = (pageNum - 1) * limitNum;

  const where = {
    clientId: req.user!.sub,
    ...(enrichmentStage && { enrichmentStage: enrichmentStage as EnrichmentStage }),
    ...(outreachStage && { outreachStage: outreachStage as OutreachStage }),
    ...(terminalOutcome && { terminalOutcome: terminalOutcome as TerminalOutcome }),
    ...(source && { source: source as LeadSource }),
    ...(campaignId && { assignedCampaignId: campaignId }),
    ...(search && {
      OR: [
        { fullName: { contains: search, mode: 'insensitive' as const } },
        { company: { contains: search, mode: 'insensitive' as const } },
        { emailAddress: { contains: search, mode: 'insensitive' as const } },
      ],
    }),
  };

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: [{ fitScore: 'desc' }, { createdDate: 'desc' }],
      skip,
      take: limitNum,
    }),
    prisma.lead.count({ where }),
  ]);

  res.status(200).json({
    leads,
    pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
  });
});

// ─── GET /api/leads/export — CSV download (must be before /:id route) ────────

router.get('/leads/export', requireAuth, async (req: AuthRequest, res: Response) => {
  const leads = await prisma.lead.findMany({
    where: { clientId: req.user!.sub },
    orderBy: { createdDate: 'desc' },
  });

  const headers = [
    'id', 'fullName', 'jobTitle', 'company', 'emailAddress', 'phoneNumber',
    'linkedinUrl', 'source', 'fitScore', 'enrichmentStage', 'outreachStage',
    'terminalOutcome', 'dncFlag', 'createdDate', 'lastActivityDate',
  ] as const;

  const escape = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = [
    headers.join(','),
    ...leads.map((lead) =>
      headers.map((h) => escape(lead[h])).join(',')
    ),
  ];

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
  res.status(200).send(rows.join('\n'));
});

// ─── GET /api/leads/:id ───────────────────────────────────────────────────────

router.get('/leads/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const lead = await prisma.lead.findFirst({
    where: { id: req.params.id, clientId: req.user!.sub },
    include: { activities: { orderBy: { timestamp: 'desc' } } },
  });

  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  res.status(200).json({ lead });
});

// ─── PATCH /api/leads/:id/stage — move enrichment or outreach stage ──────────

router.patch('/leads/:id/stage', requireAuth, async (req: AuthRequest, res: Response) => {
  const { enrichmentStage, outreachStage, terminalOutcome, followUpDate } = req.body as {
    enrichmentStage?: EnrichmentStage;
    outreachStage?: OutreachStage;
    terminalOutcome?: TerminalOutcome;
    followUpDate?: string;
  };

  const existing = await prisma.lead.findFirst({
    where: { id: req.params.id, clientId: req.user!.sub },
  });

  if (!existing) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  // Validate: terminalOutcome=FollowUpLater requires followUpDate
  if (terminalOutcome === TerminalOutcome.FollowUpLater && !followUpDate) {
    res.status(400).json({ error: 'followUpDate is required when setting outcome to FollowUpLater' });
    return;
  }

  const lead = await prisma.lead.update({
    where: { id: req.params.id },
    data: {
      ...(enrichmentStage !== undefined && { enrichmentStage }),
      ...(outreachStage !== undefined && { outreachStage }),
      ...(terminalOutcome !== undefined && { terminalOutcome }),
      ...(followUpDate !== undefined && { followUpDate: new Date(followUpDate) }),
      lastActivityDate: new Date(),
    },
  });

  res.status(200).json({ lead });
});

// ─── PATCH /api/leads/:id — general update ───────────────────────────────────

router.patch('/leads/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const existing = await prisma.lead.findFirst({
    where: { id: req.params.id, clientId: req.user!.sub },
  });

  if (!existing) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  const {
    fullName, jobTitle, company, linkedinUrl,
    emailAddress, phoneNumber, assignedCampaignId, dncFlag,
  } = req.body as Partial<{
    fullName: string;
    jobTitle: string;
    company: string;
    linkedinUrl: string;
    emailAddress: string;
    phoneNumber: string;
    assignedCampaignId: string;
    dncFlag: boolean;
  }>;

  const lead = await prisma.lead.update({
    where: { id: req.params.id },
    data: {
      ...(fullName !== undefined && { fullName }),
      ...(jobTitle !== undefined && { jobTitle }),
      ...(company !== undefined && { company }),
      ...(linkedinUrl !== undefined && { linkedinUrl }),
      ...(emailAddress !== undefined && { emailAddress }),
      ...(phoneNumber !== undefined && { phoneNumber }),
      ...(assignedCampaignId !== undefined && { assignedCampaignId }),
      ...(dncFlag !== undefined && { dncFlag }),
      lastActivityDate: new Date(),
    },
  });

  res.status(200).json({ lead });
});

// ─── DELETE /api/leads/:id ────────────────────────────────────────────────────

router.delete('/leads/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const existing = await prisma.lead.findFirst({
    where: { id: req.params.id, clientId: req.user!.sub },
  });

  if (!existing) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  await prisma.lead.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export default router;
