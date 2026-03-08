import { test, expect } from '@playwright/test';
import { gotoDashboard } from '../helpers';

test.describe('Dashboard — Overview View', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    // Overview is active by default
    await expect(page.locator('#view-overview')).toHaveClass(/active/);
  });

  // ── KPI Cards ─────────────────────────────────────────────────────────────
  test('4 KPI cards are visible', async ({ page }) => {
    await expect(page.locator('#view-overview .kpi-card')).toHaveCount(4);
  });

  test('Qualified Meetings KPI is present', async ({ page }) => {
    await expect(
      page.locator('#view-overview .kpi-card').filter({ hasText: 'Qualified Meetings' })
    ).toBeVisible();
  });

  test('Pipeline Value KPI is present', async ({ page }) => {
    await expect(
      page.locator('#view-overview .kpi-card').filter({ hasText: 'Pipeline Value' })
    ).toBeVisible();
  });

  test('Outreach Sent KPI is present', async ({ page }) => {
    await expect(
      page.locator('#view-overview .kpi-card').filter({ hasText: 'Outreach Sent' })
    ).toBeVisible();
  });

  test('Response Rate KPI is present', async ({ page }) => {
    await expect(
      page.locator('#view-overview .kpi-card').filter({ hasText: 'Response Rate' })
    ).toBeVisible();
  });

  test('KPI cards show numeric values', async ({ page }) => {
    const kpiNums = page.locator('#view-overview .kpi-num');
    const count = await kpiNums.count();
    expect(count).toBe(4);
    for (let i = 0; i < count; i++) {
      const text = await kpiNums.nth(i).textContent();
      expect(text!.trim().length).toBeGreaterThan(0);
    }
  });

  test('trend badges are present on KPI cards', async ({ page }) => {
    const upBadges = page.locator('#view-overview .badge-up');
    const downBadges = page.locator('#view-overview .badge-down');
    const total = (await upBadges.count()) + (await downBadges.count());
    expect(total).toBe(4);
  });

  // ── Outreach Performance Chart ─────────────────────────────────────────────
  test('outreach performance chart is visible', async ({ page }) => {
    await expect(page.locator('#chartBars')).toBeVisible();
  });

  test('chart has 8 bar groups (W1–W8)', async ({ page }) => {
    await expect(page.locator('.bar-grp')).toHaveCount(8);
  });

  test('chart legend shows Email, LinkedIn, Meetings', async ({ page }) => {
    await expect(page.locator('.chart-legend')).toContainText('Email');
    await expect(page.locator('.chart-legend')).toContainText('LinkedIn');
    await expect(page.locator('.chart-legend')).toContainText('Meeting');
  });

  test('sparkline for email open rate is present', async ({ page }) => {
    await expect(page.locator('#sp1')).toBeVisible();
  });

  test('sparkline for LinkedIn reply rate is present', async ({ page }) => {
    await expect(page.locator('#sp2')).toBeVisible();
  });

  test('sparkline for voice connect rate is present', async ({ page }) => {
    await expect(page.locator('#sp3')).toBeVisible();
  });

  // ── Live Activity Feed ────────────────────────────────────────────────────
  test('live activity feed is visible', async ({ page }) => {
    await expect(page.locator('#actFeed')).toBeVisible();
  });

  test('activity feed has at least 1 item', async ({ page }) => {
    const items = page.locator('#actFeed .act-item');
    await expect(items).not.toHaveCount(0);
  });

  test('activity feed items have timestamps', async ({ page }) => {
    await expect(page.locator('#actFeed .act-item .act-time').first()).not.toBeEmpty();
  });

  // ── Pipeline Snapshot ─────────────────────────────────────────────────────
  test('pipeline snapshot board is visible', async ({ page }) => {
    await expect(page.locator('#view-overview .pipeline-board')).toBeVisible();
  });

  test('pipeline snapshot has 5 stage columns', async ({ page }) => {
    await expect(page.locator('#view-overview .pipe-col')).toHaveCount(5);
  });

  test('pipeline stages are: Identified, In Outreach, Responded, Qualified, Booked', async ({ page }) => {
    const stages = ['Identified', 'In Outreach', 'Responded', 'Qualified', 'Booked'];
    for (const stage of stages) {
      await expect(
        page.locator('#view-overview .pipe-col-name').filter({ hasText: stage })
      ).toBeVisible();
    }
  });

  test('"Full Pipeline" button navigates to pipeline view', async ({ page }) => {
    // The button calls navigate('pipeline')
    await page.locator('#view-overview .panel-act').filter({ hasText: 'Full Pipeline' }).click();
    await expect(page.locator('#view-pipeline')).toHaveClass(/active/);
  });

  // ── Upcoming Meetings ─────────────────────────────────────────────────────
  test('upcoming meetings panel is visible', async ({ page }) => {
    await expect(
      page.locator('#view-overview .meetings-list')
    ).toBeVisible();
  });

  test('upcoming meetings list has at least 1 row', async ({ page }) => {
    const rows = page.locator('#view-overview .meeting-row');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('"All Meetings" button navigates to meetings view', async ({ page }) => {
    await page.locator('#view-overview .panel-act').filter({ hasText: 'All Meetings' }).click();
    await expect(page.locator('#view-meetings')).toHaveClass(/active/);
  });

  test('meeting rows show status badges', async ({ page }) => {
    await expect(
      page.locator('#view-overview .meet-badge').first()
    ).toBeVisible();
  });
});
