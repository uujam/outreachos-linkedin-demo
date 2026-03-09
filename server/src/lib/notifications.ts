/**
 * B-010b — Notification utilities (F-028).
 * queueNotification: enqueues a job on the BullMQ `notifications` queue.
 * createNotification: directly creates a D-020 Notification record (used by the worker).
 */
import { getQueues } from '../queues';
import { prisma } from './prisma';

export interface NotificationPayload {
  clientId: string;
  eventType: string;
  title: string;
  body: string;
  linkUrl?: string;
}

/**
 * Enqueue a notification job — call this from webhook handlers and business logic.
 * Never throws; logs and swallows queue errors so callers are never blocked.
 */
export async function queueNotification(payload: NotificationPayload): Promise<void> {
  try {
    const queues = getQueues();
    await queues.notifications.add('send-notification', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
  } catch (err) {
    console.error('[Notifications] Failed to queue notification:', err);
  }
}

/**
 * Directly create a D-020 Notification record in the database.
 * Called by the BullMQ notifications worker.
 */
export async function createNotification(payload: NotificationPayload): Promise<void> {
  await prisma.notification.create({
    data: {
      clientId: payload.clientId,
      eventType: payload.eventType,
      title: payload.title,
      body: payload.body,
      linkUrl: payload.linkUrl ?? null,
    },
  });
}
