import { test, expect } from '@playwright/test';
import { gotoDashboard } from '../helpers';

test.describe('Dashboard — Reports View', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await page.locator('.sidebar-link[data-view="reports"]').click();
    await expect(page.locator('#view-reports')).toHaveClass(/active/);
  });

  test('reports view is visible', async ({ page }) => {
    await expect(page.locator('#view-reports')).toBeVisible();
  });

  test('reports view title is visible', async ({ page }) => {
    await expect(page.locator('#view-reports .view-title')).toContainText('Report');
  });

  test('4 report cards are present', async ({ page }) => {
    await expect(page.locator('#view-reports .report-card')).toHaveCount(4);
  });

  test('February Performance Report is listed', async ({ page }) => {
    await expect(
      page.locator('#view-reports .report-card').filter({ hasText: 'February' })
    ).toBeVisible();
  });

  test('Pipeline Quality Report is listed', async ({ page }) => {
    await expect(
      page.locator('#view-reports .report-card').filter({ hasText: 'Pipeline Quality' })
    ).toBeVisible();
  });

  test('Email Deliverability Report is listed', async ({ page }) => {
    await expect(
      page.locator('#view-reports .report-card').filter({ hasText: 'Deliverability' })
    ).toBeVisible();
  });

  test('Meeting Outcomes Report is listed', async ({ page }) => {
    await expect(
      page.locator('#view-reports .report-card').filter({ hasText: 'Meeting Outcomes' })
    ).toBeVisible();
  });

  test('each report card has a report name', async ({ page }) => {
    const names = page.locator('#view-reports .report-name');
    const count = await names.count();
    expect(count).toBe(4);
    for (let i = 0; i < count; i++) {
      await expect(names.nth(i)).not.toBeEmpty();
    }
  });

  test('each report card has a description', async ({ page }) => {
    const descs = page.locator('#view-reports .report-desc');
    const count = await descs.count();
    expect(count).toBe(4);
  });

  test('each report card shows a generated date', async ({ page }) => {
    const dates = page.locator('#view-reports .report-date');
    const count = await dates.count();
    expect(count).toBe(4);
    for (let i = 0; i < count; i++) {
      await expect(dates.nth(i)).not.toBeEmpty();
    }
  });

  test('each report card has a download link', async ({ page }) => {
    const downloads = page.locator('#view-reports .report-dl');
    const count = await downloads.count();
    expect(count).toBe(4);
  });

  test('report icon containers are visible', async ({ page }) => {
    await expect(page.locator('#view-reports .report-icon').first()).toBeVisible();
  });

  test('download links contain "Download" text', async ({ page }) => {
    const firstDl = page.locator('#view-reports .report-dl').first();
    await expect(firstDl).toContainText('Download');
  });
});
