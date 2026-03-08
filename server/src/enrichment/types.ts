export interface EnrichmentData {
  fullName?: string;
  jobTitle?: string;
  company?: string;
  companyDomain?: string;
  linkedinUrl?: string;
  email?: string;
  phone?: string;
  emailDeliverable?: boolean;
  emailDeliverableReason?: string;
  sourceLinkedin?: string;
  sourceEmail?: string;
  sourceVerified?: string;
}

export interface StepResult {
  success: boolean;
  data: EnrichmentData;
  provider: string;
  error?: string;
}

export interface LeadEnrichmentInput {
  leadId: string;
  clientId: string;
  linkedinUrl?: string | null;
  fullName?: string;
  company?: string;
  emailAddress?: string | null;
  skipLinkedin?: boolean;
  skipEmail?: boolean;
}
