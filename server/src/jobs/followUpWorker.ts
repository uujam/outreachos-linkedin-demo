/**
 * B-011b — Follow-up reactivation job (F-026).
 * BullMQ repeatable job on the `follow-up` queue, running hourly.
 * Finds leads where terminalOutcome = FollowUpLater AND followUpDate <= now().
 * For each matched lead: clears terminalOutcome, sets outreachStage to Responded,
 * writes an activity log note, and enqueues a "lead_reactivated" notification.
 * Uses `<= now()` to catch up correctly after downtime.
 */
import { Worker, Queue, Job } from 'bullmq';
import { getRedisClient } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { queueNotification } from '../lib/notifications';
import { TerminalOutcome, OutreachStage, ActivityChannel, ActivityAction } from '@prisma/client';

const JOB_NAME = 'reactivate-follow-ups';

/** Schedule the repeatable follow-up job. Call once at server startup. */
export async function scheduleFollowUpJob(queue: Queue): Promise<void> {
  await queue.add(JOB_NAME, {}, {
    repeat: { every: 60 * 60 * 1000 }, // every hour
    jobId: 'follow-up-repeatable',
    removeOnComplete: 10,
    removeOnFail: 5,
  });
}

export async function reactivateFollowUps(_job: Job): Promise<number> {
  const now = new Date();

  const leads = await prisma.lead.findMany({
    where: {
      terminalOutcome: TerminalOutcome.FollowUpLater,
      followUpDate: { lte: now },
    },
  });

  let reactivated = 0;

  for (const lead of leads) {
    try {
      // Clear terminalOutcome, set outreachStage to Responded
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          terminalOutcome: null,
          outreachStage: OutreachStage.Responded,
          followUpDate: null,
          lastActivityDate: now,
        },
      });

      // Write activity log note
      await prisma.outreachActivity.create({
        data: {
          leadId: lead.id,
          channel: ActivityChannel.Email, // generic channel for system note
          actionType: ActivityAction.Sent,
          timestamp: now,
          notes: 'Lead reactivated — follow-up date reached.',
        },
      });

      // Notify client (F-028)
      await queueNotification({
        clientId: lead.clientId,
        eventType: 'lead_reactivated',
        title: 'Lead ready for follow-up',
        body: `${lead.fullName} from ${lead.company ?? 'Unknown'} is ready for follow-up.`,
        linkUrl: `/leads/${lead.id}`,
      });

      reactivated++;
    } catch (err) {
      console.error(`[FollowUpWorker] Failed to reactivate lead ${lead.id}:`, err);
    }
  }

  if (reactivated > 0) {
    console.log(`[FollowUpWorker] Reactivated ${reactivated} lead(s).`);
  }

  return reactivated;
}

export function startFollowUpWorker(): Worker {
  const connection = getRedisClient();
  const worker = new Worker('follow-up', async (job) => {
    if (job.name === JOB_NAME) {
      await reactivateFollowUps(job);
    }
  }, {
    connection: connection as never,
    concurrency: 1,
  });

  worker.on('failed', (job, err) => {
    console.error(`[FollowUpWorker] Job ${job?.id} failed:`, err);
  });

  return worker;
}
