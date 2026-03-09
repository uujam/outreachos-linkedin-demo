/**
 * B-011 — Meetings tracker tests
 * Covers: Calendly webhook, Cal.com webhook, manual entry,
 * GET /meetings, PATCH /meetings/:id, DELETE /meetings/:id.
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
    lead: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    meeting: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    bookingWebhookEvent: {
      create: jest.fn().mockResolvedValue({}),
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
  checkLeadCap: jest.fn().mockResolvedValue({ allowed: true, used: 5, cap: 100 }),
  incrementLeadCount: jest.fn().mockResolvedValue(undefined),
  resetLeadCap: jest.fn(),
}));

jest.mock('../src/orchestration/channel-sequencer', () => ({
  cancelPendingOutreachJobs: jest.fn().mockResolvedValue(undefined),
  scheduleChannelSteps: jest.fn().mockResolvedValue(undefined),
}));

import { prisma } from '../src/lib/prisma';

const mockLeadFindFirst = prisma.lead.findFirst as jest.MockedFunction<typeof prisma.lead.findFirst>;
const mockMeetingCreate = prisma.meeting.create as jest.MockedFunction<typeof prisma.meeting.create>;
const mockMeetingFindMany = prisma.meeting.findMany as jest.MockedFunction<typeof prisma.meeting.findMany>;
const mockMeetingFindFirst = prisma.meeting.findFirst as jest.MockedFunction<typeof prisma.meeting.findFirst>;
const mockMeetingUpdate = prisma.meeting.update as jest.MockedFunction<typeof prisma.meeting.update>;
const mockMeetingDelete = prisma.meeting.delete as jest.MockedFunction<typeof prisma.meeting.delete>;

process.env.JWT_SECRET = 'test-secret-b011';
const clientToken = `Bearer ${signToken({ sub: 'user-001', role: 'client' })}`;

const LEAD = {
  id: 'lead-001',
  clientId: 'user-001',
  fullName: 'Jane Smith',
  company: 'ACME',
  emailAddress: 'jane@acme.com',
};

const MEETING = {
  id: 'meeting-001',
  leadId: 'lead-001',
  meetingDate: new Date('2026-04-01T10:00:00Z'),
  duration: 30,
  channelBookedVia: 'Calendly',
  confirmationStatus: 'Confirmed',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLeadFindFirst.mockResolvedValue(LEAD as never);
  mockMeetingCreate.mockResolvedValue(MEETING as never);
  mockMeetingFindFirst.mockResolvedValue(MEETING as never);
  mockMeetingUpdate.mockResolvedValue({ ...MEETING, confirmationStatus: 'NoShow' } as never);
});

// ─── POST /api/booking/calendly ───────────────────────────────────────────────

describe('POST /api/booking/calendly', () => {
  it('creates a meeting and updates lead on invitee.created', async () => {
    const res = await request(app)
      .post('/api/booking/calendly')
      .send({
        event: 'invitee.created',
        payload: {
          invitee: { email: 'jane@acme.com' },
          event: { start_time: '2026-04-01T10:00:00Z', duration: 30 },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockMeetingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ channelBookedVia: 'Calendly', duration: 30 }),
      })
    );
    expect(mockNotificationsAdd).toHaveBeenCalledWith(
      'send-notification',
      expect.objectContaining({ eventType: 'meeting_booked' }),
      expect.any(Object)
    );
  });

  it('writes unmatched D-016 event when lead not found', async () => {
    mockLeadFindFirst.mockResolvedValue(null as never);

    const res = await request(app)
      .post('/api/booking/calendly')
      .send({
        event: 'invitee.created',
        payload: { invitee: { email: 'unknown@test.com' }, event: { start_time: '2026-04-01T10:00:00Z' } },
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockMeetingCreate).not.toHaveBeenCalled();
  });

  it('handles invitee.canceled and marks meeting as NoShow', async () => {
    const res = await request(app)
      .post('/api/booking/calendly')
      .send({
        event: 'invitee.canceled',
        payload: { invitee: { email: 'jane@acme.com' } },
      });

    expect(res.status).toBe(200);
    expect(mockMeetingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { confirmationStatus: 'NoShow' } })
    );
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/booking/calendly')
      .send({ event: 'invitee.created' }); // no payload/email

    expect(res.status).toBe(400);
  });
});

// ─── POST /api/booking/cal-com ────────────────────────────────────────────────

describe('POST /api/booking/cal-com', () => {
  it('creates a meeting on BOOKING_CREATED', async () => {
    const res = await request(app)
      .post('/api/booking/cal-com')
      .send({
        triggerEvent: 'BOOKING_CREATED',
        payload: {
          attendees: [{ email: 'jane@acme.com' }],
          startTime: '2026-04-01T10:00:00Z',
          duration: 45,
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockMeetingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ channelBookedVia: 'CalCom', duration: 45 }),
      })
    );
  });

  it('handles BOOKING_CANCELLED', async () => {
    const res = await request(app)
      .post('/api/booking/cal-com')
      .send({
        triggerEvent: 'BOOKING_CANCELLED',
        payload: { attendees: [{ email: 'jane@acme.com' }] },
      });

    expect(res.status).toBe(200);
  });

  it('handles BOOKING_RESCHEDULED and updates meeting date', async () => {
    const res = await request(app)
      .post('/api/booking/cal-com')
      .send({
        triggerEvent: 'BOOKING_RESCHEDULED',
        payload: {
          attendees: [{ email: 'jane@acme.com' }],
          rescheduleStartTime: '2026-04-08T10:00:00Z',
          duration: 30,
        },
      });

    expect(res.status).toBe(200);
    expect(mockMeetingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ meetingDate: new Date('2026-04-08T10:00:00Z') }),
      })
    );
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/booking/cal-com')
      .send({ triggerEvent: 'BOOKING_CREATED' }); // no attendees

    expect(res.status).toBe(400);
  });
});

// ─── POST /api/meetings — manual entry ───────────────────────────────────────

describe('POST /api/meetings', () => {
  it('creates a manual meeting for an authenticated client', async () => {
    const res = await request(app)
      .post('/api/meetings')
      .set('Authorization', clientToken)
      .send({ leadId: 'lead-001', meetingDate: '2026-04-01T10:00:00Z', duration: 60 });

    expect(res.status).toBe(201);
    expect(res.body.meeting.id).toBe('meeting-001');
    expect(mockMeetingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ channelBookedVia: 'Manual', duration: 60 }),
      })
    );
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/meetings')
      .set('Authorization', clientToken)
      .send({ leadId: 'lead-001' }); // no meetingDate

    expect(res.status).toBe(400);
  });

  it('returns 404 when lead not found', async () => {
    mockLeadFindFirst.mockResolvedValue(null as never);

    const res = await request(app)
      .post('/api/meetings')
      .set('Authorization', clientToken)
      .send({ leadId: 'nonexistent', meetingDate: '2026-04-01T10:00:00Z' });

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/meetings')
      .send({ leadId: 'lead-001', meetingDate: '2026-04-01T10:00:00Z' });
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/meetings ────────────────────────────────────────────────────────

describe('GET /api/meetings', () => {
  it('returns meetings list for authenticated client', async () => {
    mockMeetingFindMany.mockResolvedValue([
      { ...MEETING, lead: { fullName: 'Jane Smith', company: 'ACME', emailAddress: 'jane@acme.com', clientId: 'user-001' } },
    ] as never);

    const res = await request(app)
      .get('/api/meetings')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.meetings).toHaveLength(1);
    expect(res.body.pagination.total).toBe(0);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/meetings');
    expect(res.status).toBe(401);
  });
});

// ─── PATCH /api/meetings/:id ──────────────────────────────────────────────────

describe('PATCH /api/meetings/:id', () => {
  it('updates confirmation status to NoShow', async () => {
    const res = await request(app)
      .patch('/api/meetings/meeting-001')
      .set('Authorization', clientToken)
      .send({ confirmationStatus: 'NoShow' });

    expect(res.status).toBe(200);
    expect(res.body.meeting.confirmationStatus).toBe('NoShow');
  });

  it('returns 400 for invalid confirmationStatus', async () => {
    const res = await request(app)
      .patch('/api/meetings/meeting-001')
      .set('Authorization', clientToken)
      .send({ confirmationStatus: 'BadValue' });

    expect(res.status).toBe(400);
  });

  it('returns 404 when meeting not found', async () => {
    mockMeetingFindFirst.mockResolvedValue(null as never);

    const res = await request(app)
      .patch('/api/meetings/nonexistent')
      .set('Authorization', clientToken)
      .send({ confirmationStatus: 'Confirmed' });

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .patch('/api/meetings/meeting-001')
      .send({ confirmationStatus: 'NoShow' });
    expect(res.status).toBe(401);
  });
});

// ─── DELETE /api/meetings/:id ─────────────────────────────────────────────────

describe('DELETE /api/meetings/:id', () => {
  it('deletes a meeting and returns 204', async () => {
    const res = await request(app)
      .delete('/api/meetings/meeting-001')
      .set('Authorization', clientToken);

    expect(res.status).toBe(204);
    expect(mockMeetingDelete).toHaveBeenCalledWith({ where: { id: 'meeting-001' } });
  });

  it('returns 404 when meeting not found', async () => {
    mockMeetingFindFirst.mockResolvedValue(null as never);

    const res = await request(app)
      .delete('/api/meetings/nonexistent')
      .set('Authorization', clientToken);

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).delete('/api/meetings/meeting-001');
    expect(res.status).toBe(401);
  });
});
