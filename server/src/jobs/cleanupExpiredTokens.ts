import { Worker, Queue } from 'bullmq';
import { getRedisClient } from '../lib/redis';
import { purgeExpiredTokens } from '../lib/passwordReset';

const QUEUE_NAME = 'notifications';
const JOB_NAME = 'cleanup-expired-tokens';

/**
 * Schedules the daily password-reset token cleanup as a BullMQ repeatable job
 * on the notifications queue (as specified in B-003a).
 */
export async function scheduleTokenCleanupJob(): Promise<void> {
  const queue = new Queue(QUEUE_NAME, { connection: getRedisClient() });

  await queue.add(
    JOB_NAME,
    {},
    {
      repeat: { pattern: '0 3 * * *' }, // 3 AM daily
      removeOnComplete: true,
      removeOnFail: false,
    }
  );

  await queue.close();
}

/**
 * Creates the worker that processes cleanup-expired-tokens jobs.
 * Returns the worker instance (call worker.close() to shut down).
 */
export function createTokenCleanupWorker(): Worker {
  return new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name !== JOB_NAME) return;
      const deleted = await purgeExpiredTokens();
      console.log(`[TokenCleanup] Purged ${deleted} expired password reset token(s)`);
    },
    { connection: getRedisClient() }
  );
}
