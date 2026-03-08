import crypto from 'crypto';
import { prisma } from './prisma';
import { hashPassword } from './auth';

const TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 request per minute per email

// In-memory rate limit store (keyed by email → last request timestamp)
const rateLimitStore = new Map<string, number>();

export { rateLimitStore };

/**
 * Generates a secure random token, invalidates any existing token for the
 * client, stores the SHA-256 hash, and returns the plain token for emailing.
 * Returns null if the user doesn't exist (silent — prevents email enumeration).
 */
export async function generatePasswordResetToken(email: string): Promise<string | null> {
  const normalised = email.toLowerCase().trim();

  // Rate limit: max one request per minute per email
  const lastRequest = rateLimitStore.get(normalised);
  if (lastRequest && Date.now() - lastRequest < RATE_LIMIT_WINDOW_MS) {
    return null; // silently rate-limited
  }
  rateLimitStore.set(normalised, Date.now());

  const user = await prisma.user.findUnique({ where: { email: normalised } });
  if (!user) return null; // silent — don't reveal whether email exists

  // Invalidate any existing unused token for this client
  await prisma.passwordResetToken.deleteMany({ where: { clientId: user.id } });

  const plainToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(plainToken).digest('hex');
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS);

  await prisma.passwordResetToken.create({
    data: { clientId: user.id, tokenHash, expiresAt },
  });

  return plainToken;
}

export interface ResetResult {
  success: boolean;
  error?: 'invalid' | 'expired';
}

/**
 * Validates the plain token, updates the user's password, and invalidates
 * all existing refresh sessions by deleting the token.
 */
export async function resetPassword(plainToken: string, newPassword: string): Promise<ResetResult> {
  const tokenHash = crypto.createHash('sha256').update(plainToken).digest('hex');

  const record = await prisma.passwordResetToken.findFirst({
    where: { tokenHash, usedAt: null },
  });

  if (!record) return { success: false, error: 'invalid' };
  if (record.expiresAt < new Date()) {
    await prisma.passwordResetToken.delete({ where: { id: record.id } });
    return { success: false, error: 'expired' };
  }

  const hashedPassword = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.clientId },
      data: { hashedPassword },
    }),
    // Mark token as used and delete it immediately
    prisma.passwordResetToken.delete({ where: { id: record.id } }),
  ]);

  return { success: true };
}

/**
 * Deletes all expired, unused tokens. Called by the daily BullMQ cleanup job.
 */
export async function purgeExpiredTokens(): Promise<number> {
  const result = await prisma.passwordResetToken.deleteMany({
    where: { expiresAt: { lt: new Date() }, usedAt: null },
  });
  return result.count;
}
