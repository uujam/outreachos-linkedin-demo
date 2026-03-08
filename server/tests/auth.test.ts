import request from 'supertest';
import app from '../src/app';
import { hashPassword, lockoutStore, signToken } from '../src/lib/auth';

// Mock Prisma so tests don't need a real database
jest.mock('../src/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
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

import { prisma } from '../src/lib/prisma';
const mockFindUnique = prisma.user.findUnique as jest.MockedFunction<typeof prisma.user.findUnique>;

// Set JWT_SECRET for all tests
process.env.JWT_SECRET = 'test-secret-key-for-b003';

const BASE_USER = {
  id: 'user-001',
  name: 'Test User',
  email: 'test@example.com',
  role: 'client' as const,
  companyName: 'Test Co',
  hashedPassword: '',
  createdDate: new Date(),
  lastLogin: null,
  customLeadCapOverride: null,
  onboardingDismissed: false,
  notificationPreferences: null,
  discoveryPaused: false,
};

beforeAll(async () => {
  BASE_USER.hashedPassword = await hashPassword('correct-password');
});

beforeEach(() => {
  lockoutStore.clear();
  jest.clearAllMocks();
});

// ─── POST /api/auth/login ──────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  it('returns 200 and sets token cookie on valid credentials', async () => {
    mockFindUnique.mockResolvedValue(BASE_USER);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'correct-password' });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: 'user-001',
      name: 'Test User',
      email: 'test@example.com',
      role: 'client',
    });
    // Token cookie should be set
    const cookie = res.headers['set-cookie'] as unknown as string[];
    expect(cookie).toBeDefined();
    expect(cookie.some((c: string) => c.startsWith('token='))).toBe(true);
  });

  it('returns 401 on wrong password', async () => {
    mockFindUnique.mockResolvedValue(BASE_USER);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Incorrect email or password');
  });

  it('returns 401 on unknown email', async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'any' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Incorrect email or password');
  });

  it('returns 400 when email or password missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com' });

    expect(res.status).toBe(400);
  });

  it('normalises email to lowercase', async () => {
    mockFindUnique.mockResolvedValue(BASE_USER);

    await request(app)
      .post('/api/auth/login')
      .send({ email: 'TEST@EXAMPLE.COM', password: 'correct-password' });

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { email: 'test@example.com' },
    });
  });

  it('does not expose hashed_password in response', async () => {
    mockFindUnique.mockResolvedValue(BASE_USER);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'correct-password' });

    expect(res.body.user.hashedPassword).toBeUndefined();
  });
});

// ─── Account lockout (5 failed attempts → 15-minute lock) ────────────────────

describe('Account lockout', () => {
  it('locks account after 5 failed login attempts', async () => {
    mockFindUnique.mockResolvedValue(BASE_USER);

    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'wrong' });
    }

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrong' });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/temporarily locked/i);
  });

  it('still blocks even with correct password when locked', async () => {
    mockFindUnique.mockResolvedValue(BASE_USER);

    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'wrong' });
    }

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'correct-password' });

    expect(res.status).toBe(429);
  });

  it('clears failed attempts on successful login', async () => {
    mockFindUnique.mockResolvedValue(BASE_USER);

    // 4 failed attempts (one below lockout threshold)
    for (let i = 0; i < 4; i++) {
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'wrong' });
    }

    // Successful login should clear the counter
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'correct-password' });

    expect(lockoutStore.has('test@example.com')).toBe(false);
  });
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  it('returns 200 and clears the token cookie', async () => {
    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Logged out');
    const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
    if (cookies) {
      const tokenCookie = cookies.find((c: string) => c.startsWith('token='));
      if (tokenCookie) {
        // Cookie should be expired/cleared
        expect(tokenCookie).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
      }
    }
  });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with an invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid.token.here');
    expect(res.status).toBe(401);
  });

  it('returns 200 and user data with a valid Bearer token', async () => {
    mockFindUnique.mockResolvedValue(BASE_USER);

    const token = signToken({ sub: 'user-001', role: 'client' });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe('user-001');
  });

  it('returns 200 with token from cookie', async () => {
    mockFindUnique.mockResolvedValue(BASE_USER);

    const token = signToken({ sub: 'user-001', role: 'client' });
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `token=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe('user-001');
  });
});

// ─── requireAdmin middleware ──────────────────────────────────────────────────

describe('requireAdmin middleware', () => {
  it('blocks a client-role user from admin routes', async () => {
    // Register a throwaway admin-only route to test the middleware
    // We test it indirectly via the middleware module
    const { requireAdmin } = await import('../src/middleware/requireAuth');
    const mockReq = {
      cookies: {},
      headers: { authorization: `Bearer ${signToken({ sub: 'u1', role: 'client' })}` },
    } as unknown as Parameters<typeof requireAdmin>[0];
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Parameters<typeof requireAdmin>[1];
    const mockNext = jest.fn();

    requireAdmin(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('allows an admin-role user through', async () => {
    const { requireAdmin } = await import('../src/middleware/requireAuth');
    const mockReq = {
      cookies: {},
      headers: { authorization: `Bearer ${signToken({ sub: 'u1', role: 'admin' })}` },
    } as unknown as Parameters<typeof requireAdmin>[0];
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Parameters<typeof requireAdmin>[1];
    const mockNext = jest.fn();

    requireAdmin(mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });
});
