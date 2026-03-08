import request from 'supertest';
import app from '../src/app';
import { signToken } from '../src/lib/auth';

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    company: { upsert: jest.fn() },
    lead: { create: jest.fn() },
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
  getQueues: jest.fn(), getDlqs: jest.fn(),
  checkQueuesHealth: jest.fn().mockResolvedValue({
    enrichment: true, outreach: true, discovery: true,
    scoring: true, 'follow-up': true, notifications: true,
  }),
  wireDlqForwarding: jest.fn(), closeQueues: jest.fn(),
}));

jest.mock('../src/lib/companiesHouse', () => ({
  searchCompanies: jest.fn(),
  getCompany: jest.fn(),
}));

import { prisma } from '../src/lib/prisma';
import { searchCompanies } from '../src/lib/companiesHouse';

const mockSearchCompanies = searchCompanies as jest.MockedFunction<typeof searchCompanies>;
const mockLeadCreate = prisma.lead.create as jest.MockedFunction<typeof prisma.lead.create>;
const mockCompanyUpsert = prisma.company.upsert as jest.MockedFunction<typeof prisma.company.upsert>;

process.env.JWT_SECRET = 'test-secret-key-for-b003';
const clientToken = `Bearer ${signToken({ sub: 'user-001', role: 'client' })}`;

const SAMPLE_SEARCH_RESPONSE = {
  results: [
    {
      companiesHouseNumber: '12345678',
      companyName: 'ACME SOFTWARE LTD',
      companyStatus: 'active',
      companyType: 'ltd',
      dateOfCreation: '2015-03-10',
      addressSnippet: '10 Tech Street, London, EC1A 1AA',
      sicCodes: ['62012'],
    },
  ],
  totalResults: 1,
  pageNumber: 1,
  itemsPerPage: 20,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCompanyUpsert.mockResolvedValue({} as never);
});

// ─── GET /api/companies-house/search ─────────────────────────────────────────

describe('GET /api/companies-house/search', () => {
  it('returns 401 with no auth token', async () => {
    const res = await request(app).get('/api/companies-house/search?q=acme');
    expect(res.status).toBe(401);
  });

  it('returns 400 when q param is missing', async () => {
    const res = await request(app)
      .get('/api/companies-house/search')
      .set('Authorization', clientToken);

    expect(res.status).toBe(400);
  });

  it('returns search results from Companies House API', async () => {
    mockSearchCompanies.mockResolvedValue(SAMPLE_SEARCH_RESPONSE);

    const res = await request(app)
      .get('/api/companies-house/search?q=acme')
      .set('Authorization', clientToken);

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].companiesHouseNumber).toBe('12345678');
    expect(res.body.totalResults).toBe(1);
  });

  it('passes page and itemsPerPage to the API client', async () => {
    mockSearchCompanies.mockResolvedValue(SAMPLE_SEARCH_RESPONSE);

    await request(app)
      .get('/api/companies-house/search?q=acme&page=2&itemsPerPage=50')
      .set('Authorization', clientToken);

    expect(mockSearchCompanies).toHaveBeenCalledWith('acme', 2, 50);
  });

  it('caps itemsPerPage at 100', async () => {
    mockSearchCompanies.mockResolvedValue(SAMPLE_SEARCH_RESPONSE);

    await request(app)
      .get('/api/companies-house/search?q=acme&itemsPerPage=999')
      .set('Authorization', clientToken);

    expect(mockSearchCompanies).toHaveBeenCalledWith('acme', 1, 100);
  });
});

// ─── POST /api/companies-house/add-to-pipeline ───────────────────────────────

describe('POST /api/companies-house/add-to-pipeline', () => {
  const VALID_BODY = {
    companiesHouseNumber: '12345678',
    companyName: 'ACME SOFTWARE LTD',
    directorName: 'Jane Smith',
    region: 'London',
    sicCodes: ['62012'],
  };

  const CREATED_LEAD = {
    id: 'lead-001',
    clientId: 'user-001',
    fullName: 'Jane Smith',
    jobTitle: 'Director',
    company: 'ACME SOFTWARE LTD',
    source: 'CompaniesHouse',
    enrichmentStage: 'Discovered',
  };

  it('returns 401 with no auth token', async () => {
    const res = await request(app)
      .post('/api/companies-house/add-to-pipeline')
      .send(VALID_BODY);
    expect(res.status).toBe(401);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/companies-house/add-to-pipeline')
      .set('Authorization', clientToken)
      .send({ companyName: 'ACME' }); // missing companiesHouseNumber

    expect(res.status).toBe(400);
  });

  it('creates a lead at Discovered stage with CompaniesHouse source', async () => {
    mockLeadCreate.mockResolvedValue(CREATED_LEAD as never);

    const res = await request(app)
      .post('/api/companies-house/add-to-pipeline')
      .set('Authorization', clientToken)
      .send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body.lead.source).toBe('CompaniesHouse');
    expect(res.body.lead.enrichmentStage).toBe('Discovered');
  });

  it('scopes the lead to the authenticated client', async () => {
    mockLeadCreate.mockResolvedValue(CREATED_LEAD as never);

    await request(app)
      .post('/api/companies-house/add-to-pipeline')
      .set('Authorization', clientToken)
      .send(VALID_BODY);

    expect(mockLeadCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ clientId: 'user-001' }) })
    );
  });

  it('upserts the Company record in D-003', async () => {
    mockLeadCreate.mockResolvedValue(CREATED_LEAD as never);

    await request(app)
      .post('/api/companies-house/add-to-pipeline')
      .set('Authorization', clientToken)
      .send(VALID_BODY);

    expect(mockCompanyUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companiesHouseNumber: '12345678' } })
    );
  });
});
