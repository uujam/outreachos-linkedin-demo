/**
 * B-006b Lead detail view tests
 * Covers: conversation timeline (GET/POST messages), DNC, campaign reassign,
 * discovery-pause toggle, and SSE connection endpoint.
 */
import request from 'supertest';
import app from '../src/app';
import { signToken } from '../src/lib/auth';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockDiscoveryRemoveRepeatable = jest.fn().mockResolvedValue(undefined);

jest.mock('../src/queues', () => ({
  QUEUE_NAMES: ['enrichment', 'outreach', 'discovery', 'scoring', 'follow-up', 'notifications'],
  getQueues: jest.fn(() => ({
    enrichment: { add: jest.fn() },
    outreach: { add: jest.fn(), getJob: jest.fn().mockResolvedValue(null) },
    discovery: { add: jest.fn(), removeRepeatable: mockDiscoveryRemoveRepeatable },
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
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
    campaign: { findFirst: jest.fn() },
    message: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
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
import { cancelPendingOutreachJobs } from '../src/orchestration/channel-sequencer';

const mockLeadFindFirst = prisma.lead.findFirst as jest.MockedFunction<typeof prisma.lead.findFirst>;
const mockLeadUpdate = prisma.lead.update as jest.MockedFunction<typeof prisma.lead.update>;
const mockMessageFindMany = prisma.message.findMany as jest.MockedFunction<typeof prisma.message.findMany>;
const mockMessageCreate = prisma.message.create as jest.MockedFunction<typeof prisma.message.create>;
const mockCampaignFindFirst = prisma.campaign.findFirst as jest.MockedFunction<typeof prisma.campaign.findFirst>;
const mockUserUpdate = prisma.user.update as jest.MockedFunction<typeof prisma.user.update>;
const mockCancelJobs = cancelPendingOutreachJobs as jest.MockedFunction<typeof cancelPendingOutreachJobs>;

process.env.JWT_SECRET = 'test-secret-b006b';
const clientToken = `Bearer ${signToken({ sub: 'user-001', role: 'client' })}`;

const LEAD = {
  id: 'lead-001',
  clientId: 'user-001',
  fullName: 'Jane Smith',
  company: 'ACME Ltd',
  dncFlag: false,
  terminalOutcome: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLeadFindFirst.mockResolvedValue(LEAD as never);
  mockLeadUpdate.mockResolvedValue(LEAD as never);
});

// ─── GET /api/leads/:id/messages ─────────────────────────────────────────────

describe('GET /api/leads/:id/messages', () => {
  it('returns messages for an authenticated client', async () => {
    const messages = [
      { id: 'msg-001', body: 'Hello', timestamp: new Date(), channel: 'email' },
    ];
    mockMessageFindMany.mockResolvedValue(messages as never);

    const res = await request(app)
      .get('/api/leads/lead-001/messages')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0].id).toBe('msg-001');
  });

  it('returns 404 when lead does not exist', async () => {
    mockLeadFindFirst.mockResolvedValue(null as never);

    const res = await request(app)
      .get('/api/leads/nonexistent/messages')
      .set('Authorization', clientToken);

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/leads/lead-001/messages');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/leads/:id/messages — manual note ───────────────────────────────

describe('POST /api/leads/:id/messages', () => {
  it('creates a manual note and returns 201', async () => {
    const note = { id: 'msg-002', body: 'Called prospect', channel: 'note', tool: 'Manual' };
    mockMessageCreate.mockResolvedValue(note as never);

    const res = await request(app)
      .post('/api/leads/lead-001/messages')
      .set('Authorization', clientToken)
      .send({ body: 'Called prospect' });

    expect(res.status).toBe(201);
    expect(res.body.message.id).toBe('msg-002');
    expect(mockMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tool: 'Manual', channel: 'note' }),
      })
    );
  });

  it('returns 400 when body is missing', async () => {
    const res = await request(app)
      .post('/api/leads/lead-001/messages')
      .set('Authorization', clientToken)
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 404 when lead does not exist', async () => {
    mockLeadFindFirst.mockResolvedValue(null as never);

    const res = await request(app)
      .post('/api/leads/nonexistent/messages')
      .set('Authorization', clientToken)
      .send({ body: 'Note' });

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/leads/lead-001/messages')
      .send({ body: 'Note' });
    expect(res.status).toBe(401);
  });
});

// ─── PATCH /api/leads/:id/dnc ─────────────────────────────────────────────────

describe('PATCH /api/leads/:id/dnc', () => {
  it('marks lead as DNC and cancels outreach jobs', async () => {
    const res = await request(app)
      .patch('/api/leads/lead-001/dnc')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(mockCancelJobs).toHaveBeenCalledWith('lead-001');
    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dncFlag: true, terminalOutcome: 'DoNotContact' }),
      })
    );
  });

  it('returns 404 when lead does not exist', async () => {
    mockLeadFindFirst.mockResolvedValue(null as never);

    const res = await request(app)
      .patch('/api/leads/nonexistent/dnc')
      .set('Authorization', clientToken);

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).patch('/api/leads/lead-001/dnc');
    expect(res.status).toBe(401);
  });
});

