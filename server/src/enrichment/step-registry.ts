/**
 * Step registry — defines the three enrichment steps and which providers
 * are tried in order for each step.
 *
 * Step 1 (Identify): Get LinkedIn profile data — ProxyCurl
 * Step 2 (Enrich):  Find email address — Apollo.io → Hunter.io
 * Step 3 (Validate): Verify email deliverability — ZeroBounce
 */
export const ENRICHMENT_STEPS = ['Identify', 'Enrich', 'Validate'] as const;
export type EnrichmentStepName = (typeof ENRICHMENT_STEPS)[number];
