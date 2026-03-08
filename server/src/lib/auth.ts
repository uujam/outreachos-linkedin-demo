import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const BCRYPT_ROUNDS = 12;
const LOCKOUT_MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// In-memory lockout store (keyed by email). For production this should be in Redis.
interface LockoutEntry {
  attempts: number;
  lockedUntil: number | null;
}
const lockoutStore = new Map<string, LockoutEntry>();

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export interface JwtPayload {
  sub: string;   // user id
  role: string;
  iat?: number;
  exp?: number;
}

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return secret;
}

const JWT_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60; // 7 days

export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, jwtSecret(), {
    expiresIn: JWT_EXPIRES_IN_SECONDS,
  });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, jwtSecret()) as JwtPayload;
}

// ─── Lockout helpers ──────────────────────────────────────────────────────────

export function isLockedOut(email: string): boolean {
  const entry = lockoutStore.get(email);
  if (!entry || entry.lockedUntil === null) return false;
  if (Date.now() < entry.lockedUntil) return true;
  // Lockout expired — reset
  lockoutStore.delete(email);
  return false;
}

export function recordFailedAttempt(email: string): void {
  const entry = lockoutStore.get(email) ?? { attempts: 0, lockedUntil: null };
  entry.attempts += 1;
  if (entry.attempts >= LOCKOUT_MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
  }
  lockoutStore.set(email, entry);
}

export function clearFailedAttempts(email: string): void {
  lockoutStore.delete(email);
}

export function getLockoutRemainingMs(email: string): number {
  const entry = lockoutStore.get(email);
  if (!entry?.lockedUntil) return 0;
  return Math.max(0, entry.lockedUntil - Date.now());
}

// Exposed for tests
export { lockoutStore };
