/**
 * B-010b — In-app notification API endpoints (F-028).
 * GET  /api/notifications         — paginated list, newest first (last 20 default)
 * POST /api/notifications/:id/read — mark a single notification as read
 * POST /api/notifications/read-all — mark all unread notifications as read
 * GET  /api/notifications/unread-count — badge count for notification bell
 */
import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/requireAuth';
import { prisma } from '../lib/prisma';

const router = Router();

// Notifications older than 90 days are not returned (AC-092)
function cutoffDate(): Date {
  return new Date(Date.now() - 90 * 86400_000);
}

// ─── GET /api/notifications ───────────────────────────────────────────────────

router.get('/notifications', requireAuth, async (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where: { clientId, createdAt: { gte: cutoffDate() } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.notification.count({
      where: { clientId, createdAt: { gte: cutoffDate() } },
    }),
  ]);

  res.status(200).json({ notifications, total });
});

// ─── GET /api/notifications/unread-count ────────────────────────────────────

router.get('/notifications/unread-count', requireAuth, async (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;

  const count = await prisma.notification.count({
    where: { clientId, readAt: null, createdAt: { gte: cutoffDate() } },
  });

  res.status(200).json({ count });
});

// ─── POST /api/notifications/read-all ───────────────────────────────────────

router.post('/notifications/read-all', requireAuth, async (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;

  await prisma.notification.updateMany({
    where: { clientId, readAt: null },
    data: { readAt: new Date() },
  });

  res.status(200).json({ ok: true });
});

// ─── POST /api/notifications/:id/read ────────────────────────────────────────

router.post('/notifications/:id/read', requireAuth, async (req: AuthRequest, res: Response) => {
  const clientId = req.user!.sub;
  const { id } = req.params;

  const notification = await prisma.notification.findFirst({
    where: { id, clientId },
  });

  if (!notification) {
    res.status(404).json({ error: 'Notification not found' });
    return;
  }

  const updated = await prisma.notification.update({
    where: { id },
    data: { readAt: notification.readAt ?? new Date() },
  });

  res.status(200).json({ notification: updated });
});

export default router;
