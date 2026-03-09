/**
 * B-019 — Security hardening tests.
 * Covers: CORS headers, security headers (helmet), body size limit,
 * auth rate-limit configuration (skip flag in test mode), HTTPS redirect logic.
 */
import request from 'supertest';
import app from '../src/app';

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
  getDlqs: jest.fn(() => ({})),
  checkQueuesHealth: jest.fn().mockResolvedValue({}),
  wireDlqForwarding: jest.fn(),
  closeQueues: jest.fn(),
}));

jest.mock('../src/lib/prisma', () => ({
  prisma: { $queryRaw: jest.fn().mockResolvedValue([{ result: 1 }]) },
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

// ─── Helmet security headers ──────────────────────────────────────────────────

describe('Security headers (helmet)', () => {
  it('sets X-Content-Type-Options: nosniff', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-Frame-Options header', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('sets X-XSS-Protection or Content-Security-Policy', async () => {
    const res = await request(app).get('/api/health');
    const hasXss = res.headers['x-xss-protection'] !== undefined;
    const hasCsp = res.headers['content-security-policy'] !== undefined;
    expect(hasXss || hasCsp).toBe(true);
  });
});

// ─── CORS ─────────────────────────────────────────────────────────────────────

describe('CORS', () => {
  it('allows requests with no origin (server-to-server)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });

  it('includes CORS header for allowed origin', async () => {
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'http://localhost:3000');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('blocks requests from disallowed origins', async () => {
    process.env.ALLOWED_ORIGINS = 'https://outreachos.com';
    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'https://evil.example.com');
    // The request itself gets through (Express CORS sends 5xx only on actual CORS preflight)
    // but the allow-origin header should not be set for the attacker's origin
    expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example.com');
  });
});

// ─── Body size limit ──────────────────────────────────────────────────────────

describe('Body size limit', () => {
  it('rejects payloads over 1 MB', async () => {
    const bigBody = { data: 'x'.repeat(1.1 * 1024 * 1024) };

    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(bigBody));

    expect(res.status).toBe(413);
  });
});

// ─── HTTPS redirect ───────────────────────────────────────────────────────────

describe('HTTPS redirect', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('does not redirect in test/development mode', async () => {
    process.env.NODE_ENV = 'test';
    const res = await request(app)
      .get('/api/health')
      .set('x-forwarded-proto', 'http');
    expect(res.status).toBe(200);
  });

  it('redirects HTTP to HTTPS in production', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(app)
      .get('/api/health')
      .set('x-forwarded-proto', 'http')
      .set('host', 'app.outreachos.com');
    expect(res.status).toBe(301);
    expect(res.headers.location).toMatch(/^https:/);
  });

  it('allows HTTPS through in production', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(app)
      .get('/api/health')
      .set('x-forwarded-proto', 'https');
    expect(res.status).toBe(200);
  });
});
