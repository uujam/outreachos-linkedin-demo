import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import {
  verifyPassword,
  signToken,
  isLockedOut,
  recordFailedAttempt,
  clearFailedAttempts,
  getLockoutRemainingMs,
} from '../lib/auth';
import { requireAuth, AuthRequest } from '../middleware/requireAuth';

const router = Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  path: '/',
};

// POST /api/auth/login
router.post('/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const normalised = email.toLowerCase().trim();

  // Check lockout before hitting the database
  if (isLockedOut(normalised)) {
    const remainingMs = getLockoutRemainingMs(normalised);
    const remainingMins = Math.ceil(remainingMs / 60_000);
    res.status(429).json({
      error: `Account temporarily locked. Try again in ${remainingMins} minute${remainingMins === 1 ? '' : 's'}.`,
    });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email: normalised } });

  // Constant-time-like response to prevent user enumeration
  if (!user) {
    recordFailedAttempt(normalised);
    res.status(401).json({ error: 'Incorrect email or password' });
    return;
  }

  const valid = await verifyPassword(password, user.hashedPassword);
  if (!valid) {
    recordFailedAttempt(normalised);
    res.status(401).json({ error: 'Incorrect email or password' });
    return;
  }

  clearFailedAttempts(normalised);

  // Update last login (fire-and-forget — don't block the response)
  prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() },
  }).catch(() => {});

  const token = signToken({ sub: user.id, role: user.role });

  res.cookie('token', token, COOKIE_OPTIONS);
  res.status(200).json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      companyName: user.companyName,
    },
  });
});

// POST /api/auth/logout
router.post('/auth/logout', (_req: Request, res: Response) => {
  res.clearCookie('token', { path: '/' });
  res.status(200).json({ message: 'Logged out' });
});

// GET /api/auth/me — returns the currently authenticated user
router.get('/auth/me', requireAuth, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.sub },
    select: { id: true, name: true, email: true, role: true, companyName: true },
  });
  if (!user) {
    res.status(401).json({ error: 'User not found' });
    return;
  }
  res.status(200).json({ user });
});

export default router;
