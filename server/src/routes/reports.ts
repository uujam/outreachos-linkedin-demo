/**
 * B-012 — Reporting and export endpoints (F-011, S-012).
 * POST /api/reports/generate     — generate a snapshot report and store in D-011
 * GET  /api/reports              — list past report snapshots (most recent first)
 * GET  /api/reports/:id          — get a specific snapshot's data payload
 * GET  /api/reports/:id/csv      — download snapshot data as CSV
 *
 * Report types: pipeline_summary | campaign_performance | outreach_by_channel | meetings
 * Data is always generated fresh; the snapshot captures the result at generation time.
 * If generation takes > 10s, the endpoint still returns immediately with the snapshot ID
 * and the data is available via GET /api/reports/:id once the query completes.
 * (For this implementation all queries are fast enough to run inline.)
 */
import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/requireAuth';
import { prisma } from '../lib/prisma';

const router = Router();

type ReportType = 'pipeline_summary' | 'campaign_performance' | 'outreach_by_channel' | 'meetings';
const VALID_REPORT_TYPES: ReportType[] = [
  'pipeline_summary',
  'campaign_performance',
  'outreach_by_channel',
  'meetings',
];

// ─── Report generators ────────────────────────────────────────────────────────

async function generatePipelineSummary(clientId: string) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400_000);

  const [
    totalLeads,
    leadsInPipeline,
    byEnrichmentStage,
    byOutreachStage,
    byTerminalOutcome,
    meetingsBooked,
    newLeadsLast30,
  ] = await Promise.all([
    prisma.lead.count({ where: { clientId } }),
    prisma.lead.count({ where: { clientId, terminalOutcome: null } }),
    prisma.lead.groupBy({ by: ['enrichmentStage'], where: { clientId, terminalOutcome: null }, _count: { id: true } }),
    prisma.lead.groupBy({ by: ['outreachStage'], where: { clientId, outreachStage: { not: null }, terminalOutcome: null }, _count: { id: true } }),
    prisma.lead.groupBy({ by: ['terminalOutcome'], where: { clientId, terminalOutcome: { not: null } }, _count: { id: true } }),
    prisma.meeting.count({ where: { lead: { clientId } } }),
    prisma.lead.count({ where: { clientId, createdDate: { gte: thirtyDaysAgo } } }),
  ]);

  return {
    generatedAt: now.toISOString(),
    totalLeads,
    leadsInPipeline,
    meetingsBooked,
    newLeadsLast30Days: newLeadsLast30,
    byEnrichmentStage: Object.fromEntries(byEnrichmentStage.map((r) => [r.enrichmentStage, r._count.id])),
    byOutreachStage: Object.fromEntries(byOutreachStage.map((r) => [r.outreachStage ?? 'null', r._count.id])),
    byTerminalOutcome: Object.fromEntries(byTerminalOutcome.map((r) => [r.terminalOutcome ?? 'null', r._count.id])),
  };
}

