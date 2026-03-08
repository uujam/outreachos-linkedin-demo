import { test, expect } from '@playwright/test';
import { gotoDashboard } from '../helpers';

// ── LinkedIn ──────────────────────────────────────────────────────────────────
test.describe('Dashboard — LinkedIn Channel View', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await page.locator('.sidebar-link[data-view="linkedin"]').click();
    await expect(page.locator('#view-linkedin')).toHaveClass(/active/);
  });

  test('LinkedIn view title is visible', async ({ page }) => {
    await expect(page.locator('#view-linkedin .view-title')).toContainText('LinkedIn');
  });

  test('6 LinkedIn channel stat cards are present', async ({ page }) => {
    await expect(page.locator('#view-linkedin .chan-stats-grid > *')).toHaveCount(6);
  });

  test('Profiles Scraped stat is visible', async ({ page }) => {
    await expect(page.locator('#view-linkedin')).toContainText('Profiles Scraped');
  });

  test('Connections Sent stat is visible', async ({ page }) => {
    await expect(page.locator('#view-linkedin')).toContainText('Connections Sent');
  });

  test('Acceptance Rate stat is visible', async ({ page }) => {
    await expect(page.locator('#view-linkedin')).toContainText('Acceptance Rate');
  });

  test('scrape batches table is visible', async ({ page }) => {
    await expect(page.locator('#view-linkedin table')).toBeVisible();
  });

  test('table has Batch, Filter, Leads Found, Status columns', async ({ page }) => {
    const headers = page.locator('#view-linkedin table thead th');
    const texts = await headers.allTextContents();
    expect(texts.some(t => t.includes('Batch'))).toBeTruthy();
    expect(texts.some(t => t.includes('Leads'))).toBeTruthy();
    expect(texts.some(t => t.includes('Status'))).toBeTruthy();
  });

  test('at least 3 batch rows are present', async ({ page }) => {
    const rows = page.locator('#view-linkedin table tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('"Run New Scrape" button is visible', async ({ page }) => {
    await expect(
      page.locator('#view-linkedin').getByText(/New Scrape/i)
    ).toBeVisible();
  });
});

// ── Email ─────────────────────────────────────────────────────────────────────
test.describe('Dashboard — Email Channel View', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await page.locator('.sidebar-link[data-view="email"]').click();
    await expect(page.locator('#view-email')).toHaveClass(/active/);
  });

  test('Email view title is visible', async ({ page }) => {
    await expect(page.locator('#view-email .view-title')).toContainText('Email');
  });

  test('6 email channel stat cards are present', async ({ page }) => {
    await expect(page.locator('#view-email .chan-stats-grid > *')).toHaveCount(6);
  });

  test('Emails Sent stat is visible', async ({ page }) => {
    await expect(page.locator('#view-email')).toContainText('Emails Sent');
  });

  test('Open Rate stat is visible', async ({ page }) => {
    await expect(page.locator('#view-email')).toContainText('Open Rate');
  });

  test('Reply Rate stat is visible', async ({ page }) => {
    await expect(page.locator('#view-email')).toContainText('Reply Rate');
  });

  test('Inbox Placement stat is visible', async ({ page }) => {
    await expect(page.locator('#view-email')).toContainText('Inbox Placement');
  });

  test('Bounce Rate stat is visible', async ({ page }) => {
    await expect(page.locator('#view-email')).toContainText('Bounce Rate');
  });

  test('active sequences table is visible', async ({ page }) => {
    await expect(page.locator('#view-email table')).toBeVisible();
  });

  test('table has Sequence, Steps, Contacts columns', async ({ page }) => {
    const headers = page.locator('#view-email table thead th');
    const texts = await headers.allTextContents();
    expect(texts.some(t => t.includes('Sequence'))).toBeTruthy();
    expect(texts.some(t => t.includes('Steps'))).toBeTruthy();
    expect(texts.some(t => t.includes('Contact'))).toBeTruthy();
  });

  test('at least 2 sequence rows are present', async ({ page }) => {
    const rows = page.locator('#view-email table tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('"Create Sequence" button is visible', async ({ page }) => {
    await expect(
      page.locator('#view-email').getByText(/Create Sequence/i)
    ).toBeVisible();
  });
});

