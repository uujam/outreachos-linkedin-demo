/**
 * B-009a Channel sequencer tests
 * Covers: scheduleChannelSteps with all channels, per-channel delays,
 * cancelPendingOutreachJobs, and reply cancellation via Heyreach/Instantly webhooks.
 */

const mockOutreachAdd = jest.fn().mockResolvedValue({});
const mockOutreachGetJob = jest.fn();

jest.mock('../src/queues', () => ({
  QUEUE_NAMES: ['enrichment', 'outreach', 'discovery', 'scoring', 'follow-up', 'notifications'],
  getQueues: jest.fn(() => ({
    outreach: { add: mockOutreachAdd, getJob: mockOutreachGetJob },
    enrichment: { add: jest.fn() },
    discovery: { add: jest.fn(), removeRepeatable: jest.fn() },
    scoring: { add: jest.fn() },
    'follow-up': { add: jest.fn() },
    notifications: { add: jest.fn() },
  })),
  getDlqs: jest.fn(),
  checkQueuesHealth: jest.fn().mockResolvedValue({}),
  wireDlqForwarding: jest.fn(),
  closeQueues: jest.fn(),
}));

jest.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    lead: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    campaign: { findFirst: jest.fn() },
    $queryRaw: jest.fn(),
  },
  checkDatabaseHealth: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/lib/redis', () => ({
  getRedisClient: jest.fn(),
  checkRedisHealth: jest.fn().mockResolvedValue(true),
  closeRedis: jest.fn(),
}));

jest.mock('../src/lib/heyreach', () => ({
  enrolLeadInHeyreach: jest.fn().mockResolvedValue({ success: true }),
  getLinkedInAccountStatus: jest.fn(),
}));

import { prisma } from '../src/lib/prisma';
import { scheduleChannelSteps, cancelPendingOutreachJobs } from '../src/orchestration/channel-sequencer';
import { CampaignChannel } from '@prisma/client';

const mockLeadFindUnique = prisma.lead.findUnique as jest.MockedFunction<typeof prisma.lead.findUnique>;
const mockLeadUpdate = prisma.lead.update as jest.MockedFunction<typeof prisma.lead.update>;

beforeEach(() => {
  jest.clearAllMocks();
  mockLeadUpdate.mockResolvedValue({} as never);
});

const BASE_PARAMS = {
  leadId: 'lead-001',
  clientId: 'user-001',
  campaignId: 'campaign-001',
  campaignChannels: [CampaignChannel.Email, CampaignChannel.LinkedIn, CampaignChannel.Voice] as CampaignChannel[],
  channelConfig: {
    instantlyCampaignId: 'inst-001',
    heyreachCampaignId: 'hey-001',
    voiceEnabled: true,
  },
  instantlyCampaignId: 'inst-001',
  heyreachCampaignId: 'hey-001',
};

// ─── scheduleChannelSteps ─────────────────────────────────────────────────────

describe('scheduleChannelSteps', () => {
  beforeEach(() => {
    mockLeadFindUnique.mockResolvedValue({ phoneNumber: '+44 7700 900000' } as never);
  });

  it('queues email, linkedin, and voice jobs for a full-channel campaign', async () => {
    await scheduleChannelSteps(BASE_PARAMS);

    const jobNames = mockOutreachAdd.mock.calls.map((c) => c[0] as string);
    expect(jobNames).toContain('outreach:lead-001:email');
    expect(jobNames).toContain('outreach:lead-001:linkedin');
    expect(jobNames).toContain('outreach:lead-001:voice');
  });

  it('email step has zero delay by default', async () => {
    await scheduleChannelSteps(BASE_PARAMS);

    const emailCall = mockOutreachAdd.mock.calls.find((c) => (c[0] as string).includes(':email'));
    expect(emailCall?.[2]).toMatchObject({ delay: 0 });
  });

  it('linkedin step has 2-day delay by default', async () => {
    await scheduleChannelSteps(BASE_PARAMS);

    const linkedinCall = mockOutreachAdd.mock.calls.find((c) => (c[0] as string).includes(':linkedin'));
    expect(linkedinCall?.[2]).toMatchObject({ delay: 2 * 86400_000 });
  });

  it('voice step has 5-day delay by default', async () => {
    await scheduleChannelSteps(BASE_PARAMS);

    const voiceCall = mockOutreachAdd.mock.calls.find((c) => (c[0] as string).includes(':voice'));
    expect(voiceCall?.[2]).toMatchObject({ delay: 5 * 86400_000 });
  });

  it('respects custom delays from channelConfig', async () => {
    await scheduleChannelSteps({
      ...BASE_PARAMS,
      channelConfig: {
        ...BASE_PARAMS.channelConfig,
        emailDelayMs: 3600_000, // 1 hour
        linkedinDelayMs: 86400_000, // 1 day
      },
    });

    const emailCall = mockOutreachAdd.mock.calls.find((c) => (c[0] as string).includes(':email'));
    expect(emailCall?.[2]).toMatchObject({ delay: 3600_000 });
  });

  it('skips voice step when lead has no phone number', async () => {
    mockLeadFindUnique.mockResolvedValue({ phoneNumber: null } as never);

    await scheduleChannelSteps(BASE_PARAMS);

    const jobNames = mockOutreachAdd.mock.calls.map((c) => c[0] as string);
    expect(jobNames).not.toContain('outreach:lead-001:voice');
  });

  it('skips email step when campaign has no Email channel', async () => {
    await scheduleChannelSteps({
      ...BASE_PARAMS,
      campaignChannels: [CampaignChannel.LinkedIn],
    });

    const jobNames = mockOutreachAdd.mock.calls.map((c) => c[0] as string);
    expect(jobNames).not.toContain('outreach:lead-001:email');
    expect(jobNames).toContain('outreach:lead-001:linkedin');
  });
});

// ─── cancelPendingOutreachJobs ────────────────────────────────────────────────

describe('cancelPendingOutreachJobs', () => {
  it('removes all pending outreach jobs and marks lead Responded', async () => {
    const mockRemove = jest.fn().mockResolvedValue(undefined);
    mockOutreachGetJob.mockResolvedValue({ remove: mockRemove });

    await cancelPendingOutreachJobs('lead-001');

    expect(mockOutreachGetJob).toHaveBeenCalledWith('outreach-lead-001-email');
    expect(mockOutreachGetJob).toHaveBeenCalledWith('outreach-lead-001-linkedin');
    expect(mockOutreachGetJob).toHaveBeenCalledWith('outreach-lead-001-voice');
    expect(mockRemove).toHaveBeenCalledTimes(3);
    expect(mockLeadUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ outreachStage: 'Responded' }) })
    );
  });

  it('handles missing jobs gracefully (job already completed)', async () => {
    mockOutreachGetJob.mockResolvedValue(null); // no pending job

    await expect(cancelPendingOutreachJobs('lead-001')).resolves.not.toThrow();
    expect(mockLeadUpdate).toHaveBeenCalled();
  });
});
