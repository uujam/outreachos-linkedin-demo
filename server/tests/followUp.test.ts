/**
 * B-011b — Follow-up reactivation job tests (F-026)
 * Covers: reactivateFollowUps() reactivates due leads, skips future leads,
 * writes activity log, enqueues notification, handles partial failures gracefully.
 */

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
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    outreachActivity: {
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

import { prisma } from '../src/lib/prisma';
import { reactivateFollowUps } from '../src/jobs/followUpWorker';

const mockLeadFindMany = prisma.lead.findMany as jest.MockedFunction<typeof prisma.lead.findMany>;
const mockLeadUpdate = prisma.lead.update as jest.MockedFunction<typeof prisma.lead.update>;
const mockActivityCreate = prisma.outreachActivity.create as jest.MockedFunction<typeof prisma.outreachActivity.create>;

const PAST_DATE = new Date(Date.now() - 86400_000); // yesterday

const LEAD_DUE = {
  id: 'lead-001',
  clientId: 'user-001',
  fullName: 'Jane Smith',
  company: 'ACME',
  terminalOutcome: 'FollowUpLater',
  followUpDate: PAST_DATE,
};

const LEAD_DUE_2 = {
  id: 'lead-002',
  clientId: 'user-001',
  fullName: 'Bob Jones',
  company: 'Globex',
  terminalOutcome: 'FollowUpLater',
  followUpDate: PAST_DATE,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLeadUpdate.mockResolvedValue({} as never);
  mockActivityCreate.mockResolvedValue({} as never);
});

describe('reactivateFollowUps', () => {
  it('reactivates a due lead: clears terminalOutcome and sets outreachStage=Responded', async () => {
    mockLeadFindMany.mockResolvedValue([LEAD_DUE] as never);

    const count = await reactivateFollowUps({} as never);

    expect(count).toBe(1);
    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lead-001' },
        data: expect.objectContaining({
          terminalOutcome: null,
          outreachStage: 'Responded',
          followUpDate: null,
        }),
      })
    );
  });

  it('writes an outreachActivity note for each reactivated lead', async () => {
    mockLeadFindMany.mockResolvedValue([LEAD_DUE] as never);

    await reactivateFollowUps({} as never);

    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leadId: 'lead-001',
          notes: expect.stringContaining('reactivated'),
        }),
      })
    );
  });

  it('enqueues a lead_reactivated notification for each lead', async () => {
    mockLeadFindMany.mockResolvedValue([LEAD_DUE] as never);

    await reactivateFollowUps({} as never);

    expect(mockNotificationsAdd).toHaveBeenCalledWith(
      'send-notification',
      expect.objectContaining({
        clientId: 'user-001',
        eventType: 'lead_reactivated',
      }),
      expect.any(Object)
    );
  });

  it('reactivates multiple due leads in one run', async () => {
    mockLeadFindMany.mockResolvedValue([LEAD_DUE, LEAD_DUE_2] as never);

    const count = await reactivateFollowUps({} as never);

    expect(count).toBe(2);
    expect(mockLeadUpdate).toHaveBeenCalledTimes(2);
    expect(mockNotificationsAdd).toHaveBeenCalledTimes(2);
  });

  it('returns 0 when no leads are due', async () => {
    mockLeadFindMany.mockResolvedValue([] as never);

    const count = await reactivateFollowUps({} as never);

    expect(count).toBe(0);
    expect(mockLeadUpdate).not.toHaveBeenCalled();
  });

  it('queries with followUpDate <= now (catches up after downtime)', async () => {
    mockLeadFindMany.mockResolvedValue([] as never);

    await reactivateFollowUps({} as never);

    expect(mockLeadFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          terminalOutcome: 'FollowUpLater',
          followUpDate: expect.objectContaining({ lte: expect.any(Date) }),
        }),
      })
    );
  });

  it('continues processing remaining leads if one lead update fails', async () => {
    mockLeadFindMany.mockResolvedValue([LEAD_DUE, LEAD_DUE_2] as never);
    mockLeadUpdate
      .mockRejectedValueOnce(new Error('DB error')) // first lead fails
      .mockResolvedValue({} as never);              // second lead succeeds

    const count = await reactivateFollowUps({} as never);

    // Second lead still processed
    expect(count).toBe(1);
    expect(mockLeadUpdate).toHaveBeenCalledTimes(2);
  });
});
