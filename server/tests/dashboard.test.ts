/**
 * B-010 Dashboard KPI and activity feed tests
 */
import request from 'supertest';
import app from '../src/app';
import { signToken } from '../src/lib/auth';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    meeting: { count: jest.fn() },
    message: { count: jest.fn() },
    lead: { count: jest.fn(), groupBy: jest.fn() },
    outreachActivity: { findMany: jest.fn() },
    enrichmentLog: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  },
  checkDatabaseHealth: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/lib/redis', () => ({
  getRedisClient: jest.fn(),
  checkRedisHealth: jest.fn().mockResolvedValue(true),
  closeRedis: jest.fn(),
}));

jest.mock('../src/queues', () => ({
  QUEUE_NAMES: ['enrichment', 'outreach', 'discovery', 'scoring', 'follow-up', 'notifications'],
  getQueues: jest.fn(),
  getDlqs: jest.fn(),
  checkQueuesHealth: jest.fn().mockResolvedValue({}),
  wireDlqForwarding: jest.fn(),
  closeQueues: jest.fn(),
}));

import { prisma } from '../src/lib/prisma';

const mockMeetingCount = prisma.meeting.count as jest.MockedFunction<typeof prisma.meeting.count>;
const mockMessageCount = prisma.message.count as jest.MockedFunction<typeof prisma.message.count>;
const mockLeadCount = prisma.lead.count as jest.MockedFunction<typeof prisma.lead.count>;
const mockLeadGroupBy = prisma.lead.groupBy as jest.MockedFunction<typeof prisma.lead.groupBy>;
const mockActivityFindMany = prisma.outreachActivity.findMany as jest.MockedFunction<typeof prisma.outreachActivity.findMany>;
const mockEnrichmentFindMany = prisma.enrichmentLog.findMany as jest.MockedFunction<typeof prisma.enrichmentLog.findMany>;

process.env.JWT_SECRET = 'test-secret-b010';
const clientToken = `Bearer ${signToken({ sub: 'user-001', role: 'client' })}`;

beforeEach(() => {
  jest.clearAllMocks();
  mockMeetingCount.mockResolvedValue(5);
  mockMessageCount.mockResolvedValueOnce(120).mockResolvedValueOnce(18).mockResolvedValue(80);
  mockLeadCount.mockResolvedValue(47);
  mockLeadGroupBy.mockResolvedValue([] as never);
  mockActivityFindMany.mockResolvedValue([]);
  mockEnrichmentFindMany.mockResolvedValue([]);
});

// ─── GET /api/dashboard/kpis ──────────────────────────────────────────────────

describe('GET /api/dashboard/kpis', () => {
  it('returns all KPI fields for the authenticated client', async () => {
    const res = await request(app)
      .get('/api/dashboard/kpis')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.kpis).toBeDefined();
    expect(res.body.kpis.meetingsBooked).toBe(5);
    expect(res.body.kpis.outreachSentLast30Days).toBe(120);
    expect(res.body.kpis.repliesLast30Days).toBe(18);
    expect(res.body.kpis.responseRatePercent).toBe(15); // 18/120 * 100
  });

  it('returns 0 response rate when no outreach sent', async () => {
    mockMeetingCount.mockResolvedValue(0);
    mockMessageCount.mockReset().mockResolvedValue(0);

    const res = await request(app)
      .get('/api/dashboard/kpis')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.kpis.responseRatePercent).toBe(0);
  });

  it('returns null kpis and error message on DB error (does not crash)', async () => {
    mockMeetingCount.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .get('/api/dashboard/kpis')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.kpis).toBeNull();
    expect(res.body.error).toBeDefined();
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/dashboard/kpis');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/dashboard/activity ──────────────────────────────────────────────

describe('GET /api/dashboard/activity', () => {
  it('returns merged activity and enrichment events sorted by timestamp', async () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 10000);

    mockActivityFindMany.mockResolvedValue([
      {
        id: 'act-001',
        channel: 'Email',
        actionType: 'Sent',
        timestamp: now,
        notes: null,
        lead: { fullName: 'Jane Smith', company: 'ACME' },
      },
    ] as never);

    mockEnrichmentFindMany.mockResolvedValue([
      {
        id: 'enr-001',
        enrichmentStep: 'Identify',
        thirdPartyService: 'ProxyCurl',
        status: 'success',
        timestamp: earlier,
        lead: { fullName: 'Jane Smith', company: 'ACME' },
      },
    ] as never);

    const res = await request(app)
      .get('/api/dashboard/activity')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.activity).toHaveLength(2);
    // Most recent first
    expect(res.body.activity[0].type).toBe('outreach');
    expect(res.body.activity[1].type).toBe('enrichment');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/dashboard/activity');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/dashboard/pipeline ──────────────────────────────────────────────

describe('GET /api/dashboard/pipeline', () => {
  it('returns lead counts by stage', async () => {
    mockLeadGroupBy
      .mockResolvedValueOnce([{ enrichmentStage: 'ReadyForOutreach', _count: { id: 10 } }] as never)
      .mockResolvedValueOnce([{ outreachStage: 'InOutreach', _count: { id: 7 } }] as never)
      .mockResolvedValueOnce([{ terminalOutcome: 'MeetingBooked', _count: { id: 3 } }] as never);

    const res = await request(app)
      .get('/api/dashboard/pipeline')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.pipeline.byEnrichmentStage.ReadyForOutreach).toBe(10);
    expect(res.body.pipeline.byOutreachStage.InOutreach).toBe(7);
    expect(res.body.pipeline.byTerminalOutcome.MeetingBooked).toBe(3);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/dashboard/pipeline');
    expect(res.status).toBe(401);
  });
});
