import { test, expect } from '@playwright/test';
import { gotoDashboard } from '../helpers';

const VIEWS = [
  { dataView: 'overview',        title: 'Dashboard' },
  { dataView: 'pipeline',        title: 'Pipeline' },
  { dataView: 'campaigns',       title: 'Campaigns' },
  { dataView: 'meetings',        title: 'Meetings' },
  { dataView: 'linkedin',        title: 'LinkedIn' },
  { dataView: 'email',           title: 'Email' },
  { dataView: 'voice',           title: 'Voice' },
  { dataView: 'companies-house', title: 'Companies House' },
  { dataView: 'icp',             title: 'ICP' },
  { dataView: 'reports',         title: 'Reports' },
];

test.describe('Dashboard — Sidebar Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
  });

  test('sidebar is visible', async ({ page }) => {
    await expect(page.locator('.sidebar')).toBeVisible();
  });

  test('brand logo is visible in sidebar', async ({ page }) => {
    await expect(page.locator('.brand-name')).toContainText('OutreachOS');
  });

  test('user name and role shown in sidebar footer', async ({ page }) => {
    await expect(page.locator('.user-name')).toBeVisible();
    await expect(page.locator('.user-role')).toBeVisible();
  });

  test('overview view is active by default', async ({ page }) => {
    await expect(page.locator('#view-overview')).toHaveClass(/active/);
    await expect(
      page.locator('.sidebar-link[data-view="overview"]')
    ).toHaveClass(/active/);
  });

  test('all sidebar nav links are present', async ({ page }) => {
    for (const { dataView } of VIEWS) {
      await expect(
        page.locator(`.sidebar-link[data-view="${dataView}"]`)
      ).toBeVisible();
    }
  });

  for (const { dataView, title } of VIEWS) {
    test(`clicking "${dataView}" shows the correct view`, async ({ page }) => {
      await page.locator(`.sidebar-link[data-view="${dataView}"]`).click();
      await expect(page.locator(`#view-${dataView}`)).toHaveClass(/active/);
    });

    test(`clicking "${dataView}" hides all other views`, async ({ page }) => {
      await page.locator(`.sidebar-link[data-view="${dataView}"]`).click();
      const otherViews = VIEWS.filter(v => v.dataView !== dataView);
      for (const { dataView: other } of otherViews) {
        await expect(page.locator(`#view-${other}`)).not.toHaveClass(/active/);
      }
    });

    test(`clicking "${dataView}" marks its sidebar link as active`, async ({ page }) => {
      await page.locator(`.sidebar-link[data-view="${dataView}"]`).click();
      await expect(
        page.locator(`.sidebar-link[data-view="${dataView}"]`)
      ).toHaveClass(/active/);
    });

    test(`clicking "${dataView}" updates the topbar title`, async ({ page }) => {
      await page.locator(`.sidebar-link[data-view="${dataView}"]`).click();
      await expect(page.locator('#topbarTitle')).toContainText(title);
    });
  }

  test('pipeline link has "47" badge', async ({ page }) => {
    await expect(
      page.locator('.sidebar-link[data-view="pipeline"] .sidebar-badge')
    ).toContainText('47');
  });

  test('topbar is visible', async ({ page }) => {
    await expect(page.locator('.topbar')).toBeVisible();
  });

  test('live badge is visible in topbar', async ({ page }) => {
    // Scope to topbar specifically — multiple .live-badge elements exist in the dashboard
    await expect(page.locator('.topbar .live-badge')).toBeVisible();
  });

  test('period selector is visible in topbar', async ({ page }) => {
    await expect(page.locator('.tb-select')).toBeVisible();
  });

  test('export button is visible in topbar', async ({ page }) => {
    await expect(page.locator('.tb-btn').first()).toBeVisible();
  });

  test('notification icon button is visible', async ({ page }) => {
    await expect(page.locator('.tb-icon-btn')).toBeVisible();
  });

  test('"Back to Site" link points to index.html', async ({ page }) => {
    await expect(
      page.locator('.sidebar a[href="index.html"]')
    ).toBeVisible();
  });
});
