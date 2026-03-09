/**
 * B-018 — Subscription enforcement middleware tests (F-017).
 * Tests the requireSubscription middleware in isolation using a test route.
 */
import request from 'supertest';
import express from 'express';
import { signToken } from '../src/lib/auth';
import { requireAuth } from '../src/middleware/requireAuth';
import { requireSubscription } from '../src/middleware/requireSubscription';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    subscription: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
  },
  checkDatabaseHealth: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/lib/redis', () => ({
  getRedisClient: jest.fn(),
  checkRedisHealth: jest.fn().mockResolvedValue(true),
  closeRedis: jest.fn(),
}));

import { prisma } from '../src/lib/prisma';

const mockSubFindUnique = prisma.subscription.findUnique as jest.MockedFunction<typeof prisma.subscription.findUnique>;

process.env.JWT_SECRET = 'test-secret-b018';
const clientToken = `Bearer ${signToken({ sub: 'user-001', role: 'client' })}`;
const adminToken = `Bearer ${signToken({ sub: 'admin-001', role: 'admin' })}`;

// Build a minimal test app with a protected route
const testApp = express();
testApp.use(express.json());
testApp.get('/protected', requireAuth, requireSubscription, (_req, res) => {
  res.status(200).json({ ok: true });
});

beforeEach(() => {
  jest.clearAllMocks();
});

function makeActiveSub(overrides: Partial<{ status: string; currentPeriodEnd: Date }> = {}) {
  return {
    status: 'active',
    currentPeriodEnd: new Date(Date.now() + 30 * 86400_000),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('requireSubscription middleware', () => {
  it('allows through when subscription is active', async () => {
    mockSubFindUnique.mockResolvedValue(makeActiveSub() as never);
    const res = await request(testApp).get('/protected').set('Authorization', clientToken);
    expect(res.status).toBe(200);
  });

  it('returns 402 when no subscription exists', async () => {
    mockSubFindUnique.mockResolvedValue(null as never);
    const res = await request(testApp).get('/protected').set('Authorization', clientToken);
    expect(res.status).toBe(402);
    expect(res.body.error).toBe('no_subscription');
  });

  it('returns 402 when subscription is cancelled', async () => {
    mockSubFindUnique.mockResolvedValue(makeActiveSub({ status: 'cancelled' }) as never);
    const res = await request(testApp).get('/protected').set('Authorization', clientToken);
    expect(res.status).toBe(402);
    expect(res.body.error).toBe('subscription_cancelled');
  });

  it('returns 402 when subscription is unpaid', async () => {
    mockSubFindUnique.mockResolvedValue(makeActiveSub({ status: 'unpaid' }) as never);
    const res = await request(testApp).get('/protected').set('Authorization', clientToken);
    expect(res.status).toBe(402);
    expect(res.body.error).toBe('subscription_cancelled');
  });

  it('allows through when past_due but within 7-day grace period', async () => {
    // currentPeriodEnd was 3 days ago — still within 7-day grace
    const periodEnd = new Date(Date.now() - 3 * 86400_000);
    mockSubFindUnique.mockResolvedValue(makeActiveSub({ status: 'past_due', currentPeriodEnd: periodEnd }) as never);
    const res = await request(testApp).get('/protected').set('Authorization', clientToken);
    expect(res.status).toBe(200);
  });

  it('returns 402 when past_due and grace period has expired', async () => {
    // currentPeriodEnd was 10 days ago — grace period (7 days) has passed
    const periodEnd = new Date(Date.now() - 10 * 86400_000);
    mockSubFindUnique.mockResolvedValue(makeActiveSub({ status: 'past_due', currentPeriodEnd: periodEnd }) as never);
    const res = await request(testApp).get('/protected').set('Authorization', clientToken);
    expect(res.status).toBe(402);
    expect(res.body.error).toBe('subscription_past_due');
  });

  it('admin users bypass subscription check', async () => {
    mockSubFindUnique.mockResolvedValue(null as never); // no sub for admin
    const res = await request(testApp).get('/protected').set('Authorization', adminToken);
    expect(res.status).toBe(200);
    expect(mockSubFindUnique).not.toHaveBeenCalled();
  });

  it('returns 401 without any auth token', async () => {
    const res = await request(testApp).get('/protected');
    expect(res.status).toBe(401);
  });
});
