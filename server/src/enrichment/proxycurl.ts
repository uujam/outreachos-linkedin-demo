import { StepResult } from './types';

const BASE_URL = 'https://nubela.co/proxycurl/api';

export async function lookupByLinkedinUrl(linkedinUrl: string): Promise<StepResult> {
  const apiKey = process.env.PROXYCURL_API_KEY;
  if (!apiKey) return { success: false, data: {}, provider: 'ProxyCurl', error: 'API key not set' };

  try {
    const url = `${BASE_URL}/v2/linkedin?url=${encodeURIComponent(linkedinUrl)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) return { success: false, data: {}, provider: 'ProxyCurl', error: `HTTP ${res.status}` };

    const data = await res.json() as {
      full_name?: string;
      occupation?: string;
      experiences?: Array<{ company?: string; company_linkedin_profile_url?: string }>;
    };

    return {
      success: true,
      provider: 'ProxyCurl',
      data: {
        fullName: data.full_name,
        jobTitle: data.occupation,
        company: data.experiences?.[0]?.company,
        linkedinUrl,
        sourceLinkedin: 'ProxyCurl',
      },
    };
  } catch (err) {
    return { success: false, data: {}, provider: 'ProxyCurl', error: String(err) };
  }
}
