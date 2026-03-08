import request from 'supertest';
import app from '../src/app';

// Mock all external service dependencies so tests run without real infrastructure
jest.mock('../src/lib/prisma', () => ({
  prisma: {},
  checkDatabaseHealth: jest.fn(),
}));

jest.mock('../src/lib/redis', () => ({
  getRedisClient: jest.fn(),
  checkRedisHealth: jest.fn(),
  closeRedis: jest.fn(),
}));

jest.mock('../src/queues', () => ({
  QUEUE_NAMES: ['enrichment', 'outreach', 'discovery', 'scoring', 'follow-up', 'notifications'],
  getQueues: jest.fn(),
  getDlqs: jest.fn(),
  checkQueuesHealth: jest.fn(),
  wireDlqForwarding: jest.fn(),
  closeQueues: jest.fn(),
}));

import { checkDatabaseHealth } from '../src/lib/prisma';
import { checkRedisHealth } from '../src/lib/redis';
import { checkQueuesHealth } from '../src/queues';

const mockCheckDatabaseHealth = checkDatabaseHealth as jest.MockedFunction<typeof checkDatabaseHealth>;
const mockCheckRedisHealth = checkRedisHealth as jest.MockedFunction<typeof checkRedisHealth>;
const mockCheckQueuesHealth = checkQueuesHealth as jest.MockedFunction<typeof checkQueuesHealth>;

const ALL_QUEUES_OK = {
  enrichment: true,
  outreach: true,
  discovery: true,
  scoring: true,
  'follow-up': true,
  notifications: true,
};

const ALL_QUEUES_ERROR = Object.fromEntries(
  Object.keys(ALL_QUEUES_OK).map((k) => [k, false])
);

describe('GET /api/health', () => {
  it('returns 200 and status ok when all services are healthy', async () => {
    mockCheckDatabaseHealth.mockResolvedValue(true);
    mockCheckRedisHealth.mockResolvedValue(true);
    mockCheckQueuesHealth.mockResolvedValue(ALL_QUEUES_OK);

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.services.database).toBe('ok');
    expect(res.body.services.redis).toBe('ok');
    expect(Object.values(res.body.services.queues)).toEqual(
      expect.arrayContaining(['ok'])
    );
  });

  it('returns 503 and status degraded when database is down', async () => {
    mockCheckDatabaseHealth.mockResolvedValue(false);
    mockCheckRedisHealth.mockResolvedValue(true);
    mockCheckQueuesHealth.mockResolvedValue(ALL_QUEUES_OK);

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.services.database).toBe('error');
    expect(res.body.services.redis).toBe('ok');
  });

  it('returns 503 and status degraded when redis is down', async () => {
    mockCheckDatabaseHealth.mockResolvedValue(true);
    mockCheckRedisHealth.mockResolvedValue(false);
    mockCheckQueuesHealth.mockResolvedValue(ALL_QUEUES_OK);

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.services.redis).toBe('error');
  });

  it('returns 503 and status degraded when one or more queues are down', async () => {
    mockCheckDatabaseHealth.mockResolvedValue(true);
    mockCheckRedisHealth.mockResolvedValue(true);
    mockCheckQueuesHealth.mockResolvedValue({ ...ALL_QUEUES_OK, enrichment: false });

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.services.queues.enrichment).toBe('error');
  });

  it('returns 503 when all queues are down', async () => {
    mockCheckDatabaseHealth.mockResolvedValue(true);
    mockCheckRedisHealth.mockResolvedValue(true);
    mockCheckQueuesHealth.mockResolvedValue(ALL_QUEUES_ERROR);

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    Object.values(res.body.services.queues).forEach((v) => {
      expect(v).toBe('error');
    });
  });

  it('response always includes a timestamp', async () => {
    mockCheckDatabaseHealth.mockResolvedValue(true);
    mockCheckRedisHealth.mockResolvedValue(true);
    mockCheckQueuesHealth.mockResolvedValue(ALL_QUEUES_OK);

    const res = await request(app).get('/api/health');

    expect(res.body.timestamp).toBeDefined();
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });

  it('response includes all 6 expected queues', async () => {
    mockCheckDatabaseHealth.mockResolvedValue(true);
    mockCheckRedisHealth.mockResolvedValue(true);
    mockCheckQueuesHealth.mockResolvedValue(ALL_QUEUES_OK);

    const res = await request(app).get('/api/health');

    const queueNames = Object.keys(res.body.services.queues);
    expect(queueNames).toEqual(
      expect.arrayContaining(['enrichment', 'outreach', 'discovery', 'scoring', 'follow-up', 'notifications'])
    );
    expect(queueNames).toHaveLength(6);
  });

  it('handles checkQueuesHealth throwing an error gracefully', async () => {
    mockCheckDatabaseHealth.mockResolvedValue(true);
    mockCheckRedisHealth.mockResolvedValue(true);
    mockCheckQueuesHealth.mockRejectedValue(new Error('Redis connection refused'));

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    // All queues should report error when the health check itself throws
    Object.values(res.body.services.queues).forEach((v) => {
      expect(v).toBe('error');
    });
  });
});
