import { test, expect } from '@playwright/test';
import { gotoDashboard } from '../helpers';

test.describe('Dashboard — Pipeline View', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await page.locator('.sidebar-link[data-view="pipeline"]').click();
    await expect(page.locator('#view-pipeline')).toHaveClass(/active/);
  });

  // ── Header ────────────────────────────────────────────────────────────────
  test('pipeline view title is visible', async ({ page }) => {
    await expect(page.locator('#view-pipeline .view-title')).toBeVisible();
    await expect(page.locator('#view-pipeline .view-title')).toContainText('Pipeline');
  });

  test('pipeline subtitle mentions active prospects', async ({ page }) => {
    await expect(page.locator('#view-pipeline .view-sub')).toContainText('prospects');
  });

  // ── Kanban Board ──────────────────────────────────────────────────────────
  test('pipeline kanban board has 5 columns', async ({ page }) => {
    await expect(page.locator('#view-pipeline .pipeline-board .pipe-col')).toHaveCount(5);
  });

  test('all 5 pipeline stages are labelled correctly', async ({ page }) => {
    const stages = ['Identified', 'In Outreach', 'Responded', 'Qualified', 'Booked'];
    for (const stage of stages) {
      await expect(
        page.locator('#view-pipeline .pipe-col-name').filter({ hasText: stage })
      ).toBeVisible();
    }
  });

  test('each column shows a count badge', async ({ page }) => {
    const counts = page.locator('#view-pipeline .pipe-count');
    await expect(counts).toHaveCount(5);
  });

  test('at least one prospect card is visible in the board', async ({ page }) => {
    const cards = page.locator('#view-pipeline .pipeline-board .pcard');
    await expect(cards).not.toHaveCount(0);
  });

  test('prospect cards show name and company', async ({ page }) => {
    const firstCard = page.locator('#view-pipeline .pipeline-board .pcard').first();
    await expect(firstCard.locator('.pcard-name')).not.toBeEmpty();
    await expect(firstCard.locator('.pcard-co')).not.toBeEmpty();
  });

  test('prospect cards show channel tags', async ({ page }) => {
    await expect(
      page.locator('#view-pipeline .pipeline-board .ptag').first()
    ).toBeVisible();
  });

  // ── All Leads Table ───────────────────────────────────────────────────────
  test('all leads table is visible', async ({ page }) => {
    await expect(page.locator('#view-pipeline table')).toBeVisible();
  });

  test('table has correct columns', async ({ page }) => {
    const headers = page.locator('#view-pipeline table thead th');
    const texts = await headers.allTextContents();
    expect(texts.some(t => t.includes('Name'))).toBeTruthy();
    expect(texts.some(t => t.includes('Status'))).toBeTruthy();
    expect(texts.some(t => t.includes('Channel'))).toBeTruthy();
    expect(texts.some(t => t.includes('Fit'))).toBeTruthy();
    expect(texts.some(t => t.includes('Source'))).toBeTruthy();
  });

  test('table has at least 5 data rows', async ({ page }) => {
    const rows = page.locator('#view-pipeline table tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test('status pills are present in the table', async ({ page }) => {
    await expect(page.locator('#view-pipeline .pill').first()).toBeVisible();
  });

  test('fit score bars are present in the table', async ({ page }) => {
    await expect(page.locator('#view-pipeline .score-bar').first()).toBeVisible();
  });

  test('score fill width reflects the score value', async ({ page }) => {
    const firstFill = page.locator('#view-pipeline .score-fill').first();
    const style = await firstFill.getAttribute('style');
    expect(style).toContain('width');
  });

  test('pipeline includes Sarah Whitfield', async ({ page }) => {
    await expect(page.locator('#view-pipeline')).toContainText('Sarah Whitfield');
  });

  test('pipeline includes Priya Mehta', async ({ page }) => {
    await expect(page.locator('#view-pipeline')).toContainText('Priya Mehta');
  });

  test('"Export CSV" button is visible', async ({ page }) => {
    const exportBtn = page.locator('#view-pipeline .panel-act').filter({ hasText: 'Export' });
    await expect(exportBtn).toBeVisible();
  });

  // ── Status pills ──────────────────────────────────────────────────────────
  test('Booked pill style is present', async ({ page }) => {
    await expect(page.locator('#view-pipeline .pill-booked')).toBeVisible();
  });

  test('Qualified pill is present', async ({ page }) => {
    await expect(page.locator('#view-pipeline .pill-qual')).toBeVisible();
  });
});
