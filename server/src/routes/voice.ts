/**
 * B-009 — VAPI voice integration routes.
 * POST /api/voice/call — trigger an outbound AI call
 * POST /api/vapi/webhook — receive call outcome from VAPI
 * GET  /api/voice/calls — list voice call records for the authenticated client
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/requireAuth';
import { placeVapiCall } from '../lib/vapi';
import {
  VoiceCallOutcome,
  MessageDirection,
  MessageChannel,
  MessageTool,
  MessageType,
  DeliveryStatus,
  ActivityChannel,
  ActivityAction,
} from '@prisma/client';

const router = Router();

const VAPI_WEBHOOK_SECRET = process.env.VAPI_WEBHOOK_SECRET ?? '';

function verifySignature(req: Request): boolean {
  const sig = req.headers['x-vapi-signature'] as string | undefined;
  if (!sig || !VAPI_WEBHOOK_SECRET) return !VAPI_WEBHOOK_SECRET;
  const expected = crypto
    .createHmac('sha256', VAPI_WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

// ─── POST /api/voice/call — trigger outbound call ─────────────────────────────

router.post('/voice/call', requireAuth, async (req: AuthRequest, res: Response) => {
  const { leadId } = req.body as { leadId?: string };
  const clientId = req.user!.sub;

  if (!leadId) {
    res.status(400).json({ error: 'leadId is required' });
    return;
  }

  const lead = await prisma.lead.findFirst({ where: { id: leadId, clientId } });
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  if (lead.dncFlag) {
    res.status(422).json({ error: 'Lead is marked Do Not Contact' });
    return;
  }

  if (!lead.phoneNumber) {
    res.status(422).json({ error: 'Lead has no phone number' });
    return;
  }

  const result = await placeVapiCall({
    phoneNumber: lead.phoneNumber,
    leadId: lead.id,
    clientId,
    leadName: lead.fullName,
    company: lead.company,
  });

  if (!result.success) {
    res.status(502).json({ error: result.error });
    return;
  }

  res.status(202).json({ ok: true, callId: result.callId });
});

// ─── GET /api/voice/calls — list call records ──────────────────────────────────

router.get('/voice/calls', requireAuth, async (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;
  const { leadId } = req.query as { leadId?: string };

  const calls = await prisma.voiceCallRecord.findMany({
    where: leadId
      ? { leadId, lead: { clientId } }
      : { lead: { clientId } },
    orderBy: { callDate: 'desc' },
    take: 100,
  });

  res.status(200).json({ calls });
});

// ─── POST /api/vapi/webhook — receive VAPI call outcome ───────────────────────

interface VapiWebhookPayload {
  type: string;
  call?: {
    id: string;
    metadata?: { leadId?: string; clientId?: string };
    endedReason?: string;
    duration?: number;
    summary?: string;
    recordingUrl?: string;
    transcript?: string;
  };
}

const OUTCOME_MAP: Record<string, VoiceCallOutcome> = {
  customer_ended_call_with_meeting_agreed: VoiceCallOutcome.Qualified,
  customer_ended_call_interested: VoiceCallOutcome.Interested,
  voicemail: VoiceCallOutcome.Voicemail,
  no_answer: VoiceCallOutcome.NotReached,
  customer_busy: VoiceCallOutcome.NotReached,
  failed: VoiceCallOutcome.NotReached,
};

router.post('/vapi/webhook', async (req: Request, res: Response) => {
  if (!verifySignature(req)) {
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  const payload = req.body as VapiWebhookPayload;
  if (payload.type !== 'end-of-call-report' || !payload.call) {
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  const { call } = payload;
  const leadId = call.metadata?.leadId;
  const clientId = call.metadata?.clientId;

  if (!leadId || !clientId) {
    res.status(400).json({ error: 'Missing leadId or clientId in call metadata' });
    return;
  }

  const lead = await prisma.lead.findFirst({ where: { id: leadId, clientId } });
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  const outcome = OUTCOME_MAP[call.endedReason ?? ''] ?? VoiceCallOutcome.NotReached;
  const callDate = new Date();
  const duration = call.duration ?? 0;
  const aiSummaryNotes = call.summary ?? null;

  // Create VoiceCallRecord (D-009)
  await prisma.voiceCallRecord.create({
    data: {
      leadId: lead.id,
      callDate,
      duration,
      outcome,
      aiSummaryNotes,
      recordingUrl: call.recordingUrl ?? null,
    },
  });

  // Create D-022 Message record
  const isReply = outcome === VoiceCallOutcome.Qualified || outcome === VoiceCallOutcome.Interested;
  await prisma.message.create({
    data: {
      leadId: lead.id,
      clientId: lead.clientId,
      direction: isReply ? MessageDirection.inbound : MessageDirection.outbound,
      channel: MessageChannel.voice,
      tool: MessageTool.VAPI,
      messageType: MessageType.voice_call,
      body: aiSummaryNotes ?? `Voice call — ${outcome}`,
      deliveryStatus: isReply ? DeliveryStatus.qualified : (outcome === VoiceCallOutcome.Voicemail ? DeliveryStatus.voicemail : DeliveryStatus.not_reached),
      externalId: call.id,
      timestamp: callDate,
    },
  });

  // Create D-005 OutreachActivity
  await prisma.outreachActivity.create({
    data: {
      leadId: lead.id,
      channel: ActivityChannel.Voice,
      actionType: isReply ? ActivityAction.Called : (outcome === VoiceCallOutcome.Voicemail ? ActivityAction.Voicemail : ActivityAction.Called),
      timestamp: callDate,
      notes: aiSummaryNotes,
    },
  });

  // Handle DNC verbal opt-out — VAPI returns a specific signal
  const isDnc = call.endedReason === 'do_not_contact' ||
    (call.transcript?.toLowerCase().includes('do not call') || call.transcript?.toLowerCase().includes('take me off'));

  if (isDnc) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { dncFlag: true, terminalOutcome: 'DoNotContact', lastActivityDate: callDate },
    });
  } else if (outcome === VoiceCallOutcome.Qualified || outcome === VoiceCallOutcome.Interested) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { outreachStage: 'Qualified', lastActivityDate: callDate },
    });
  } else {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { lastActivityDate: callDate },
    });
  }

  res.status(200).json({ ok: true, outcome });
});

export default router;
