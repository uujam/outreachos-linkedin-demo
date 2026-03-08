/**
 * Heyreach white-label webhook receiver.
 * Receives LinkedIn events: connection_request_sent, connection_accepted,
 * message_sent, message_received, profile_viewed.
 * Maps each event to a D-022 Message and D-005 OutreachActivity record.
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import {
  MessageDirection,
  MessageChannel,
  MessageTool,
  MessageType,
  DeliveryStatus,
  ActivityChannel,
  ActivityAction,
} from '@prisma/client';

const router = Router();

const HEYREACH_WEBHOOK_SECRET = process.env.HEYREACH_WEBHOOK_SECRET ?? '';

function verifySignature(req: Request): boolean {
  const sig = req.headers['x-heyreach-signature'] as string | undefined;
  if (!sig || !HEYREACH_WEBHOOK_SECRET) return !HEYREACH_WEBHOOK_SECRET; // skip in dev if no secret set
  const expected = crypto
    .createHmac('sha256', HEYREACH_WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

type HeyreachEvent =
  | 'connection_request_sent'
  | 'connection_accepted'
  | 'message_sent'
  | 'message_received'
  | 'profile_viewed';

interface HeyreachWebhookPayload {
  event: HeyreachEvent;
  lead_id?: string;         // internal lead ID in OutreachOS — stored as reference when enroling
  external_id?: string;     // Heyreach message / event ID
  linkedin_url?: string;
  message_body?: string;
  timestamp?: string;
}

function mapEventToMessage(event: HeyreachEvent): {
  direction: MessageDirection;
  messageType: MessageType;
  deliveryStatus: DeliveryStatus;
  activityAction: ActivityAction;
} {
  switch (event) {
    case 'connection_request_sent':
      return { direction: MessageDirection.outbound, messageType: MessageType.connection_request, deliveryStatus: DeliveryStatus.sent, activityAction: ActivityAction.Sent };
    case 'connection_accepted':
      return { direction: MessageDirection.inbound, messageType: MessageType.connection_request, deliveryStatus: DeliveryStatus.accepted, activityAction: ActivityAction.Replied };
    case 'message_sent':
      return { direction: MessageDirection.outbound, messageType: MessageType.linkedin_message, deliveryStatus: DeliveryStatus.sent, activityAction: ActivityAction.Sent };
    case 'message_received':
      return { direction: MessageDirection.inbound, messageType: MessageType.linkedin_message, deliveryStatus: DeliveryStatus.replied, activityAction: ActivityAction.Replied };
    case 'profile_viewed':
      return { direction: MessageDirection.outbound, messageType: MessageType.linkedin_message, deliveryStatus: DeliveryStatus.delivered, activityAction: ActivityAction.Sent };
  }
}

// POST /api/heyreach/webhook
router.post('/heyreach/webhook', async (req: Request, res: Response) => {
  if (!verifySignature(req)) {
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  const payload = req.body as HeyreachWebhookPayload;
  const { event, lead_id, external_id, message_body, timestamp } = payload;

  if (!event || !lead_id) {
    res.status(400).json({ error: 'Missing event or lead_id' });
    return;
  }

  // Look up the lead
  const lead = await prisma.lead.findUnique({ where: { id: lead_id } });
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  const { direction, messageType, deliveryStatus, activityAction } = mapEventToMessage(event);

  const eventTimestamp = timestamp ? new Date(timestamp) : new Date();

  // Create D-022 Message record (idempotent via externalId)
  if (external_id) {
    const existing = await prisma.message.findFirst({ where: { externalId: external_id } });
    if (existing) {
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }
  }

  await prisma.message.create({
    data: {
      leadId: lead.id,
      clientId: lead.clientId,
      direction,
      channel: MessageChannel.linkedin,
      tool: MessageTool.Heyreach,
      messageType,
      body: message_body ?? event.replace(/_/g, ' '),
      deliveryStatus,
      externalId: external_id,
      timestamp: eventTimestamp,
    },
  });

  // Create D-005 OutreachActivity record
  await prisma.outreachActivity.create({
    data: {
      leadId: lead.id,
      channel: ActivityChannel.LinkedIn,
      actionType: activityAction,
      timestamp: eventTimestamp,
      notes: message_body,
    },
  });

  // If a reply is received, advance lead to Responded stage
  if (event === 'message_received' || event === 'connection_accepted') {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { outreachStage: 'Responded', lastActivityDate: eventTimestamp },
    });
  } else {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { lastActivityDate: eventTimestamp },
    });
  }

  res.status(200).json({ ok: true });
});

export default router;
