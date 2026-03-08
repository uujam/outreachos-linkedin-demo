/**
 * B-007a Enrichment tests
 * Tests the pipeline, individual providers (mocked), cache behaviour, and Clay webhook.
 */
import request from 'supertest';
import app from '../src/app';

// ─── Prisma mock ──────────────────────────────────────────────────────────────

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    lead: { findUnique: jest.fn(), update: jest.fn() },
    enrichmentCache: { findUnique: jest.fn(), upsert: jest.fn() },
    enrichmentLog: { create: jest.fn().mockResolvedValue({}) },
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
  getQueues: jest.fn(() => ({
    scoring: { add: jest.fn().mockResolvedValue({}) },
    enrichment: { add: jest.fn().mockResolvedValue({}) },
    outreach: { add: jest.fn().mockResolvedValue({}) },
    discovery: { add: jest.fn().mockResolvedValue({}) },
    'follow-up': { add: jest.fn().mockResolvedValue({}) },
    notifications: { add: jest.fn().mockResolvedValue({}) },
  })),
  getDlqs: jest.fn(),
  checkQueuesHealth: jest.fn().mockResolvedValue({
    enrichment: true, outreach: true, discovery: true,
    scoring: true, 'follow-up': true, notifications: true,
  }),
  wireDlqForwarding: jest.fn(), closeQueues: jest.fn(),
}));

// ─── Provider mocks ───────────────────────────────────────────────────────────

jest.mock('../src/enrichment/proxycurl', () => ({ lookupByLinkedinUrl: jest.fn() }));
jest.mock('../src/enrichment/apollo', () => ({ findEmailByLinkedIn: jest.fn() }));
jest.mock('../src/enrichment/hunter', () => ({ findEmailByDomain: jest.fn() }));
jest.mock('../src/enrichment/zerobounce', () => ({ validateEmail: jest.fn() }));
jest.mock('../src/enrichment/clay', () => ({ submitToClayBatch: jest.fn() }));

import { prisma } from '../src/lib/prisma';
import { lookupByLinkedinUrl } from '../src/enrichment/proxycurl';
import { findEmailByLinkedIn } from '../src/enrichment/apollo';
import { findEmailByDomain } from '../src/enrichment/hunter';
import { validateEmail } from '../src/enrichment/zerobounce';
import { submitToClayBatch } from '../src/enrichment/clay';
import { runEnrichmentPipeline } from '../src/enrichment/pipeline';

const mockLookup = lookupByLinkedinUrl as jest.MockedFunction<typeof lookupByLinkedinUrl>;
const mockApollo = findEmailByLinkedIn as jest.MockedFunction<typeof findEmailByLinkedIn>;
const mockHunter = findEmailByDomain as jest.MockedFunction<typeof findEmailByDomain>;
const mockZb = validateEmail as jest.MockedFunction<typeof validateEmail>;
const mockClay = submitToClayBatch as jest.MockedFunction<typeof submitToClayBatch>;
const mockLeadFindUnique = prisma.lead.findUnique as jest.MockedFunction<typeof prisma.lead.findUnique>;
const mockLeadUpdate = prisma.lead.update as jest.MockedFunction<typeof prisma.lead.update>;
const mockCacheFind = prisma.enrichmentCache.findUnique as jest.MockedFunction<typeof prisma.enrichmentCache.findUnique>;
const mockCacheUpsert = prisma.enrichmentCache.upsert as jest.MockedFunction<typeof prisma.enrichmentCache.upsert>;

const BASE_LEAD = {
  id: 'lead-001',
  clientId: 'user-001',
  fullName: 'Jane Smith',
  jobTitle: 'CEO',
  company: 'ACME Ltd',
  linkedinUrl: 'https://linkedin.com/in/jane',
  emailAddress: null,
  phoneNumber: null,
  enrichmentStage: 'Discovered',
  dncFlag: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLeadUpdate.mockResolvedValue({} as never);
  mockCacheUpsert.mockResolvedValue({} as never);
  (prisma.enrichmentLog.create as jest.Mock).mockResolvedValue({});
});

// ─── Pipeline: full happy path ────────────────────────────────────────────────

