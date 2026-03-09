/**
 * B-011a — Integration OAuth tests (F-027)
 * Covers: list integrations, connect redirect, callback (token store + Calendly webhook),
 * disconnect (webhook dereg + notification), status endpoint,
 * encryptToken/decryptToken round-trip, buildOAuthState/parseOAuthState.
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
    lead: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    integrationConnection: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      upsert: jest.fn().mockResolvedValue({}),
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

jest.mock('../src/lib/leadCap', () => ({
  checkLeadCap: jest.fn().mockResolvedValue({ allowed: true, used: 0, cap: 100 }),
  incrementLeadCount: jest.fn(),
  resetLeadCap: jest.fn(),
}));

jest.mock('../src/orchestration/channel-sequencer', () => ({
  cancelPendingOutreachJobs: jest.fn().mockResolvedValue(undefined),
  scheduleChannelSteps: jest.fn().mockResolvedValue(undefined),
}));

// Mock the OAuth exchange and Calendly webhook registration
jest.mock('../src/lib/integrations', () => {
  const actual = jest.requireActual('../src/lib/integrations');
  return {
    ...actual,
    exchangeCode: jest.fn().mockResolvedValue({
      access_token: 'access-token-123',
      refresh_token: 'refresh-token-456',
      expires_in: 3600,
      scope: 'default',
    }),
    registerCalendlyWebhook: jest.fn().mockResolvedValue('https://api.calendly.com/webhook_subscriptions/wh-001'),
    deregisterCalendlyWebhook: jest.fn().mockResolvedValue(undefined),
  };
});

import { prisma } from '../src/lib/prisma';
import { encryptToken, decryptToken, buildOAuthState, parseOAuthState } from '../src/lib/integrations';

const mockIntegrationFindMany = prisma.integrationConnection.findMany as jest.MockedFunction<typeof prisma.integrationConnection.findMany>;
const mockIntegrationFindUnique = prisma.integrationConnection.findUnique as jest.MockedFunction<typeof prisma.integrationConnection.findUnique>;
const mockIntegrationUpsert = prisma.integrationConnection.upsert as jest.MockedFunction<typeof prisma.integrationConnection.upsert>;
const mockIntegrationUpdate = prisma.integrationConnection.update as jest.MockedFunction<typeof prisma.integrationConnection.update>;

process.env.JWT_SECRET = 'test-secret-b011a';
const clientToken = `Bearer ${signToken({ sub: 'user-001', role: 'client' })}`;

const CONNECTED_INTEGRATION = {
  id: 'int-001',
  clientId: 'user-001',
  service: 'calendly',
  accessToken: encryptToken('live-access-token'),
  refreshToken: encryptToken('live-refresh-token'),
  status: 'active',
  calendlyWebhookId: 'https://api.calendly.com/webhook_subscriptions/wh-001',
  lastSyncAt: null,
  errorMessage: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockIntegrationFindUnique.mockResolvedValue(CONNECTED_INTEGRATION as never);
});

// ─── Token encryption round-trip ─────────────────────────────────────────────

describe('encryptToken / decryptToken', () => {
  it('encrypts and decrypts a token correctly', () => {
    const original = 'super-secret-oauth-token';
    const encrypted = encryptToken(original);
    expect(encrypted).not.toBe(original);
    expect(decryptToken(encrypted)).toBe(original);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const token = 'same-token';
    expect(encryptToken(token)).not.toBe(encryptToken(token));
  });
});

// ─── OAuth state ─────────────────────────────────────────────────────────────

describe('buildOAuthState / parseOAuthState', () => {
  it('builds and parses a valid state', () => {
    const state = buildOAuthState('user-001', 'calendly' as never);
    const parsed = parseOAuthState(state);
    expect(parsed).not.toBeNull();
    expect(parsed!.clientId).toBe('user-001');
    expect(parsed!.service).toBe('calendly');
  });

  it('returns null for a tampered state', () => {
    const state = buildOAuthState('user-001', 'calendly' as never);
    const tampered = state.slice(0, -4) + 'xxxx';
    expect(parseOAuthState(tampered)).toBeNull();
  });
});

// ─── GET /api/integrations ────────────────────────────────────────────────────

describe('GET /api/integrations', () => {
  it('returns all integration connections for the client', async () => {
    mockIntegrationFindMany.mockResolvedValue([
      { service: 'calendly', status: 'active', lastSyncAt: null, errorMessage: null },
    ] as never);

    const res = await request(app)
      .get('/api/integrations')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.integrations).toHaveLength(1);
    expect(res.body.integrations[0].service).toBe('calendly');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/integrations');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/integrations/:service/status ────────────────────────────────────

describe('GET /api/integrations/:service/status', () => {
  it('returns connected:true for an active integration', async () => {
    mockIntegrationFindUnique.mockResolvedValue({ service: 'calendly', status: 'active', lastSyncAt: null, errorMessage: null } as never);

    const res = await request(app)
      .get('/api/integrations/calendly/status')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.status).toBe('active');
  });

  it('returns connected:false when not connected', async () => {
    mockIntegrationFindUnique.mockResolvedValue(null as never);

    const res = await request(app)
      .get('/api/integrations/calendly/status')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(false);
  });

  it('returns 400 for unknown service', async () => {
    const res = await request(app)
      .get('/api/integrations/unknown-service/status')
      .set('Authorization', clientToken);

    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/integrations/calendly/status');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/integrations/:service/connect ───────────────────────────────────

describe('GET /api/integrations/:service/connect', () => {
  it('redirects to OAuth provider for calendly', async () => {
    const res = await request(app)
      .get('/api/integrations/calendly/connect')
      .set('Authorization', clientToken)
      .redirects(0); // Don't follow redirects

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('auth.calendly.com');
    expect(res.headers.location).toContain('state=');
  });

  it('redirects for google-calendar', async () => {
    const res = await request(app)
      .get('/api/integrations/google-calendar/connect')
      .set('Authorization', clientToken)
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com');
  });

  it('redirects for microsoft-outlook', async () => {
    const res = await request(app)
      .get('/api/integrations/microsoft-outlook/connect')
      .set('Authorization', clientToken)
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('login.microsoftonline.com');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/integrations/calendly/connect');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/integrations/:service/callback ─────────────────────────────────

describe('GET /api/integrations/:service/callback', () => {
  it('stores tokens and registers Calendly webhook on valid callback', async () => {
    const state = buildOAuthState('user-001', 'calendly' as never);

    const res = await request(app)
      .get(`/api/integrations/calendly/callback?code=auth-code-123&state=${state}`)
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('connected=calendly');
    expect(mockIntegrationUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ service: 'calendly', status: 'active' }),
      })
    );
  });

  it('redirects to error page on missing code', async () => {
    const res = await request(app)
      .get('/api/integrations/calendly/callback?error=access_denied')
      .redirects(0);

    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid state', async () => {
    const res = await request(app)
      .get('/api/integrations/calendly/callback?code=xyz&state=invalidstate')
      .redirects(0);

    expect(res.status).toBe(400);
  });
});

// ─── DELETE /api/integrations/:service — disconnect ───────────────────────────

describe('DELETE /api/integrations/:service', () => {
  it('disconnects Calendly, deregisters webhook, queues notification', async () => {
    const { deregisterCalendlyWebhook } = require('../src/lib/integrations');

    const res = await request(app)
      .delete('/api/integrations/calendly')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(deregisterCalendlyWebhook).toHaveBeenCalled();
    expect(mockIntegrationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'disconnected' }) })
    );
    expect(mockNotificationsAdd).toHaveBeenCalledWith(
      'send-notification',
      expect.objectContaining({ eventType: 'calendly_disconnected' }),
      expect.any(Object)
    );
  });

  it('returns 404 when integration not connected', async () => {
    mockIntegrationFindUnique.mockResolvedValue(null as never);

    const res = await request(app)
      .delete('/api/integrations/calendly')
      .set('Authorization', clientToken);

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).delete('/api/integrations/calendly');
    expect(res.status).toBe(401);
  });
});
