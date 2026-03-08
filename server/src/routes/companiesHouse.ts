import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthRequest } from '../middleware/requireAuth';
import { searchCompanies, getCompany } from '../lib/companiesHouse';
import { LeadSource, EnrichmentStage } from '@prisma/client';

const router = Router();

// GET /api/companies-house/search?q=&page=&itemsPerPage=
router.get('/companies-house/search', requireAuth, async (req: AuthRequest, res: Response) => {
  const { q, page, itemsPerPage } = req.query as {
    q?: string;
    page?: string;
    itemsPerPage?: string;
  };

  if (!q?.trim()) {
    res.status(400).json({ error: 'Search query (q) is required' });
    return;
  }

  const results = await searchCompanies(
    q.trim(),
    page ? parseInt(page, 10) : 1,
    itemsPerPage ? Math.min(parseInt(itemsPerPage, 10), 100) : 20
  );

  res.status(200).json(results);
});

// POST /api/companies-house/add-to-pipeline
// Creates a lead record from a Companies House company
router.post('/companies-house/add-to-pipeline', requireAuth, async (req: AuthRequest, res: Response) => {
  const {
    companiesHouseNumber,
    companyName,
    directorName,
    region,
    sicCodes,
    employeeRange,
  } = req.body as {
    companiesHouseNumber?: string;
    companyName?: string;
    directorName?: string;
    region?: string;
    sicCodes?: string[];
    employeeRange?: string;
  };

  if (!companiesHouseNumber || !companyName) {
    res.status(400).json({ error: 'companiesHouseNumber and companyName are required' });
    return;
  }

  const clientId = req.user!.sub;

  // Upsert the Company record (D-003)
  await prisma.company.upsert({
    where: { companiesHouseNumber },
    create: {
      companyName,
      companiesHouseNumber,
      sicCodes: sicCodes?.join(',') ?? null,
      directorNames: directorName ?? null,
      region: region ?? null,
      employeeRange: employeeRange ?? null,
    },
    update: {
      companyName,
      ...(directorName && { directorNames: directorName }),
      ...(region && { region }),
      ...(sicCodes && { sicCodes: sicCodes.join(',') }),
      ...(employeeRange && { employeeRange }),
    },
  });

  // Create the Lead record (D-002) scoped to this client
  const lead = await prisma.lead.create({
    data: {
      clientId,
      fullName: directorName ?? 'Unknown',
      jobTitle: 'Director',
      company: companyName,
      source: LeadSource.CompaniesHouse,
      enrichmentStage: EnrichmentStage.Discovered,
    },
  });

  res.status(201).json({ lead });
});

export default router;
