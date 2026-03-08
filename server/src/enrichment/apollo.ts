import { StepResult } from './types';

const BASE_URL = 'https://api.apollo.io/v1';

export async function findEmailByLinkedIn(linkedinUrl: string): Promise<StepResult> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) return { success: false, data: {}, provider: 'ApolloIo', error: 'API key not set' };

  try {
    const res = await fetch(`${BASE_URL}/people/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({ linkedin_url: linkedinUrl, reveal_personal_emails: false }),
    });
    if (!res.ok) return { success: false, data: {}, provider: 'ApolloIo', error: `HTTP ${res.status}` };

    const data = await res.json() as {
      person?: { email?: string; organization?: { primary_domain?: string }; name?: string; title?: string };
    };
    const person = data.person;

    return {
      success: !!person?.email,
      provider: 'ApolloIo',
      data: {
        email: person?.email,
        companyDomain: person?.organization?.primary_domain,
        fullName: person?.name,
        jobTitle: person?.title,
        sourceEmail: person?.email ? 'ApolloIo' : undefined,
      },
    };
  } catch (err) {
    return { success: false, data: {}, provider: 'ApolloIo', error: String(err) };
  }
}
