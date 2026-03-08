import request from 'supertest';
import app from '../src/app';
import { signToken } from '../src/lib/auth';

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    lead: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
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
import { getQueues } from '../src/queues';

const mockFindFirst = prisma.lead.findFirst as jest.MockedFunction<typeof prisma.lead.findFirst>;
const mockCreate = prisma.lead.create as jest.MockedFunction<typeof prisma.lead.create>;
const mockSubFindUnique = prisma.subscription.findUnique as jest.MockedFunction<typeof prisma.subscription.findUnique>;
const mockUserFindUnique = prisma.user.findUnique as jest.MockedFunction<typeof prisma.user.findUnique>;
const mockGetQueues = getQueues as jest.MockedFunction<typeof getQueues>;

process.env.JWT_SECRET = 'test-secret-key-for-b003';
const clientToken = `Bearer ${signToken({ sub: 'user-001', role: 'client' })}`;

const ACTIVE_SUB = {
  id: 'sub-001',
  clientId: 'user-001',
  stripeCustomerId: 'cus_001',
  stripeSubscriptionId: 'sub_001',
  planName: 'Starter' as const,
  status: 'active' as const,
  currentPeriodStart: new Date(),
  currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
  leadsUsedThisPeriod: 0,
  trialEndDate: null,
};

const CREATED_LEAD = {
  id: 'lead-new',
  clientId: 'user-001',
  fullName: 'John Doe',
  jobTitle: 'CTO',
  company: 'Test Corp',
  linkedinUrl: null,
  emailAddress: 'john@test.com',
  phoneNumber: null,
  source: 'Manual',
  enrichmentStage: 'Discovered',
  outreachStage: null,
  terminalOutcome: null,
  followUpDate: null,
  dncFlag: false,
  fitScore: null,
  fitScoreReasoning: null,
  assignedCampaignId: null,
  currentChannelStep: null,
  createdDate: new Date(),
  lastActivityDate: null,
};

let mockAddJob: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockAddJob = jest.fn().mockResolvedValue({ id: 'job-001' });
  mockGetQueues.mockReturnValue({ enrichment: { add: mockAddJob } } as unknown as ReturnType<typeof getQueues>);
  mockFindFirst.mockResolvedValue(null); // no duplicates by default
  mockCreate.mockResolvedValue(CREATED_LEAD as never);
  mockSubFindUnique.mockResolvedValue(ACTIVE_SUB as never);
  mockUserFindUnique.mockResolvedValue({ customLeadCapOverride: null } as never);
});

// ─── POST /api/leads ──────────────────────────────────────────────────────────

describe('POST /api/leads', () => {
  it('returns 401 with no auth', async () => {
    const res = await request(app).post('/api/leads').send({});
    expect(res.status).toBe(401);
  });

  it('returns 400 when fullName or company are missing', async () => {
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', clientToken)
      .send({ fullName: 'John' }); // missing company

    expect(res.status).toBe(400);
  });

  it('creates a lead with source=Manual and stage=Discovered', async () => {
    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', clientToken)
      .send({ fullName: 'John Doe', company: 'Test Corp', emailAddress: 'john@test.com' });

    expect(res.status).toBe(201);
    expect(res.body.lead.source).toBe('Manual');
    expect(res.body.lead.enrichmentStage).toBe('Discovered');
  });

  it('returns 409 on duplicate LinkedIn URL', async () => {
    mockFindFirst.mockResolvedValue(CREATED_LEAD as never);

    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', clientToken)
      .send({ fullName: 'John Doe', company: 'Test Corp', linkedinUrl: 'https://linkedin.com/in/john' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
    expect(res.body.existingLeadId).toBe('lead-new');
  });

  it('returns 409 on duplicate email address', async () => {
    mockFindFirst.mockResolvedValue(CREATED_LEAD as never);

    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', clientToken)
      .send({ fullName: 'John Doe', company: 'Test Corp', emailAddress: 'john@test.com' });

    expect(res.status).toBe(409);
  });

  it('returns 402 when lead cap is reached', async () => {
    mockSubFindUnique.mockResolvedValue({ ...ACTIVE_SUB, leadsUsedThisPeriod: 500 } as never);

    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', clientToken)
      .send({ fullName: 'John Doe', company: 'Test Corp' });

    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/cap reached/i);
  });

  it('queues an enrichment job after creating the lead', async () => {
    await request(app)
      .post('/api/leads')
      .set('Authorization', clientToken)
      .send({ fullName: 'John Doe', company: 'Test Corp' });

    expect(mockAddJob).toHaveBeenCalledWith(
      'enrich-lead',
      expect.objectContaining({ leadId: 'lead-new', clientId: 'user-001' })
    );
  });

  it('skips linkedin enrichment when linkedinUrl is already provided', async () => {
    await request(app)
      .post('/api/leads')
      .set('Authorization', clientToken)
      .send({ fullName: 'John Doe', company: 'Test Corp', linkedinUrl: 'https://linkedin.com/in/john' });

    expect(mockAddJob).toHaveBeenCalledWith(
      'enrich-lead',
      expect.objectContaining({ skipLinkedin: true })
    );
  });

  it('still returns 201 even if the enrichment queue fails', async () => {
    mockAddJob.mockRejectedValueOnce(new Error('Redis unavailable'));

    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', clientToken)
      .send({ fullName: 'John Doe', company: 'Test Corp' });

    expect(res.status).toBe(201);
  });

  it('allows unlimited lead creation on Enterprise plan', async () => {
    mockSubFindUnique.mockResolvedValue({
      ...ACTIVE_SUB,
      planName: 'Enterprise',
      leadsUsedThisPeriod: 99999,
    } as never);

    const res = await request(app)
      .post('/api/leads')
      .set('Authorization', clientToken)
      .send({ fullName: 'John Doe', company: 'Test Corp' });

    expect(res.status).toBe(201);
  });
});
