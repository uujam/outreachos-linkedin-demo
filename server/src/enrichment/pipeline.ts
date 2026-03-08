import { prisma } from '../lib/prisma';
import { EnrichmentStage, EnrichmentStep, EnrichmentLogStatus, ThirdPartyService } from '@prisma/client';
import { lookupByLinkedinUrl } from './proxycurl';
import { findEmailByLinkedIn } from './apollo';
import { findEmailByDomain } from './hunter';
import { validateEmail } from './zerobounce';
import { submitToClayBatch } from './clay';
import { LeadEnrichmentInput, EnrichmentData } from './types';
import { enrolLeadIfReady } from '../orchestration/automationTrigger';

const CACHE_TTL_DAYS = 90;

// ─── Cache helpers ────────────────────────────────────────────────────────────

async function getCachedEnrichment(key: string): Promise<EnrichmentData | null> {
  const cached = await prisma.enrichmentCache.findUnique({ where: { cacheKey: key } });
  if (!cached) return null;

  const staleDate = new Date(Date.now() - CACHE_TTL_DAYS * 86400_000);
  if (cached.lastVerifiedAt && cached.lastVerifiedAt < staleDate) return null;

  return {
    fullName: cached.fullName ?? undefined,
    jobTitle: cached.jobTitle ?? undefined,
    company: cached.companyName ?? undefined,
    companyDomain: cached.companyDomain ?? undefined,
    linkedinUrl: cached.linkedinUrl ?? undefined,
    email: cached.email ?? undefined,
    phone: cached.phone ?? undefined,
    emailDeliverable: cached.emailDeliverable ?? undefined,
    emailDeliverableReason: cached.emailDeliverableReason ?? undefined,
    sourceLinkedin: cached.sourceLinkedin ?? undefined,
    sourceEmail: cached.sourceEmail ?? undefined,
    sourceVerified: cached.sourceVerified ?? undefined,
  };
}

async function upsertCache(key: string, data: EnrichmentData): Promise<void> {
  await prisma.enrichmentCache.upsert({
    where: { cacheKey: key },
    create: {
      cacheKey: key,
      fullName: data.fullName,
      jobTitle: data.jobTitle,
      companyName: data.company,
      companyDomain: data.companyDomain,
      linkedinUrl: data.linkedinUrl,
      email: data.email,
      phone: data.phone,
      emailDeliverable: data.emailDeliverable,
      emailDeliverableReason: data.emailDeliverableReason,
      sourceLinkedin: data.sourceLinkedin,
      sourceEmail: data.sourceEmail,
      sourceVerified: data.sourceVerified,
      lastVerifiedAt: new Date(),
    },
    update: {
      ...(data.fullName && { fullName: data.fullName }),
      ...(data.jobTitle && { jobTitle: data.jobTitle }),
      ...(data.company && { companyName: data.company }),
      ...(data.companyDomain && { companyDomain: data.companyDomain }),
      ...(data.email && { email: data.email }),
      ...(data.phone && { phone: data.phone }),
      ...(data.emailDeliverable !== undefined && { emailDeliverable: data.emailDeliverable }),
      ...(data.emailDeliverableReason && { emailDeliverableReason: data.emailDeliverableReason }),
      ...(data.sourceLinkedin && { sourceLinkedin: data.sourceLinkedin }),
      ...(data.sourceEmail && { sourceEmail: data.sourceEmail }),
      ...(data.sourceVerified && { sourceVerified: data.sourceVerified }),
      lastVerifiedAt: new Date(),
    },
  });
}

