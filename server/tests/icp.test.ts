import request from 'supertest';
import app from '../src/app';
import { signToken } from '../src/lib/auth';

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    icpSettings: { findUnique: jest.fn(), upsert: jest.fn() },
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

const mockFindUnique = prisma.icpSettings.findUnique as jest.MockedFunction<typeof prisma.icpSettings.findUnique>;
const mockUpsert = prisma.icpSettings.upsert as jest.MockedFunction<typeof prisma.icpSettings.upsert>;

process.env.JWT_SECRET = 'test-secret-key-for-b003';

const clientToken = `Bearer ${signToken({ sub: 'user-001', role: 'client' })}`;

const SAMPLE_SETTINGS = {
  id: 'icp-001',
  clientId: 'user-001',
  industries: ['SaaS', 'Fintech'],
  geography: ['London', 'Manchester'],
  jobTitles: ['CEO', 'Founder'],
  revenueRange: '£1M–£10M',
  employeeRange: '10–100',
  buyingSignals: 'hiring, funding',
  descriptionText: 'B2B SaaS companies in the UK',
  exclusions: 'Recruitment agencies',
  updatedAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── GET /api/icp ─────────────────────────────────────────────────────────────

describe('GET /api/icp', () => {
  it('returns 401 with no auth token', async () => {
    const res = await request(app).get('/api/icp');
    expect(res.status).toBe(401);
  });

  it('returns null settings when none exist yet', async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/icp')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.settings).toBeNull();
  });

  it('returns existing ICP settings for the authenticated client', async () => {
    mockFindUnique.mockResolvedValue(SAMPLE_SETTINGS);

    const res = await request(app)
      .get('/api/icp')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.settings.industries).toEqual(['SaaS', 'Fintech']);
    expect(res.body.settings.geography).toEqual(['London', 'Manchester']);
    expect(res.body.settings.jobTitles).toEqual(['CEO', 'Founder']);
  });

  it('scopes query to the authenticated client id', async () => {
    mockFindUnique.mockResolvedValue(null);

    await request(app)
      .get('/api/icp')
      .set('Authorization', clientToken);

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { clientId: 'user-001' },
    });
  });
});

// ─── PUT /api/icp ─────────────────────────────────────────────────────────────

describe('PUT /api/icp', () => {
  it('returns 401 with no auth token', async () => {
    const res = await request(app).put('/api/icp').send({});
    expect(res.status).toBe(401);
  });

  it('creates ICP settings on first save', async () => {
    mockUpsert.mockResolvedValue(SAMPLE_SETTINGS);

    const res = await request(app)
      .put('/api/icp')
      .set('Authorization', clientToken)
      .send({
        industries: ['SaaS', 'Fintech'],
        geography: ['London'],
        jobTitles: ['CEO'],
        revenueRange: '£1M–£10M',
      });

    expect(res.status).toBe(200);
    expect(res.body.settings).toBeDefined();
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it('upserts by clientId', async () => {
    mockUpsert.mockResolvedValue(SAMPLE_SETTINGS);

    await request(app)
      .put('/api/icp')
      .set('Authorization', clientToken)
      .send({ industries: ['HealthTech'] });

    const call = mockUpsert.mock.calls[0][0];
    expect(call.where).toEqual({ clientId: 'user-001' });
    expect(call.create.clientId).toBe('user-001');
  });

  it('only updates fields that are explicitly provided', async () => {
    mockUpsert.mockResolvedValue(SAMPLE_SETTINGS);

    await request(app)
      .put('/api/icp')
      .set('Authorization', clientToken)
      .send({ revenueRange: '£5M–£50M' });

    const { update } = mockUpsert.mock.calls[0][0];
    expect(update.revenueRange).toBe('£5M–£50M');
    expect(update.industries).toBeUndefined();
  });

  it('returns the saved settings in the response', async () => {
    mockUpsert.mockResolvedValue(SAMPLE_SETTINGS);

    const res = await request(app)
      .put('/api/icp')
      .set('Authorization', clientToken)
      .send({ industries: ['SaaS'] });

    expect(res.body.settings.clientId).toBe('user-001');
    expect(res.body.settings.industries).toEqual(['SaaS', 'Fintech']);
  });
});