// ─── PATCH /api/leads/:id/campaign ───────────────────────────────────────────

describe('PATCH /api/leads/:id/campaign', () => {
  it('reassigns lead to a campaign', async () => {
    mockCampaignFindFirst.mockResolvedValue({ id: 'camp-001', clientId: 'user-001' } as never);

    const res = await request(app)
      .patch('/api/leads/lead-001/campaign')
      .set('Authorization', clientToken)
      .send({ campaignId: 'camp-001' });

    expect(res.status).toBe(200);
    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assignedCampaignId: 'camp-001' }),
      })
    );
  });

  it('clears campaign assignment when campaignId is null', async () => {
    const res = await request(app)
      .patch('/api/leads/lead-001/campaign')
      .set('Authorization', clientToken)
      .send({ campaignId: null });

    expect(res.status).toBe(200);
    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assignedCampaignId: null }),
      })
    );
  });

  it('returns 404 when campaign does not exist', async () => {
    mockCampaignFindFirst.mockResolvedValue(null as never);

    const res = await request(app)
      .patch('/api/leads/lead-001/campaign')
      .set('Authorization', clientToken)
      .send({ campaignId: 'nonexistent' });

    expect(res.status).toBe(404);
  });

  it('returns 404 when lead does not exist', async () => {
    mockLeadFindFirst.mockResolvedValue(null as never);

    const res = await request(app)
      .patch('/api/leads/nonexistent/campaign')
      .set('Authorization', clientToken)
      .send({ campaignId: null });

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).patch('/api/leads/lead-001/campaign');
    expect(res.status).toBe(401);
  });
});

// ─── PATCH /api/users/me/discovery-pause ─────────────────────────────────────

describe('PATCH /api/users/me/discovery-pause', () => {
  it('sets discoveryPaused to true and cancels discovery job', async () => {
    const res = await request(app)
      .patch('/api/users/me/discovery-pause')
      .set('Authorization', clientToken)
      .send({ paused: true });

    expect(res.status).toBe(200);
    expect(res.body.paused).toBe(true);
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { discoveryPaused: true } })
    );
    expect(mockDiscoveryRemoveRepeatable).toHaveBeenCalled();
  });

  it('sets discoveryPaused to false without cancelling jobs', async () => {
    const res = await request(app)
      .patch('/api/users/me/discovery-pause')
      .set('Authorization', clientToken)
      .send({ paused: false });

    expect(res.status).toBe(200);
    expect(res.body.paused).toBe(false);
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { discoveryPaused: false } })
    );
    expect(mockDiscoveryRemoveRepeatable).not.toHaveBeenCalled();
  });

  it('returns 400 when paused is not a boolean', async () => {
    const res = await request(app)
      .patch('/api/users/me/discovery-pause')
      .set('Authorization', clientToken)
      .send({ paused: 'yes' });

    expect(res.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .patch('/api/users/me/discovery-pause')
      .send({ paused: true });
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/events — SSE connection ────────────────────────────────────────

describe('GET /api/events', () => {
  it('opens an SSE connection with correct content-type header', (done) => {
    // SSE connections stay open — use http.get with a quick abort
    const http = require('http');
    const server = app.listen(0, () => {
      const { port } = server.address() as { port: number };
      const req = http.get(
        `http://localhost:${port}/api/events`,
        { headers: { Authorization: clientToken } },
        (res: any) => {
          expect(res.headers['content-type']).toMatch(/text\/event-stream/);
          req.destroy();
          server.close(done);
        }
      );
      req.on('error', () => server.close(done));
    });
  }, 5000);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/events');
    expect(res.status).toBe(401);
  });
});
