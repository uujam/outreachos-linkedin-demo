import { StepResult } from './types';

const BASE_URL = 'https://api.zerobounce.net/v2';

type ZBStatus = 'valid' | 'invalid' | 'catch-all' | 'unknown' | 'spamtrap' | 'abuse' | 'do_not_mail';

export async function validateEmail(email: string): Promise<StepResult> {
  const apiKey = process.env.ZEROBOUNCE_API_KEY;
  if (!apiKey) return { success: false, data: {}, provider: 'ZeroBounce', error: 'API key not set' };

  try {
    const params = new URLSearchParams({ api_key: apiKey, email });
    const res = await fetch(`${BASE_URL}/validate?${params}`);
    if (!res.ok) return { success: false, data: {}, provider: 'ZeroBounce', error: `HTTP ${res.status}` };

    const data = await res.json() as { status?: ZBStatus; sub_status?: string };
    const deliverable = data.status === 'valid';

    return {
      success: true,
      provider: 'ZeroBounce',
      data: {
        emailDeliverable: deliverable,
        emailDeliverableReason: data.sub_status ?? data.status,
        sourceVerified: 'ZeroBounce',
      },
    };
  } catch (err) {
    return { success: false, data: {}, provider: 'ZeroBounce', error: String(err) };
  }
}
