/**
 * B-011a — Integration OAuth helpers (F-027).
 * Handles token encryption/decryption, OAuth URL construction, code exchange,
 * token refresh, Calendly webhook registration/deregistration, and calendar event creation.
 */
import crypto from 'crypto';
import { IntegrationService } from '@prisma/client';

// ─── Token encryption (AES-256-GCM) ──────────────────────────────────────────

const ENCRYPTION_KEY_HEX = process.env.TOKEN_ENCRYPTION_KEY ?? '';
const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  if (ENCRYPTION_KEY_HEX && ENCRYPTION_KEY_HEX.length === 64) {
    return Buffer.from(ENCRYPTION_KEY_HEX, 'hex');
  }
  // Derive a key from APP_SECRET in dev/test
  const secret = process.env.JWT_SECRET ?? 'dev-secret';
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptToken(ciphertext: string): string {
  const [ivHex, tagHex, encryptedHex] = ciphertext.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

// ─── OAuth state (HMAC-signed, encodes clientId + service + timestamp) ────────

export function buildOAuthState(clientId: string, service: IntegrationService): string {
  const payload = `${clientId}:${service}:${Date.now()}`;
  const sig = crypto
    .createHmac('sha256', process.env.JWT_SECRET ?? 'dev-secret')
    .update(payload)
    .digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

export function parseOAuthState(state: string): { clientId: string; service: IntegrationService } | null {
  try {
    const decoded = Buffer.from(state, 'base64url').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length < 4) return null;
    const sig = parts.pop()!;
    const payload = parts.join(':');
    const expectedSig = crypto
      .createHmac('sha256', process.env.JWT_SECRET ?? 'dev-secret')
      .update(payload)
      .digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'))) return null;
    const [clientId, service] = parts;
    return { clientId, service: service as IntegrationService };
  } catch {
    return null;
  }
}

// ─── OAuth config per service ─────────────────────────────────────────────────

interface OAuthConfig {
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  callbackPath: string;
}

export function getOAuthConfig(service: IntegrationService): OAuthConfig {
  const base = process.env.APP_URL ?? 'https://api.outreachos.com';
  switch (service) {
    case IntegrationService.calendly:
      return {
        authUrl: 'https://auth.calendly.com/oauth/authorize',
        tokenUrl: 'https://auth.calendly.com/oauth/token',
        clientId: process.env.CALENDLY_CLIENT_ID ?? '',
        clientSecret: process.env.CALENDLY_CLIENT_SECRET ?? '',
        scope: 'default',
        callbackPath: `${base}/api/integrations/calendly/callback`,
      };
    case IntegrationService.cal_com:
      return {
        authUrl: 'https://app.cal.com/oauth/authorize',
        tokenUrl: 'https://app.cal.com/oauth/token',
        clientId: process.env.CAL_COM_CLIENT_ID ?? '',
        clientSecret: process.env.CAL_COM_CLIENT_SECRET ?? '',
        scope: 'READ_BOOKING WRITE_BOOKING',
        callbackPath: `${base}/api/integrations/cal-com/callback`,
      };
    case IntegrationService.google_calendar:
      return {
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        clientId: process.env.GOOGLE_CLIENT_ID ?? '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        scope: 'https://www.googleapis.com/auth/calendar.events',
        callbackPath: `${base}/api/integrations/google-calendar/callback`,
      };
    case IntegrationService.microsoft_outlook:
      return {
        authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        clientId: process.env.MICROSOFT_CLIENT_ID ?? '',
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? '',
        scope: 'Calendars.ReadWrite offline_access',
        callbackPath: `${base}/api/integrations/microsoft-outlook/callback`,
      };
  }
}

export function buildAuthUrl(service: IntegrationService, state: string): string {
  const config = getOAuthConfig(service);
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callbackPath,
    response_type: 'code',
    scope: config.scope,
    state,
    access_type: 'offline', // Google needs this for refresh token
    prompt: 'consent',
  });
  return `${config.authUrl}?${params.toString()}`;
}

// ─── Token exchange ───────────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

export async function exchangeCode(service: IntegrationService, code: string): Promise<TokenResponse> {
  const config = getOAuthConfig(service);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.callbackPath,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed for ${service}: ${response.status} ${text}`);
  }

  return response.json() as Promise<TokenResponse>;
}

export async function refreshAccessToken(service: IntegrationService, refreshToken: string): Promise<TokenResponse> {
  const config = getOAuthConfig(service);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed for ${service}: ${response.status} ${text}`);
  }

  return response.json() as Promise<TokenResponse>;
}

// ─── Calendly webhook management ─────────────────────────────────────────────

export async function registerCalendlyWebhook(accessToken: string, callbackUrl: string): Promise<string> {
  // First, get the current user's org URI
  const userRes = await fetch('https://api.calendly.com/users/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!userRes.ok) throw new Error('Failed to get Calendly user info');
  const userData = await userRes.json() as { resource: { current_organization: string } };
  const orgUri = userData.resource.current_organization;

  const webhookRes = await fetch('https://api.calendly.com/webhook_subscriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: callbackUrl,
      events: ['invitee.created', 'invitee.canceled'],
      organization: orgUri,
      scope: 'organization',
    }),
  });

  if (!webhookRes.ok) throw new Error('Failed to register Calendly webhook');
  const webhookData = await webhookRes.json() as { resource: { uri: string } };
  return webhookData.resource.uri;
}

export async function deregisterCalendlyWebhook(accessToken: string, webhookUri: string): Promise<void> {
  // Extract the webhook UUID from the URI
  const uuid = webhookUri.split('/').pop();
  await fetch(`https://api.calendly.com/webhook_subscriptions/${uuid}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// ─── Calendar event creation ──────────────────────────────────────────────────

export interface CalendarEventParams {
  summary: string;
  startTime: Date;
  durationMinutes: number;
  attendeeEmail?: string;
  description?: string;
}

export async function createGoogleCalendarEvent(accessToken: string, params: CalendarEventParams): Promise<void> {
  const endTime = new Date(params.startTime.getTime() + params.durationMinutes * 60_000);
  await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: params.summary,
      description: params.description,
      start: { dateTime: params.startTime.toISOString() },
      end: { dateTime: endTime.toISOString() },
      attendees: params.attendeeEmail ? [{ email: params.attendeeEmail }] : [],
    }),
  });
}

export async function createOutlookCalendarEvent(accessToken: string, params: CalendarEventParams): Promise<void> {
  const endTime = new Date(params.startTime.getTime() + params.durationMinutes * 60_000);
  await fetch('https://graph.microsoft.com/v1.0/me/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: params.summary,
      body: { contentType: 'Text', content: params.description ?? '' },
      start: { dateTime: params.startTime.toISOString(), timeZone: 'UTC' },
      end: { dateTime: endTime.toISOString(), timeZone: 'UTC' },
      attendees: params.attendeeEmail
        ? [{ emailAddress: { address: params.attendeeEmail }, type: 'required' }]
        : [],
    }),
  });
}
