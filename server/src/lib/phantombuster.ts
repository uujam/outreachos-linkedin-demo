/**
 * Phantombuster API client (F-004 — LinkedIn scraping)
 * Docs: https://phantombuster.com/api-documentation
 */

const BASE_URL = 'https://api.phantombuster.com/api/v2';

function apiKey(): string {
  const key = process.env.PHANTOMBUSTER_API_KEY;
  if (!key) throw new Error('PHANTOMBUSTER_API_KEY environment variable is not set');
  return key;
}

function headers() {
  return { 'X-Phantombuster-Key': apiKey(), 'Content-Type': 'application/json' };
}

export interface PhantomLaunchResult {
  containerId: string;
  status: 'running' | 'finished' | 'error';
}

export interface ScrapedProfile {
  linkedinUrl: string;
  fullName: string;
  jobTitle: string;
  company: string;
  location?: string;
}

/**
 * Launches a Phantombuster agent with the given filters.
 * Returns the container ID which can be polled for results.
 */
export async function launchScrape(
  agentId: string,
  filters: Record<string, unknown>
): Promise<PhantomLaunchResult> {
  const response = await fetch(`${BASE_URL}/agents/launch`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ id: agentId, argument: filters }),
  });

  if (!response.ok) {
    throw new Error(`Phantombuster launch error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { containerId: string };
  return { containerId: data.containerId, status: 'running' };
}

/**
 * Fetches the output of a completed Phantombuster container.
 */
export async function fetchScrapeResults(containerId: string): Promise<ScrapedProfile[]> {
  const response = await fetch(
    `${BASE_URL}/containers/fetch-output?id=${encodeURIComponent(containerId)}`,
    { headers: { 'X-Phantombuster-Key': apiKey() } }
  );

  if (!response.ok) {
    throw new Error(`Phantombuster fetch error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    output?: string | null;
    status?: string;
    resultObject?: Array<{
      linkedInUrl?: string;
      linkedinUrl?: string;
      fullName?: string;
      title?: string;
      jobTitle?: string;
      company?: string;
      companyName?: string;
      location?: string;
    }>;
  };

  const items = data.resultObject ?? [];
  return items
    .filter((item) => item.linkedInUrl || item.linkedinUrl)
    .map((item) => ({
      linkedinUrl: (item.linkedInUrl ?? item.linkedinUrl ?? '').trim(),
      fullName: (item.fullName ?? '').trim(),
      jobTitle: (item.title ?? item.jobTitle ?? '').trim(),
      company: (item.company ?? item.companyName ?? '').trim(),
      location: item.location,
    }));
}
