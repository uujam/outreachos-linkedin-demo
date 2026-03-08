/**
 * B-007d Fit scoring tests
 * Covers: scoreLead happy path, Claude API error handling, scoring worker,
 * rescore on ICP save.
 */

// ─── Mock Anthropic SDK ───────────────────────────────────────────────────────

const mockMessagesCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  const MockClass = jest.fn().mockImplementation(() => ({
    messages: { create: mockMessagesCreate },
  }));
  return { __esModule: true, default: MockClass };
});

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    lead: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    icpSettings: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
  },
  checkDatabaseHealth: jest.fn().mockResolvedValue(true),
}));

const mockScoringAdd = jest.fn().mockResolvedValue({});

jest.mock('../src/queues', () => ({
  QUEUE_NAMES: ['enrichment', 'outreach', 'discovery', 'scoring', 'follow-up', 'notifications'],
  getQueues: jest.fn(() => ({
    scoring: { add: mockScoringAdd },
    discovery: { add: jest.fn(), removeRepeatable: jest.fn() },
    outreach: { add: jest.fn() },
    enrichment: { add: jest.fn() },
    'follow-up': { add: jest.fn() },
    notifications: { add: jest.fn() },
  })),
  getDlqs: jest.fn(),
  checkQueuesHealth: jest.fn().mockResolvedValue({}),
  wireDlqForwarding: jest.fn(),
  closeQueues: jest.fn(),
}));

jest.mock('../src/lib/redis', () => ({
  getRedisClient: jest.fn(),
  checkRedisHealth: jest.fn().mockResolvedValue(true),
  closeRedis: jest.fn(),
}));

import { scoreLead } from '../src/lib/fitScoring';
import { prisma } from '../src/lib/prisma';
import { rescoreActiveLeads } from '../src/orchestration/automationTrigger';

const mockLeadFindMany = prisma.lead.findMany as jest.MockedFunction<typeof prisma.lead.findMany>;

const SAMPLE_LEAD = {
  fullName: 'Jane Smith',
  jobTitle: 'CEO',
  company: 'ACME Ltd',
  linkedinUrl: 'https://linkedin.com/in/jane',
};

const SAMPLE_ICP = {
  jobTitles: ['CEO', 'MD', 'Founder'],
  industries: ['Technology', 'SaaS'],
  geography: ['London', 'UK'],
  employeeRange: '10-50',
  revenueRange: '£1m-£5m',
  buyingSignals: 'hiring growth scaling',
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── scoreLead ────────────────────────────────────────────────────────────────

describe('scoreLead', () => {
  it('returns score and reasoning from Claude API', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"score": 87, "reasoning": "Strong CEO title and SaaS company in London."}' }],
    });

    const result = await scoreLead({ lead: SAMPLE_LEAD, icp: SAMPLE_ICP });

    expect(result.score).toBe(87);
    expect(result.reasoning).toContain('CEO');
  });

  it('clamps score to 100 when Claude returns value above 100', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"score": 150, "reasoning": "Perfect match."}' }],
    });

    const result = await scoreLead({ lead: SAMPLE_LEAD, icp: SAMPLE_ICP });
    expect(result.score).toBe(100);
  });

  it('returns null score and reasoning on Claude API error', async () => {
    mockMessagesCreate.mockRejectedValue(new Error('Claude API unavailable'));

    const result = await scoreLead({ lead: SAMPLE_LEAD, icp: SAMPLE_ICP });

    expect(result.score).toBeNull();
    expect(result.reasoning).toBeNull();
  });

  it('returns null when Claude returns invalid JSON', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'I cannot score this lead.' }],
    });

    const result = await scoreLead({ lead: SAMPLE_LEAD, icp: SAMPLE_ICP });
    expect(result.score).toBeNull();
  });
});

// ─── rescoreActiveLeads ───────────────────────────────────────────────────────

describe('rescoreActiveLeads', () => {
  it('queues scoring jobs for all active leads', async () => {
    mockLeadFindMany.mockResolvedValue([
      { id: 'lead-001' } as never,
      { id: 'lead-002' } as never,
    ]);

    await rescoreActiveLeads('user-001');

    expect(mockScoringAdd).toHaveBeenCalledTimes(2);
    expect(mockScoringAdd).toHaveBeenCalledWith(
      'score:lead-001',
      { leadId: 'lead-001', clientId: 'user-001' },
      expect.any(Object)
    );
    expect(mockScoringAdd).toHaveBeenCalledWith(
      'score:lead-002',
      { leadId: 'lead-002', clientId: 'user-001' },
      expect.any(Object)
    );
  });

  it('does nothing when client has no active leads', async () => {
    mockLeadFindMany.mockResolvedValue([]);

    await rescoreActiveLeads('user-empty');

    expect(mockScoringAdd).not.toHaveBeenCalled();
  });
});
