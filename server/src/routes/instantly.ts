/**
 * Instantly webhook receiver + email enrolment endpoint.
 * Webhook events: email_sent, email_opened, email_clicked, email_replied,
 * email_bounced, email_unsubscribed.
 * Each event maps to a D-022 Message and D-005 OutreachActivity record.
 * Unsubscribe sets DNC flag on the lead.
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { cancelPendingOutreachJobs } from '../orchestration/channel-sequencer';
import { queueNotification } from '../lib/notifications';
import { requireAuth, AuthRequest } from '../middleware/requireAuth';
import { enrolLeadInInstantly } from '../lib/instantly';
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

const INSTANTLY_WEBHOOK_SECRET = process.env.INSTANTLY_WEBHOOK_SECRET ?? '';

function verifySignature(req: Request): boolean {
  const sig = req.headers['x-instantly-signature'] as string | undefined;
  if (!sig || !INSTANTLY_WEBHOOK_SECRET) return !INSTANTLY_WEBHOOK_SECRET;
  const expected = crypto
    .createHmac('sha256', INSTANTLY_WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

type InstantlyEvent =
  | 'email_sent'
  | 'email_opened'
  | 'email_clicked'
  | 'email_replied'
  | 'email_bounced'
  | 'email_unsubscribed';

interface InstantlyWebhookPayload {
  event_type: InstantlyEvent;
  lead_id?: string;        // OutreachOS lead ID — stored as reference when enroling
  external_id?: string;    // Instantly message ID
  subject?: string;
  body_preview?: string;
  reply_body?: string;
  timestamp?: string;
}

function mapEventToDelivery(event: InstantlyEvent): {
  deliveryStatus: DeliveryStatus;
  activityAction: ActivityAction;
  direction: MessageDirection;
} {
  switch (event) {
    case 'email_sent':
      return { deliveryStatus: DeliveryStatus.sent, activityAction: ActivityAction.Sent, direction: MessageDirection.outbound };
    case 'email_opened':
      return { deliveryStatus: DeliveryStatus.opened, activityAction: ActivityAction.Opened, direction: MessageDirection.outbound };
    case 'email_clicked':
      return { deliveryStatus: DeliveryStatus.clicked, activityAction: ActivityAction.Clicked, direction: MessageDirection.outbound };
    case 'email_replied':
      return { deliveryStatus: DeliveryStatus.replied, activityAction: ActivityAction.Replied, direction: MessageDirection.inbound };
    case 'email_bounced':
      return { deliveryStatus: DeliveryStatus.bounced, activityAction: ActivityAction.Sent, direction: MessageDirection.outbound };
    case 'email_unsubscribed':
      return { deliveryStatus: DeliveryStatus.unsubscribed, activityAction: ActivityAction.Replied, direction: MessageDirection.inbound };
  }
}

// POST /api/instantly/webhook
router.post('/instantly/webhook', async (req: Request, res: Response) => {
  if (!verifySignature(req)) {
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  const payload = req.body as InstantlyWebhookPayload;
  const { event_type, lead_id, external_id, subject, body_preview, reply_body, timestamp } = payload;

  if (!event_type || !lead_id) {
    res.status(400).json({ error: 'Missing event_type or lead_id' });
    return;
  }

  const lead = await prisma.lead.findUnique({ where: { id: lead_id } });
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  // Idempotency check
  if (external_id) {
    const existing = await prisma.message.findFirst({ where: { externalId: external_id } });
    if (existing) {
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }
  }

  const { deliveryStatus, activityAction, direction } = mapEventToDelivery(event_type);
  const eventTimestamp = timestamp ? new Date(timestamp) : new Date();
  const body = reply_body ?? body_preview ?? event_type.replace(/_/g, ' ');

  await prisma.message.create({
    data: {
      leadId: lead.id,
      clientId: lead.clientId,
      direction,
      channel: MessageChannel.email,
      tool: MessageTool.Instantly,
      messageType: MessageType.email,
      subject: subject ?? null,
      body,
      deliveryStatus,
      externalId: external_id,
      timestamp: eventTimestamp,
    },
  });

  await prisma.outreachActivity.create({
    data: {
      leadId: lead.id,
      channel: ActivityChannel.Email,
      actionType: activityAction,
      timestamp: eventTimestamp,
      notes: body,
    },
  });

  // Handle specific event outcomes
  if (event_type === 'email_unsubscribed') {
    // Set DNC flag — enforced server-side
    await prisma.lead.update({
      where: { id: lead.id },
      data: { dncFlag: true, terminalOutcome: 'DoNotContact', lastActivityDate: eventTimestamp },
    });
  } else if (event_type === 'email_replied') {
    await cancelPendingOutreachJobs(lead.id).catch(() => {});
    await prisma.lead.update({
      where: { id: lead.id },
      data: { outreachStage: 'Responded', lastActivityDate: eventTimestamp },
    });
    // Notify client (F-028)
    await queueNotification({
      clientId: lead.clientId,
      eventType: 'lead_replied',
      title: 'Lead replied via email',
      body: `${lead.fullName} from ${lead.company ?? 'Unknown'} replied to your email.`,
      linkUrl: `/leads/${lead.id}`,
    });
  } else {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { lastActivityDate: eventTimestamp },
    });
  }

  res.status(200).json({ ok: true });
});

// POST /api/email/enrol — enrol a ReadyForOutreach lead in an Instantly campaign
router.post('/email/enrol', requireAuth, async (req: AuthRequest, res: Response) => {
  const { leadId, instantlyCampaignId } = req.body as { leadId?: string; instantlyCampaignId?: string };
  const clientId = req.user!.sub;

  if (!leadId || !instantlyCampaignId) {
    res.status(400).json({ error: 'leadId and instantlyCampaignId are required' });
    return;
  }

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, clientId },
  });

  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  if (lead.enrichmentStage !== 'ReadyForOutreach') {
    res.status(422).json({ error: 'Lead must be ReadyForOutreach before email enrolment' });
    return;
  }

  if (!lead.emailAddress) {
    res.status(422).json({ error: 'Lead has no email address' });
    return;
  }

  if (lead.dncFlag) {
    res.status(422).json({ error: 'Lead is marked Do Not Contact' });
    return;
  }

  const result = await enrolLeadInInstantly({
    campaignId: instantlyCampaignId,
    email: lead.emailAddress,
    fullName: lead.fullName,
    company: lead.company,
  });

  if (!result.success) {
    res.status(502).json({ error: result.error });
    return;
  }

  res.status(200).json({ ok: true, instantlyLeadId: result.leadId });
});

export default router;
