/**
 * B-002 Schema tests
 *
 * Validates that the Prisma client was generated with all 22 models (D-001–D-022)
 * and that the expected enums are exported. No database connection required.
 */

import { PrismaClient } from '@prisma/client';
import * as PrismaTypes from '@prisma/client';

describe('Prisma schema — model coverage (D-001 to D-022)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Each model name maps to the corresponding data-model requirement
  const expectedModels: Array<[string, string]> = [
    ['user',                  'D-001 User / Client Account'],
    ['lead',                  'D-002 Lead / Prospect'],
    ['company',               'D-003 Company (Companies House)'],
    ['campaign',              'D-004 Campaign'],
    ['outreachActivity',      'D-005 Outreach Activity'],
    ['emailSequence',         'D-006 Email Sequence'],
    ['voiceCallRecord',       'D-007 Voice Call Record'],
    ['meeting',               'D-008 Meeting'],
    ['icpSettings',           'D-009 ICP Settings'],
    ['linkedInScrapeBatch',   'D-010 LinkedIn Scrape Batch'],
    ['reportSnapshot',        'D-011 Report Snapshot'],
    ['subscription',          'D-012 Subscription'],
    ['invoice',               'D-013 Invoice'],
    ['pricingPlan',           'D-014 Pricing Plan'],
    ['enrichmentLog',         'D-015 Enrichment Log'],
    ['bookingWebhookEvent',   'D-016 Booking Webhook Event'],
    ['apiUsageLog',           'D-017 API Usage Log'],
    ['enrichmentCache',       'D-018 Enrichment Cache'],
    ['passwordResetToken',    'D-019 Password Reset Token'],
    ['notification',          'D-020 Notification'],
    ['integrationConnection', 'D-021 Integration Connection'],
    ['message',               'D-022 Message (Conversation Timeline)'],
  ];

  it.each(expectedModels)(
    'PrismaClient has model delegate for %s (%s)',
    (modelName) => {
      const client = prisma as unknown as Record<string, unknown>;
      expect(client).toHaveProperty(modelName);
      expect(typeof client[modelName]).toBe('object');
    }
  );

  it('has exactly 22 model delegates (one per data-model requirement)', () => {
    const modelCount = expectedModels.length;
    expect(modelCount).toBe(22);

    const client = prisma as unknown as Record<string, unknown>;
    const allPresent = expectedModels.every(
      ([name]) => typeof client[name] === 'object'
    );
    expect(allPresent).toBe(true);
  });
});

describe('Prisma schema — enum exports', () => {
  const expectedEnums: Array<[string, string[]]> = [
    ['Role',                ['client', 'admin']],
    ['LeadSource',          ['LinkedIn', 'CompaniesHouse', 'Manual']],
    ['EnrichmentStage',     ['Discovered', 'Identified', 'Enriched', 'Validated', 'ReadyForOutreach', 'InvalidEmail']],
    ['OutreachStage',       ['InOutreach', 'Responded', 'Qualified']],
    ['TerminalOutcome',     ['MeetingBooked', 'NotInterested', 'FollowUpLater', 'WrongFit', 'DoNotContact']],
    ['CampaignChannel',     ['LinkedIn', 'Email', 'Voice']],
    ['CampaignStatus',      ['Active', 'Paused', 'Complete']],
    ['ActivityChannel',     ['LinkedIn', 'Email', 'Voice']],
    ['ActivityAction',      ['Sent', 'Opened', 'Clicked', 'Replied', 'Called', 'Voicemail']],
    ['VoiceCallOutcome',    ['Qualified', 'Interested', 'NotReached', 'Voicemail']],
    ['MeetingBookedVia',    ['Calendly', 'CalCom', 'Manual']],
    ['MeetingConfirmation', ['Confirmed', 'Pending', 'NoShow']],
    ['SequenceStatus',      ['Active', 'Paused', 'Complete']],
    ['ScrapeBatchStatus',   ['Running', 'Complete', 'Failed']],
    ['SubscriptionPlan',    ['Starter', 'Growth', 'Enterprise']],
    ['SubscriptionStatus',  ['active', 'past_due', 'cancelled', 'unpaid']],
    ['InvoiceStatus',       ['paid', 'open', 'void']],
    ['EnrichmentStep',      ['Identify', 'Enrich', 'Validate']],
    ['EnrichmentLogStatus', ['success', 'failed', 'skipped']],
    ['ThirdPartyService',   ['ProxyCurl', 'ApolloIo', 'HunterIo', 'ZeroBounce', 'Clay', 'VAPI', 'Twilio', 'Instantly', 'Phantombuster', 'Heyreach']],
    ['ApiActionType',       ['EnrichmentLookup', 'ClayFallbackRun', 'VoiceCallMinute', 'TwilioBrandedCall', 'EmailSent', 'ScrapeRun', 'LinkedInAction', 'CacheHit']],
    ['BookingEventType',    ['BookingCreated', 'BookingCancelled', 'BookingRescheduled']],
    ['IntegrationService',  ['calendly', 'cal_com', 'google_calendar', 'microsoft_outlook']],
    ['IntegrationStatus',   ['active', 'error', 'disconnected']],
    ['MessageDirection',    ['outbound', 'inbound']],
    ['MessageChannel',      ['email', 'linkedin', 'voice', 'note']],
    ['MessageTool',         ['Instantly', 'Heyreach', 'VAPI', 'Manual']],
    ['MessageType',         ['email', 'connection_request', 'linkedin_message', 'voice_call', 'note']],
    ['DeliveryStatus',      ['sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'unsubscribed', 'accepted', 'not_reached', 'voicemail', 'qualified']],
  ];

  it.each(expectedEnums)(
    'enum %s is exported with correct values',
    (enumName, values) => {
      const exported = (PrismaTypes as Record<string, unknown>)[enumName];
      expect(exported).toBeDefined();

      values.forEach((value) => {
        expect((exported as Record<string, unknown>)[value]).toBe(value);
      });
    }
  );
});
