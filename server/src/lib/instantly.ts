/**
 * Instantly API client.
 * Handles email sequence creation and lead enrolment.
 */

const INSTANTLY_BASE_URL = process.env.INSTANTLY_API_URL ?? 'https://api.instantly.ai/api/v2';
const INSTANTLY_API_KEY = process.env.INSTANTLY_API_KEY ?? '';

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${INSTANTLY_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

export interface InstantlyEnrolResult {
  success: boolean;
  leadId?: string;
  error?: string;
}

/**
 * Enrol a lead in an Instantly email campaign.
 * Enforces that the lead must be ReadyForOutreach.
 */
export async function enrolLeadInInstantly(params: {
  campaignId: string;
  email: string;
  fullName: string;
  company?: string;
  personalisationVariables?: Record<string, string>;
}): Promise<InstantlyEnrolResult> {
  try {
    const res = await fetch(`${INSTANTLY_BASE_URL}/lead`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        campaign_id: params.campaignId,
        email: params.email,
        first_name: params.fullName.split(' ')[0],
        last_name: params.fullName.split(' ').slice(1).join(' '),
        company_name: params.company ?? '',
        personalization_variables: params.personalisationVariables ?? {},
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `Instantly API error ${res.status}: ${body}` };
    }

    const data = await res.json() as { id?: string };
    return { success: true, leadId: data.id };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Get the warmup status of a sending domain via Instantly API.
 */
export async function getDomainWarmupStatus(email: string): Promise<{ status: string; dailySendLimit: number } | null> {
  try {
    const res = await fetch(`${INSTANTLY_BASE_URL}/account?email=${encodeURIComponent(email)}`, {
      headers: headers(),
    });
    if (!res.ok) return null;
    const data = await res.json() as { warmup_status?: string; daily_limit?: number };
    return {
      status: data.warmup_status ?? 'unknown',
      dailySendLimit: data.daily_limit ?? 0,
    };
  } catch {
    return null;
  }
}
