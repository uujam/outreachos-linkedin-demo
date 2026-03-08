/**
 * B-007b Automation trigger tests
 * Covers: ICP save → discovery queue, enrolLeadIfReady, queueEnrichmentForLead
 */
import request from 'supertest';
import app from '../src/app';
import { signToken } from '../src/lib/auth';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockDiscoveryAdd = jest.fn().mockResolvedValue({});
const mockDiscoveryRemoveRepeatable = jest.fn().mockResolvedValue({});
const mockOutreachAdd = jest.fn().mockResolvedValue({});
const mockEnrichmentAdd = jest.fn().mockResolvedValue({});

jest.mock('../src/queues', () => ({
  QUEUE_NAMES: ['enrichment', 'outreach', 'discovery', 'scoring', 'follow-up', 'notifications'],
  getQueues: jest.fn(() => ({
    discovery: { add: mockDiscoveryAdd, removeRepeatable: mockDiscoveryRemoveRepeatable },
    outreach: { add: mockOutreachAdd },
    enrichment: { add: mockEnrichmentAdd },
    scoring: { add: jest.fn() },
    'follow-up': { add: jest.fn() },
    notifications: { add: jest.fn() },
  })),
  getDlqs: jest.fn(),
  checkQueuesHealth: jest.fn().mockResolvedValue({
    enrichment: true, outreach: true, discovery: true,
    scoring: true, 'follow-up': true, notifications: true,
  }),
  wireDlqForwarding: jest.fn(),
  closeQueues: jest.fn(),
}));

jest.mock('../src/orchestration/channel-sequencer', () => ({
  scheduleChannelSteps: jest.fn().mockResolvedValue({}),
  cancelPendingOutreachJobs: jest.fn().mockResolvedValue({}),
}));

jest.mock('../src/lib/heyreach', () => ({
  enrolLeadInHeyreach: jest.fn().mockResolvedValue({ success: true }),
  getLinkedInAccountStatus: jest.fn(),
}));

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    icpSettings: { findUnique: jest.fn(), upsert: jest.fn() },
    lead: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    campaign: { findFirst: jest.fn() },
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
import { triggerAutomationOnIcpSave, enrolLeadIfReady, queueEnrichmentForLead } from '../src/orchestration/automationTrigger';

const mockIcpUpsert = prisma.icpSettings.upsert as jest.MockedFunction<typeof prisma.icpSettings.upsert>;
const mockLeadFindFirst = prisma.lead.findFirst as jest.MockedFunction<typeof prisma.lead.findFirst>;
const mockLeadUpdate = prisma.lead.update as jest.MockedFunction<typeof prisma.lead.update>;
const mockCampaignFindFirst = prisma.campaign.findFirst as jest.MockedFunction<typeof prisma.campaign.findFirst>;

process.env.JWT_SECRET = 'test-secret-key-b007b';
const clientToken = `Bearer ${signToken({ sub: 'user-001', role: 'client' })}`;

const ACTIVE_CAMPAIGN = {
  id: 'campaign-001',
  clientId: 'user-001',
  name: 'Q1 Outreach',
  status: 'Active',
  channelMix: ['Email'],      // no LinkedIn → Heyreach enrolment skipped
  channelConfig: null,
  createdAt: new Date(),
};

const READY_LEAD = {
  id: 'lead-001',
  clientId: 'user-001',
  enrichmentStage: 'ReadyForOutreach',
  assignedCampaignId: null,
  dncFlag: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockIcpUpsert.mockResolvedValue({} as never);
});

// ─── ICP save → discovery queue ───────────────────────────────────────────────

