import { StepResult } from './types';

const BASE_URL = 'https://api.hunter.io/v2';

export async function findEmailByDomain(fullName: string, domain: string): Promise<StepResult> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) return { success: false, data: {}, provider: 'HunterIo', error: 'API key not set' };

  try {
    const params = new URLSearchParams({
      full_name: fullName,
      domain,
      api_key: apiKey,
    });
    const res = await fetch(`${BASE_URL}/email-finder?${params}`);
    if (!res.ok) return { success: false, data: {}, provider: 'HunterIo', error: `HTTP ${res.status}` };

    const data = await res.json() as { data?: { email?: string; score?: number } };
    const email = data.data?.email;

    return {
      success: !!email,
      provider: 'HunterIo',
      data: {
        email,
        sourceEmail: email ? 'HunterIo' : undefined,
      },
    };
  } catch (err) {
    return { success: false, data: {}, provider: 'HunterIo', error: String(err) };
  }
}
