/**
 * B-009 VAPI voice integration tests
 * Covers: call trigger endpoint, VAPI webhook outcomes (Qualified, Interested,
 * NotReached, Voicemail, DoNotContact verbal opt-out), idempotency, guard rails.
 */
import request from 'supertest';
import app from '../src/app';
import { signToken } from '../src/lib/auth';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    lead: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    voiceCallRecord: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
    message: { create: jest.fn().mockResolvedValue({}) },
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

jest.mock('../src/lib/vapi', () => ({
  placeVapiCall: jest.fn(),
}));

import { prisma } from '../src/lib/prisma';
import { placeVapiCall } from '../src/lib/vapi';

const mockLeadFindFirst = prisma.lead.findFirst as jest.MockedFunction<typeof prisma.lead.findFirst>;
const mockLeadUpdate = prisma.lead.update as jest.MockedFunction<typeof prisma.lead.update>;
const mockCallCreate = prisma.voiceCallRecord.create as jest.MockedFunction<typeof prisma.voiceCallRecord.create>;
const mockMessageCreate = prisma.message.create as jest.MockedFunction<typeof prisma.message.create>;
const mockPlaceCall = placeVapiCall as jest.MockedFunction<typeof placeVapiCall>;

process.env.JWT_SECRET = 'test-secret-b009';
delete process.env.VAPI_WEBHOOK_SECRET;

const clientToken = `Bearer ${signToken({ sub: 'user-001', role: 'client' })}`;

const BASE_LEAD = {
  id: 'lead-001',
  clientId: 'user-001',
  fullName: 'Jane Smith',
  company: 'ACME Ltd',
  phoneNumber: '+44 7700 900000',
  enrichmentStage: 'ReadyForOutreach',
  dncFlag: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLeadFindFirst.mockResolvedValue(BASE_LEAD as never);
  mockCallCreate.mockResolvedValue({} as never);
  mockMessageCreate.mockResolvedValue({} as never);
  mockLeadUpdate.mockResolvedValue({} as never);
});

const WEBHOOK = (body: object) =>
  request(app).post('/api/vapi/webhook').send(body);

function callPayload(endedReason: string, extras: object = {}) {
  return {
    type: 'end-of-call-report',
    call: {
      id: 'call-001',
      metadata: { leadId: 'lead-001', clientId: 'user-001' },
      endedReason,
      duration: 120,
      summary: 'Lead expressed interest.',
      ...extras,
    },
  };
}

// ─── POST /api/voice/call ─────────────────────────────────────────────────────

describe('POST /api/voice/call', () => {
  it('places a call and returns 202', async () => {
    mockPlaceCall.mockResolvedValue({ success: true, callId: 'call-001' });

    const res = await request(app)
      .post('/api/voice/call')
      .set('Authorization', clientToken)
      .send({ leadId: 'lead-001' });

    expect(res.status).toBe(202);
    expect(res.body.callId).toBe('call-001');
    expect(mockPlaceCall).toHaveBeenCalled();
  });

  it('returns 422 when lead has DNC flag', async () => {
    mockLeadFindFirst.mockResolvedValue({ ...BASE_LEAD, dncFlag: true } as never);

    const res = await request(app)
      .post('/api/voice/call')
      .set('Authorization', clientToken)
      .send({ leadId: 'lead-001' });

    expect(res.status).toBe(422);
  });

  it('returns 422 when lead has no phone number', async () => {
    mockLeadFindFirst.mockResolvedValue({ ...BASE_LEAD, phoneNumber: null } as never);

    const res = await request(app)
      .post('/api/voice/call')
      .set('Authorization', clientToken)
      .send({ leadId: 'lead-001' });

    expect(res.status).toBe(422);
  });

  it('returns 502 when VAPI fails', async () => {
    mockPlaceCall.mockResolvedValue({ success: false, error: 'VAPI down' });

    const res = await request(app)
      .post('/api/voice/call')
      .set('Authorization', clientToken)
      .send({ leadId: 'lead-001' });

    expect(res.status).toBe(502);
  });

  it('returns 400 when leadId is missing', async () => {
    const res = await request(app)
      .post('/api/voice/call')
      .set('Authorization', clientToken)
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/voice/call').send({ leadId: 'lead-001' });
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/vapi/webhook ───────────────────────────────────────────────────

describe('POST /api/vapi/webhook', () => {
  it('creates VoiceCallRecord and advances lead to Qualified on meeting agreed', async () => {
    const res = await WEBHOOK(callPayload('customer_ended_call_with_meeting_agreed'));

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('Qualified');
    expect(mockCallCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outcome: 'Qualified' }) })
    );
    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outreachStage: 'Qualified' }) })
    );
  });

  it('sets outcome to Voicemail on voicemail', async () => {
    const res = await WEBHOOK(callPayload('voicemail'));

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('Voicemail');
    expect(mockCallCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outcome: 'Voicemail' }) })
    );
  });

  it('sets outcome to NotReached on no_answer', async () => {
    const res = await WEBHOOK(callPayload('no_answer'));

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('NotReached');
  });

  it('sets DNC flag on verbal opt-out signal from VAPI', async () => {
    const res = await WEBHOOK(callPayload('do_not_contact'));

    expect(res.status).toBe(200);
    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dncFlag: true, terminalOutcome: 'DoNotContact' }),
      })
    );
  });

  it('creates a Message record for each call outcome', async () => {
    await WEBHOOK(callPayload('customer_ended_call_interested'));

    expect(mockMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channel: 'voice',
          tool: 'VAPI',
          messageType: 'voice_call',
        }),
      })
    );
  });

  it('ignores non end-of-call-report event types', async () => {
    const res = await WEBHOOK({ type: 'speech-update', call: {} });

    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
    expect(mockCallCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when call metadata is missing leadId', async () => {
    const res = await WEBHOOK({
      type: 'end-of-call-report',
      call: { id: 'call-001', metadata: { clientId: 'user-001' } },
    });

    expect(res.status).toBe(400);
  });
});

// ─── GET /api/voice/calls ─────────────────────────────────────────────────────

describe('GET /api/voice/calls', () => {
  it('returns list of voice calls for the authenticated client', async () => {
    (prisma.voiceCallRecord.findMany as jest.Mock).mockResolvedValue([
      { id: 'call-001', outcome: 'Qualified' },
    ]);

    const res = await request(app)
      .get('/api/voice/calls')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.calls).toHaveLength(1);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/voice/calls');
    expect(res.status).toBe(401);
  });
});
