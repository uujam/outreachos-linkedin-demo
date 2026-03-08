import { test, expect } from '@playwright/test';
import { gotoDashboard } from '../helpers';

test.describe('Dashboard — ICP Settings View', () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await page.locator('.sidebar-link[data-view="icp"]').click();
    await expect(page.locator('#view-icp')).toHaveClass(/active/);
  });

  test('ICP settings view is visible', async ({ page }) => {
    await expect(page.locator('#view-icp')).toBeVisible();
  });

  test('ICP settings title is visible', async ({ page }) => {
    await expect(page.locator('#view-icp .view-title')).toContainText('ICP');
  });

  // ── Form fields ───────────────────────────────────────────────────────────
  test('Target Industries field is present', async ({ page }) => {
    // Use exact label text — /Industries/i would also match the Exclusions label
    await expect(
      page.locator('#view-icp .form-group').filter({ hasText: 'Target Industries' })
    ).toBeVisible();
  });

  test('Geography select field is present', async ({ page }) => {
    await expect(
      page.locator('#view-icp .form-group').filter({ hasText: /Geography/i })
    ).toBeVisible();
  });

  test('Target Job Titles field is present', async ({ page }) => {
    await expect(
      page.locator('#view-icp .form-group').filter({ hasText: /Job Titles|Seniority/i })
    ).toBeVisible();
  });

  test('Revenue Range select field is present', async ({ page }) => {
    await expect(
      page.locator('#view-icp .form-group').filter({ hasText: /Revenue/i })
    ).toBeVisible();
  });

  test('Min. Employees field is present', async ({ page }) => {
    await expect(
      page.locator('#view-icp .form-group').filter({ hasText: /Min.*Employees/i })
    ).toBeVisible();
  });

  test('Max. Employees field is present', async ({ page }) => {
    await expect(
      page.locator('#view-icp .form-group').filter({ hasText: /Max.*Employees/i })
    ).toBeVisible();
  });

  test('Ideal Client Description textarea is present', async ({ page }) => {
    await expect(page.locator('#view-icp .form-textarea')).toBeVisible();
  });

  test('Exclusions field is present', async ({ page }) => {
    await expect(
      page.locator('#view-icp .form-group').filter({ hasText: /Exclusion/i })
    ).toBeVisible();
  });

  // ── Signal tags ───────────────────────────────────────────────────────────
  test('buying signal tags are present', async ({ page }) => {
    await expect(page.locator('#view-icp .form-tag').first()).toBeVisible();
  });

  test('Funding round signal tag is present', async ({ page }) => {
    await expect(
      page.locator('#view-icp .form-tag').filter({ hasText: /Funding/i })
    ).toBeVisible();
  });

  test('New director signal tag is present', async ({ page }) => {
    await expect(
      page.locator('#view-icp .form-tag').filter({ hasText: /director/i })
    ).toBeVisible();
  });

  // ── Form actions ──────────────────────────────────────────────────────────
  test('"Save ICP Settings" button is present', async ({ page }) => {
    await expect(page.locator('.btn-save')).toBeVisible();
    await expect(page.locator('.btn-save')).toContainText('Save');
  });

  test('"Cancel" button is present', async ({ page }) => {
    await expect(page.locator('.btn-cancel')).toBeVisible();
  });

  // ── Form interaction ──────────────────────────────────────────────────────
  test('text inputs are editable', async ({ page }) => {
    const inputs = page.locator('#view-icp .form-input');
    const count = await inputs.count();
    expect(count).toBeGreaterThan(0);
    // Fill first text input and verify
    await inputs.first().fill('Test value');
    await expect(inputs.first()).toHaveValue('Test value');
  });

  test('textarea is editable', async ({ page }) => {
    const textarea = page.locator('#view-icp .form-textarea');
    await textarea.fill('Our ideal client is a...');
    await expect(textarea).toHaveValue('Our ideal client is a...');
  });

  test('geography select has options', async ({ page }) => {
    const select = page.locator('#view-icp .form-select').first();
    const options = select.locator('option');
    const count = await options.count();
    expect(count).toBeGreaterThan(1);
  });

  test('min employees field accepts numeric input', async ({ page }) => {
    const minEmployees = page.locator('#view-icp input[type="number"]').first();
    await minEmployees.fill('10');
    await expect(minEmployees).toHaveValue('10');
  });
});
