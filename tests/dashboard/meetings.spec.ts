import { test, expect } from '@playwright/test';
import { gotoDashboard } from '../helpers';

test.describe('Dashboard — Meetings View', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await page.locator('.sidebar-link[data-view="meetings"]').click();
    await expect(page.locator('#view-meetings')).toHaveClass(/active/);
  });

  test('meetings view title is visible', async ({ page }) => {
    await expect(page.locator('#view-meetings .view-title')).toContainText('Meeting');
  });

  // ── KPI Cards ─────────────────────────────────────────────────────────────
  test('meetings view has 3 KPI cards', async ({ page }) => {
    await expect(page.locator('#view-meetings .kpi-card')).toHaveCount(3);
  });

  test('This Month KPI is present', async ({ page }) => {
    await expect(
      page.locator('#view-meetings .kpi-card').filter({ hasText: 'This Month' })
    ).toBeVisible();
  });

  test('Show Rate KPI is present', async ({ page }) => {
    await expect(
      page.locator('#view-meetings .kpi-card').filter({ hasText: 'Show Rate' })
    ).toBeVisible();
  });

  test('Avg. to Book KPI is present', async ({ page }) => {
    await expect(
      page.locator('#view-meetings .kpi-card').filter({ hasText: 'Book' })
    ).toBeVisible();
  });

  // ── Meetings List ─────────────────────────────────────────────────────────
  test('at least 4 meeting rows are present', async ({ page }) => {
    const rows = page.locator('#view-meetings .meeting-row');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test('Sarah Whitfield meeting is listed', async ({ page }) => {
    await expect(page.locator('#view-meetings')).toContainText('Sarah Whitfield');
  });

  test('Daniel Frost meeting is listed', async ({ page }) => {
    await expect(page.locator('#view-meetings')).toContainText('Daniel Frost');
  });

  test('Sophie Caldwell meeting is listed', async ({ page }) => {
    await expect(page.locator('#view-meetings')).toContainText('Sophie Caldwell');
  });

  test('meeting rows show time slot', async ({ page }) => {
    const firstRow = page.locator('#view-meetings .meeting-row').first();
    await expect(firstRow.locator('.meet-time')).not.toBeEmpty();
  });

  test('meeting rows show duration', async ({ page }) => {
    const firstRow = page.locator('#view-meetings .meeting-row').first();
    await expect(firstRow.locator('.meet-dur')).not.toBeEmpty();
  });

  test('meeting rows show date', async ({ page }) => {
    const firstRow = page.locator('#view-meetings .meeting-row').first();
    await expect(firstRow.locator('.meet-day')).not.toBeEmpty();
  });

  test('Confirmed status badges are present', async ({ page }) => {
    await expect(page.locator('#view-meetings .mb-conf').first()).toBeVisible();
  });

  test('"Sync Calendar" button is present', async ({ page }) => {
    await expect(
      page.locator('#view-meetings').getByText('Sync Calendar')
    ).toBeVisible();
  });
});
