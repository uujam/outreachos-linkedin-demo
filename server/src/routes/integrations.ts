/**
 * B-011a — Integration OAuth connection endpoints (F-027, S-018).
 * GET  /api/integrations                         — list all connections + health status
 * GET  /api/integrations/:service/connect        — OAuth redirect
 * GET  /api/integrations/:service/callback       — code exchange + token store + Calendly webhook reg
 * DELETE /api/integrations/:service              — disconnect + Calendly webhook dereg
 * GET  /api/integrations/:service/status         — single service health
 */
import { Router, Request, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/requireAuth';
import { prisma } from '../lib/prisma';
import {
  buildOAuthState,
  parseOAuthState,
  buildAuthUrl,
  exchangeCode,
  encryptToken,
  decryptToken,
  registerCalendlyWebhook,
  deregisterCalendlyWebhook,
} from '../lib/integrations';
import { queueNotification } from '../lib/notifications';
import { IntegrationService, IntegrationStatus } from '@prisma/client';

const router = Router();

// Normalise URL segment to enum (e.g. "cal-com" → "cal_com")
function segmentToService(segment: string): IntegrationService | null {
  const map: Record<string, IntegrationService> = {
    calendly: IntegrationService.calendly,
    'cal-com': IntegrationService.cal_com,
    'google-calendar': IntegrationService.google_calendar,
    'microsoft-outlook': IntegrationService.microsoft_outlook,
  };
  return map[segment] ?? null;
}

// ─── GET /api/integrations ────────────────────────────────────────────────────

router.get('/integrations', requireAuth, async (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;

  const connections = await prisma.integrationConnection.findMany({
    where: { clientId },
    select: {
      service: true,
      status: true,
      lastSyncAt: true,
      errorMessage: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  res.status(200).json({ integrations: connections });
});

// ─── GET /api/integrations/:service/status ────────────────────────────────────

router.get('/integrations/:service/status', requireAuth, async (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;
  const service = segmentToService(req.params.service);
  if (!service) {
    res.status(400).json({ error: 'Unknown integration service' });
    return;
  }

  const connection = await prisma.integrationConnection.findUnique({
    where: { clientId_service: { clientId, service } },
    select: { service: true, status: true, lastSyncAt: true, errorMessage: true },
  });

  if (!connection) {
    res.status(200).json({ connected: false });
    return;
  }

  res.status(200).json({ connected: true, ...connection });
});

// ─── GET /api/integrations/:service/connect — OAuth redirect ─────────────────

router.get('/integrations/:service/connect', requireAuth, (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;
  const service = segmentToService(req.params.service);
  if (!service) {
    res.status(400).json({ error: 'Unknown integration service' });
    return;
  }

  const state = buildOAuthState(clientId, service);
  const authUrl = buildAuthUrl(service, state);
  res.redirect(302, authUrl);
});

// ─── GET /api/integrations/:service/callback — OAuth callback ─────────────────

router.get('/integrations/:service/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query as {
    code?: string;
    state?: string;
    error?: string;
  };

  const service = segmentToService(req.params.service);
  if (!service) {
    res.status(400).send('Unknown integration service');
    return;
  }

  if (error || !code || !state) {
    res.status(400).send(`OAuth error: ${error ?? 'Missing code or state'}`);
    return;
  }

  const parsed = parseOAuthState(state);
  if (!parsed || parsed.service !== service) {
    res.status(400).send('Invalid OAuth state');
    return;
  }

  const { clientId } = parsed;
  const dashboardUrl = process.env.DASHBOARD_URL ?? 'https://app.outreachos.com';

  try {
    const tokens = await exchangeCode(service, code);

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;

    const encryptedAccess = encryptToken(tokens.access_token);
    const encryptedRefresh = tokens.refresh_token ? encryptToken(tokens.refresh_token) : null;

    let calendlyWebhookId: string | null = null;

    // Register Calendly webhook on connect
    if (service === IntegrationService.calendly) {
      try {
        const webhookCallbackUrl = `${process.env.APP_URL ?? 'https://api.outreachos.com'}/api/booking/calendly`;
        calendlyWebhookId = await registerCalendlyWebhook(tokens.access_token, webhookCallbackUrl);
      } catch (err) {
        console.error('[Integrations] Calendly webhook registration failed:', err);
        // Non-fatal — connection still stored
      }
    }

    await prisma.integrationConnection.upsert({
      where: { clientId_service: { clientId, service } },
      create: {
        clientId,
        service,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiresAt: expiresAt,
        scope: tokens.scope ?? null,
        status: IntegrationStatus.active,
        calendlyWebhookId,
      },
      update: {
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiresAt: expiresAt,
        scope: tokens.scope ?? null,
        status: IntegrationStatus.active,
        errorMessage: null,
        calendlyWebhookId: calendlyWebhookId ?? undefined,
      },
    });

    // Redirect back to integrations screen
    res.redirect(302, `${dashboardUrl}/integrations?connected=${service}`);
  } catch (err) {
    console.error(`[Integrations] Callback error for ${service}:`, err);
    res.redirect(302, `${dashboardUrl}/integrations?error=${service}`);
  }
});

// ─── DELETE /api/integrations/:service — disconnect ───────────────────────────

router.delete('/integrations/:service', requireAuth, async (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;
  const service = segmentToService(req.params.service);
  if (!service) {
    res.status(400).json({ error: 'Unknown integration service' });
    return;
  }

  const connection = await prisma.integrationConnection.findUnique({
    where: { clientId_service: { clientId, service } },
  });

  if (!connection) {
    res.status(404).json({ error: 'Integration not connected' });
    return;
  }

  // Deregister Calendly webhook on disconnect
  if (service === IntegrationService.calendly && connection.calendlyWebhookId) {
    try {
      const accessToken = decryptToken(connection.accessToken);
      await deregisterCalendlyWebhook(accessToken, connection.calendlyWebhookId);
    } catch (err) {
      console.error('[Integrations] Calendly webhook deregistration failed:', err);
    }
  }

  await prisma.integrationConnection.update({
    where: { clientId_service: { clientId, service } },
    data: { status: IntegrationStatus.disconnected, accessToken: '', refreshToken: null },
  });

  // Notify client if Calendly is disconnected (F-028)
  if (service === IntegrationService.calendly) {
    await queueNotification({
      clientId,
      eventType: 'calendly_disconnected',
      title: 'Calendly disconnected',
      body: 'Your Calendly integration has been disconnected. Meeting booking links may stop working.',
      linkUrl: '/integrations',
    });
  }

  res.status(200).json({ ok: true });
});

export default router;
