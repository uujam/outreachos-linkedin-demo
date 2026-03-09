/**
 * B-010b — Notification system tests (F-028)
 * Covers: GET /notifications, GET /notifications/unread-count,
 * POST /notifications/:id/read, POST /notifications/read-all,
 * queueNotification utility, and heyreach/instantly reply notification triggers.
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
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn(),
    },
    message: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    outreachActivity: { create: jest.fn().mockResolvedValue({}) },
    notification: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 3 }),
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

jest.mock('../src/lib/leadCap', () => ({
  checkLeadCap: jest.fn().mockResolvedValue({ allowed: true, used: 5, cap: 100 }),
  incrementLeadCount: jest.fn().mockResolvedValue(undefined),
  resetLeadCap: jest.fn(),
}));

import { prisma } from '../src/lib/prisma';

const mockNotificationFindMany = prisma.notification.findMany as jest.MockedFunction<typeof prisma.notification.findMany>;
const mockNotificationFindFirst = prisma.notification.findFirst as jest.MockedFunction<typeof prisma.notification.findFirst>;
const mockNotificationCount = prisma.notification.count as jest.MockedFunction<typeof prisma.notification.count>;
const mockNotificationUpdate = prisma.notification.update as jest.MockedFunction<typeof prisma.notification.update>;
const mockNotificationUpdateMany = prisma.notification.updateMany as jest.MockedFunction<typeof prisma.notification.updateMany>;
const mockLeadFindUnique = prisma.lead.findUnique as jest.MockedFunction<typeof prisma.lead.findUnique>;

process.env.JWT_SECRET = 'test-secret-b010b';
const clientToken = `Bearer ${signToken({ sub: 'user-001', role: 'client' })}`;

const NOTIFICATION = {
  id: 'notif-001',
  clientId: 'user-001',
  eventType: 'lead_replied',
  title: 'Lead replied',
  body: 'Jane Smith replied.',
  linkUrl: '/leads/lead-001',
  readAt: null,
  createdAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockNotificationFindMany.mockResolvedValue([NOTIFICATION] as never);
  mockNotificationCount.mockResolvedValue(3);
  mockNotificationFindFirst.mockResolvedValue(NOTIFICATION as never);
  mockNotificationUpdate.mockResolvedValue({ ...NOTIFICATION, readAt: new Date() } as never);
});

// ─── GET /api/notifications ───────────────────────────────────────────────────

describe('GET /api/notifications', () => {
  it('returns paginated notifications for the authenticated client', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.notifications[0].id).toBe('notif-001');
    expect(res.body.total).toBe(3);
  });

  it('supports limit and offset query params', async () => {
    mockNotificationFindMany.mockResolvedValue([] as never);
    mockNotificationCount.mockResolvedValue(10);

    const res = await request(app)
      .get('/api/notifications?limit=5&offset=5')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(mockNotificationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5, skip: 5 })
    );
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/notifications/unread-count ─────────────────────────────────────

describe('GET /api/notifications/unread-count', () => {
  it('returns unread notification count', async () => {
    mockNotificationCount.mockResolvedValue(5);

    const res = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(5);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/notifications/unread-count');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/notifications/read-all ────────────────────────────────────────

describe('POST /api/notifications/read-all', () => {
  it('marks all unread notifications as read', async () => {
    const res = await request(app)
      .post('/api/notifications/read-all')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockNotificationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clientId: 'user-001', readAt: null }),
        data: expect.objectContaining({ readAt: expect.any(Date) }),
      })
    );
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/notifications/read-all');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/notifications/:id/read ────────────────────────────────────────

describe('POST /api/notifications/:id/read', () => {
  it('marks a single notification as read', async () => {
    const res = await request(app)
      .post('/api/notifications/notif-001/read')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.notification.readAt).toBeDefined();
    expect(mockNotificationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'notif-001' } })
    );
  });

  it('returns 404 when notification not found', async () => {
    mockNotificationFindFirst.mockResolvedValue(null as never);

    const res = await request(app)
      .post('/api/notifications/nonexistent/read')
      .set('Authorization', clientToken);

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/notifications/notif-001/read');
    expect(res.status).toBe(401);
  });
});

// ─── queueNotification fires on LinkedIn reply (heyreach webhook) ─────────────

describe('Heyreach webhook — notification trigger on reply', () => {
  beforeEach(() => {
    mockLeadFindUnique.mockResolvedValue({
      id: 'lead-001',
      clientId: 'user-001',
      fullName: 'Jane Smith',
      company: 'ACME',
    } as never);
  });

  it('queues a lead_replied notification when message_received fires', async () => {
    const res = await request(app)
      .post('/api/heyreach/webhook')
      .send({
        event: 'message_received',
        lead_id: 'lead-001',
        external_id: 'ext-001',
        message_body: 'Hi there!',
      });

    expect(res.status).toBe(200);
    expect(mockNotificationsAdd).toHaveBeenCalledWith(
      'send-notification',
      expect.objectContaining({ eventType: 'lead_replied', clientId: 'user-001' }),
      expect.any(Object)
    );
  });
});

// ─── queueNotification fires on email reply (instantly webhook) ───────────────

describe('Instantly webhook — notification trigger on reply', () => {
  beforeEach(() => {
    mockLeadFindUnique.mockResolvedValue({
      id: 'lead-001',
      clientId: 'user-001',
      fullName: 'Jane Smith',
      company: 'ACME',
    } as never);
  });

  it('queues a lead_replied notification when email_replied fires', async () => {
    const res = await request(app)
      .post('/api/instantly/webhook')
      .send({
        event_type: 'email_replied',
        lead_id: 'lead-001',
        external_id: 'ext-email-001',
        reply_body: 'Interested!',
      });

    expect(res.status).toBe(200);
    expect(mockNotificationsAdd).toHaveBeenCalledWith(
      'send-notification',
      expect.objectContaining({ eventType: 'lead_replied', clientId: 'user-001' }),
      expect.any(Object)
    );
  });
});
