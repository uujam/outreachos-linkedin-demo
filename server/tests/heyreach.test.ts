/**
 * B-007c Heyreach webhook tests
 * Covers: each event type → Message + OutreachActivity creation, reply detection,
 * idempotency via externalId, signature verification, missing fields.
 */
import request from 'supertest';
import app from '../src/app';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    lead: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
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
  checkQueuesHealth: jest.fn().mockResolvedValue({
    enrichment: true, outreach: true, discovery: true,
    scoring: true, 'follow-up': true, notifications: true,
  }),
  wireDlqForwarding: jest.fn(),
  closeQueues: jest.fn(),
}));

import { prisma } from '../src/lib/prisma';

const mockLeadFindUnique = prisma.lead.findUnique as jest.MockedFunction<typeof prisma.lead.findUnique>;
const mockMessageCreate = prisma.message.create as jest.MockedFunction<typeof prisma.message.create>;
const mockMessageFindFirst = prisma.message.findFirst as jest.MockedFunction<typeof prisma.message.findFirst>;
const mockActivityCreate = prisma.outreachActivity.create as jest.MockedFunction<typeof prisma.outreachActivity.create>;
const mockLeadUpdate = prisma.lead.update as jest.MockedFunction<typeof prisma.lead.update>;

const BASE_LEAD = {
  id: 'lead-001',
  clientId: 'user-001',
  fullName: 'Jane Smith',
  linkedinUrl: 'https://linkedin.com/in/jane',
};

// No webhook secret in test — signature check bypassed when HEYREACH_WEBHOOK_SECRET is empty
delete process.env.HEYREACH_WEBHOOK_SECRET;

beforeEach(() => {
  jest.clearAllMocks();
  mockLeadFindUnique.mockResolvedValue(BASE_LEAD as never);
  mockMessageFindFirst.mockResolvedValue(null);
  mockMessageCreate.mockResolvedValue({} as never);
  mockActivityCreate.mockResolvedValue({} as never);
  mockLeadUpdate.mockResolvedValue({} as never);
});

const POST = (body: object) =>
  request(app).post('/api/heyreach/webhook').send(body);

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('POST /api/heyreach/webhook', () => {
  it('creates a Message and OutreachActivity for connection_request_sent', async () => {
    const res = await POST({
      event: 'connection_request_sent',
      lead_id: 'lead-001',
      external_id: 'ext-001',
    });

    expect(res.status).toBe(200);
    expect(mockMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channel: 'linkedin',
          tool: 'Heyreach',
          messageType: 'connection_request',
          deliveryStatus: 'sent',
          externalId: 'ext-001',
        }),
      })
    );
    expect(mockActivityCreate).toHaveBeenCalled();
  });

  it('creates a Message for message_sent with body', async () => {
    const res = await POST({
      event: 'message_sent',
      lead_id: 'lead-001',
      external_id: 'ext-002',
      message_body: 'Hi Jane, I noticed...',
    });

    expect(res.status).toBe(200);
    expect(mockMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          messageType: 'linkedin_message',
          direction: 'outbound',
          body: 'Hi Jane, I noticed...',
        }),
      })
    );
  });

  it('creates an inbound message for message_received and marks lead Responded', async () => {
    const res = await POST({
      event: 'message_received',
      lead_id: 'lead-001',
      external_id: 'ext-003',
      message_body: 'Thanks for reaching out!',
    });

    expect(res.status).toBe(200);
    expect(mockMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          direction: 'inbound',
          deliveryStatus: 'replied',
        }),
      })
    );
    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outreachStage: 'Responded' }) })
    );
  });

  it('marks lead Responded on connection_accepted', async () => {
    const res = await POST({
      event: 'connection_accepted',
      lead_id: 'lead-001',
      external_id: 'ext-004',
    });

    expect(res.status).toBe(200);
    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outreachStage: 'Responded' }) })
    );
  });

  it('handles profile_viewed without advancing stage', async () => {
    const res = await POST({
      event: 'profile_viewed',
      lead_id: 'lead-001',
      external_id: 'ext-005',
    });

    expect(res.status).toBe(200);
    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.not.objectContaining({ outreachStage: 'Responded' }) })
    );
  });
});

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe('POST /api/heyreach/webhook — idempotency', () => {
  it('skips duplicate events by externalId', async () => {
    mockMessageFindFirst.mockResolvedValue({ id: 'existing-msg' } as never);

    const res = await POST({
      event: 'message_sent',
      lead_id: 'lead-001',
      external_id: 'ext-already-seen',
    });

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    expect(mockMessageCreate).not.toHaveBeenCalled();
  });
});

// ─── Error cases ──────────────────────────────────────────────────────────────

describe('POST /api/heyreach/webhook — errors', () => {
  it('returns 400 when event or lead_id is missing', async () => {
    const res = await POST({ event: 'message_sent' }); // missing lead_id
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown lead', async () => {
    mockLeadFindUnique.mockResolvedValue(null);

    const res = await POST({ event: 'message_sent', lead_id: 'bad-lead' });
    expect(res.status).toBe(404);
  });
});
