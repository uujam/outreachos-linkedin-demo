/**
 * B-010b — BullMQ worker for the `notifications` queue (F-028).
 * Processes notification jobs: creates the D-020 record and sends transactional email
 * for high-priority event types (if client has not opted out via notification preferences).
 */
import { Worker, Job } from 'bullmq';
import { getRedisClient } from '../lib/redis';
import { createNotification, NotificationPayload } from '../lib/notifications';
import { sendNotificationEmail, HIGH_PRIORITY_EVENTS } from '../lib/email';
import { prisma } from '../lib/prisma';

const HIGH_PRIORITY = new Set(HIGH_PRIORITY_EVENTS);

async function processNotification(job: Job<NotificationPayload>): Promise<void> {
  const { clientId, eventType, title, body, linkUrl } = job.data;

  // 1. Always create the in-app notification record
  await createNotification({ clientId, eventType, title, body, linkUrl });

  // 2. Send email only for high-priority events, respecting per-client opt-outs
  if (HIGH_PRIORITY.has(eventType)) {
    const user = await prisma.user.findUnique({
      where: { id: clientId },
      select: { email: true, name: true, notificationPreferences: true },
    });

    if (user) {
      const prefs = (user.notificationPreferences ?? {}) as Record<string, boolean>;
      // Default to sending unless explicitly disabled
      const emailEnabled = prefs[eventType] !== false;

      if (emailEnabled) {
        await sendNotificationEmail({
          to: user.email,
          name: user.name,
          eventType,
          title,
          body,
          linkUrl,
        }).catch((err: unknown) => {
          // Email failure is non-fatal — log and continue
          console.error(`[NotificationsWorker] Email send failed for ${eventType}:`, err);
        });
      }
    }
  }
}

export function startNotificationsWorker(): Worker {
  const connection = getRedisClient();
  const worker = new Worker('notifications', processNotification, {
    connection: connection as never,
    concurrency: 5,
  });

  worker.on('failed', (job, err) => {
    console.error(`[NotificationsWorker] Job ${job?.id} failed:`, err);
  });

  return worker;
}
