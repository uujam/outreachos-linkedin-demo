/**
 * B-010 — Dashboard KPI aggregation and activity feed endpoints.
 * GET /api/dashboard/kpis    — meetings booked, outreach sent, response rate, leads in pipeline
 * GET /api/dashboard/activity — recent automation events (paginated)
 * GET /api/dashboard/pipeline — lead counts by enrichment/outreach stage
 */
import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/requireAuth';
import { prisma } from '../lib/prisma';

const router = Router();

// ─── GET /api/dashboard/kpis ──────────────────────────────────────────────────

router.get('/dashboard/kpis', requireAuth, async (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400_000);

  try {
    const [
      meetingsBooked,
      outreachSent,
      replies,
      totalOutreachLeads,
      leadsInPipeline,
    ] = await Promise.all([
      // Meetings booked (all time)
      prisma.meeting.count({
        where: { lead: { clientId } },
      }),

      // Outreach sent (last 30 days — messages with direction outbound)
      prisma.message.count({
        where: {
          clientId,
          direction: 'outbound',
          timestamp: { gte: thirtyDaysAgo },
        },
      }),

      // Replies received (last 30 days — inbound messages)
      prisma.message.count({
        where: {
          clientId,
          direction: 'inbound',
          timestamp: { gte: thirtyDaysAgo },
        },
      }),

      // Total leads that received outreach in the last 30 days
      prisma.lead.count({
        where: {
          clientId,
          outreachStage: { not: null },
        },
      }),

      // Total active leads in pipeline
      prisma.lead.count({
        where: { clientId, terminalOutcome: null },
      }),
    ]);

    const responseRate = outreachSent > 0
      ? Math.round((replies / outreachSent) * 100)
      : 0;

    res.status(200).json({
      kpis: {
        meetingsBooked,
        outreachSentLast30Days: outreachSent,
        repliesLast30Days: replies,
        responseRatePercent: responseRate,
        leadsInPipeline,
        totalOutreachLeads,
      },
    });
  } catch (err) {
    console.error('[Dashboard KPIs] Error:', err);
    res.status(200).json({
      kpis: null,
      error: 'Could not load KPI data',
    });
  }
});

// ─── GET /api/dashboard/activity ──────────────────────────────────────────────

router.get('/dashboard/activity', requireAuth, async (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Number(req.query.offset) || 0;

  // Activity feed: most recent outreach activities + enrichment log events
  const [activities, enrichmentLogs] = await Promise.all([
    prisma.outreachActivity.findMany({
      where: { lead: { clientId } },
      orderBy: { timestamp: 'desc' },
      take: limit,
      skip: offset,
      include: {
        lead: { select: { fullName: true, company: true } },
      },
    }),
    prisma.enrichmentLog.findMany({
      where: { lead: { clientId } },
      orderBy: { timestamp: 'desc' },
      take: limit,
      skip: offset,
      include: {
        lead: { select: { fullName: true, company: true } },
      },
    }),
  ]);

  // Merge and sort by timestamp
  const activityEvents = activities.map((a) => ({
    id: a.id,
    type: 'outreach' as const,
    channel: a.channel,
    action: a.actionType,
    leadName: a.lead?.fullName ?? 'Unknown',
    company: a.lead?.company ?? '',
    notes: a.notes,
    timestamp: a.timestamp,
  }));

  const enrichmentEvents = enrichmentLogs.map((e) => ({
    id: e.id,
    type: 'enrichment' as const,
    channel: null,
    action: e.enrichmentStep,
    leadName: (e as typeof e & { lead?: { fullName: string; company: string } }).lead?.fullName ?? 'Unknown',
    company: (e as typeof e & { lead?: { fullName: string; company: string } }).lead?.company ?? '',
    notes: `${e.thirdPartyService} — ${e.status}`,
    timestamp: e.timestamp,
  }));

  const combined = [...activityEvents, ...enrichmentEvents]
    .sort((a, b) => (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0))
    .slice(0, limit);

  res.status(200).json({ activity: combined });
});

// ─── GET /api/dashboard/pipeline ──────────────────────────────────────────────

router.get('/dashboard/pipeline', requireAuth, async (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;

  const [enrichmentCounts, outreachCounts, terminalCounts] = await Promise.all([
    // Count by enrichment stage
    prisma.lead.groupBy({
      by: ['enrichmentStage'],
      where: { clientId, terminalOutcome: null },
      _count: { id: true },
    }),

    // Count by outreach stage
    prisma.lead.groupBy({
      by: ['outreachStage'],
      where: { clientId, outreachStage: { not: null }, terminalOutcome: null },
      _count: { id: true },
    }),

    // Count by terminal outcome
    prisma.lead.groupBy({
      by: ['terminalOutcome'],
      where: { clientId, terminalOutcome: { not: null } },
      _count: { id: true },
    }),
  ]);

  res.status(200).json({
    pipeline: {
      byEnrichmentStage: Object.fromEntries(
        enrichmentCounts.map((r) => [r.enrichmentStage, r._count.id])
      ),
      byOutreachStage: Object.fromEntries(
        outreachCounts.map((r) => [r.outreachStage ?? 'null', r._count.id])
      ),
      byTerminalOutcome: Object.fromEntries(
        terminalCounts.map((r) => [r.terminalOutcome ?? 'null', r._count.id])
      ),
    },
  });
});

export default router;
