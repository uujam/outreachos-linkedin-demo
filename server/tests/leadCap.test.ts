/**
 * B-018a — Lead cap enforcement tests (F-020).
 * Covers: checkLeadCap logic, incrementLeadCount, resetLeadCap,
 * cap enforcement in POST /api/leads, 80% warning notification,
 * and PATCH /api/admin/clients/:id/cap-override.
 */
import request from 'supertest';
import app from '../src/app';
import { signToken } from '../src/lib/auth';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockNotificationsAdd = jest.fn().mockResolvedValue({});

jest.mock('../src/queues', () => ({
  QUEUE_NAMES: ['enrichment', 'outreach', 'discovery', 'scoring', 'follow-up', 'notifications'],
  getQueues: jest.fn(() => ({
    enrichment: { add: jest.fn() },
    outreach: { add: jest.fn(), getJob: jest.fn().mockResolvedValue(null) },
    discovery: { add: jest.fn(), removeRepeatable: jest.fn() },
    scoring: { add: jest.fn() },
    'follow-up': { add: jest.fn() },
    notifications: { add: mockNotificationsAdd },
  })),
  getDlqs: jest.fn(() => ({})),
  checkQueuesHealth: jest.fn().mockResolvedValue({}),
  wireDlqForwarding: jest.fn(),
  closeQueues: jest.fn(),
}));

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    lead: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({}),
    },
    subscription: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
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

jest.mock('../src/orchestration/channel-sequencer', () => ({
  cancelPendingOutreachJobs: jest.fn().mockResolvedValue(undefined),
  scheduleChannelSteps: jest.fn().mockResolvedValue(undefined),
}));

import { prisma } from '../src/lib/prisma';
import { checkLeadCap, incrementLeadCount, resetLeadCap } from '../src/lib/leadCap';

const mockSubFindUnique = prisma.subscription.findUnique as jest.MockedFunction<typeof prisma.subscription.findUnique>;
const mockSubUpdate = prisma.subscription.update as jest.MockedFunction<typeof prisma.subscription.update>;
const mockUserFindUnique = prisma.user.findUnique as jest.MockedFunction<typeof prisma.user.findUnique>;
const mockLeadCreate = prisma.lead.create as jest.MockedFunction<typeof prisma.lead.create>;

process.env.JWT_SECRET = 'test-secret-b018a';
const clientToken = `Bearer ${signToken({ sub: 'user-001', role: 'client' })}`;
const adminToken = `Bearer ${signToken({ sub: 'admin-001', role: 'admin' })}`;

beforeEach(() => {
  jest.clearAllMocks();
  mockUserFindUnique.mockResolvedValue({ id: 'user-001', customLeadCapOverride: null } as never);
});

// ─── checkLeadCap unit tests ──────────────────────────────────────────────────

describe('checkLeadCap', () => {
  it('returns allowed=false when no subscription', async () => {
    mockSubFindUnique.mockResolvedValue(null as never);
    const status = await checkLeadCap('user-001');
    expect(status.allowed).toBe(false);
    expect(status.cap).toBe(0);
  });

  it('returns allowed=true when under cap', async () => {
    mockSubFindUnique.mockResolvedValue({ planName: 'Starter', leadsUsedThisPeriod: 100 } as never);
    const status = await checkLeadCap('user-001');
    expect(status.allowed).toBe(true);
    expect(status.cap).toBe(500);
    expect(status.used).toBe(100);
    expect(status.percentUsed).toBe(20);
  });

  it('returns allowed=false when at cap', async () => {
    mockSubFindUnique.mockResolvedValue({ planName: 'Starter', leadsUsedThisPeriod: 500 } as never);
    const status = await checkLeadCap('user-001');
    expect(status.allowed).toBe(false);
  });

  it('returns allowed=true with null cap for Enterprise', async () => {
    mockSubFindUnique.mockResolvedValue({ planName: 'Enterprise', leadsUsedThisPeriod: 9999 } as never);
    const status = await checkLeadCap('user-001');
    expect(status.allowed).toBe(true);
    expect(status.cap).toBeNull();
    expect(status.percentUsed).toBeNull();
  });

  it('respects customLeadCapOverride', async () => {
    mockSubFindUnique.mockResolvedValue({ planName: 'Starter', leadsUsedThisPeriod: 60 } as never);
    mockUserFindUnique.mockResolvedValue({ customLeadCapOverride: 50 } as never);
    const status = await checkLeadCap('user-001');
    expect(status.cap).toBe(50);
    expect(status.allowed).toBe(false); // 60 >= 50
  });
});

