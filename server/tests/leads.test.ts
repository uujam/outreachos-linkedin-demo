import request from 'supertest';
import app from '../src/app';
import { signToken } from '../src/lib/auth';

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    lead: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
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
  getQueues: jest.fn(), getDlqs: jest.fn(),
  checkQueuesHealth: jest.fn().mockResolvedValue({
    enrichment: true, outreach: true, discovery: true,
    scoring: true, 'follow-up': true, notifications: true,
  }),
  wireDlqForwarding: jest.fn(), closeQueues: jest.fn(),
}));

import { prisma } from '../src/lib/prisma';

const mockFindMany = prisma.lead.findMany as jest.MockedFunction<typeof prisma.lead.findMany>;
const mockFindFirst = prisma.lead.findFirst as jest.MockedFunction<typeof prisma.lead.findFirst>;
const mockUpdate = prisma.lead.update as jest.MockedFunction<typeof prisma.lead.update>;
const mockDelete = prisma.lead.delete as jest.MockedFunction<typeof prisma.lead.delete>;
const mockCount = prisma.lead.count as jest.MockedFunction<typeof prisma.lead.count>;

process.env.JWT_SECRET = 'test-secret-key-for-b003';
const clientToken = `Bearer ${signToken({ sub: 'user-001', role: 'client' })}`;

const LEAD = {
  id: 'lead-001',
  clientId: 'user-001',
  fullName: 'Jane Smith',
  jobTitle: 'CEO',
  company: 'ACME Ltd',
  linkedinUrl: null,
  emailAddress: 'jane@acme.com',
  phoneNumber: null,
  source: 'LinkedIn',
  fitScore: 85,
  fitScoreReasoning: null,
  enrichmentStage: 'ReadyForOutreach',
  outreachStage: null,
  terminalOutcome: null,
  followUpDate: null,
  dncFlag: false,
  assignedCampaignId: null,
  currentChannelStep: null,
  createdDate: new Date('2024-01-01'),
  lastActivityDate: null,
  activities: [],
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── GET /api/leads ───────────────────────────────────────────────────────────

describe('GET /api/leads', () => {
  it('returns 401 with no auth', async () => {
    const res = await request(app).get('/api/leads');
    expect(res.status).toBe(401);
  });

  it('returns paginated lead list for the authenticated client', async () => {
    mockFindMany.mockResolvedValue([LEAD] as never);
    mockCount.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/leads')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.leads).toHaveLength(1);
    expect(res.body.pagination.total).toBe(1);
  });

  it('always scopes to clientId', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await request(app)
      .get('/api/leads')
      .set('Authorization', clientToken);

    const call = mockFindMany.mock.calls[0][0];
    expect((call as { where: { clientId: string } }).where.clientId).toBe('user-001');
  });

  it('supports enrichmentStage filter', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await request(app)
      .get('/api/leads?enrichmentStage=ReadyForOutreach')
      .set('Authorization', clientToken);

    const call = mockFindMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(call.where.enrichmentStage).toBe('ReadyForOutreach');
  });

  it('caps limit at 200', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await request(app)
      .get('/api/leads?limit=999')
      .set('Authorization', clientToken);

    const call = mockFindMany.mock.calls[0][0] as { take: number };
    expect(call.take).toBe(200);
  });
});

// ─── GET /api/leads/:id ───────────────────────────────────────────────────────

describe('GET /api/leads/:id', () => {
  it('returns 404 for a lead belonging to another client', async () => {
    mockFindFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/leads/lead-other')
      .set('Authorization', clientToken);

    expect(res.status).toBe(404);
  });

  it('returns the lead with activities', async () => {
    mockFindFirst.mockResolvedValue(LEAD as never);

    const res = await request(app)
      .get('/api/leads/lead-001')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.lead.id).toBe('lead-001');
  });
});

// ─── PATCH /api/leads/:id/stage ───────────────────────────────────────────────

describe('PATCH /api/leads/:id/stage', () => {
  it('moves enrichment stage', async () => {
    mockFindFirst.mockResolvedValue(LEAD as never);
    mockUpdate.mockResolvedValue({ ...LEAD, enrichmentStage: 'Enriched' } as never);

    const res = await request(app)
      .patch('/api/leads/lead-001/stage')
      .set('Authorization', clientToken)
      .send({ enrichmentStage: 'Enriched' });

    expect(res.status).toBe(200);
    expect(res.body.lead.enrichmentStage).toBe('Enriched');
  });

  it('requires followUpDate when setting FollowUpLater', async () => {
    mockFindFirst.mockResolvedValue(LEAD as never);

    const res = await request(app)
      .patch('/api/leads/lead-001/stage')
      .set('Authorization', clientToken)
      .send({ terminalOutcome: 'FollowUpLater' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/followUpDate/i);
  });

  it('accepts FollowUpLater with followUpDate', async () => {
    mockFindFirst.mockResolvedValue(LEAD as never);
    mockUpdate.mockResolvedValue({ ...LEAD, terminalOutcome: 'FollowUpLater' } as never);

    const res = await request(app)
      .patch('/api/leads/lead-001/stage')
      .set('Authorization', clientToken)
      .send({ terminalOutcome: 'FollowUpLater', followUpDate: '2025-06-01' });

    expect(res.status).toBe(200);
  });

  it('returns 404 for unknown lead', async () => {
    mockFindFirst.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/leads/bad-id/stage')
      .set('Authorization', clientToken)
      .send({ enrichmentStage: 'Enriched' });

    expect(res.status).toBe(404);
  });
});

// ─── DELETE /api/leads/:id ────────────────────────────────────────────────────

describe('DELETE /api/leads/:id', () => {
  it('deletes the lead and returns 204', async () => {
    mockFindFirst.mockResolvedValue(LEAD as never);
    mockDelete.mockResolvedValue(LEAD as never);

    const res = await request(app)
      .delete('/api/leads/lead-001')
      .set('Authorization', clientToken);

    expect(res.status).toBe(204);
  });

  it('returns 404 for a lead not belonging to the client', async () => {
    mockFindFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/leads/lead-other')
      .set('Authorization', clientToken);

    expect(res.status).toBe(404);
  });
});

// ─── GET /api/leads/export ────────────────────────────────────────────────────

describe('GET /api/leads/export', () => {
  it('returns a CSV file with correct headers', async () => {
    mockFindMany.mockResolvedValue([LEAD] as never);

    const res = await request(app)
      .get('/api/leads/export')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/leads\.csv/);

    const lines = res.text.split('\n');
    expect(lines[0]).toContain('fullName');
    expect(lines[0]).toContain('enrichmentStage');
    expect(lines[1]).toContain('Jane Smith');
  });

  it('escapes commas in values', async () => {
    const leadWithComma = { ...LEAD, company: 'Smith, Jones & Co' };
    mockFindMany.mockResolvedValue([leadWithComma] as never);

    const res = await request(app)
      .get('/api/leads/export')
      .set('Authorization', clientToken);

    expect(res.text).toContain('"Smith, Jones & Co"');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/leads/export');
    expect(res.status).toBe(401);
  });
});