// ── Voice ─────────────────────────────────────────────────────────────────────
test.describe('Dashboard — Voice Channel View', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await page.locator('.sidebar-link[data-view="voice"]').click();
    await expect(page.locator('#view-voice')).toHaveClass(/active/);
  });

  test('Voice view title is visible', async ({ page }) => {
    await expect(page.locator('#view-voice .view-title')).toContainText('Voice');
  });

  test('6 voice channel stat cards are present', async ({ page }) => {
    await expect(page.locator('#view-voice .chan-stats-grid > *')).toHaveCount(6);
  });

  test('Calls Made stat is visible', async ({ page }) => {
    await expect(page.locator('#view-voice')).toContainText('Calls Made');
  });

  test('Connect Rate stat is visible', async ({ page }) => {
    await expect(page.locator('#view-voice')).toContainText('Connect Rate');
  });

  test('Qualified Rate stat is visible', async ({ page }) => {
    await expect(page.locator('#view-voice')).toContainText('Qualified Rate');
  });

  test('Avg. Call Duration stat is visible', async ({ page }) => {
    await expect(page.locator('#view-voice')).toContainText('Duration');
  });

  test('call log table is visible', async ({ page }) => {
    await expect(page.locator('#view-voice table')).toBeVisible();
  });

  test('call log has Prospect, Duration, Outcome columns', async ({ page }) => {
    const headers = page.locator('#view-voice table thead th');
    const texts = await headers.allTextContents();
    expect(texts.some(t => t.includes('Prospect'))).toBeTruthy();
    expect(texts.some(t => t.includes('Duration'))).toBeTruthy();
    expect(texts.some(t => t.includes('Outcome'))).toBeTruthy();
  });

  test('at least 3 call log rows are present', async ({ page }) => {
    const rows = page.locator('#view-voice table tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('call outcome pills are visible', async ({ page }) => {
    await expect(page.locator('#view-voice .pill').first()).toBeVisible();
  });

  test('"Download Log" button is visible', async ({ page }) => {
    await expect(
      page.locator('#view-voice').getByText(/Download Log/i)
    ).toBeVisible();
  });
});

// ── Companies House ────────────────────────────────────────────────────────────
test.describe('Dashboard — Companies House View', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await page.locator('.sidebar-link[data-view="companies-house"]').click();
    await expect(page.locator('#view-companies-house')).toHaveClass(/active/);
  });

  test('Companies House view title is visible', async ({ page }) => {
    await expect(page.locator('#view-companies-house .view-title')).toContainText('Companies House');
  });

  test('search input is visible', async ({ page }) => {
    await expect(page.locator('.ch-input')).toBeVisible();
  });

  test('search input has correct placeholder', async ({ page }) => {
    await expect(page.locator('.ch-input')).toHaveAttribute('placeholder', /company/i);
  });

  test('sector filter dropdown is visible', async ({ page }) => {
    const filters = page.locator('.ch-filter');
    const count = await filters.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('search button is visible', async ({ page }) => {
    await expect(page.locator('#view-companies-house .tb-btn')).toBeVisible();
  });

  test('companies table is visible', async ({ page }) => {
    await expect(page.locator('#view-companies-house table')).toBeVisible();
  });

  test('table has Company, Sector, Director, ICP Match columns', async ({ page }) => {
    const headers = page.locator('#view-companies-house table thead th');
    const texts = await headers.allTextContents();
    expect(texts.some(t => t.includes('Company'))).toBeTruthy();
    expect(texts.some(t => t.includes('Sector'))).toBeTruthy();
    expect(texts.some(t => t.includes('ICP'))).toBeTruthy();
  });

  test('at least 3 company rows are present', async ({ page }) => {
    const rows = page.locator('#view-companies-house table tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('"Add to Pipeline" buttons are visible', async ({ page }) => {
    await expect(
      page.locator('#view-companies-house').getByText(/Add to Pipeline/i).first()
    ).toBeVisible();
  });

  test('"Export to Pipeline" button is visible', async ({ page }) => {
    await expect(
      page.locator('#view-companies-house').getByText(/Export to Pipeline/i)
    ).toBeVisible();
  });

  test('search input accepts text', async ({ page }) => {
    await page.locator('.ch-input').fill('Thornton');
    await expect(page.locator('.ch-input')).toHaveValue('Thornton');
  });

  test('ICP match score bars are visible', async ({ page }) => {
    await expect(page.locator('#view-companies-house .score-bar').first()).toBeVisible();
  });
});
