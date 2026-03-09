/**
 * B-011 — Meetings tracker + booking webhooks.
 * POST /api/booking/calendly       — Calendly webhook (booking.created / .cancelled / .rescheduled)
 * POST /api/booking/cal-com        — Cal.com webhook (BOOKING_CREATED / _CANCELLED / _RESCHEDULED)
 * POST /api/meetings               — manual meeting entry
 * GET  /api/meetings               — list meetings for authenticated client (with lead info)
 * PATCH /api/meetings/:id          — update confirmation status (Confirmed / NoShow)
 * DELETE /api/meetings/:id         — delete meeting record
 */
import { Router, Request, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/requireAuth';
import { prisma } from '../lib/prisma';
import { queueNotification } from '../lib/notifications';
import { MeetingBookedVia, MeetingConfirmation, TerminalOutcome, BookingEventType } from '@prisma/client';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Match a booking to a lead by invitee email, scoped to a client where possible. */
async function findLeadByEmail(email: string, clientId?: string) {
  return prisma.lead.findFirst({
    where: {
      emailAddress: { equals: email, mode: 'insensitive' },
      ...(clientId ? { clientId } : {}),
    },
  });
}

/** Core booking logic: create Meeting (D-008), write D-016 event log, update lead, notify. */
async function handleBookingCreated(params: {
  email: string;
  meetingDate: Date;
  duration: number;
  channelBookedVia: MeetingBookedVia;
  rawPayload: unknown;
}): Promise<{ ok: boolean; meetingId?: string; error?: string }> {
  const { email, meetingDate, duration, channelBookedVia, rawPayload } = params;

  const lead = await findLeadByEmail(email);
  if (!lead) {
    // Write D-016 unmatched event log and acknowledge
    await prisma.bookingWebhookEvent.create({
      data: {
        rawPayload: rawPayload as never,
        eventType: BookingEventType.BookingCreated,
        matchedLeadId: null,
      },
    });
    return { ok: true }; // still 200 — webhook acknowledged
  }

  const meeting = await prisma.meeting.create({
    data: {
      leadId: lead.id,
      meetingDate,
      duration,
      channelBookedVia,
      confirmationStatus: MeetingConfirmation.Confirmed,
    },
  });

  // Update lead terminal outcome
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      terminalOutcome: TerminalOutcome.MeetingBooked,
      lastActivityDate: new Date(),
    },
  });

  // Write D-016 raw event log
  await prisma.bookingWebhookEvent.create({
    data: {
      rawPayload: rawPayload as never,
      eventType: BookingEventType.BookingCreated,
      matchedLeadId: lead.id,
    },
  });

  // Notify client (F-028)
  await queueNotification({
    clientId: lead.clientId,
    eventType: 'meeting_booked',
    title: 'Meeting booked',
    body: `${lead.fullName} from ${lead.company ?? 'Unknown'} booked a meeting.`,
    linkUrl: `/meetings`,
  });

  return { ok: true, meetingId: meeting.id };
}

async function handleBookingCancelled(params: {
  email: string;
  rawPayload: unknown;
  eventType: BookingEventType;
}): Promise<void> {
  const lead = await findLeadByEmail(params.email);

  await prisma.bookingWebhookEvent.create({
    data: {
      rawPayload: params.rawPayload as never,
      eventType: params.eventType,
      matchedLeadId: lead?.id ?? null,
    },
  });

  if (lead) {
    // Revert terminal outcome so lead can re-enter outreach
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        terminalOutcome: null,
        lastActivityDate: new Date(),
      },
    });

    // Mark most recent meeting as NoShow (cancelled == no-show for tracking)
    const latest = await prisma.meeting.findFirst({
      where: { leadId: lead.id },
      orderBy: { meetingDate: 'desc' },
    });
    if (latest) {
      await prisma.meeting.update({
        where: { id: latest.id },
        data: { confirmationStatus: MeetingConfirmation.NoShow },
      });
    }
  }
}

async function handleBookingRescheduled(params: {
  email: string;
  newMeetingDate: Date;
  duration: number;
  channelBookedVia: MeetingBookedVia;
  rawPayload: unknown;
}): Promise<void> {
  const lead = await findLeadByEmail(params.email);

  await prisma.bookingWebhookEvent.create({
    data: {
      rawPayload: params.rawPayload as never,
      eventType: BookingEventType.BookingRescheduled,
      matchedLeadId: lead?.id ?? null,
    },
  });

  if (lead) {
    // Update most recent meeting to new date
    const latest = await prisma.meeting.findFirst({
      where: { leadId: lead.id },
      orderBy: { meetingDate: 'desc' },
    });
    if (latest) {
      await prisma.meeting.update({
        where: { id: latest.id },
        data: { meetingDate: params.newMeetingDate, duration: params.duration },
      });
    }
    await prisma.lead.update({
      where: { id: lead.id },
      data: { lastActivityDate: new Date() },
    });
  }
}

// ─── POST /api/booking/calendly ───────────────────────────────────────────────

