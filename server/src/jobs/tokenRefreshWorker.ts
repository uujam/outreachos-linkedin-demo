/**
 * B-011a — Token refresh background job.
 * BullMQ repeatable job on the `notifications` queue (reuses existing infrastructure).
 * Runs every 6 hours. Finds all active integration tokens expiring within 24 hours
 * and silently refreshes them. Marks errored integrations as status=error.
 */
import { Worker, Job, Queue } from 'bullmq';
import { getRedisClient } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { refreshAccessToken, encryptToken, decryptToken } from '../lib/integrations';
import { IntegrationStatus } from '@prisma/client';

const JOB_NAME = 'refresh-integration-tokens';
const QUEUE_NAME = 'notifications'; // uses the existing notifications queue

/** Schedule the repeatable token refresh job. Call once at server startup. */
export async function scheduleTokenRefreshJob(queue: Queue): Promise<void> {
  await queue.add(JOB_NAME, {}, {
    repeat: { every: 6 * 60 * 60 * 1000 }, // every 6 hours
    jobId: 'token-refresh-repeatable',
    removeOnComplete: 10,
    removeOnFail: 5,
  });
}

async function refreshTokens(_job: Job): Promise<void> {
  // Find integrations expiring within the next 24 hours that have a refresh token
  const expiringBefore = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const integrations = await prisma.integrationConnection.findMany({
    where: {
      status: IntegrationStatus.active,
      refreshToken: { not: null },
      tokenExpiresAt: { lte: expiringBefore },
    },
  });

  for (const integration of integrations) {
    try {
      const refreshToken = decryptToken(integration.refreshToken!);
      const tokens = await refreshAccessToken(integration.service, refreshToken);

      const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : integration.tokenExpiresAt;

      await prisma.integrationConnection.update({
        where: { id: integration.id },
        data: {
          accessToken: encryptToken(tokens.access_token),
          refreshToken: tokens.refresh_token ? encryptToken(tokens.refresh_token) : integration.refreshToken,
          tokenExpiresAt: expiresAt,
          status: IntegrationStatus.active,
          errorMessage: null,
        },
      });
    } catch (err) {
      console.error(`[TokenRefresh] Failed to refresh ${integration.service} for client ${integration.clientId}:`, err);
      await prisma.integrationConnection.update({
        where: { id: integration.id },
        data: {
          status: IntegrationStatus.error,
          errorMessage: err instanceof Error ? err.message : 'Token refresh failed',
        },
      });
    }
  }
}

export function startTokenRefreshWorker(): Worker {
  const connection = getRedisClient();
  const worker = new Worker(QUEUE_NAME, async (job) => {
    if (job.name === JOB_NAME) {
      await refreshTokens(job);
    }
  }, {
    connection: connection as never,
    concurrency: 1,
  });

  worker.on('failed', (job, err) => {
    console.error(`[TokenRefreshWorker] Job ${job?.id} failed:`, err);
  });

  return worker;
}
