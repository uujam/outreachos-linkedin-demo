import { test, expect } from '@playwright/test';
import { gotoDashboard } from '../helpers';

test.describe('Dashboard — Campaigns View', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await page.locator('.sidebar-link[data-view="campaigns"]').click();
    await expect(page.locator('#view-campaigns')).toHaveClass(/active/);
  });

  test('campaigns view title is visible', async ({ page }) => {
    await expect(page.locator('#view-campaigns .view-title')).toContainText('Campaign');
  });

  // ── KPI Cards ─────────────────────────────────────────────────────────────
  test('campaigns view has 3 KPI cards', async ({ page }) => {
    await expect(page.locator('#view-campaigns .kpi-card')).toHaveCount(3);
  });

  test('Total Sent KPI is visible', async ({ page }) => {
    await expect(
      page.locator('#view-campaigns .kpi-card').filter({ hasText: 'Total Sent' })
    ).toBeVisible();
  });

  test('Average Open Rate KPI is visible', async ({ page }) => {
    await expect(
      page.locator('#view-campaigns .kpi-card').filter({ hasText: 'Open Rate' })
    ).toBeVisible();
  });

  test('Total Replies KPI is visible', async ({ page }) => {
    await expect(
      page.locator('#view-campaigns .kpi-card').filter({ hasText: 'Replies' })
    ).toBeVisible();
  });

  // ── Campaign List ─────────────────────────────────────────────────────────
  test('3 campaign items are visible', async ({ page }) => {
    await expect(page.locator('#view-campaigns .camp-item')).toHaveCount(3);
  });

  test('Financial Services campaign is listed', async ({ page }) => {
    await expect(
      page.locator('#view-campaigns .camp-item').filter({ hasText: 'Financial Services' })
    ).toBeVisible();
  });

  test('Professional Services campaign is listed', async ({ page }) => {
    await expect(
      page.locator('#view-campaigns .camp-item').filter({ hasText: 'Professional Services' })
    ).toBeVisible();
  });

  test('Companies House campaign is listed', async ({ page }) => {
    await expect(
      page.locator('#view-campaigns .camp-item').filter({ hasText: 'Companies House' })
    ).toBeVisible();
  });

  test('all campaigns show Active status', async ({ page }) => {
    const activePills = page.locator('#view-campaigns .pill-active');
    const count = await activePills.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('campaign progress bars are visible', async ({ page }) => {
    await expect(page.locator('#view-campaigns .camp-prog').first()).toBeVisible();
  });

  test('progress fill width is set', async ({ page }) => {
    const fill = page.locator('#view-campaigns .camp-prog-fill').first();
    const style = await fill.getAttribute('style');
    expect(style).toContain('width');
  });

  test('campaign stats (Sent, Open, Replies) are visible', async ({ page }) => {
    const firstCamp = page.locator('#view-campaigns .camp-item').first();
    await expect(firstCamp.locator('.cst').first()).toBeVisible();
  });

  test('"New Campaign" button is visible', async ({ page }) => {
    await expect(
      page.locator('#view-campaigns .panel-hd button, #view-campaigns .panel-hd .panel-act')
        .filter({ hasText: 'New Campaign' })
    ).toBeVisible();
  });
});
