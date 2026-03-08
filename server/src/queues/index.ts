import { Queue, QueueEvents } from 'bullmq';
import { getRedisClient } from '../lib/redis';

export const QUEUE_NAMES = [
  'enrichment',
  'outreach',
  'discovery',
  'scoring',
  'follow-up',
  'notifications',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

type QueueMap = Record<QueueName, Queue>;
type DlqMap = Record<QueueName, Queue>;

let queues: QueueMap | null = null;
let dlqs: DlqMap | null = null;

function createQueue(name: string): Queue {
  return new Queue(name, {
    connection: getRedisClient(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: false, // Keep failed jobs for DLQ inspection
    },
  });
}

export function getQueues(): QueueMap {
  if (!queues) {
    queues = Object.fromEntries(
      QUEUE_NAMES.map((name) => [name, createQueue(name)])
    ) as QueueMap;
  }
  return queues;
}

export function getDlqs(): DlqMap {
  if (!dlqs) {
    dlqs = Object.fromEntries(
      QUEUE_NAMES.map((name) => [name, createQueue(`${name}-dlq`)])
    ) as DlqMap;
  }
  return dlqs;
}

/**
 * Wire up DLQ forwarding: when a job exhausts all retries on a main queue,
 * move it to the corresponding dead-letter queue for inspection.
 */
export function wireDlqForwarding(): void {
  const mainQueues = getQueues();
  const deadLetterQueues = getDlqs();

  for (const name of QUEUE_NAMES) {
    const events = new QueueEvents(name, { connection: getRedisClient() });
    events.on('failed', async ({ jobId }) => {
      try {
        const job = await mainQueues[name].getJob(jobId);
        if (!job) return;
        // Only forward to DLQ when all attempts are exhausted
        const isExhausted = (job.attemptsMade ?? 0) >= (job.opts.attempts ?? 3);
        if (isExhausted) {
          await deadLetterQueues[name].add(
            job.name,
            { ...job.data, _originalJobId: jobId, _failedAt: new Date().toISOString() },
            { removeOnFail: true, removeOnComplete: true }
          );
        }
      } catch (err) {
        console.error(`[DLQ] Failed to forward job ${jobId} from ${name}:`, err);
      }
    });
  }
}

export async function checkQueuesHealth(): Promise<Record<string, boolean>> {
  const health: Record<string, boolean> = {};
  const mainQueues = getQueues();

  for (const name of QUEUE_NAMES) {
    try {
      await mainQueues[name].getJobCounts('waiting');
      health[name] = true;
    } catch {
      health[name] = false;
    }
  }
  return health;
}

export async function closeQueues(): Promise<void> {
  if (queues) {
    await Promise.all(Object.values(queues).map((q) => q.close()));
    queues = null;
  }
  if (dlqs) {
    await Promise.all(Object.values(dlqs).map((q) => q.close()));
    dlqs = null;
  }
}
