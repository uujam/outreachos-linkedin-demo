/**
 * B-015a — Onboarding checklist tests (F-030).
 * Covers: GET /onboarding (all combinations), POST /onboarding/dismiss, auth.
 */
import request from 'supertest';
import app from '../src/app';
import { signToken } from '../src/lib/auth';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/queues', () => ({
  QUEUE_NAMES: ['enrichment', 'outreach', 'discovery', 'scoring', 'follow-up', 'notifications'],
  getQueues: jest.fn(() => ({
    enrichment: { add: jest.fn() },
    outreach: { add: jest.fn(), getJob: jest.fn().mockResolvedValue(null) },
    discovery: { add: jest.fn(), removeRepeatable: jest.fn() },
    scoring: { add: jest.fn() },
    'follow-up': { add: jest.fn() },
    notifications: { add: jest.fn() },
  })),
  getDlqs: jest.fn(),
  checkQueuesHealth: jest.fn().mockResolvedValue({}),
  wireDlqForwarding: jest.fn(),
  closeQueues: jest.fn(),
}));

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    lead: { count: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    icpSettings: { findUnique: jest.fn() },
    integrationConnection: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn(),
  },
  checkDatabaseHealth: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/lib/redis', () => ({
  getRedisClient: jest.fn(),
  checkRedisHealth: jest.fn().mockResolvedValue(true),
  closeRedis: jest.fn(),
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

const mockUserFindUnique = prisma.user.findUnique as jest.MockedFunction<typeof prisma.user.findUnique>;
const mockUserUpdate = prisma.user.update as jest.MockedFunction<typeof prisma.user.update>;
const mockIcpFindUnique = prisma.icpSettings.findUnique as jest.MockedFunction<typeof prisma.icpSettings.findUnique>;
const mockIntegrationFindFirst = prisma.integrationConnection.findFirst as jest.MockedFunction<typeof prisma.integrationConnection.findFirst>;
const mockLeadCount = prisma.lead.count as jest.MockedFunction<typeof prisma.lead.count>;

process.env.JWT_SECRET = 'test-secret-b015a';
const clientToken = `Bearer ${signToken({ sub: 'user-001', role: 'client' })}`;

beforeEach(() => {
  jest.clearAllMocks();
  mockUserFindUnique.mockResolvedValue({ onboardingDismissed: false } as never);
  mockIcpFindUnique.mockResolvedValue(null as never);
  mockIntegrationFindFirst.mockResolvedValue(null as never);
  mockLeadCount.mockResolvedValue(0);
});

// ─── GET /api/onboarding ──────────────────────────────────────────────────────

describe('GET /api/onboarding', () => {
  it('returns 4 steps with account_created always true', async () => {
    const res = await request(app)
      .get('/api/onboarding')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.steps).toHaveLength(4);
    expect(res.body.steps[0].key).toBe('account_created');
    expect(res.body.steps[0].complete).toBe(true);
  });

  it('returns all steps incomplete except account_created when nothing done', async () => {
    const res = await request(app)
      .get('/api/onboarding')
      .set('Authorization', clientToken);

    expect(res.body.steps[1].complete).toBe(false); // icp_saved
    expect(res.body.steps[2].complete).toBe(false); // calendar_linked
    expect(res.body.steps[3].complete).toBe(false); // first_lead_added
    expect(res.body.allComplete).toBe(false);
  });

  it('marks icp_saved when IcpSettings exists', async () => {
    mockIcpFindUnique.mockResolvedValue({ id: 'icp-001' } as never);

    const res = await request(app)
      .get('/api/onboarding')
      .set('Authorization', clientToken);

    expect(res.body.steps[1].complete).toBe(true);
  });

  it('marks calendar_linked when active integration exists', async () => {
    mockIntegrationFindFirst.mockResolvedValue({ service: 'calendly' } as never);

    const res = await request(app)
      .get('/api/onboarding')
      .set('Authorization', clientToken);

    expect(res.body.steps[2].complete).toBe(true);
  });

  it('marks first_lead_added when lead count > 0', async () => {
    mockLeadCount.mockResolvedValue(3);

    const res = await request(app)
      .get('/api/onboarding')
      .set('Authorization', clientToken);

    expect(res.body.steps[3].complete).toBe(true);
  });

  it('sets allComplete when all 4 steps are done', async () => {
    mockIcpFindUnique.mockResolvedValue({ id: 'icp-001' } as never);
    mockIntegrationFindFirst.mockResolvedValue({ service: 'calendly' } as never);
    mockLeadCount.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/onboarding')
      .set('Authorization', clientToken);

    expect(res.body.allComplete).toBe(true);
  });

  it('includes dismissed flag from user record', async () => {
    mockUserFindUnique.mockResolvedValue({ onboardingDismissed: true } as never);

    const res = await request(app)
      .get('/api/onboarding')
      .set('Authorization', clientToken);

    expect(res.body.dismissed).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/onboarding');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/onboarding/dismiss ─────────────────────────────────────────────

describe('POST /api/onboarding/dismiss', () => {
  it('sets onboardingDismissed to true', async () => {
    const res = await request(app)
      .post('/api/onboarding/dismiss')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-001' },
        data: { onboardingDismissed: true },
      })
    );
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/onboarding/dismiss');
    expect(res.status).toBe(401);
  });
});
