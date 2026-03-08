import request from 'supertest';
import app from '../src/app';
import { signToken } from '../src/lib/auth';

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    lead: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    linkedInScrapeBatch: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    subscription: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
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
  getQueues: jest.fn().mockReturnValue({
    enrichment: { add: jest.fn().mockResolvedValue({}) },
    discovery: { add: jest.fn().mockResolvedValue({}) },
  }),
  getDlqs: jest.fn(),
  checkQueuesHealth: jest.fn().mockResolvedValue({
    enrichment: true, outreach: true, discovery: true,
    scoring: true, 'follow-up': true, notifications: true,
  }),
  wireDlqForwarding: jest.fn(),
  closeQueues: jest.fn(),
}));

jest.mock('../src/lib/phantombuster', () => ({
  launchScrape: jest.fn(),
  fetchScrapeResults: jest.fn(),
}));

import { prisma } from '../src/lib/prisma';
import { launchScrape, fetchScrapeResults } from '../src/lib/phantombuster';

const mockLaunchScrape = launchScrape as jest.MockedFunction<typeof launchScrape>;
const mockFetchResults = fetchScrapeResults as jest.MockedFunction<typeof fetchScrapeResults>;
const mockBatchCreate = prisma.linkedInScrapeBatch.create as jest.MockedFunction<typeof prisma.linkedInScrapeBatch.create>;
const mockBatchFindMany = prisma.linkedInScrapeBatch.findMany as jest.MockedFunction<typeof prisma.linkedInScrapeBatch.findMany>;
const mockBatchFindUnique = prisma.linkedInScrapeBatch.findUnique as jest.MockedFunction<typeof prisma.linkedInScrapeBatch.findUnique>;
const mockBatchUpdate = prisma.linkedInScrapeBatch.update as jest.MockedFunction<typeof prisma.linkedInScrapeBatch.update>;
const mockLeadCreate = prisma.lead.create as jest.MockedFunction<typeof prisma.lead.create>;
const mockSubFindUnique = prisma.subscription.findUnique as jest.MockedFunction<typeof prisma.subscription.findUnique>;
const mockUserFindUnique = prisma.user.findUnique as jest.MockedFunction<typeof prisma.user.findUnique>;

process.env.JWT_SECRET = 'test-secret-key-for-b003';
process.env.PHANTOMBUSTER_AGENT_ID = 'agent-123';

const clientToken = `Bearer ${signToken({ sub: 'user-001', role: 'client' })}`;

const ACTIVE_SUB = {
  id: 'sub-001', clientId: 'user-001', stripeCustomerId: 'cus_001',
  stripeSubscriptionId: 'sub_001', planName: 'Growth' as const,
  status: 'active' as const, currentPeriodStart: new Date(),
  currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
  leadsUsedThisPeriod: 0, trialEndDate: null,
};

const BATCH = {
  id: 'b-001', batchId: 'batch-uuid', filtersUsed: {},
  numberOfLeads: 0, averageFitScore: null,
  status: 'Running', dateRun: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSubFindUnique.mockResolvedValue(ACTIVE_SUB as never);
  mockUserFindUnique.mockResolvedValue({ customLeadCapOverride: null } as never);
  mockBatchCreate.mockResolvedValue(BATCH as never);
  mockBatchUpdate.mockResolvedValue(BATCH as never);
});

// ─── POST /api/linkedin/scrape ────────────────────────────────────────────────

describe('POST /api/linkedin/scrape', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/linkedin/scrape').send({});
    expect(res.status).toBe(401);
  });

  it('returns 400 when filters are missing', async () => {
    const res = await request(app)
      .post('/api/linkedin/scrape')
      .set('Authorization', clientToken)
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 202 and creates a batch record on success', async () => {
    mockLaunchScrape.mockResolvedValue({ containerId: 'c-001', status: 'running' });

    const res = await request(app)
      .post('/api/linkedin/scrape')
      .set('Authorization', clientToken)
      .send({ filters: { keywords: 'CEO', location: 'London' } });

    expect(res.status).toBe(202);
    expect(res.body.batch).toBeDefined();
    expect(mockBatchCreate).toHaveBeenCalledTimes(1);
  });

  it('marks batch as Failed and returns 502 if Phantombuster launch fails', async () => {
    mockLaunchScrape.mockRejectedValue(new Error('API error'));

    const res = await request(app)
      .post('/api/linkedin/scrape')
      .set('Authorization', clientToken)
      .send({ filters: { keywords: 'CEO' } });

    expect(res.status).toBe(502);
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'Failed' } })
    );
  });
});

// ─── GET /api/linkedin/batches ────────────────────────────────────────────────

describe('GET /api/linkedin/batches', () => {
  it('returns the list of scrape batches', async () => {
    mockBatchFindMany.mockResolvedValue([BATCH] as never);

    const res = await request(app)
      .get('/api/linkedin/batches')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.batches).toHaveLength(1);
  });
});

// ─── GET /api/linkedin/batches/:batchId ──────────────────────────────────────

describe('GET /api/linkedin/batches/:batchId', () => {
  it('returns 404 for unknown batch', async () => {
    mockBatchFindUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/linkedin/batches/unknown')
      .set('Authorization', clientToken);

    expect(res.status).toBe(404);
  });

  it('returns the batch', async () => {
    mockBatchFindUnique.mockResolvedValue(BATCH as never);

    const res = await request(app)
      .get('/api/linkedin/batches/batch-uuid')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.batch.batchId).toBe('batch-uuid');
  });
});

// ─── POST /api/linkedin/batches/:batchId/process ──────────────────────────────

describe('POST /api/linkedin/batches/:batchId/process', () => {
  const PROFILES = [
    { linkedinUrl: 'https://linkedin.com/in/jane', fullName: 'Jane Smith', jobTitle: 'CEO', company: 'ACME' },
    { linkedinUrl: 'https://linkedin.com/in/bob', fullName: 'Bob Jones', jobTitle: 'CTO', company: 'Beta Inc' },
  ];

  beforeEach(() => {
    mockBatchFindUnique.mockResolvedValue(BATCH as never);
    mockFetchResults.mockResolvedValue(PROFILES);
    mockLeadCreate.mockResolvedValue({ id: 'lead-001' } as never);
    (prisma.lead.findFirst as jest.Mock).mockResolvedValue(null);
  });

  it('creates lead records for each scraped profile', async () => {
    const res = await request(app)
      .post('/api/linkedin/batches/batch-uuid/process')
      .set('Authorization', clientToken)
      .send({ containerId: 'c-001' });

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(2);
    expect(res.body.total).toBe(2);
  });

  it('skips duplicate LinkedIn URLs', async () => {
    (prisma.lead.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'existing' });

    const res = await request(app)
      .post('/api/linkedin/batches/batch-uuid/process')
      .set('Authorization', clientToken)
      .send({ containerId: 'c-001' });

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.skipped).toBe(1);
  });

  it('marks batch as Complete on success', async () => {
    await request(app)
      .post('/api/linkedin/batches/batch-uuid/process')
      .set('Authorization', clientToken)
      .send({ containerId: 'c-001' });

    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'Complete' }) })
    );
  });

  it('marks batch as Failed when fetchScrapeResults throws', async () => {
    mockFetchResults.mockRejectedValue(new Error('Network error'));

    const res = await request(app)
      .post('/api/linkedin/batches/batch-uuid/process')
      .set('Authorization', clientToken)
      .send({ containerId: 'c-001' });

    expect(res.status).toBe(502);
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'Failed' } })
    );
  });
});
