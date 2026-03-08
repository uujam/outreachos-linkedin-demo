/**
 * Heyreach white-label API client.
 * Handles LinkedIn outreach: sequence creation, lead enrolment, and status checks.
 */

const HEYREACH_BASE_URL = process.env.HEYREACH_API_URL ?? 'https://api.heyreach.io/api/public';
const HEYREACH_API_KEY = process.env.HEYREACH_API_KEY ?? '';

function headers(): Record<string, string> {
  return {
    'X-API-KEY': HEYREACH_API_KEY,
    'Content-Type': 'application/json',
  };
}

export interface HeyreachEnrolmentResult {
  success: boolean;
  campaignId?: string;
  error?: string;
}

export interface HeyreachAccountStatus {
  accountId: string;
  status: 'active' | 'restricted' | 'banned';
  dailyConnectionsSent: number;
  dailyMessagesSent: number;
}

/**
 * Enrol a lead in a Heyreach LinkedIn sequence.
 * Creates a connection request → personalised message sequence.
 */
export async function enrolLeadInHeyreach(params: {
  heyreachCampaignId: string;
  linkedinUrl: string;
  fullName: string;
  company: string;
  jobTitle?: string;
}): Promise<HeyreachEnrolmentResult> {
  try {
    const res = await fetch(`${HEYREACH_BASE_URL}/campaign/AddLeadsToCampaign`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        campaignId: params.heyreachCampaignId,
        leads: [
          {
            profileUrl: params.linkedinUrl,
            firstName: params.fullName.split(' ')[0],
            lastName: params.fullName.split(' ').slice(1).join(' '),
            companyName: params.company,
            position: params.jobTitle ?? '',
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `Heyreach API error ${res.status}: ${body}` };
    }

    return { success: true, campaignId: params.heyreachCampaignId };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Get the health status of all connected LinkedIn accounts in Heyreach.
 */
export async function getLinkedInAccountStatus(): Promise<HeyreachAccountStatus[]> {
  const res = await fetch(`${HEYREACH_BASE_URL}/linkedin-account/GetAll`, {
    headers: headers(),
  });

  if (!res.ok) {
    throw new Error(`Heyreach account status error ${res.status}`);
  }

  const data = await res.json() as { items?: Array<{
    id: string;
    status: string;
    statistics?: { dailyConnectionsSent?: number; dailyMessagesSent?: number };
  }> };

  return (data.items ?? []).map((account) => ({
    accountId: account.id,
    status: (account.status?.toLowerCase() ?? 'active') as HeyreachAccountStatus['status'],
    dailyConnectionsSent: account.statistics?.dailyConnectionsSent ?? 0,
    dailyMessagesSent: account.statistics?.dailyMessagesSent ?? 0,
  }));
}