router.post('/booking/calendly', async (req: Request, res: Response) => {
  const body = req.body as {
    event?: string;
    payload?: {
      invitee?: { email?: string };
      event?: { start_time?: string; duration?: number };
      cancel_url?: string;
    };
  };

  const eventType = body.event;
  const email = body.payload?.invitee?.email;
  const startTime = body.payload?.event?.start_time;
  const duration = body.payload?.event?.duration ?? 30;

  if (!eventType || !email) {
    res.status(400).json({ error: 'Missing event or invitee email' });
    return;
  }

  if (eventType === 'invitee.created') {
    const result = await handleBookingCreated({
      email,
      meetingDate: startTime ? new Date(startTime) : new Date(),
      duration,
      channelBookedVia: MeetingBookedVia.Calendly,
      rawPayload: body,
    });
    res.status(200).json(result);
    return;
  }

  if (eventType === 'invitee.canceled') {
    await handleBookingCancelled({ email, rawPayload: body, eventType: BookingEventType.BookingCancelled });
    res.status(200).json({ ok: true });
    return;
  }

  // Rescheduled events in Calendly fire as a cancel + new create — acknowledge unknown events
  res.status(200).json({ ok: true, skipped: true });
});

// ─── POST /api/booking/cal-com ────────────────────────────────────────────────

router.post('/booking/cal-com', async (req: Request, res: Response) => {
  const body = req.body as {
    triggerEvent?: string;
    payload?: {
      attendees?: Array<{ email?: string }>;
      startTime?: string;
      duration?: number;
      rescheduleStartTime?: string;
    };
  };

  const triggerEvent = body.triggerEvent;
  const email = body.payload?.attendees?.[0]?.email;
  const startTime = body.payload?.startTime;
  const duration = body.payload?.duration ?? 30;

  if (!triggerEvent || !email) {
    res.status(400).json({ error: 'Missing triggerEvent or attendee email' });
    return;
  }

  if (triggerEvent === 'BOOKING_CREATED') {
    const result = await handleBookingCreated({
      email,
      meetingDate: startTime ? new Date(startTime) : new Date(),
      duration,
      channelBookedVia: MeetingBookedVia.CalCom,
      rawPayload: body,
    });
    res.status(200).json(result);
    return;
  }

  if (triggerEvent === 'BOOKING_CANCELLED') {
    await handleBookingCancelled({ email, rawPayload: body, eventType: BookingEventType.BookingCancelled });
    res.status(200).json({ ok: true });
    return;
  }

  if (triggerEvent === 'BOOKING_RESCHEDULED') {
    const rescheduleTime = body.payload?.rescheduleStartTime ?? startTime;
    await handleBookingRescheduled({
      email,
      newMeetingDate: rescheduleTime ? new Date(rescheduleTime) : new Date(),
      duration,
      channelBookedVia: MeetingBookedVia.CalCom,
      rawPayload: body,
    });
    res.status(200).json({ ok: true });
    return;
  }

  res.status(200).json({ ok: true, skipped: true });
});

// ─── POST /api/meetings — manual meeting entry ────────────────────────────────

router.post('/meetings', requireAuth, async (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;
  const { leadId, meetingDate, duration = 30 } = req.body as {
    leadId?: string;
    meetingDate?: string;
    duration?: number;
  };

  if (!leadId || !meetingDate) {
    res.status(400).json({ error: 'leadId and meetingDate are required' });
    return;
  }

  const lead = await prisma.lead.findFirst({ where: { id: leadId, clientId } });
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  const meeting = await prisma.meeting.create({
    data: {
      leadId,
      meetingDate: new Date(meetingDate),
      duration,
      channelBookedVia: MeetingBookedVia.Manual,
      confirmationStatus: MeetingConfirmation.Confirmed,
    },
  });

  await prisma.lead.update({
    where: { id: leadId },
    data: { terminalOutcome: TerminalOutcome.MeetingBooked, lastActivityDate: new Date() },
  });

  await queueNotification({
    clientId,
    eventType: 'meeting_booked',
    title: 'Meeting booked',
    body: `${lead.fullName} from ${lead.company ?? 'Unknown'} has a meeting booked.`,
    linkUrl: `/meetings`,
  });

  res.status(201).json({ meeting });
});

// ─── GET /api/meetings — list meetings for authenticated client ───────────────

router.get('/meetings', requireAuth, async (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;
  const page = parseInt(req.query.page as string || '1', 10);
  const limit = Math.min(parseInt(req.query.limit as string || '50', 10), 200);
  const skip = (page - 1) * limit;

  const [meetings, total] = await Promise.all([
    prisma.meeting.findMany({
      where: { lead: { clientId } },
      include: { lead: { select: { fullName: true, company: true, emailAddress: true, clientId: true } } },
      orderBy: { meetingDate: 'desc' },
      skip,
      take: limit,
    }),
    prisma.meeting.count({ where: { lead: { clientId } } }),
  ]);

  res.status(200).json({
    meetings,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  });
});

// ─── PATCH /api/meetings/:id — update confirmation status ────────────────────

router.patch('/meetings/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;
  const { confirmationStatus } = req.body as { confirmationStatus?: MeetingConfirmation };

  const existing = await prisma.meeting.findFirst({
    where: { id: req.params.id, lead: { clientId } },
  });
  if (!existing) {
    res.status(404).json({ error: 'Meeting not found' });
    return;
  }

  if (!confirmationStatus || !Object.values(MeetingConfirmation).includes(confirmationStatus)) {
    res.status(400).json({ error: 'Valid confirmationStatus is required (Confirmed, Pending, NoShow)' });
    return;
  }

  const meeting = await prisma.meeting.update({
    where: { id: req.params.id },
    data: { confirmationStatus },
  });

  res.status(200).json({ meeting });
});

// ─── DELETE /api/meetings/:id ─────────────────────────────────────────────────

router.delete('/meetings/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;

  const existing = await prisma.meeting.findFirst({
    where: { id: req.params.id, lead: { clientId } },
  });
  if (!existing) {
    res.status(404).json({ error: 'Meeting not found' });
    return;
  }

  await prisma.meeting.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export default router;
