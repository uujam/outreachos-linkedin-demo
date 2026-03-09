/**
 * B-012 — Reporting and export tests (F-011)
 * Covers: POST /reports/generate for all 4 types, GET /reports, GET /reports/:id,
 * GET /reports/:id/csv, input validation, auth, CSV serialisation.
 */
import request from 'supertest';
import app from '../src/app';
import { signToken } from '../src/lib/auth';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/queues', () => ({
  QUEUE_NAMES: ['enrichment', 'outreach', 'discovery', 'scoring', 'follow-up', 'notifications'],
  getQueues: jest.fn(() => ({
    enrichment: { add: jest.fn() },
    outreach: { add: jest.fn(), getJob: jest.fn().mockResolvedValue(null) },
    discovery: { add: jest.fn(), removeRepeatable: jest.fn() },
    scoring: { add: jest.fn() },
    'follow-up': { add: jest.fn() },
    notifications: { add: jest.fn() },
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
      count: jest.fn().mockResolvedValue(42),
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
    },
    meeting: {
      count: jest.fn().mockResolvedValue(5),
      findMany: jest.fn().mockResolvedValue([]),
    },
    campaign: { findMany: jest.fn().mockResolvedValue([]) },
    message: { count: jest.fn().mockResolvedValue(100) },
    voiceCallRecord: { count: jest.fn().mockResolvedValue(8) },
    reportSnapshot: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
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

import { prisma } from '../src/lib/prisma';

const mockSnapshotCreate = prisma.reportSnapshot.create as jest.MockedFunction<typeof prisma.reportSnapshot.create>;
const mockSnapshotFindMany = prisma.reportSnapshot.findMany as jest.MockedFunction<typeof prisma.reportSnapshot.findMany>;
const mockSnapshotFindFirst = prisma.reportSnapshot.findFirst as jest.MockedFunction<typeof prisma.reportSnapshot.findFirst>;

process.env.JWT_SECRET = 'test-secret-b012';
const clientToken = `Bearer ${signToken({ sub: 'user-001', role: 'client' })}`;

const SNAPSHOT = {
  id: 'snap-001',
  clientId: 'user-001',
  reportType: 'pipeline_summary',
  dateGenerated: new Date('2026-03-09T00:00:00Z'),
  dataPayload: { totalLeads: 42, leadsInPipeline: 30, meetingsBooked: 5 },
  fileUrl: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSnapshotCreate.mockResolvedValue(SNAPSHOT as never);
  mockSnapshotFindMany.mockResolvedValue([SNAPSHOT] as never);
  mockSnapshotFindFirst.mockResolvedValue(SNAPSHOT as never);
});

// ─── POST /api/reports/generate ───────────────────────────────────────────────

describe('POST /api/reports/generate', () => {
  it('generates a pipeline_summary report and returns snapshot id', async () => {
    const res = await request(app)
      .post('/api/reports/generate')
      .set('Authorization', clientToken)
      .send({ type: 'pipeline_summary' });

    expect(res.status).toBe(201);
    expect(res.body.snapshot.id).toBe('snap-001');
    expect(res.body.snapshot.reportType).toBe('pipeline_summary');
    expect(mockSnapshotCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ clientId: 'user-001', reportType: 'pipeline_summary' }),
      })
    );
  });

  it('generates campaign_performance report', async () => {
    const res = await request(app)
      .post('/api/reports/generate')
      .set('Authorization', clientToken)
      .send({ type: 'campaign_performance' });

    expect(res.status).toBe(201);
  });

  it('generates outreach_by_channel report', async () => {
    const res = await request(app)
      .post('/api/reports/generate')
      .set('Authorization', clientToken)
      .send({ type: 'outreach_by_channel' });

    expect(res.status).toBe(201);
  });

  it('generates meetings report', async () => {
    const res = await request(app)
      .post('/api/reports/generate')
      .set('Authorization', clientToken)
      .send({ type: 'meetings' });

    expect(res.status).toBe(201);
  });

  it('returns 400 for unknown report type', async () => {
    const res = await request(app)
      .post('/api/reports/generate')
      .set('Authorization', clientToken)
      .send({ type: 'invalid_type' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when type is missing', async () => {
    const res = await request(app)
      .post('/api/reports/generate')
      .set('Authorization', clientToken)
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/reports/generate')
      .send({ type: 'pipeline_summary' });
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/reports ─────────────────────────────────────────────────────────

describe('GET /api/reports', () => {
  it('returns list of report snapshots', async () => {
    const res = await request(app)
      .get('/api/reports')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.snapshots).toHaveLength(1);
    expect(res.body.snapshots[0].id).toBe('snap-001');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/reports');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/reports/:id ─────────────────────────────────────────────────────

describe('GET /api/reports/:id', () => {
  it('returns the full snapshot with dataPayload', async () => {
    const res = await request(app)
      .get('/api/reports/snap-001')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.snapshot.dataPayload.totalLeads).toBe(42);
  });

  it('returns 404 when snapshot not found', async () => {
    mockSnapshotFindFirst.mockResolvedValue(null as never);

    const res = await request(app)
      .get('/api/reports/nonexistent')
      .set('Authorization', clientToken);

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/reports/snap-001');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/reports/:id/csv ─────────────────────────────────────────────────

describe('GET /api/reports/:id/csv', () => {
  it('returns CSV with correct content-type header', async () => {
    const res = await request(app)
      .get('/api/reports/snap-001/csv')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('.csv');
  });

  it('CSV content includes keys from data payload', async () => {
    const res = await request(app)
      .get('/api/reports/snap-001/csv')
      .set('Authorization', clientToken);

    expect(res.text).toContain('totalLeads');
    expect(res.text).toContain('42');
  });

  it('returns CSV with tabular data when payload contains array', async () => {
    mockSnapshotFindFirst.mockResolvedValue({
      ...SNAPSHOT,
      dataPayload: {
        meetings: [
          { id: 'meeting-001', leadName: 'Jane Smith', company: 'ACME', status: 'Confirmed' },
          { id: 'meeting-002', leadName: 'Bob Jones', company: 'Globex', status: 'NoShow' },
        ],
      },
    } as never);

    const res = await request(app)
      .get('/api/reports/snap-001/csv')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.text).toContain('leadName');
    expect(res.text).toContain('Jane Smith');
    expect(res.text).toContain('Bob Jones');
  });

  it('returns 404 when snapshot not found', async () => {
    mockSnapshotFindFirst.mockResolvedValue(null as never);

    const res = await request(app)
      .get('/api/reports/nonexistent/csv')
      .set('Authorization', clientToken);

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/reports/snap-001/csv');
    expect(res.status).toBe(401);
  });
});
