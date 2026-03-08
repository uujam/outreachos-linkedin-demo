import { StepResult } from './types';

const BASE_URL = 'https://api.clay.com/v1';

/**
 * Submits a lead to Clay for batch enrichment when all direct providers fail.
 * Results are returned asynchronously via webhook (see /api/enrichment/clay-webhook).
 */
export async function submitToClayBatch(lead: {
  leadId: string;
  fullName: string;
  company: string;
  linkedinUrl?: string | null;
}): Promise<StepResult> {
  const apiKey = process.env.CLAY_API_KEY;
  if (!apiKey) return { success: false, data: {}, provider: 'Clay', error: 'API key not set' };

  try {
    const res = await fetch(`${BASE_URL}/enrich`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        reference_id: lead.leadId,
        person: {
          name: lead.fullName,
          company_name: lead.company,
          linkedin_url: lead.linkedinUrl,
        },
        webhook_url: process.env.CLAY_WEBHOOK_URL,
      }),
    });
    if (!res.ok) return { success: false, data: {}, provider: 'Clay', error: `HTTP ${res.status}` };

    return { success: true, provider: 'Clay', data: {} };
  } catch (err) {
    return { success: false, data: {}, provider: 'Clay', error: String(err) };
  }
}
