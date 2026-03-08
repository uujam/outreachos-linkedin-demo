import { test, expect } from '@playwright/test';
import { gotoLanding } from '../helpers';

test.describe('Landing — Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await gotoLanding(page);
  });

  test('nav bar is present and visible', async ({ page }) => {
    await expect(page.locator('nav#nav')).toBeVisible();
  });

  test('logo text is correct', async ({ page }) => {
    const logo = page.locator('.nav-logo');
    await expect(logo).toBeVisible();
    await expect(logo).toContainText('OutreachOS');
  });

  test('all nav section links are present', async ({ page }) => {
    const expectedLinks = ['Services', 'Process', 'Pricing', 'Why Us', 'Contact'];
    for (const text of expectedLinks) {
      await expect(
        page.locator('.nav-links a').filter({ hasText: text })
      ).toBeVisible();
    }
  });

  test('nav section links point to correct anchors', async ({ page }) => {
    const links = [
      { text: 'Services', section: 'services' },
      { text: 'Process', section: 'process' },
      { text: 'Pricing', section: 'pricing' },
    ];
    for (const { text, section } of links) {
      const link = page.locator('.nav-links a').filter({ hasText: text });
      await expect(link).toHaveAttribute('href', `#${section}`);
    }
  });

  test('Client Login link points to dashboard', async ({ page }) => {
    const loginLink = page.locator('.nav-login');
    await expect(loginLink).toBeVisible();
    await expect(loginLink).toContainText('Client Login');
    await expect(loginLink).toHaveAttribute('href', 'dashboard.html');
  });

  test('Book a Demo nav button is present and triggers modal', async ({ page }) => {
    const ctaBtn = page.locator('button#openModal.nav-cta');
    await expect(ctaBtn).toBeVisible();
    await expect(ctaBtn).toContainText('Book a Demo');

    await ctaBtn.click();
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
  });

  test('nav becomes scrolled after scrolling down', async ({ page }) => {
    await expect(page.locator('nav#nav')).not.toHaveClass(/scrolled/);
    await page.evaluate(() => window.scrollTo(0, 200));
    await expect(page.locator('nav#nav')).toHaveClass(/scrolled/);
  });

  test('nav returns to transparent after scrolling back to top', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 200));
    await expect(page.locator('nav#nav')).toHaveClass(/scrolled/);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('nav#nav')).not.toHaveClass(/scrolled/);
  });

  test('clicking Services link scrolls to services section', async ({ page }) => {
    await page.locator('.nav-links a[href="#services"]').click();
    await expect(page.locator('#services')).toBeInViewport();
  });

  test('clicking Process link scrolls to process section', async ({ page }) => {
    await page.locator('.nav-links a[href="#process"]').click();
    await expect(page.locator('#process')).toBeInViewport();
  });

  test('clicking Pricing link scrolls to pricing section', async ({ page }) => {
    await page.locator('.nav-links a[href="#pricing"]').click();
    await expect(page.locator('#pricing')).toBeInViewport();
  });

  test('footer nav links are all present', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const footerLinks = ['Services', 'Process', 'Pricing', 'Why Us', 'FAQ', 'Contact'];
    for (const text of footerLinks) {
      await expect(
        page.locator('footer .footer-nav a').filter({ hasText: text })
      ).toBeVisible();
    }
  });

  test('footer email link is correct', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(
      page.locator('footer a[href="mailto:hello@outreachos.io"]')
    ).toBeVisible();
  });

  test('footer logo is present', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator('.footer-logo')).toContainText('OutreachOS');
  });
});
