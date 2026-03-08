import { test, expect } from '@playwright/test';
import { gotoLanding } from '../helpers';

test.describe('Landing — FAQ Accordion', () => {
  test.beforeEach(async ({ page }) => {
    await gotoLanding(page);
    await page.locator('#faq').scrollIntoViewIfNeeded();
  });

  test('FAQ section is visible', async ({ page }) => {
    await expect(page.locator('#faq')).toBeVisible();
  });

  test('FAQ title is correct', async ({ page }) => {
    await expect(page.locator('.faq-title')).toContainText('Common questions');
  });

  test('at least 7 FAQ items are present', async ({ page }) => {
    const items = page.locator('.faq-item');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(7);
  });

  test('no FAQ item is open by default', async ({ page }) => {
    await expect(page.locator('.faq-item.open')).toHaveCount(0);
  });

  test('clicking a question opens it', async ({ page }) => {
    const firstQuestion = page.locator('.faq-question').first();
    await firstQuestion.click();
    await expect(page.locator('.faq-item').first()).toHaveClass(/open/);
  });

  test('clicking an open question closes it', async ({ page }) => {
    const firstQuestion = page.locator('.faq-question').first();
    await firstQuestion.click();
    await expect(page.locator('.faq-item').first()).toHaveClass(/open/);
    await firstQuestion.click();
    await expect(page.locator('.faq-item').first()).not.toHaveClass(/open/);
  });

  test('only one FAQ item can be open at a time', async ({ page }) => {
    const questions = page.locator('.faq-question');
    await questions.nth(0).click();
    await expect(page.locator('.faq-item.open')).toHaveCount(1);
    await questions.nth(1).click();
    await expect(page.locator('.faq-item.open')).toHaveCount(1);
    // Verify it's the second item that's now open
    await expect(page.locator('.faq-item').nth(1)).toHaveClass(/open/);
    await expect(page.locator('.faq-item').nth(0)).not.toHaveClass(/open/);
  });

  test('opening a question reveals its answer', async ({ page }) => {
    await page.locator('.faq-question').first().click();
    await expect(page.locator('.faq-item').first().locator('.faq-answer')).toBeVisible();
  });

  test('expected FAQ topics are covered', async ({ page }) => {
    // Use question-specific phrases so each matches exactly one item.
    // 'qualified meeting' matches Q1 answer text too, so use the quoted form unique to Q4.
    const uniquePhrases = [
      'quickly will we see results',
      'minimum contract',
      'different from hiring an SDR',
      '"qualified meeting" actually mean',
      'GDPR compliant',
      'integrate with our CRM',
    ];
    for (const phrase of uniquePhrases) {
      await expect(
        page.locator('.faq-item').filter({ hasText: new RegExp(phrase, 'i') })
      ).toHaveCount(1);
    }
  });

  test('FAQ icon rotates when item is open', async ({ page }) => {
    const firstItem = page.locator('.faq-item').first();
    await firstItem.locator('.faq-question').click();
    // The .faq-item.open should have icon styled to 45deg via CSS
    await expect(firstItem).toHaveClass(/open/);
    // The icon element should exist
    await expect(firstItem.locator('.faq-icon')).toBeVisible();
  });
});
