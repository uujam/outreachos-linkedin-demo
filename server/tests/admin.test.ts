/**
 * B-013 — Admin panel tests (F-013, S-013)
 * Covers: client list, single client, API costs, Clay queue,
 * Heyreach health, Instantly domains, BullMQ queue health,
 * admin-only access enforcement (403 for client role).
 */
import request from 'supertest';
import app from '../src/app';
import { signToken } from '../src/lib/auth';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetWaitingCount = jest.fn().mockResolvedValue(5);
const mockGetActiveCount = jest.fn().mockResolvedValue(2);
const mockGetFailedCount = jest.fn().mockResolvedValue(1);

const mockQueue = {
  add: jest.fn(),
  getJob: jest.fn().mockResolvedValue(null),
  getWaitingCount: mockGetWaitingCount,
  getActiveCount: mockGetActiveCount,
  getFailedCount: mockGetFailedCount,
  removeRepeatable: jest.fn(),
};

jest.mock('../src/queues', () => ({
  QUEUE_NAMES: ['enrichment', 'outreach', 'discovery', 'scoring', 'follow-up', 'notifications'],
  getQueues: jest.fn(() => ({
    enrichment: mockQueue,
    outreach: mockQueue,
    discovery: mockQueue,
    scoring: mockQueue,
    'follow-up': mockQueue,
    notifications: mockQueue,
  })),
  getDlqs: jest.fn(() => ({
    enrichment: mockQueue,
    outreach: mockQueue,
    discovery: mockQueue,
    scoring: mockQueue,
    'follow-up': mockQueue,
    notifications: mockQueue,
  })),
  checkQueuesHealth: jest.fn().mockResolvedValue({}),
  wireDlqForwarding: jest.fn(),
  closeQueues: jest.fn(),
}));

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    lead: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({}),
    },
    subscription: { findUnique: jest.fn().mockResolvedValue(null) },
    apiUsageLog: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn(),
  },
  checkDatabaseHealth: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/lib/redis', () => ({
  getRedisClient: jest.fn(),
  checkRedisHealth: jest.fn().mockResolvedValue(true),
  closeRedis: jest.fn(),
}));

jest.mock('../src/lib/heyreach', () => ({
  enrolLeadInHeyreach: jest.fn().mockResolvedValue({ success: true }),
  getLinkedInAccountStatus: jest.fn().mockResolvedValue([
    { accountId: 'acc-001', status: 'active', dailyActions: 45, dailyLimit: 100 },
  ]),
}));

jest.mock('../src/lib/instantly', () => ({
  enrolLeadInInstantly: jest.fn().mockResolvedValue({ success: true }),
  getDomainWarmupStatus: jest.fn().mockResolvedValue({ status: 'Active', dailySendLimit: 50 }),
}));

jest.mock('../src/lib/leadCap', () => ({
  checkLeadCap: jest.fn().mockResolvedValue({ allowed: true, used: 0, cap: 100 }),
  incrementLeadCount: jest.fn(),
  resetLeadCap: jest.fn(),
}));

jest.mock('../src/orchestration/channel-sequencer', () => ({
  cancelPendingOutreachJobs: jest.fn().mockResolvedValue(undefined),
  scheduleChannelSteps: jest.fn().mockResolvedValue(undefined),
}));

import { prisma } from '../src/lib/prisma';

const mockUserFindMany = prisma.user.findMany as jest.MockedFunction<typeof prisma.user.findMany>;
const mockUserFindUnique = prisma.user.findUnique as jest.MockedFunction<typeof prisma.user.findUnique>;
const mockApiUsageFindMany = prisma.apiUsageLog.findMany as jest.MockedFunction<typeof prisma.apiUsageLog.findMany>;
const mockLeadFindMany = prisma.lead.findMany as jest.MockedFunction<typeof prisma.lead.findMany>;

process.env.JWT_SECRET = 'test-secret-b013';
const adminToken = `Bearer ${signToken({ sub: 'admin-001', role: 'admin' })}`;
const clientToken = `Bearer ${signToken({ sub: 'user-001', role: 'client' })}`;

const CLIENT_USER = {
  id: 'user-001',
  name: 'Jane Smith',
  email: 'jane@acme.com',
  role: 'client',
  companyName: 'ACME',
  createdDate: new Date(),
  lastLogin: null,
  customLeadCapOverride: null,
  _count: { leads: 42 },
  subscriptions: [{ planName: 'Growth', status: 'active', leadsUsedThisPeriod: 10 }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUserFindMany.mockResolvedValue([CLIENT_USER] as never);
  mockUserFindUnique.mockResolvedValue({ ...CLIENT_USER, subscriptions: [] } as never);
});

// ─── Admin-only access control ────────────────────────────────────────────────

