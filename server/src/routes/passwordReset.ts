import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { generatePasswordResetToken, resetPassword } from '../lib/passwordReset';
import { sendPasswordResetEmail } from '../lib/email';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts — please wait before trying again.' },
  skip: () => process.env.NODE_ENV === 'test',
});

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

// POST /api/auth/forgot-password
// Always returns 200 to prevent email enumeration
router.post('/auth/forgot-password', authLimiter, async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };

  if (!email) {
    res.status(400).json({ error: 'Email is required' });
    return;
  }

  const token = await generatePasswordResetToken(email);

  if (token) {
    const resetUrl = `${APP_URL}/reset-password?token=${token}`;
    await sendPasswordResetEmail(email.toLowerCase().trim(), resetUrl).catch(() => {
      // Log but don't surface email send failures to the client
      console.error(`[PasswordReset] Failed to send reset email to ${email}`);
    });
  }

  // Always return 200 — don't reveal whether the email exists
  res.status(200).json({ message: 'If that email is registered, a reset link has been sent.' });
});

// POST /api/auth/reset-password
router.post('/auth/reset-password', authLimiter, async (req: Request, res: Response) => {
  const { token, password } = req.body as { token?: string; password?: string };

  if (!token || !password) {
    res.status(400).json({ error: 'Token and new password are required' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  const result = await resetPassword(token, password);

  if (!result.success) {
    res.status(400).json({
      error: result.error === 'expired'
        ? 'Reset link has expired. Please request a new one.'
        : 'Invalid or already-used reset link.',
    });
    return;
  }

  res.status(200).json({ message: 'Password updated successfully. Please log in.' });
});

export default router;
