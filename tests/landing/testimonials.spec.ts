import { test, expect } from '@playwright/test';
import { gotoLanding } from '../helpers';

test.describe('Landing — Testimonials Carousel', () => {
  test.beforeEach(async ({ page }) => {
    await gotoLanding(page);
    await page.locator('#testimonial').scrollIntoViewIfNeeded();
  });

  test('testimonials section is visible', async ({ page }) => {
    await expect(page.locator('#testimonial')).toBeVisible();
  });

  test('3 testimonial slides are present in the DOM', async ({ page }) => {
    await expect(page.locator('.testimonial-slide')).toHaveCount(3);
  });

  test('exactly one slide is active by default', async ({ page }) => {
    await expect(page.locator('.testimonial-slide.active')).toHaveCount(1);
  });

  test('3 dot navigation items are present', async ({ page }) => {
    await expect(page.locator('.t-dot')).toHaveCount(3);
  });

  test('exactly one dot is active by default', async ({ page }) => {
    await expect(page.locator('.t-dot.active')).toHaveCount(1);
  });

  test('first dot is active by default', async ({ page }) => {
    await expect(page.locator('.t-dot').first()).toHaveClass(/active/);
  });

  test('clicking second dot activates second slide', async ({ page }) => {
    await page.locator('.t-dot').nth(1).click();
    await expect(page.locator('.testimonial-slide').nth(1)).toHaveClass(/active/);
    await expect(page.locator('.t-dot').nth(1)).toHaveClass(/active/);
  });

  test('clicking third dot activates third slide', async ({ page }) => {
    await page.locator('.t-dot').nth(2).click();
    await expect(page.locator('.testimonial-slide').nth(2)).toHaveClass(/active/);
    await expect(page.locator('.t-dot').nth(2)).toHaveClass(/active/);
  });

  test('clicking second dot deactivates first slide', async ({ page }) => {
    await page.locator('.t-dot').nth(1).click();
    await expect(page.locator('.testimonial-slide').nth(0)).not.toHaveClass(/active/);
    await expect(page.locator('.t-dot').nth(0)).not.toHaveClass(/active/);
  });

  test('only one slide is active after dot click', async ({ page }) => {
    await page.locator('.t-dot').nth(1).click();
    await expect(page.locator('.testimonial-slide.active')).toHaveCount(1);
    await expect(page.locator('.t-dot.active')).toHaveCount(1);
  });

  test('testimonial slides contain quote text', async ({ page }) => {
    const quotes = page.locator('.testimonial-quote');
    const count = await quotes.count();
    expect(count).toBeGreaterThan(0);
    // Active slide quote should have content
    const activeQuote = page.locator('.testimonial-slide.active .testimonial-quote');
    const text = await activeQuote.textContent();
    expect(text!.trim().length).toBeGreaterThan(10);
  });

  test('testimonial slides contain name and role', async ({ page }) => {
    await expect(
      page.locator('.testimonial-slide.active .testimonial-name')
    ).not.toBeEmpty();
    await expect(
      page.locator('.testimonial-slide.active .testimonial-role')
    ).not.toBeEmpty();
  });

  test('testimonial names include James Whitmore, Sophie Caldwell, Daniel Frost', async ({ page }) => {
    const allSlides = page.locator('.testimonial-slide');
    const allText = await allSlides.allTextContents();
    const combined = allText.join(' ');
    expect(combined).toContain('James Whitmore');
    expect(combined).toContain('Sophie Caldwell');
    expect(combined).toContain('Daniel Frost');
  });
});