async function generateCampaignPerformance(clientId: string) {
  const campaigns = await prisma.campaign.findMany({
    where: { clientId },
    include: {
      _count: { select: { leads: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const rows = await Promise.all(
    campaigns.map(async (c) => {
      const [responded, meetings, outreachSent] = await Promise.all([
        prisma.lead.count({ where: { assignedCampaignId: c.id, outreachStage: { not: null } } }),
        prisma.meeting.count({ where: { lead: { assignedCampaignId: c.id } } }),
        prisma.message.count({ where: { clientId, direction: 'outbound' } }),
      ]);
      return {
        campaignId: c.id,
        campaignName: c.name,
        status: c.status,
        totalLeads: c._count.leads,
        responded,
        meetingsBooked: meetings,
        outreachSent,
        responseRate: outreachSent > 0 ? Math.round((responded / outreachSent) * 100) : 0,
      };
    })
  );

  return { generatedAt: new Date().toISOString(), campaigns: rows };
}

async function generateOutreachByChannel(clientId: string) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000);

  const [emailSent, emailReplied, linkedinSent, linkedinReplied, voiceCalls] = await Promise.all([
    prisma.message.count({ where: { clientId, channel: 'email', direction: 'outbound', timestamp: { gte: thirtyDaysAgo } } }),
    prisma.message.count({ where: { clientId, channel: 'email', direction: 'inbound', timestamp: { gte: thirtyDaysAgo } } }),
    prisma.message.count({ where: { clientId, channel: 'linkedin', direction: 'outbound', timestamp: { gte: thirtyDaysAgo } } }),
    prisma.message.count({ where: { clientId, channel: 'linkedin', direction: 'inbound', timestamp: { gte: thirtyDaysAgo } } }),
    prisma.voiceCallRecord.count({ where: { lead: { clientId }, callDate: { gte: thirtyDaysAgo } } }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    periodDays: 30,
    email: { sent: emailSent, replied: emailReplied, responseRate: emailSent > 0 ? Math.round((emailReplied / emailSent) * 100) : 0 },
    linkedin: { sent: linkedinSent, replied: linkedinReplied, responseRate: linkedinSent > 0 ? Math.round((linkedinReplied / linkedinSent) * 100) : 0 },
    voice: { calls: voiceCalls },
  };
}

async function generateMeetingsReport(clientId: string) {
  const meetings = await prisma.meeting.findMany({
    where: { lead: { clientId } },
    include: { lead: { select: { fullName: true, company: true, emailAddress: true } } },
    orderBy: { meetingDate: 'desc' },
    take: 500,
  });

  const byStatus = meetings.reduce<Record<string, number>>((acc, m) => {
    acc[m.confirmationStatus] = (acc[m.confirmationStatus] ?? 0) + 1;
    return acc;
  }, {});

  const byChannel = meetings.reduce<Record<string, number>>((acc, m) => {
    acc[m.channelBookedVia] = (acc[m.channelBookedVia] ?? 0) + 1;
    return acc;
  }, {});

  return {
    generatedAt: new Date().toISOString(),
    totalMeetings: meetings.length,
    byStatus,
    byChannel,
    meetings: meetings.map((m) => ({
      id: m.id,
      leadName: m.lead.fullName,
      company: m.lead.company,
      email: m.lead.emailAddress,
      meetingDate: m.meetingDate,
      duration: m.duration,
      bookedVia: m.channelBookedVia,
      status: m.confirmationStatus,
    })),
  };
}

async function buildReportData(type: ReportType, clientId: string): Promise<unknown> {
  switch (type) {
    case 'pipeline_summary':     return generatePipelineSummary(clientId);
    case 'campaign_performance': return generateCampaignPerformance(clientId);
    case 'outreach_by_channel':  return generateOutreachByChannel(clientId);
    case 'meetings':             return generateMeetingsReport(clientId);
  }
}

// ─── CSV serialisation ────────────────────────────────────────────────────────

function escapeCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function toCSV(data: unknown): string {
  // For tabular data: find the first array in the payload and use it
  if (Array.isArray(data)) {
    if (data.length === 0) return '';
    const keys = Object.keys(data[0] as object);
    return [keys.join(','), ...data.map((row) => keys.map((k) => escapeCell((row as Record<string, unknown>)[k])).join(','))].join('\n');
  }

  // For object payload: find the first array property
  const obj = data as Record<string, unknown>;
  const arrayKey = Object.keys(obj).find((k) => Array.isArray(obj[k]));
  if (arrayKey) return toCSV(obj[arrayKey]);

  // Fall back to key-value pairs
  return ['key,value', ...Object.entries(obj).map(([k, v]) => `${k},${escapeCell(v)}`)].join('\n');
}

// ─── POST /api/reports/generate ───────────────────────────────────────────────

router.post('/reports/generate', requireAuth, async (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;
  const { type } = req.body as { type?: string };

  if (!type || !VALID_REPORT_TYPES.includes(type as ReportType)) {
    res.status(400).json({
      error: `type must be one of: ${VALID_REPORT_TYPES.join(', ')}`,
    });
    return;
  }

  const data = await buildReportData(type as ReportType, clientId);

  const snapshot = await prisma.reportSnapshot.create({
    data: {
      clientId,
      reportType: type,
      dataPayload: data as never,
    },
  });

  res.status(201).json({ snapshot: { id: snapshot.id, reportType: snapshot.reportType, dateGenerated: snapshot.dateGenerated } });
});

// ─── GET /api/reports ─────────────────────────────────────────────────────────

router.get('/reports', requireAuth, async (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  const snapshots = await prisma.reportSnapshot.findMany({
    where: { clientId },
    orderBy: { dateGenerated: 'desc' },
    take: limit,
    select: { id: true, reportType: true, dateGenerated: true, fileUrl: true },
  });

  res.status(200).json({ snapshots });
});

// ─── GET /api/reports/:id ─────────────────────────────────────────────────────

router.get('/reports/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;

  const snapshot = await prisma.reportSnapshot.findFirst({
    where: { id: req.params.id, clientId },
  });

  if (!snapshot) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }

  res.status(200).json({ snapshot });
});

// ─── GET /api/reports/:id/csv ─────────────────────────────────────────────────

router.get('/reports/:id/csv', requireAuth, async (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;

  const snapshot = await prisma.reportSnapshot.findFirst({
    where: { id: req.params.id, clientId },
  });

  if (!snapshot) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }

  const csv = toCSV(snapshot.dataPayload);
  const filename = `${snapshot.reportType}-${snapshot.dateGenerated.toISOString().slice(0, 10)}.csv`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csv);
});

export default router;