describe('runEnrichmentPipeline — happy path', () => {
  it('progresses lead to ReadyForOutreach when all steps succeed', async () => {
    mockLeadFindUnique.mockResolvedValue(BASE_LEAD as never);
    mockCacheFind.mockResolvedValue(null);
    mockLookup.mockResolvedValue({ success: true, provider: 'ProxyCurl', data: { fullName: 'Jane Smith', jobTitle: 'CEO', company: 'ACME Ltd' } });
    mockApollo.mockResolvedValue({ success: true, provider: 'ApolloIo', data: { email: 'jane@acme.com', companyDomain: 'acme.com', sourceEmail: 'ApolloIo' } });
    mockZb.mockResolvedValue({ success: true, provider: 'ZeroBounce', data: { emailDeliverable: true, emailDeliverableReason: 'valid', sourceVerified: 'ZeroBounce' } });

    await runEnrichmentPipeline({ leadId: 'lead-001', clientId: 'user-001', linkedinUrl: 'https://linkedin.com/in/jane' });

    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ enrichmentStage: 'ReadyForOutreach' }) })
    );
  });

  it('writes to enrichment cache after each successful provider', async () => {
    mockLeadFindUnique.mockResolvedValue(BASE_LEAD as never);
    mockCacheFind.mockResolvedValue(null);
    mockLookup.mockResolvedValue({ success: true, provider: 'ProxyCurl', data: { fullName: 'Jane Smith' } });
    mockApollo.mockResolvedValue({ success: true, provider: 'ApolloIo', data: { email: 'jane@acme.com', companyDomain: 'acme.com', sourceEmail: 'ApolloIo' } });
    mockZb.mockResolvedValue({ success: true, provider: 'ZeroBounce', data: { emailDeliverable: true, sourceVerified: 'ZeroBounce' } });

    await runEnrichmentPipeline({ leadId: 'lead-001', clientId: 'user-001', linkedinUrl: 'https://linkedin.com/in/jane' });

    expect(mockCacheUpsert).toHaveBeenCalled();
  });
});

// ─── Pipeline: cache hit ──────────────────────────────────────────────────────

describe('runEnrichmentPipeline — cache hit', () => {
  it('skips all API calls and marks lead Ready when fresh cache hit found', async () => {
    mockLeadFindUnique.mockResolvedValue(BASE_LEAD as never);
    mockCacheFind.mockResolvedValueOnce(null).mockResolvedValueOnce({
      cacheKey: 'https://linkedin.com/in/jane',
      email: 'jane@acme.com',
      emailDeliverable: true,
      lastVerifiedAt: new Date(),
      globalSuppression: false,
      fullName: 'Jane Smith', jobTitle: 'CEO', companyName: 'ACME', companyDomain: 'acme.com',
      linkedinUrl: 'https://linkedin.com/in/jane', phone: null,
      sourceLinkedin: 'ProxyCurl', sourceEmail: 'ApolloIo', sourceVerified: 'ZeroBounce',
    } as never);

    await runEnrichmentPipeline({ leadId: 'lead-001', clientId: 'user-001', linkedinUrl: 'https://linkedin.com/in/jane' });

    expect(mockLookup).not.toHaveBeenCalled();
    expect(mockApollo).not.toHaveBeenCalled();
    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ enrichmentStage: 'ReadyForOutreach' }) })
    );
  });
});

// ─── Pipeline: global suppression ────────────────────────────────────────────

describe('runEnrichmentPipeline — global suppression', () => {
  it('sets dncFlag and InvalidEmail stage when global suppression is true', async () => {
    mockLeadFindUnique.mockResolvedValue(BASE_LEAD as never);
    mockCacheFind.mockResolvedValue({ globalSuppression: true } as never);

    await runEnrichmentPipeline({ leadId: 'lead-001', clientId: 'user-001' });

    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { dncFlag: true, enrichmentStage: 'InvalidEmail' } })
    );
    expect(mockLookup).not.toHaveBeenCalled();
  });
});

// ─── Pipeline: Apollo fallback to Hunter ─────────────────────────────────────

