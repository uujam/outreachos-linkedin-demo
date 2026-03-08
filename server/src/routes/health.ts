import { Router, Request, Response } from 'express';
import { checkDatabaseHealth } from '../lib/prisma';
import { checkRedisHealth } from '../lib/redis';
import { checkQueuesHealth } from '../queues';

const router = Router();

router.get('/health', async (_req: Request, res: Response) => {
  const [database, redis, queues] = await Promise.all([
    checkDatabaseHealth(),
    checkRedisHealth(),
    checkQueuesHealth().catch(() =>
      Object.fromEntries(
        ['enrichment', 'outreach', 'discovery', 'scoring', 'follow-up', 'notifications'].map(
          (n) => [n, false]
        )
      )
    ),
  ]);

  const allQueuesOk = Object.values(queues).every(Boolean);
  const status = database && redis && allQueuesOk ? 'ok' : 'degraded';

  res.status(status === 'ok' ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    services: {
      database: database ? 'ok' : 'error',
      redis: redis ? 'ok' : 'error',
      queues: Object.fromEntries(
        Object.entries(queues).map(([k, v]) => [k, v ? 'ok' : 'error'])
      ),
    },
  });
});

export default router;