async function logEnrichmentStep(
  leadId: string,
  step: EnrichmentStep,
  status: EnrichmentLogStatus,
  provider: ThirdPartyService,
  dataRetrieved?: string
): Promise<void> {
  await prisma.enrichmentLog.create({
    data: { leadId, enrichmentStep: step, status, thirdPartyService: provider, dataRetrieved },
  });
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

export async function runEnrichmentPipeline(input: LeadEnrichmentInput): Promise<void> {
  const { leadId, clientId, skipLinkedin, skipEmail } = input;

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;

  // ── Global suppression check ─────────────────────────────────────────────
  const cacheKey = lead.linkedinUrl ?? `${lead.fullName}:${lead.company}`;
  const cachedFull = await prisma.enrichmentCache.findUnique({ where: { cacheKey } });
  if (cachedFull?.globalSuppression) {
    await prisma.lead.update({
      where: { id: leadId },
      data: { dncFlag: true, enrichmentStage: EnrichmentStage.InvalidEmail },
    });
    return;
  }

  // ── Cache hit check ───────────────────────────────────────────────────────
  const cached = await getCachedEnrichment(cacheKey);
  if (cached && cached.email && cached.emailDeliverable) {
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        fullName: cached.fullName ?? lead.fullName,
        jobTitle: cached.jobTitle ?? lead.jobTitle,
        company: cached.company ?? lead.company,
        linkedinUrl: cached.linkedinUrl ?? lead.linkedinUrl,
        emailAddress: cached.email,
        phoneNumber: cached.phone ?? lead.phoneNumber,
        enrichmentStage: EnrichmentStage.ReadyForOutreach,
      },
    });
    await logEnrichmentStep(leadId, EnrichmentStep.Validate, EnrichmentLogStatus.success, ThirdPartyService.ZeroBounce, 'cache hit');
    await enrolLeadIfReady(leadId, clientId).catch(() => {});
    return;
  }

  let accumulated: EnrichmentData = {};

  // ── Step 1: Identify (ProxyCurl) ─────────────────────────────────────────
  await prisma.lead.update({ where: { id: leadId }, data: { enrichmentStage: EnrichmentStage.Identified } });

  if (!skipLinkedin && lead.linkedinUrl) {
    const result = await lookupByLinkedinUrl(lead.linkedinUrl);
    const status = result.success ? EnrichmentLogStatus.success : EnrichmentLogStatus.failed;
    await logEnrichmentStep(leadId, EnrichmentStep.Identify, status, ThirdPartyService.ProxyCurl, result.error ?? result.data.fullName);
    if (result.success) {
      accumulated = { ...accumulated, ...result.data };
      await upsertCache(cacheKey, accumulated);
    }
  } else {
    await logEnrichmentStep(leadId, EnrichmentStep.Identify, EnrichmentLogStatus.skipped, ThirdPartyService.ProxyCurl, 'linkedinUrl already known');
    accumulated.linkedinUrl = lead.linkedinUrl ?? undefined;
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      enrichmentStage: EnrichmentStage.Enriched,
      ...(accumulated.fullName && { fullName: accumulated.fullName }),
      ...(accumulated.jobTitle && { jobTitle: accumulated.jobTitle }),
      ...(accumulated.company && { company: accumulated.company }),
    },
  });

  // ── Step 2: Enrich (Apollo → Hunter) ─────────────────────────────────────
  let emailFound = lead.emailAddress ?? accumulated.email ?? null;

  if (!skipEmail && !emailFound) {
    // Try Apollo first
    if (lead.linkedinUrl ?? accumulated.linkedinUrl) {
      const apolloResult = await findEmailByLinkedIn(lead.linkedinUrl ?? accumulated.linkedinUrl ?? '');
      const status = apolloResult.success ? EnrichmentLogStatus.success : EnrichmentLogStatus.failed;
      await logEnrichmentStep(leadId, EnrichmentStep.Enrich, status, ThirdPartyService.ApolloIo, apolloResult.data.email ?? apolloResult.error);
      if (apolloResult.success && apolloResult.data.email) {
        emailFound = apolloResult.data.email;
        accumulated = { ...accumulated, ...apolloResult.data };
        await upsertCache(cacheKey, accumulated);
      }
    }

    // Fallback to Hunter if Apollo failed
    if (!emailFound && accumulated.companyDomain && (accumulated.fullName ?? lead.fullName)) {
      const hunterResult = await findEmailByDomain(accumulated.fullName ?? lead.fullName, accumulated.companyDomain);
      const status = hunterResult.success ? EnrichmentLogStatus.success : EnrichmentLogStatus.failed;
      await logEnrichmentStep(leadId, EnrichmentStep.Enrich, status, ThirdPartyService.HunterIo, hunterResult.data.email ?? hunterResult.error);
      if (hunterResult.success && hunterResult.data.email) {
        emailFound = hunterResult.data.email;
        accumulated = { ...accumulated, ...hunterResult.data };
        await upsertCache(cacheKey, accumulated);
      }
    }
  }

  // If no email found — send to Clay batch fallback
  if (!emailFound) {
    const clayResult = await submitToClayBatch({
      leadId,
      fullName: accumulated.fullName ?? lead.fullName,
      company: accumulated.company ?? lead.company,
      linkedinUrl: lead.linkedinUrl ?? accumulated.linkedinUrl,
    });
    await logEnrichmentStep(leadId, EnrichmentStep.Enrich, EnrichmentLogStatus.failed, ThirdPartyService.Clay, clayResult.error ?? 'submitted to Clay');

    // Mark lead as pending Clay — will be updated via webhook
    await prisma.lead.update({ where: { id: leadId }, data: { enrichmentStage: EnrichmentStage.Enriched } });
    return;
  }

  // ── Step 3: Validate (ZeroBounce) ────────────────────────────────────────
  const zbResult = await validateEmail(emailFound);
  const zbStatus = zbResult.success ? EnrichmentLogStatus.success : EnrichmentLogStatus.failed;
  await logEnrichmentStep(leadId, EnrichmentStep.Validate, zbStatus, ThirdPartyService.ZeroBounce, zbResult.data.emailDeliverableReason ?? zbResult.error);

  if (!zbResult.data.emailDeliverable) {
    await prisma.lead.update({
      where: { id: leadId },
      data: { emailAddress: emailFound, enrichmentStage: EnrichmentStage.InvalidEmail },
    });
    return;
  }

  accumulated = { ...accumulated, ...zbResult.data, email: emailFound };
  await upsertCache(cacheKey, accumulated);

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      emailAddress: emailFound,
      phoneNumber: accumulated.phone ?? lead.phoneNumber,
      enrichmentStage: EnrichmentStage.ReadyForOutreach,
    },
  });

  await enrolLeadIfReady(leadId, clientId).catch(() => {});
}
