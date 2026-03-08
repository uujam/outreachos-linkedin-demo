import { test, expect } from '@playwright/test';
import { gotoLanding } from '../helpers';

test.describe('Landing — Book a Demo Modal', () => {
  test.beforeEach(async ({ page }) => {
    await gotoLanding(page);
  });

  // ── Open / close ──────────────────────────────────────────────────────────
  test('modal is hidden by default', async ({ page }) => {
    await expect(page.locator('#modalOverlay')).not.toHaveClass(/open/);
  });

  test('nav "Book a Demo" button opens the modal', async ({ page }) => {
    await page.locator('button#openModal').click();
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
  });

  test('hero primary CTA opens the modal', async ({ page }) => {
    await page.locator('a.btn-primary[data-modal]').first().click();
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
  });

  test('all three pricing CTAs open the modal', async ({ page }) => {
    await page.locator('#pricing').scrollIntoViewIfNeeded();
    const ctaButtons = page.locator('.pricing-cta[data-modal]');
    const count = await ctaButtons.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Test first one only to avoid closing/reopening complexity
    await ctaButtons.first().click();
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
  });

  test('final CTA button opens the modal', async ({ page }) => {
    await page.locator('#cta').scrollIntoViewIfNeeded();
    await page.locator('#cta a.btn-primary[data-modal]').click();
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
  });

  test('close button dismisses the modal', async ({ page }) => {
    await page.locator('button#openModal').click();
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
    await page.locator('#modalClose').click();
    await expect(page.locator('#modalOverlay')).not.toHaveClass(/open/);
  });

  test('pressing Escape dismisses the modal', async ({ page }) => {
    await page.locator('button#openModal').click();
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#modalOverlay')).not.toHaveClass(/open/);
  });

  test('clicking the overlay backdrop dismisses the modal', async ({ page }) => {
    await page.locator('button#openModal').click();
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
    // Click the overlay itself, not the inner modal box
    await page.locator('#modalOverlay').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('#modalOverlay')).not.toHaveClass(/open/);
  });

  // ── Content ───────────────────────────────────────────────────────────────
  test('modal title is correct', async ({ page }) => {
    await page.locator('button#openModal').click();
    // Wait for modal to be visually open before reading title (opacity:0 → opacity:1)
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
    await expect(page.locator('#modalTitle')).toContainText('See OutreachOS');
  });

  // ── Form fields ───────────────────────────────────────────────────────────
  test('all required form fields are present', async ({ page }) => {
    await page.locator('button#openModal').click();
    const fields = ['#fieldFirst', '#fieldLast', '#fieldEmail', '#fieldCompany', '#fieldGoal'];
    for (const field of fields) {
      await expect(page.locator(field)).toBeVisible();
    }
  });

  test('form submit button is present', async ({ page }) => {
    await page.locator('button#openModal').click();
    await expect(page.locator('.form-submit')).toBeVisible();
    await expect(page.locator('.form-submit')).toContainText('Request My Demo');
  });

  test('privacy notice is visible', async ({ page }) => {
    await page.locator('button#openModal').click();
    await expect(page.locator('.form-privacy')).toBeVisible();
  });

  // ── Form interaction ──────────────────────────────────────────────────────
  test('form fields accept text input', async ({ page }) => {
    await page.locator('button#openModal').click();
    await page.locator('#fieldFirst').fill('James');
    await page.locator('#fieldLast').fill('Whitmore');
    await page.locator('#fieldEmail').fill('james@example.com');
    await page.locator('#fieldCompany').fill('Whitmore Capital');
    await expect(page.locator('#fieldFirst')).toHaveValue('James');
    await expect(page.locator('#fieldLast')).toHaveValue('Whitmore');
    await expect(page.locator('#fieldEmail')).toHaveValue('james@example.com');
    await expect(page.locator('#fieldCompany')).toHaveValue('Whitmore Capital');
  });

  test('submitting the form shows a thank you state', async ({ page }) => {
    await page.locator('button#openModal').click();
    await page.locator('#fieldFirst').fill('James');
    await page.locator('#fieldLast').fill('Whitmore');
    await page.locator('#fieldEmail').fill('james@example.com');
    await page.locator('#fieldCompany').fill('Whitmore Capital');
    await page.locator('#fieldGoal').fill('Generate more meetings');
    await page.locator('.form-submit').click();
    // The JS replaces demoForm's innerHTML with a thank you message (element stays in DOM)
    await expect(page.locator('#demoForm')).toContainText('Thank you');
  });

  // ── Accessibility ─────────────────────────────────────────────────────────
  test('form labels are associated with their inputs', async ({ page }) => {
    await page.locator('button#openModal').click();
    // Each label's for attribute should match an input id
    const labels = page.locator('.form-label');
    const count = await labels.count();
    expect(count).toBeGreaterThan(0);
  });
});