describe('Admin access control', () => {
  it('returns 403 for client role on all admin endpoints', async () => {
    const endpoints = [
      ['GET', '/api/admin/clients'],
      ['GET', '/api/admin/clay-queue'],
      ['GET', '/api/admin/heyreach/health'],
      ['GET', '/api/admin/queues'],
    ];

    for (const [method, path] of endpoints) {
      const res = await (method === 'GET'
        ? request(app).get(path).set('Authorization', clientToken)
        : request(app).post(path).set('Authorization', clientToken));
      expect(res.status).toBe(403);
    }
  });

  it('returns 401 without any auth token', async () => {
    const res = await request(app).get('/api/admin/clients');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/admin/clients ───────────────────────────────────────────────────

describe('GET /api/admin/clients', () => {
  it('returns list of all clients with stats', async () => {
    const res = await request(app)
      .get('/api/admin/clients')
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.clients).toHaveLength(1);
    expect(res.body.clients[0].id).toBe('user-001');
    expect(res.body.clients[0].subscriptions).toBeDefined();
  });
});

// ─── GET /api/admin/clients/:id ───────────────────────────────────────────────

describe('GET /api/admin/clients/:id', () => {
  it('returns single client profile', async () => {
    const res = await request(app)
      .get('/api/admin/clients/user-001')
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.client.id).toBe('user-001');
  });

  it('returns 404 when client not found', async () => {
    mockUserFindUnique.mockResolvedValue(null as never);

    const res = await request(app)
      .get('/api/admin/clients/nonexistent')
      .set('Authorization', adminToken);

    expect(res.status).toBe(404);
  });
});

// ─── GET /api/admin/clients/:id/api-costs ─────────────────────────────────────

describe('GET /api/admin/clients/:id/api-costs', () => {
  it('returns cost breakdown with margin calculation', async () => {
    mockApiUsageFindMany.mockResolvedValue([
      { serviceName: 'ProxyCurl', unitCount: 10, approximateUnitCost: 1000, billingPeriod: '2026-03', timestamp: new Date() },
      { serviceName: 'ApolloIo', unitCount: 5, approximateUnitCost: 500, billingPeriod: '2026-03', timestamp: new Date() },
    ] as never);
    (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({ planName: 'Growth', status: 'active' });

    const res = await request(app)
      .get('/api/admin/clients/user-001/api-costs')
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.totalCostPence).toBe(1500);
    expect(res.body.monthlyRevenuePence).toBe(299_700);
    expect(res.body.isProfitable).toBe(true);
    expect(res.body.byCostService.ProxyCurl.units).toBe(10);
    expect(res.body.byCostService.ApolloIo.cost).toBe(500);
  });

  it('flags unprofitable accounts correctly', async () => {
    mockApiUsageFindMany.mockResolvedValue(
      Array.from({ length: 100 }, () => ({
        serviceName: 'VAPI',
        unitCount: 100,
        approximateUnitCost: 10_000,
        billingPeriod: '2026-03',
        timestamp: new Date(),
      })) as never
    );
    (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({ planName: 'Starter', status: 'active' });

    const res = await request(app)
      .get('/api/admin/clients/user-001/api-costs')
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.isProfitable).toBe(false);
  });
});

// ─── GET /api/admin/clay-queue ────────────────────────────────────────────────

describe('GET /api/admin/clay-queue', () => {
  it('returns leads pending Clay grouped by client', async () => {
    mockLeadFindMany.mockResolvedValue([
      {
        id: 'lead-001', fullName: 'Bob Jones', company: 'Globex',
        enrichmentStage: 'Enriched', createdDate: new Date(),
        clientId: 'user-001',
        client: { name: 'Jane', companyName: 'ACME' },
      },
    ] as never);

    const res = await request(app)
      .get('/api/admin/clay-queue')
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.totalPendingClay).toBe(1);
    expect(res.body.byClient['user-001'].leads).toHaveLength(1);
  });

  it('returns empty result when no leads pending Clay', async () => {
    mockLeadFindMany.mockResolvedValue([] as never);

    const res = await request(app)
      .get('/api/admin/clay-queue')
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.totalPendingClay).toBe(0);
  });
});

// ─── GET /api/admin/heyreach/health ───────────────────────────────────────────

describe('GET /api/admin/heyreach/health', () => {
  it('returns LinkedIn account statuses', async () => {
    const res = await request(app)
      .get('/api/admin/heyreach/health')
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.accounts).toHaveLength(1);
    expect(res.body.accounts[0].status).toBe('active');
    expect(res.body.accounts[0].dailyActions).toBe(45);
  });
});

// ─── GET /api/admin/instantly/domains ────────────────────────────────────────

describe('GET /api/admin/instantly/domains', () => {
  it('returns warmup status for a given email domain', async () => {
    const res = await request(app)
      .get('/api/admin/instantly/domains?email=sender@acme.com')
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.warmup.status).toBe('Active');
    expect(res.body.warmup.dailySendLimit).toBe(50);
  });

  it('returns 400 when email param is missing', async () => {
    const res = await request(app)
      .get('/api/admin/instantly/domains')
      .set('Authorization', adminToken);

    expect(res.status).toBe(400);
  });
});

// ─── GET /api/admin/queues ────────────────────────────────────────────────────

describe('GET /api/admin/queues', () => {
  it('returns depth and failure counts for all 6 queues', async () => {
    const res = await request(app)
      .get('/api/admin/queues')
      .set('Authorization', adminToken);

    expect(res.status).toBe(200);
    expect(res.body.queues).toHaveLength(6);
    expect(res.body.queues[0].waiting).toBe(5);
    expect(res.body.queues[0].active).toBe(2);
    expect(res.body.queues[0].failed).toBe(1);
    expect(res.body.queues[0].dlqDepth).toBe(5); // same mock
  });
});
