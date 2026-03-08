/**
 * B-007d — Lead fit scoring via Claude API.
 * Evaluates a lead against the client's ICP using a weighted rubric and returns
 * a score (0–100) and a one-sentence reasoning note.
 */
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' });

export interface FitScoringInput {
  lead: {
    fullName: string;
    jobTitle?: string | null;
    company?: string | null;
    linkedinUrl?: string | null;
  };
  icp: {
    industries?: string[];
    geography?: string[];
    jobTitles?: string[];
    revenueRange?: string | null;
    employeeRange?: string | null;
    buyingSignals?: string | null;
    descriptionText?: string | null;
  };
}

export interface FitScoringResult {
  score: number | null;
  reasoning: string | null;
}

const SYSTEM_PROMPT = `You are a B2B lead qualification expert. You evaluate leads against an Ideal Client Profile (ICP) using a weighted rubric. Respond ONLY with valid JSON in this exact format: {"score": <0-100 integer>, "reasoning": "<one sentence explanation>"}`;

function buildUserPrompt(input: FitScoringInput): string {
  const { lead, icp } = input;
  return `
Evaluate this lead against the ICP and return a fit score.

LEAD:
- Name: ${lead.fullName}
- Job title: ${lead.jobTitle ?? 'Unknown'}
- Company: ${lead.company ?? 'Unknown'}

ICP SETTINGS:
- Target job titles: ${icp.jobTitles?.join(', ') || 'Any'}
- Target industries: ${icp.industries?.join(', ') || 'Any'}
- Target geography: ${icp.geography?.join(', ') || 'Any'}
- Employee range: ${icp.employeeRange ?? 'Any'}
- Revenue range: ${icp.revenueRange ?? 'Any'}
- Buying signals to look for: ${icp.buyingSignals ?? 'None specified'}

RUBRIC (weighted sum × 100 = final score):
- Job title match: 30% weight
- Industry match: 25% weight
- Geography match: 20% weight
- Company size match (employees/revenue): 15% weight
- Buying signals present: 10% weight

For each dimension score 0 (no match), 0.5 (partial), or 1 (strong match).
Return JSON: {"score": <0-100>, "reasoning": "<one sentence>"}`.trim();
}

export async function scoreLead(input: FitScoringInput): Promise<FitScoringResult> {
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    const parsed = JSON.parse(text) as { score: number; reasoning: string };

    const score = Math.min(100, Math.max(0, Math.round(parsed.score)));
    return { score, reasoning: parsed.reasoning ?? null };
  } catch (err) {
    console.error('[FitScoring] Claude API error:', err);
    return { score: null, reasoning: null };
  }
}
