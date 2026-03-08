/**
 * B-008 Instantly email integration tests
 * Covers: each webhook event type → Message + OutreachActivity, DNC on unsubscribe,
 * reply → Responded stage, idempotency, enrolment endpoint (happy path + guards).
 */
import request from 'supertest';
import app from '../src/app';
import { signToken } from '../src/lib/auth';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    lead: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    message: { create: jest.fn().mockResolvedValue({}), findFirst: jest.fn() },
    outreachActivity: { create: jest.fn().mockResolvedValue({}) },
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

jest.mock('../src/lib/instantly', () => ({
  enrolLeadInInstantly: jest.fn(),
  getDomainWarmupStatus: jest.fn(),
}));

import { prisma } from '../src/lib/prisma';
import { enrolLeadInInstantly } from '../src/lib/instantly';

const mockLeadFindUnique = prisma.lead.findUnique as jest.MockedFunction<typeof prisma.lead.findUnique>;
const mockLeadFindFirst = prisma.lead.findFirst as jest.MockedFunction<typeof prisma.lead.findFirst>;
const mockLeadUpdate = prisma.lead.update as jest.MockedFunction<typeof prisma.lead.update>;
const mockMessageCreate = prisma.message.create as jest.MockedFunction<typeof prisma.message.create>;
const mockMessageFindFirst = prisma.message.findFirst as jest.MockedFunction<typeof prisma.message.findFirst>;
const mockActivityCreate = prisma.outreachActivity.create as jest.MockedFunction<typeof prisma.outreachActivity.create>;
const mockEnrolInstantly = enrolLeadInInstantly as jest.MockedFunction<typeof enrolLeadInInstantly>;

process.env.JWT_SECRET = 'test-secret-b008';
delete process.env.INSTANTLY_WEBHOOK_SECRET;

const clientToken = `Bearer ${signToken({ sub: 'user-001', role: 'client' })}`;

const BASE_LEAD = {
  id: 'lead-001',
  clientId: 'user-001',
  fullName: 'Jane Smith',
  emailAddress: 'jane@acme.com',
  company: 'ACME Ltd',
  enrichmentStage: 'ReadyForOutreach',
  dncFlag: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLeadFindUnique.mockResolvedValue(BASE_LEAD as never);
  mockLeadFindFirst.mockResolvedValue(BASE_LEAD as never);
  mockMessageFindFirst.mockResolvedValue(null);
  mockMessageCreate.mockResolvedValue({} as never);
  mockActivityCreate.mockResolvedValue({} as never);
  mockLeadUpdate.mockResolvedValue({} as never);
});

const WEBHOOK = (body: object) =>
  request(app).post('/api/instantly/webhook').send(body);

// ─── Webhook events ───────────────────────────────────────────────────────────

describe('POST /api/instantly/webhook', () => {
  it('creates Message and Activity for email_sent', async () => {
    const res = await WEBHOOK({
      event_type: 'email_sent',
      lead_id: 'lead-001',
      external_id: 'ext-001',
      subject: 'Quick question',
      body_preview: 'Hi Jane...',
    });

    expect(res.status).toBe(200);
    expect(mockMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channel: 'email',
          tool: 'Instantly',
          messageType: 'email',
          deliveryStatus: 'sent',
          subject: 'Quick question',
        }),
      })
    );
    expect(mockActivityCreate).toHaveBeenCalled();
  });

  it('creates Message for email_replied and marks lead Responded', async () => {
    const res = await WEBHOOK({
      event_type: 'email_replied',
      lead_id: 'lead-001',
      external_id: 'ext-002',
      reply_body: 'Thanks, interested!',
    });

    expect(res.status).toBe(200);
    expect(mockMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ direction: 'inbound', deliveryStatus: 'replied' }),
      })
    );
    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outreachStage: 'Responded' }) })
    );
  });

  it('sets DNC flag and DoNotContact outcome on email_unsubscribed', async () => {
    const res = await WEBHOOK({
      event_type: 'email_unsubscribed',
      lead_id: 'lead-001',
      external_id: 'ext-003',
    });

    expect(res.status).toBe(200);
    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dncFlag: true, terminalOutcome: 'DoNotContact' }),
      })
    );
  });

  it('handles email_bounced', async () => {
    const res = await WEBHOOK({
      event_type: 'email_bounced',
      lead_id: 'lead-001',
      external_id: 'ext-004',
    });

    expect(res.status).toBe(200);
    expect(mockMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deliveryStatus: 'bounced' }) })
    );
  });

  it('skips duplicate events by externalId', async () => {
    mockMessageFindFirst.mockResolvedValue({ id: 'existing' } as never);

    const res = await WEBHOOK({ event_type: 'email_sent', lead_id: 'lead-001', external_id: 'dup-id' });

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    expect(mockMessageCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when event_type or lead_id is missing', async () => {
    const res = await WEBHOOK({ event_type: 'email_sent' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown lead', async () => {
    mockLeadFindUnique.mockResolvedValue(null);
    const res = await WEBHOOK({ event_type: 'email_sent', lead_id: 'bad-id' });
    expect(res.status).toBe(404);
  });
});

// ─── Enrolment endpoint ───────────────────────────────────────────────────────

describe('POST /api/email/enrol', () => {
  it('enrols a ReadyForOutreach lead and returns 200', async () => {
    mockEnrolInstantly.mockResolvedValue({ success: true, leadId: 'inst-001' });

    const res = await request(app)
      .post('/api/email/enrol')
      .set('Authorization', clientToken)
      .send({ leadId: 'lead-001', instantlyCampaignId: 'camp-123' });

    expect(res.status).toBe(200);
    expect(res.body.instantlyLeadId).toBe('inst-001');
  });

  it('returns 422 when lead is not ReadyForOutreach', async () => {
    mockLeadFindFirst.mockResolvedValue({ ...BASE_LEAD, enrichmentStage: 'Discovered' } as never);

    const res = await request(app)
      .post('/api/email/enrol')
      .set('Authorization', clientToken)
      .send({ leadId: 'lead-001', instantlyCampaignId: 'camp-123' });

    expect(res.status).toBe(422);
  });

  it('returns 422 when lead has DNC flag', async () => {
    mockLeadFindFirst.mockResolvedValue({ ...BASE_LEAD, dncFlag: true } as never);

    const res = await request(app)
      .post('/api/email/enrol')
      .set('Authorization', clientToken)
      .send({ leadId: 'lead-001', instantlyCampaignId: 'camp-123' });

    expect(res.status).toBe(422);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/email/enrol')
      .set('Authorization', clientToken)
      .send({ leadId: 'lead-001' }); // missing instantlyCampaignId

    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/email/enrol')
      .send({ leadId: 'lead-001', instantlyCampaignId: 'camp-123' });

    expect(res.status).toBe(401);
  });

  it('returns 502 when Instantly API fails', async () => {
    mockEnrolInstantly.mockResolvedValue({ success: false, error: 'API error' });

    const res = await request(app)
      .post('/api/email/enrol')
      .set('Authorization', clientToken)
      .send({ leadId: 'lead-001', instantlyCampaignId: 'camp-123' });

    expect(res.status).toBe(502);
  });
});
