/**
 * BullMQ worker for the `scoring` queue.
 * Calls the Claude API to score each lead against the client's ICP.
 */
import { Worker, Job } from 'bullmq';
import { getRedisClient } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { scoreLead } from '../lib/fitScoring';

interface ScoringJobData {
  leadId: string;
  clientId: string;
}

async function processScoringJob(job: Job<ScoringJobData>): Promise<void> {
  const { leadId, clientId } = job.data;

  const [lead, icp] = await Promise.all([
    prisma.lead.findUnique({ where: { id: leadId } }),
    prisma.icpSettings.findUnique({ where: { clientId } }),
  ]);

  if (!lead) return;

  const { score, reasoning } = await scoreLead({
    lead: {
      fullName: lead.fullName,
      jobTitle: lead.jobTitle,
      company: lead.company,
      linkedinUrl: lead.linkedinUrl,
    },
    icp: {
      industries: (icp?.industries as string[] | undefined) ?? [],
      geography: (icp?.geography as string[] | undefined) ?? [],
      jobTitles: (icp?.jobTitles as string[] | undefined) ?? [],
      revenueRange: icp?.revenueRange,
      employeeRange: icp?.employeeRange,
      buyingSignals: icp?.buyingSignals,
      descriptionText: icp?.descriptionText,
    },
  });

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      fitScore: score,
      fitScoreReasoning: reasoning,
    },
  });
}

export function startScoringWorker(): Worker<ScoringJobData> {
  const worker = new Worker<ScoringJobData>('scoring', processScoringJob, {
    connection: getRedisClient(),
    concurrency: 3,
  });

  worker.on('failed', (job, err) => {
    console.error(`[ScoringWorker] Job ${job?.id} failed:`, err);
  });

  return worker;
}
