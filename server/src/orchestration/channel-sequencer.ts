/**
 * B-009a — Campaign channel orchestration (F-025).
 * Manages multi-channel outreach step scheduling via BullMQ delayed jobs.
 * Default step order: email → LinkedIn → voice (configurable via D-004 channel_config).
 * When any channel fires a reply, all pending outreach jobs for that lead are cancelled.
 */
import { getQueues } from '../queues';
import { prisma } from '../lib/prisma';
import { CampaignChannel } from '@prisma/client';

// Default delays (in milliseconds) between channel steps
const DEFAULT_DELAYS: Record<string, number> = {
  email: 0,              // Email starts immediately on enrolment
  linkedin: 2 * 86400_000,  // LinkedIn connection request on Day 2
  voice: 5 * 86400_000,     // Voice call on Day 5 (only if no reply)
};

interface ChannelConfig {
  emailDelayMs?: number;
  linkedinDelayMs?: number;
  voiceDelayMs?: number;
  voiceEnabled?: boolean;
}

/**
 * Schedule all channel steps for a lead enrolled in a campaign.
 * Called by enrolLeadIfReady after campaign assignment.
 */
export async function scheduleChannelSteps(params: {
  leadId: string;
  clientId: string;
  campaignId: string;
  campaignChannels: CampaignChannel[];
  channelConfig: ChannelConfig | null;
  instantlyCampaignId?: string;
  heyreachCampaignId?: string;
}): Promise<void> {
  const { leadId, clientId, campaignId, campaignChannels, channelConfig, instantlyCampaignId, heyreachCampaignId } = params;
  const queues = getQueues();

  const delays: Record<string, number> = {
    email: channelConfig?.emailDelayMs ?? DEFAULT_DELAYS.email,
    linkedin: channelConfig?.linkedinDelayMs ?? DEFAULT_DELAYS.linkedin,
    voice: channelConfig?.voiceDelayMs ?? DEFAULT_DELAYS.voice,
  };

  let stepIndex = 0;

  // Email step
  if (campaignChannels.includes(CampaignChannel.Email) && instantlyCampaignId) {
    await queues.outreach.add(
      `outreach:${leadId}:email`,
      { leadId, clientId, campaignId, step: 'email', instantlyCampaignId },
      { delay: delays.email, jobId: `outreach-${leadId}-email` }
    );

    if (stepIndex === 0) {
      await prisma.lead.update({
        where: { id: leadId },
        data: { currentChannelStep: 'email' },
      });
    }
    stepIndex++;
  }

  // LinkedIn step
  if (campaignChannels.includes(CampaignChannel.LinkedIn) && heyreachCampaignId) {
    await queues.outreach.add(
      `outreach:${leadId}:linkedin`,
      { leadId, clientId, campaignId, step: 'linkedin', heyreachCampaignId },
      { delay: delays.linkedin, jobId: `outreach-${leadId}-linkedin` }
    );
    stepIndex++;
  }

  // Voice step (only if voice is enabled and lead has a phone number)
  if (campaignChannels.includes(CampaignChannel.Voice) && channelConfig?.voiceEnabled !== false) {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { phoneNumber: true } });
    if (lead?.phoneNumber) {
      await queues.outreach.add(
        `outreach:${leadId}:voice`,
        { leadId, clientId, campaignId, step: 'voice' },
        { delay: delays.voice, jobId: `outreach-${leadId}-voice` }
      );
    }
  }
}

/**
 * Cancel all pending outreach jobs for a lead when a reply is detected.
 * Called from webhook handlers when any channel receives a reply.
 */
export async function cancelPendingOutreachJobs(leadId: string): Promise<void> {
  const queues = getQueues();
  const steps = ['email', 'linkedin', 'voice'];

  for (const step of steps) {
    const jobId = `outreach-${leadId}-${step}`;
    try {
      const job = await queues.outreach.getJob(jobId);
      if (job) {
        await job.remove();
      }
    } catch {
      // Job may not exist — ignore
    }
  }

  // Mark lead as Responded
  await prisma.lead.update({
    where: { id: leadId },
    data: { outreachStage: 'Responded' },
  });
}