describe('PUT /api/icp — automation trigger', () => {
  it('returns 200 and queues an immediate discovery job on ICP save', async () => {
    const res = await request(app)
      .put('/api/icp')
      .set('Authorization', clientToken)
      .send({ industries: ['Technology'], geography: ['London'] });

    expect(res.status).toBe(200);
    // Fire-and-forget: give micro-tasks time to settle
    await new Promise((r) => setImmediate(r));
    expect(mockDiscoveryAdd).toHaveBeenCalledWith(
      expect.stringContaining('discovery:user-001:immediate'),
      expect.objectContaining({ clientId: 'user-001', sources: ['linkedin', 'companiesHouse'] }),
      expect.any(Object)
    );
  });

  it('removes old repeatable job and registers daily cron on ICP save', async () => {
    await request(app)
      .put('/api/icp')
      .set('Authorization', clientToken)
      .send({ industries: ['Technology'] });

    await new Promise((r) => setImmediate(r));
    expect(mockDiscoveryRemoveRepeatable).toHaveBeenCalledWith(
      'discovery:user-001',
      expect.any(Object)
    );
    expect(mockDiscoveryAdd).toHaveBeenCalledWith(
      expect.stringContaining('discovery:user-001:daily'),
      expect.objectContaining({ clientId: 'user-001' }),
      expect.objectContaining({ repeat: expect.any(Object) })
    );
  });
});

// ─── enrolLeadIfReady ─────────────────────────────────────────────────────────

describe('enrolLeadIfReady', () => {
  it('assigns lead to first active campaign and queues outreach job', async () => {
    mockLeadFindFirst.mockResolvedValue(READY_LEAD as never);
    mockCampaignFindFirst.mockResolvedValue(ACTIVE_CAMPAIGN as never);

    await enrolLeadIfReady('lead-001', 'user-001');

    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assignedCampaignId: 'campaign-001',
          outreachStage: 'InOutreach',
        }),
      })
    );
    // scheduleChannelSteps (mocked) is now called instead of direct outreach queue add
    const { scheduleChannelSteps } = jest.requireMock('../src/orchestration/channel-sequencer') as { scheduleChannelSteps: jest.Mock };
    expect(scheduleChannelSteps).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'lead-001', campaignId: 'campaign-001' })
    );
  });

  it('does nothing if no active campaign exists', async () => {
    mockLeadFindFirst.mockResolvedValue(READY_LEAD as never);
    mockCampaignFindFirst.mockResolvedValue(null);

    await enrolLeadIfReady('lead-001', 'user-001');

    expect(mockLeadUpdate).not.toHaveBeenCalled();
    expect(mockOutreachAdd).not.toHaveBeenCalled();
  });

  it('does nothing if lead is not ReadyForOutreach or already assigned', async () => {
    mockLeadFindFirst.mockResolvedValue(null); // findFirst returns null when filters don't match

    await enrolLeadIfReady('lead-001', 'user-001');

    expect(mockLeadUpdate).not.toHaveBeenCalled();
  });

  it('does nothing if lead has dncFlag set', async () => {
    mockLeadFindFirst.mockResolvedValue(null); // dnc leads filtered by findFirst

    await enrolLeadIfReady('lead-001', 'user-001');

    expect(mockLeadUpdate).not.toHaveBeenCalled();
  });
});

// ─── queueEnrichmentForLead ───────────────────────────────────────────────────

describe('queueEnrichmentForLead', () => {
  it('queues an enrichment job with leadId and linkedinUrl', async () => {
    await queueEnrichmentForLead('lead-001', 'user-001', 'https://linkedin.com/in/jane');

    expect(mockEnrichmentAdd).toHaveBeenCalledWith(
      'enrich:lead-001',
      { leadId: 'lead-001', clientId: 'user-001', linkedinUrl: 'https://linkedin.com/in/jane' },
      { jobId: 'enrich-lead-001' }
    );
  });

  it('queues an enrichment job without linkedinUrl if not provided', async () => {
    await queueEnrichmentForLead('lead-002', 'user-001');

    expect(mockEnrichmentAdd).toHaveBeenCalledWith(
      'enrich:lead-002',
      { leadId: 'lead-002', clientId: 'user-001', linkedinUrl: undefined },
      { jobId: 'enrich-lead-002' }
    );
  });
});
