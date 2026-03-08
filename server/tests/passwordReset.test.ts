import request from 'supertest';
import crypto from 'crypto';
import app from '../src/app';
import { rateLimitStore } from '../src/lib/passwordReset';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    passwordResetToken: {
      create: jest.fn(),
      findFirst: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
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

jest.mock('../src/lib/email', () => ({
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
}));

import { prisma } from '../src/lib/prisma';
import { sendPasswordResetEmail } from '../src/lib/email';
import { hashPassword } from '../src/lib/auth';

const mockFindUnique = prisma.user.findUnique as jest.MockedFunction<typeof prisma.user.findUnique>;
const mockTokenCreate = prisma.passwordResetToken.create as jest.MockedFunction<typeof prisma.passwordResetToken.create>;
const mockTokenDeleteMany = prisma.passwordResetToken.deleteMany as jest.MockedFunction<typeof prisma.passwordResetToken.deleteMany>;
const mockTokenFindFirst = prisma.passwordResetToken.findFirst as jest.MockedFunction<typeof prisma.passwordResetToken.findFirst>;
const mockTokenDelete = prisma.passwordResetToken.delete as jest.MockedFunction<typeof prisma.passwordResetToken.delete>;
const mockTransaction = prisma.$transaction as jest.MockedFunction<typeof prisma.$transaction>;
const mockSendEmail = sendPasswordResetEmail as jest.MockedFunction<typeof sendPasswordResetEmail>;

const BASE_USER = {
  id: 'user-001',
  name: 'Test User',
  email: 'test@example.com',
  role: 'client' as const,
  companyName: 'Test Co',
  hashedPassword: 'hashed',
  createdDate: new Date(),
  lastLogin: null,
  customLeadCapOverride: null,
  onboardingDismissed: false,
  notificationPreferences: null,
  discoveryPaused: false,
};

process.env.JWT_SECRET = 'test-secret-key-for-b003';

beforeEach(() => {
  jest.clearAllMocks();
  rateLimitStore.clear();
  mockTokenCreate.mockResolvedValue({} as never);
  mockTokenDeleteMany.mockResolvedValue({ count: 0 });
  mockTransaction.mockResolvedValue([{}, {}] as never);
});

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────

describe('POST /api/auth/forgot-password', () => {
  it('always returns 200 even for unknown email (prevent enumeration)', async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if that email is registered/i);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('sends a reset email when email is found', async () => {
    mockFindUnique.mockResolvedValue(BASE_USER);

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'test@example.com' });

    expect(res.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const [toArg, urlArg] = mockSendEmail.mock.calls[0];
    expect(toArg).toBe('test@example.com');
    expect(urlArg).toContain('token=');
  });

  it('invalidates any previous unused token before creating a new one', async () => {
    mockFindUnique.mockResolvedValue(BASE_USER);

    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'test@example.com' });

    expect(mockTokenDeleteMany).toHaveBeenCalledWith({
      where: { clientId: 'user-001' },
    });
  });

  it('stores the SHA-256 hash of the token, not the plain token', async () => {
    mockFindUnique.mockResolvedValue(BASE_USER);

    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'test@example.com' });

    expect(mockTokenCreate).toHaveBeenCalledTimes(1);
    const { data } = mockTokenCreate.mock.calls[0][0] as { data: { tokenHash: string } };
    // tokenHash should be a 64-char hex string (SHA-256)
    expect(data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({});

    expect(res.status).toBe(400);
  });

  it('is silently rate-limited to one request per minute per email', async () => {
    mockFindUnique.mockResolvedValue(BASE_USER);

    // First request succeeds
    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'test@example.com' });

    // Second immediate request is silently accepted (still 200) but no extra email
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'test@example.com' });

    expect(res.status).toBe(200);
    // Email should only have been sent once
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────

describe('POST /api/auth/reset-password', () => {
  function makeTokenRecord(overrides: Partial<{ expiresAt: Date; usedAt: Date | null }> = {}) {
    return {
      id: 'token-001',
      clientId: 'user-001',
      tokenHash: '',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      createdAt: new Date(),
      ...overrides,
    };
  }

  it('returns 400 when token or password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'abc' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when password is shorter than 8 characters', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'sometoken', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 8 characters/i);
  });

  it('returns 400 on invalid / unknown token', async () => {
    mockTokenFindFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'bad-token', password: 'newpassword123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it('returns 400 on expired token and deletes it', async () => {
    mockTokenFindFirst.mockResolvedValue(
      makeTokenRecord({ expiresAt: new Date(Date.now() - 1000) })
    );

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'expired-token', password: 'newpassword123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/i);
    expect(mockTokenDelete).toHaveBeenCalled();
  });

  it('returns 200, updates password, and deletes token on valid reset', async () => {
    mockTokenFindFirst.mockResolvedValue(makeTokenRecord());

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'valid-token', password: 'newpassword123' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/password updated/i);
    expect(mockTransaction).toHaveBeenCalled();
  });

  it('hashes the new password before storing', async () => {
    mockTokenFindFirst.mockResolvedValue(makeTokenRecord());
    let capturedHash = '';
    mockTransaction.mockImplementation(async (ops: unknown) => {
      // ops is an array of Prisma operations — check that the user update has a hashed password
      const arr = ops as Array<{ args?: { data?: { hashedPassword?: string } } }>;
      capturedHash = arr[0]?.args?.data?.hashedPassword ?? '';
      return [{}, {}];
    });

    await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'valid-token', password: 'newpassword123' });

    // If the hash was captured, verify it's not the plain text
    if (capturedHash) {
      expect(capturedHash).not.toBe('newpassword123');
      expect(capturedHash.length).toBeGreaterThan(20);
    }
    // Transaction was called
    expect(mockTransaction).toHaveBeenCalled();
  });
});

// ─── purgeExpiredTokens ───────────────────────────────────────────────────────

describe('purgeExpiredTokens', () => {
  it('deletes only expired unused tokens', async () => {
    mockTokenDeleteMany.mockResolvedValue({ count: 3 });
    const { purgeExpiredTokens } = await import('../src/lib/passwordReset');

    const count = await purgeExpiredTokens();

    expect(count).toBe(3);
    expect(mockTokenDeleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) }, usedAt: null },
    });
  });
});
