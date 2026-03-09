/**
 * B-014/B-015/B-016/B-017 — Stripe checkout, webhook, billing portal tests.
 * Covers: POST /stripe/checkout, GET /stripe/portal,
 * POST /stripe/webhook (all 5 event types), auth enforcement.
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
  getDlqs: jest.fn(),
  checkQueuesHealth: jest.fn().mockResolvedValue({}),
  wireDlqForwarding: jest.fn(),
  closeQueues: jest.fn(),
}));

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    lead: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    subscription: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    invoice: {
      upsert: jest.fn().mockResolvedValue({}),
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

jest.mock('../src/lib/leadCap', () => ({
  checkLeadCap: jest.fn().mockResolvedValue({ allowed: true, used: 0, cap: 100 }),
  incrementLeadCount: jest.fn(),
  resetLeadCap: jest.fn(),
}));

jest.mock('../src/orchestration/channel-sequencer', () => ({
  cancelPendingOutreachJobs: jest.fn().mockResolvedValue(undefined),
  scheduleChannelSteps: jest.fn().mockResolvedValue(undefined),
}));

// Mock Stripe SDK
const mockCheckoutCreate = jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_test_123' });
const mockPortalCreate = jest.fn().mockResolvedValue({ url: 'https://billing.stripe.com/session/bps_123' });
const mockConstructEvent = jest.fn();

jest.mock('../src/lib/stripe', () => ({
  getStripe: jest.fn(() => ({
    checkout: { sessions: { create: mockCheckoutCreate } },
    billingPortal: { sessions: { create: mockPortalCreate } },
    webhooks: { constructEvent: mockConstructEvent },
  })),
  STRIPE_PRICES: { starter: 'price_starter_monthly', growth: 'price_growth_monthly' },
  STRIPE_PRICES_ANNUAL: { starter: 'price_starter_annual', growth: 'price_growth_annual' },
}));

import { prisma } from '../src/lib/prisma';

const mockSubFindUnique = prisma.subscription.findUnique as jest.MockedFunction<typeof prisma.subscription.findUnique>;
const mockSubFindFirst = prisma.subscription.findFirst as jest.MockedFunction<typeof prisma.subscription.findFirst>;
const mockSubUpsert = prisma.subscription.upsert as jest.MockedFunction<typeof prisma.subscription.upsert>;
const mockSubUpdateMany = prisma.subscription.updateMany as jest.MockedFunction<typeof prisma.subscription.updateMany>;
const mockInvoiceUpsert = prisma.invoice.upsert as jest.MockedFunction<typeof prisma.invoice.upsert>;
const mockUserFindUnique = prisma.user.findUnique as jest.MockedFunction<typeof prisma.user.findUnique>;

process.env.JWT_SECRET = 'test-secret-stripe';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const clientToken = `Bearer ${signToken({ sub: 'user-001', role: 'client' })}`;

beforeEach(() => {
  jest.clearAllMocks();
  mockUserFindUnique.mockResolvedValue({ id: 'user-001', email: 'jane@acme.com', name: 'Jane' } as never);
});

// ─── POST /api/stripe/checkout ────────────────────────────────────────────────

describe('POST /api/stripe/checkout', () => {
  it('creates a checkout session and returns redirect URL', async () => {
    const res = await request(app)
      .post('/api/stripe/checkout')
      .set('Authorization', clientToken)
      .send({ plan: 'starter', billing: 'monthly' });

    expect(res.status).toBe(200);
    expect(res.body.url).toContain('checkout.stripe.com');
    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        line_items: [{ price: 'price_starter_monthly', quantity: 1 }],
      })
    );
  });

  it('uses annual price when billing=annual', async () => {
    const res = await request(app)
      .post('/api/stripe/checkout')
      .set('Authorization', clientToken)
      .send({ plan: 'growth', billing: 'annual' });

    expect(res.status).toBe(200);
    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: 'price_growth_annual', quantity: 1 }],
      })
    );
  });

  it('returns 400 for unknown plan', async () => {
    const res = await request(app)
      .post('/api/stripe/checkout')
      .set('Authorization', clientToken)
      .send({ plan: 'enterprise' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when plan is missing', async () => {
    const res = await request(app)
      .post('/api/stripe/checkout')
      .set('Authorization', clientToken)
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/stripe/checkout')
      .send({ plan: 'starter' });

    expect(res.status).toBe(401);
  });
});

// ─── GET /api/stripe/portal ───────────────────────────────────────────────────

describe('GET /api/stripe/portal', () => {
  it('returns billing portal URL for subscribed client', async () => {
    mockSubFindUnique.mockResolvedValue({ stripeCustomerId: 'cus_123' } as never);

    const res = await request(app)
      .get('/api/stripe/portal')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.url).toContain('billing.stripe.com');
    expect(mockPortalCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_123' })
    );
  });

  it('returns 404 when no subscription exists', async () => {
    mockSubFindUnique.mockResolvedValue(null as never);

    const res = await request(app)
      .get('/api/stripe/portal')
      .set('Authorization', clientToken);

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/stripe/portal');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/stripe/webhook ─────────────────────────────────────────────────

function makeWebhookBody(event: object): Buffer {
  return Buffer.from(JSON.stringify(event));
}

describe('POST /api/stripe/webhook', () => {
  it('returns 400 when signature verification fails', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('Invalid signature');
    });

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'bad-sig')
      .send(makeWebhookBody({ type: 'checkout.session.completed' }));

    expect(res.status).toBe(400);
  });

  it('handles checkout.session.completed — upserts subscription', async () => {
    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cus_123',
          subscription: 'sub_123',
          metadata: { clientId: 'user-001', plan: 'starter', billing: 'monthly' },
        },
      },
    };
    mockConstructEvent.mockReturnValue(event);

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid')
      .send(makeWebhookBody(event));

    expect(res.status).toBe(200);
    expect(mockSubUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ planName: 'Starter', status: 'active' }),
        update: expect.objectContaining({ planName: 'Starter', status: 'active' }),
      })
    );
    expect(mockNotificationsAdd).toHaveBeenCalledWith(
      'send-notification',
      expect.objectContaining({ eventType: 'welcome' }),
      expect.any(Object)
    );
  });

  it('handles invoice.paid — resets lead count and logs invoice', async () => {
    mockSubFindFirst.mockResolvedValue({ id: 'sub-db-001', clientId: 'user-001' } as never);

    const event = {
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_001',
          customer: 'cus_123',
          amount_paid: 149700,
          currency: 'gbp',
          created: Math.floor(Date.now() / 1000),
          invoice_pdf: 'https://stripe.com/invoice.pdf',
        },
      },
    };
    mockConstructEvent.mockReturnValue(event);

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid')
      .send(makeWebhookBody(event));

    expect(res.status).toBe(200);
    expect(mockSubUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'active', leadsUsedThisPeriod: 0 }) })
    );
    expect(mockInvoiceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ amount: 149700, status: 'paid' }),
      })
    );
  });

  it('handles invoice.payment_failed — marks past_due and queues notification', async () => {
    mockSubFindFirst.mockResolvedValue({ clientId: 'user-001' } as never);

    const event = {
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_123', id: 'in_fail_001', amount_paid: 0, currency: 'gbp', created: 0 } },
    };
    mockConstructEvent.mockReturnValue(event);

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid')
      .send(makeWebhookBody(event));

    expect(res.status).toBe(200);
    expect(mockSubUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'past_due' }) })
    );
    expect(mockNotificationsAdd).toHaveBeenCalledWith(
      'send-notification',
      expect.objectContaining({ eventType: 'payment_failed' }),
      expect.any(Object)
    );
  });

  it('handles customer.subscription.updated — syncs status', async () => {
    const event = {
      type: 'customer.subscription.updated',
      data: { object: { customer: 'cus_123', status: 'past_due' } },
    };
    mockConstructEvent.mockReturnValue(event);

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid')
      .send(makeWebhookBody(event));

    expect(res.status).toBe(200);
    expect(mockSubUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'past_due' }) })
    );
  });

  it('handles customer.subscription.deleted — marks cancelled', async () => {
    const event = {
      type: 'customer.subscription.deleted',
      data: { object: { customer: 'cus_123', status: 'canceled' } },
    };
    mockConstructEvent.mockReturnValue(event);

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid')
      .send(makeWebhookBody(event));

    expect(res.status).toBe(200);
    expect(mockSubUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled' }) })
    );
  });

  it('returns 200 for unhandled event types', async () => {
    const event = { type: 'unknown.event', data: { object: {} } };
    mockConstructEvent.mockReturnValue(event);

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'valid')
      .send(makeWebhookBody(event));

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });
});
