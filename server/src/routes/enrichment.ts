import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { EnrichmentStage } from '@prisma/client';

const router = Router();

/**
 * POST /api/enrichment/clay-webhook
 * Receives async enrichment results from Clay.
 * Verifies the request signature using CLAY_WEBHOOK_SECRET.
 */
router.post('/enrichment/clay-webhook', async (req: Request, res: Response) => {
  // Verify Clay webhook signature
  const secret = process.env.CLAY_WEBHOOK_SECRET;
  if (secret) {
    const signature = req.headers['x-clay-signature'] as string | undefined;
    const body = JSON.stringify(req.body);
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    if (!signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }
  }

  const payload = req.body as {
    reference_id?: string;
    person?: {
      email?: string;
      phone?: string;
      email_deliverable?: boolean;
    };
    error?: string;
  };

  const leadId = payload.reference_id;
  if (!leadId) {
    res.status(400).json({ error: 'reference_id is required' });
    return;
  }

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  if (payload.error || !payload.person?.email) {
    // Clay also failed — mark InvalidEmail
    await prisma.lead.update({
      where: { id: leadId },
      data: { enrichmentStage: EnrichmentStage.InvalidEmail },
    });
    res.status(200).json({ ok: true });
    return;
  }

  const { email, phone, email_deliverable } = payload.person;

  if (email_deliverable === false) {
    await prisma.lead.update({
      where: { id: leadId },
      data: { emailAddress: email, enrichmentStage: EnrichmentStage.InvalidEmail },
    });
  } else {
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        emailAddress: email,
        ...(phone && { phoneNumber: phone }),
        enrichmentStage: EnrichmentStage.ReadyForOutreach,
      },
    });
  }

  res.status(200).json({ ok: true });
});

export default router;
