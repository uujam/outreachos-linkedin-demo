import { Worker } from 'bullmq';
import { getRedisClient } from '../lib/redis';
import { runEnrichmentPipeline } from '../enrichment/pipeline';
import { LeadEnrichmentInput } from '../enrichment/types';

export function createEnrichmentWorker(): Worker {
  return new Worker(
    'enrichment',
    async (job) => {
      if (job.name !== 'enrich-lead') return;
      const input = job.data as LeadEnrichmentInput;
      await runEnrichmentPipeline(input);
    },
    {
      connection: getRedisClient(),
      concurrency: 5,
    }
  );
}
