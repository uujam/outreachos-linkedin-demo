/**
 * VAPI API client.
 * Triggers AI voice calls routed via Twilio branded calling.
 */

const VAPI_BASE_URL = process.env.VAPI_API_URL ?? 'https://api.vapi.ai';
const VAPI_API_KEY = process.env.VAPI_API_KEY ?? '';
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID ?? '';
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID ?? '';

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${VAPI_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

export interface VapiCallResult {
  success: boolean;
  callId?: string;
  error?: string;
}

/**
 * Place an outbound AI voice call via VAPI (routed through Twilio).
 * The call will display the client's branded name via Twilio Enhanced Branded Calling.
 */
export async function placeVapiCall(params: {
  phoneNumber: string;
  leadId: string;
  clientId: string;
  leadName: string;
  company: string;
}): Promise<VapiCallResult> {
  try {
    const res = await fetch(`${VAPI_BASE_URL}/call/phone`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        phoneNumberId: VAPI_PHONE_NUMBER_ID,
        assistantId: VAPI_ASSISTANT_ID,
        customer: {
          number: params.phoneNumber,
          name: params.leadName,
        },
        assistantOverrides: {
          variableValues: {
            leadId: params.leadId,
            clientId: params.clientId,
            leadName: params.leadName,
            company: params.company,
          },
        },
        metadata: {
          leadId: params.leadId,
          clientId: params.clientId,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `VAPI API error ${res.status}: ${body}` };
    }

    const data = await res.json() as { id?: string };
    return { success: true, callId: data.id };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
