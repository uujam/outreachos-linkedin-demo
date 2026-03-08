/**
 * Companies House API client (F-005)
 * Docs: https://developer-specs.company-information.service.gov.uk/
 */

const BASE_URL = 'https://api.company-information.service.gov.uk';

function apiKey(): string {
  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key) throw new Error('COMPANIES_HOUSE_API_KEY environment variable is not set');
  return key;
}

function authHeader(): string {
  // Companies House uses HTTP Basic Auth with the API key as the username and empty password
  return 'Basic ' + Buffer.from(`${apiKey()}:`).toString('base64');
}

export interface CompaniesHouseResult {
  companiesHouseNumber: string;
  companyName: string;
  companyStatus: string;
  companyType: string;
  dateOfCreation: string | null;
  addressSnippet: string | null;
  sicCodes: string[];
}

export interface CompaniesHouseSearchResponse {
  results: CompaniesHouseResult[];
  totalResults: number;
  pageNumber: number;
  itemsPerPage: number;
}

export async function searchCompanies(
  query: string,
  page = 1,
  itemsPerPage = 20
): Promise<CompaniesHouseSearchResponse> {
  const startIndex = (page - 1) * itemsPerPage;
  const url = new URL(`${BASE_URL}/search/companies`);
  url.searchParams.set('q', query);
  url.searchParams.set('items_per_page', String(itemsPerPage));
  url.searchParams.set('start_index', String(startIndex));

  const response = await fetch(url.toString(), {
    headers: { Authorization: authHeader() },
  });

  if (!response.ok) {
    throw new Error(`Companies House API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    items?: Array<{
      company_number: string;
      title: string;
      company_status?: string;
      company_type?: string;
      date_of_creation?: string;
      address_snippet?: string;
      sic_codes?: string[];
    }>;
    total_results?: number;
    page_number?: number;
    items_per_page?: number;
  };

  return {
    results: (data.items ?? []).map((item) => ({
      companiesHouseNumber: item.company_number,
      companyName: item.title,
      companyStatus: item.company_status ?? '',
      companyType: item.company_type ?? '',
      dateOfCreation: item.date_of_creation ?? null,
      addressSnippet: item.address_snippet ?? null,
      sicCodes: item.sic_codes ?? [],
    })),
    totalResults: data.total_results ?? 0,
    pageNumber: data.page_number ?? page,
    itemsPerPage: data.items_per_page ?? itemsPerPage,
  };
}

export async function getCompany(companyNumber: string): Promise<CompaniesHouseResult | null> {
  const response = await fetch(`${BASE_URL}/company/${companyNumber}`, {
    headers: { Authorization: authHeader() },
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Companies House API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    company_number: string;
    company_name: string;
    company_status?: string;
    type?: string;
    date_of_creation?: string;
    registered_office_address?: { address_line_1?: string; locality?: string; postal_code?: string };
    sic_codes?: string[];
  };

  const addr = data.registered_office_address;
  const addressSnippet = addr
    ? [addr.address_line_1, addr.locality, addr.postal_code].filter(Boolean).join(', ')
    : null;

  return {
    companiesHouseNumber: data.company_number,
    companyName: data.company_name,
    companyStatus: data.company_status ?? '',
    companyType: data.type ?? '',
    dateOfCreation: data.date_of_creation ?? null,
    addressSnippet,
    sicCodes: data.sic_codes ?? [],
  };
}
