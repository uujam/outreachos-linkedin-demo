/**
 * B-007b — End-to-end automation trigger
 * Called when a client saves/updates their ICP. Queues discovery jobs for
 * all active source adapters and schedules the recurring daily discovery cron.
 */
import { getQueues } from '../queues';
import { prisma } from '../lib/prisma';
import { enrolLeadInHeyreach } from '../lib/heyreach';
import { CampaignChannel } from '@prisma/client';

const DAILY_DISCOVERY_CRON = '0 7 * * *'; // 07:00 UTC every day

/**
 * Trigger full automation pipeline when a client saves their ICP.
 * 1. Queue an immediate discovery job (LinkedIn + Companies House)
 * 2. Register a repeatable daily discovery job
 * 3. After lead creation, enrichment is auto-queued by each source adapter
 * 4. After enrichment, campaign auto-enrolment is handled by enrolLeadIfReady()
 */
export async function triggerAutomationOnIcpSave(clientId: string): Promise<void> {
  const queues = getQueues();

  // Remove any previously scheduled daily job for this client so we don't stack up duplicates
  await queues.discovery.removeRepeatable(`discovery:${clientId}`, {
    pattern: DAILY_DISCOVERY_CRON,
  });

  // Queue an immediate run
  await queues.discovery.add(
    `discovery:${clientId}:immediate`,
    { clientId, sources: ['linkedin', 'companiesHouse'] },
    { jobId: `discovery-immediate-${clientId}-${Date.now()}` }
  );

  // Schedule daily repeating job
  await queues.discovery.add(
    `discovery:${clientId}:daily`,
    { clientId, sources: ['linkedin', 'companiesHouse'] },
    {
      repeat: { pattern: DAILY_DISCOVERY_CRON },
      jobId: `discovery-daily-${clientId}`,
    }
  );

  // Re-score all active leads for this client (ICP changed — scores are stale)
  await rescoreActiveLeads(clientId);
}

/**
 * Queue scoring jobs for all active (non-terminal) leads of a client.
 * Called when ICP settings are updated.
 */
export async function rescoreActiveLeads(clientId: string): Promise<void> {
  const leads = await prisma.lead.findMany({
    where: { clientId, terminalOutcome: null, dncFlag: false },
    select: { id: true },
  });

  const queues = getQueues();
  for (const lead of leads) {
    await queues.scoring.add(
      `score:${lead.id}`,
      { leadId: lead.id, clientId },
      { jobId: `score-${lead.id}-rescore-${Date.now()}` }
    );
  }
}

/**
 * Auto-enrol a lead into the first matching active campaign, if any.
 * Called after a lead reaches ReadyForOutreach.
 */
export async function enrolLeadIfReady(leadId: string, clientId: string): Promise<void> {
  // Find the lead to confirm it's ReadyForOutreach and not already enrolled
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, clientId, enrichmentStage: 'ReadyForOutreach', assignedCampaignId: null, dncFlag: false },
  });

  if (!lead) return;

  // Find the first active campaign for this client
  const campaign = await prisma.campaign.findFirst({
    where: { clientId, status: 'Active' },
    orderBy: { createdAt: 'asc' },
  });

  if (!campaign) return;

  // Assign lead to campaign
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      assignedCampaignId: campaign.id,
      outreachStage: 'InOutreach',
    },
  });

  // If the campaign has LinkedIn in its channel mix, enrol in Heyreach
  const channelMix = campaign.channelMix as CampaignChannel[];
  if (channelMix.includes(CampaignChannel.LinkedIn) && lead.linkedinUrl) {
    const channelConfig = campaign.channelConfig as Record<string, unknown> | null;
    const heyreachCampaignId = (channelConfig?.heyreachCampaignId as string | undefined);
    if (heyreachCampaignId) {
      await enrolLeadInHeyreach({
        heyreachCampaignId,
        linkedinUrl: lead.linkedinUrl,
        fullName: lead.fullName,
        company: lead.company,
        jobTitle: lead.jobTitle ?? undefined,
      }).catch((err) => console.error('[Heyreach] Enrolment failed:', err));
    }
  }

  // Queue outreach job
  const queues = getQueues();
  await queues.outreach.add(
    `outreach:${leadId}`,
    { leadId, clientId, campaignId: campaign.id },
    { jobId: `outreach-${leadId}` }
  );
}

/**
 * Queue an enrichment job immediately after lead creation.
 * Called by all lead source adapters (LinkedIn, Companies House, manual).
 */
export async function queueEnrichmentForLead(
  leadId: string,
  clientId: string,
  linkedinUrl?: string | null
): Promise<void> {
  const queues = getQueues();
  await queues.enrichment.add(
    `enrich:${leadId}`,
    { leadId, clientId, linkedinUrl: linkedinUrl ?? undefined },
    { jobId: `enrich-${leadId}` }
  );
}