describe('runEnrichmentPipeline — Apollo fails, Hunter succeeds', () => {
  it('falls back to Hunter when Apollo returns no email', async () => {
    mockLeadFindUnique.mockResolvedValue(BASE_LEAD as never);
    mockCacheFind.mockResolvedValue(null);
    mockLookup.mockResolvedValue({ success: true, provider: 'ProxyCurl', data: { fullName: 'Jane Smith', companyDomain: 'acme.com' } });
    mockApollo.mockResolvedValue({ success: false, provider: 'ApolloIo', data: {} });
    mockHunter.mockResolvedValue({ success: true, provider: 'HunterIo', data: { email: 'jane@acme.com', sourceEmail: 'HunterIo' } });
    mockZb.mockResolvedValue({ success: true, provider: 'ZeroBounce', data: { emailDeliverable: true, sourceVerified: 'ZeroBounce' } });

    await runEnrichmentPipeline({ leadId: 'lead-001', clientId: 'user-001', linkedinUrl: 'https://linkedin.com/in/jane' });

    expect(mockHunter).toHaveBeenCalled();
    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ enrichmentStage: 'ReadyForOutreach' }) })
    );
  });
});

// ─── Pipeline: all providers fail → Clay ─────────────────────────────────────

describe('runEnrichmentPipeline — all providers fail', () => {
  it('submits to Clay when Apollo and Hunter both fail', async () => {
    mockLeadFindUnique.mockResolvedValue(BASE_LEAD as never);
    mockCacheFind.mockResolvedValue(null);
    mockLookup.mockResolvedValue({ success: true, provider: 'ProxyCurl', data: {} });
    mockApollo.mockResolvedValue({ success: false, provider: 'ApolloIo', data: {} });
    mockHunter.mockResolvedValue({ success: false, provider: 'HunterIo', data: {} });
    mockClay.mockResolvedValue({ success: true, provider: 'Clay', data: {} });

    await runEnrichmentPipeline({ leadId: 'lead-001', clientId: 'user-001', linkedinUrl: 'https://linkedin.com/in/jane' });

    expect(mockClay).toHaveBeenCalled();
  });
});

// ─── Pipeline: invalid email ──────────────────────────────────────────────────

describe('runEnrichmentPipeline — invalid email', () => {
  it('marks lead as InvalidEmail when ZeroBounce returns not deliverable', async () => {
    mockLeadFindUnique.mockResolvedValue(BASE_LEAD as never);
    mockCacheFind.mockResolvedValue(null);
    mockLookup.mockResolvedValue({ success: true, provider: 'ProxyCurl', data: {} });
    mockApollo.mockResolvedValue({ success: true, provider: 'ApolloIo', data: { email: 'bad@spam.com', sourceEmail: 'ApolloIo' } });
    mockZb.mockResolvedValue({ success: true, provider: 'ZeroBounce', data: { emailDeliverable: false, emailDeliverableReason: 'spamtrap', sourceVerified: 'ZeroBounce' } });

    await runEnrichmentPipeline({ leadId: 'lead-001', clientId: 'user-001', linkedinUrl: 'https://linkedin.com/in/jane' });

    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ enrichmentStage: 'InvalidEmail' }) })
    );
  });
});

// ─── Clay webhook ─────────────────────────────────────────────────────────────

describe('POST /api/enrichment/clay-webhook', () => {
  beforeEach(() => {
    (prisma.lead.findUnique as jest.Mock).mockResolvedValue(BASE_LEAD);
  });

  it('updates lead to ReadyForOutreach on valid Clay result', async () => {
    const res = await request(app)
      .post('/api/enrichment/clay-webhook')
      .send({ reference_id: 'lead-001', person: { email: 'jane@acme.com', email_deliverable: true } });

    expect(res.status).toBe(200);
    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ enrichmentStage: 'ReadyForOutreach' }) })
    );
  });

  it('marks lead as InvalidEmail when Clay says email not deliverable', async () => {
    const res = await request(app)
      .post('/api/enrichment/clay-webhook')
      .send({ reference_id: 'lead-001', person: { email: 'bad@spam.com', email_deliverable: false } });

    expect(res.status).toBe(200);
    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ enrichmentStage: 'InvalidEmail' }) })
    );
  });

  it('marks lead InvalidEmail when Clay returns no email', async () => {
    const res = await request(app)
      .post('/api/enrichment/clay-webhook')
      .send({ reference_id: 'lead-001', person: {} });

    expect(res.status).toBe(200);
    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { enrichmentStage: 'InvalidEmail' } })
    );
  });

  it('returns 404 for unknown lead', async () => {
    (prisma.lead.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .post('/api/enrichment/clay-webhook')
      .send({ reference_id: 'bad-lead' });

    expect(res.status).toBe(404);
  });

  it('returns 400 when reference_id is missing', async () => {
    const res = await request(app)
      .post('/api/enrichment/clay-webhook')
      .send({});

    expect(res.status).toBe(400);
  });
});