// ─── incrementLeadCount / resetLeadCap unit tests ────────────────────────────

describe('incrementLeadCount', () => {
  it('calls subscription.update with increment', async () => {
    await incrementLeadCount('user-001');
    expect(mockSubUpdate).toHaveBeenCalledWith({
      where: { clientId: 'user-001' },
      data: { leadsUsedThisPeriod: { increment: 1 } },
    });
  });
});

describe('resetLeadCap', () => {
  it('calls subscription.update with 0', async () => {
    await resetLeadCap('user-001');
    expect(mockSubUpdate).toHaveBeenCalledWith({
      where: { clientId: 'user-001' },
      data: { leadsUsedThisPeriod: 0 },
    });
  });
});

// ─── POST /api/leads cap enforcement ─────────────────────────────────────────

describe('POST /api/leads — cap enforcement', () => {
  it('returns 402 when cap is reached', async () => {
    // Mock checkLeadCap via prisma (it calls subscription.findUnique)
    mockSubFindUnique.mockResolvedValue({ planName: 'Starter', leadsUsedThisPeriod: 500 } as never);

    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', clientToken)
      .send({ fullName: 'Test User', company: 'Acme' });

    expect(res.status).toBe(402);
    expect(res.body.error).toContain('cap');
  });

  it('queues 80% warning notification when cap usage crosses threshold', async () => {
    // First call (pre-create check): 79% used (395/500) — allowed
    // Second call (post-increment check): 80% used (400/500) — triggers warning
    mockSubFindUnique
      .mockResolvedValueOnce({ planName: 'Starter', leadsUsedThisPeriod: 399 } as never) // pre check
      .mockResolvedValueOnce({ planName: 'Starter', leadsUsedThisPeriod: 400 } as never); // post increment

    mockLeadCreate.mockResolvedValue({
      id: 'lead-new',
      clientId: 'user-001',
      fullName: 'Test User',
      company: 'Acme',
    } as never);

    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', clientToken)
      .send({ fullName: 'Test User', company: 'Acme' });

    expect(res.status).toBe(201);
    expect(mockNotificationsAdd).toHaveBeenCalledWith(
      'send-notification',
      expect.objectContaining({ eventType: 'cap_80_percent' }),
      expect.any(Object)
    );
  });
});

// ─── PATCH /api/admin/clients/:id/cap-override ───────────────────────────────

describe('PATCH /api/admin/clients/:id/cap-override', () => {
  beforeEach(() => {
    mockUserFindUnique.mockResolvedValue({ id: 'user-001', role: 'client' } as never);
  });

  it('sets a cap override for a client', async () => {
    const res = await request(app)
      .patch('/api/admin/clients/user-001/cap-override')
      .set('Authorization', adminToken)
      .send({ capOverride: 150 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.capOverride).toBe(150);
  });

  it('removes cap override when null is sent', async () => {
    const res = await request(app)
      .patch('/api/admin/clients/user-001/cap-override')
      .set('Authorization', adminToken)
      .send({ capOverride: null });

    expect(res.status).toBe(200);
    expect(res.body.capOverride).toBeNull();
  });

  it('returns 400 for negative cap value', async () => {
    const res = await request(app)
      .patch('/api/admin/clients/user-001/cap-override')
      .set('Authorization', adminToken)
      .send({ capOverride: -1 });

    expect(res.status).toBe(400);
  });

  it('returns 404 when client not found', async () => {
    mockUserFindUnique.mockResolvedValue(null as never);

    const res = await request(app)
      .patch('/api/admin/clients/nonexistent/cap-override')
      .set('Authorization', adminToken)
      .send({ capOverride: 100 });

    expect(res.status).toBe(404);
  });

  it('returns 403 for client role', async () => {
    const res = await request(app)
      .patch('/api/admin/clients/user-001/cap-override')
      .set('Authorization', clientToken)
      .send({ capOverride: 100 });

    expect(res.status).toBe(403);
  });
});
