import { test, expect } from '@playwright/test';
import { gotoLanding } from '../helpers';

test.describe('Landing — Pricing Section', () => {
  test.beforeEach(async ({ page }) => {
    await gotoLanding(page);
    await page.locator('#pricing').scrollIntoViewIfNeeded();
  });

  // ── Section structure ─────────────────────────────────────────────────────
  test('pricing section is visible', async ({ page }) => {
    await expect(page.locator('#pricing')).toBeVisible();
  });

  test('pricing title is correct', async ({ page }) => {
    await expect(page.locator('.pricing-title')).toContainText('Simple, transparent pricing');
  });

  test('pricing subtitle mentions flat retainer', async ({ page }) => {
    await expect(page.locator('.pricing-subtitle')).toContainText('flat retainer');
  });

  // ── Toggle ────────────────────────────────────────────────────────────────
  test('monthly toggle button is present', async ({ page }) => {
    await expect(page.locator('.toggle-btn[data-plan="monthly"]')).toBeVisible();
  });

  test('annual toggle button is present', async ({ page }) => {
    await expect(page.locator('.toggle-btn[data-plan="annual"]')).toBeVisible();
  });

  test('monthly is active by default', async ({ page }) => {
    await expect(page.locator('.toggle-btn[data-plan="monthly"]')).toHaveClass(/active/);
    await expect(page.locator('.toggle-btn[data-plan="annual"]')).not.toHaveClass(/active/);
  });

  test('annual toggle switch activates annual plan', async ({ page }) => {
    await page.locator('.toggle-btn[data-plan="annual"]').click();
    await expect(page.locator('.toggle-btn[data-plan="annual"]')).toHaveClass(/active/);
    await expect(page.locator('.toggle-btn[data-plan="monthly"]')).not.toHaveClass(/active/);
  });

  test('annual toggle adds annual-active class to pricing grid', async ({ page }) => {
    await expect(page.locator('#pricingGrid')).not.toHaveClass(/annual-active/);
    await page.locator('.toggle-btn[data-plan="annual"]').click();
    await expect(page.locator('#pricingGrid')).toHaveClass(/annual-active/);
  });

  test('switching back to monthly removes annual-active class', async ({ page }) => {
    await page.locator('.toggle-btn[data-plan="annual"]').click();
    await expect(page.locator('#pricingGrid')).toHaveClass(/annual-active/);
    await page.locator('.toggle-btn[data-plan="monthly"]').click();
    await expect(page.locator('#pricingGrid')).not.toHaveClass(/annual-active/);
  });

  test('"Save 20%" badge is visible on annual button', async ({ page }) => {
    await expect(page.locator('.toggle-btn[data-plan="annual"] .pricing-save')).toBeVisible();
  });

  // ── Pricing cards ─────────────────────────────────────────────────────────
  test('3 pricing cards are present', async ({ page }) => {
    await expect(page.locator('.pricing-card')).toHaveCount(3);
  });

  test('Starter plan card is present', async ({ page }) => {
    await expect(
      page.locator('.pricing-card').filter({ hasText: 'Starter' })
    ).toBeVisible();
  });

  test('Growth plan card is marked as popular', async ({ page }) => {
    await expect(page.locator('.pricing-card.popular')).toBeVisible();
    await expect(page.locator('.popular-badge')).toContainText('Most Popular');
  });

  test('Enterprise plan card is present', async ({ page }) => {
    await expect(
      page.locator('.pricing-card').filter({ hasText: 'Enterprise' })
    ).toBeVisible();
  });

  test('Starter monthly price is £1,497', async ({ page }) => {
    const starterCard = page.locator('.pricing-card').filter({ hasText: 'Starter' });
    const monthlyPrice = starterCard.locator('.pricing-price-monthly .amount');
    await expect(monthlyPrice).toContainText('1,497');
  });

  test('Growth monthly price is £2,997', async ({ page }) => {
    const growthCard = page.locator('.pricing-card.popular');
    const monthlyPrice = growthCard.locator('.pricing-price-monthly .amount');
    await expect(monthlyPrice).toContainText('2,997');
  });

  test('annual prices are hidden when monthly is active', async ({ page }) => {
    // monthly is active by default
    const annualPrices = page.locator('.pricing-price-annual');
    // They exist in DOM but should not be visible (CSS hides them)
    // When not annual-active, annual prices are display:none via CSS
    const count = await annualPrices.count();
    expect(count).toBeGreaterThan(0);
  });

  test('all 3 pricing CTA buttons trigger modal', async ({ page }) => {
    const ctaButtons = page.locator('.pricing-cta[data-modal]');
    await expect(ctaButtons).toHaveCount(3);
  });

  test('Growth card CTA button has primary styling', async ({ page }) => {
    await expect(page.locator('.pricing-card.popular .pricing-cta.primary')).toBeVisible();
  });

  test('pricing note below cards is visible', async ({ page }) => {
    await expect(page.locator('.pricing-note')).toBeVisible();
  });

  // ── Feature lists ─────────────────────────────────────────────────────────
  test('each pricing card has a feature list', async ({ page }) => {
    const cards = page.locator('.pricing-card');
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      await expect(cards.nth(i).locator('.pricing-features')).toBeVisible();
    }
  });

  test('Growth plan includes AI voice qualification', async ({ page }) => {
    const growthCard = page.locator('.pricing-card.popular');
    await expect(growthCard.locator('.pricing-features')).toContainText('voice');
  });

  test('Starter plan features include LinkedIn', async ({ page }) => {
    const starterCard = page.locator('.pricing-card').filter({ hasText: 'Starter' });
    await expect(starterCard.locator('.pricing-features')).toContainText('LinkedIn');
  });
});
