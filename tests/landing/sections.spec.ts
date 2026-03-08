import { test, expect } from '@playwright/test';
import { gotoLanding } from '../helpers';

test.describe('Landing — Page Sections', () => {
  test.beforeEach(async ({ page }) => {
    await gotoLanding(page);
  });

  // ── Hero ───────────────────────────────────────────────────────────────────
  test.describe('Hero', () => {
    test('hero section renders', async ({ page }) => {
      await expect(page.locator('#hero')).toBeVisible();
    });

    test('hero headline is present', async ({ page }) => {
      await expect(page.locator('h1.hero-headline')).toBeVisible();
    });

    test('hero primary CTA button exists', async ({ page }) => {
      await expect(page.locator('a.btn-primary[data-modal]').first()).toBeVisible();
      await expect(page.locator('a.btn-primary[data-modal]').first()).toContainText('Book a Demo');
    });

    test('"How it works" ghost CTA links to process section', async ({ page }) => {
      const ghost = page.locator('a.btn-ghost[href="#process"]');
      await expect(ghost).toBeVisible();
      await expect(ghost).toContainText('How it works');
    });

    test('hero stats bar shows 4 stats', async ({ page }) => {
      await expect(page.locator('.hero-stats .stat')).toHaveCount(4);
    });

    test('pipeline activity widget is visible', async ({ page }) => {
      await expect(page.locator('.hero-widget')).toBeVisible();
    });

    test('widget live badge is visible', async ({ page }) => {
      await expect(page.locator('.widget-live')).toBeVisible();
    });

    test('widget feed items are present', async ({ page }) => {
      await expect(page.locator('.widget-feed .feed-item')).not.toHaveCount(0);
    });
  });

  // ── Integrations ───────────────────────────────────────────────────────────
  test.describe('Integrations', () => {
    test('integrations section renders', async ({ page }) => {
      await page.locator('#integrations').scrollIntoViewIfNeeded();
      await expect(page.locator('#integrations')).toBeVisible();
    });

    test('integration items are present', async ({ page }) => {
      await page.locator('#integrations').scrollIntoViewIfNeeded();
      await expect(page.locator('.integration-item')).not.toHaveCount(0);
    });

    test('LinkedIn integration is listed', async ({ page }) => {
      await page.locator('#integrations').scrollIntoViewIfNeeded();
      await expect(
        page.locator('.integration-item').filter({ hasText: 'LinkedIn' })
      ).toBeVisible();
    });
  });

  // ── Services ───────────────────────────────────────────────────────────────
  test.describe('Services', () => {
    test('services section renders', async ({ page }) => {
      await page.locator('#services').scrollIntoViewIfNeeded();
      await expect(page.locator('#services')).toBeVisible();
    });

    test('services heading is correct', async ({ page }) => {
      await page.locator('#services').scrollIntoViewIfNeeded();
      await expect(page.locator('.services-title')).toContainText('Every channel');
    });

    test('4 service cards are present', async ({ page }) => {
      await page.locator('#services').scrollIntoViewIfNeeded();
      await expect(page.locator('.service-card')).toHaveCount(4);
    });

    // Service names use <br> between words, so innerText has a newline not a space.
    // Use regex-based matching which handles both whitespace variants.
    const servicePatterns: [string, RegExp][] = [
      ['LinkedIn Intelligence',        /LinkedIn/i],
      ['AI Voice Qualification',       /AI Voice/i],
      ['Precision Email Outbound',     /Precision Email/i],
      ['Companies House Intelligence', /Companies House/i],
    ];

    for (const [name, pattern] of servicePatterns) {
      test(`"${name}" service card is present`, async ({ page }) => {
        await page.locator('#services').scrollIntoViewIfNeeded();
        await expect(
          page.locator('.service-card').filter({ hasText: pattern })
        ).toBeVisible();
      });
    }

    test('each service card has an explore link to #cta', async ({ page }) => {
      await page.locator('#services').scrollIntoViewIfNeeded();
      const links = page.locator('.service-link[href="#cta"]');
      await expect(links).toHaveCount(4);
    });
  });

  // ── Demo Preview ───────────────────────────────────────────────────────────
  test.describe('Demo Preview', () => {
    test('demo section renders', async ({ page }) => {
      await page.locator('#demo').scrollIntoViewIfNeeded();
      await expect(page.locator('#demo')).toBeVisible();
    });

    test('demo title is correct', async ({ page }) => {
      await page.locator('#demo').scrollIntoViewIfNeeded();
      // Title spans two lines via <br>; textContent joins words without spaces.
      // Check the first line segment which has no line break.
      await expect(page.locator('.demo-title')).toContainText('Your pipeline');
    });

    test('demo iframe src points to dashboard', async ({ page }) => {
      await page.locator('#demo').scrollIntoViewIfNeeded();
      const iframe = page.locator('#demoIframe');
      await expect(iframe).toHaveAttribute('src', 'dashboard.html');
    });

    test('demo URL bar shows app URL', async ({ page }) => {
      await page.locator('#demo').scrollIntoViewIfNeeded();
      await expect(page.locator('.demo-url')).toContainText('app.outreachos.io');
    });
  });

  // ── Process ────────────────────────────────────────────────────────────────
  test.describe('Process', () => {
    test('process section renders', async ({ page }) => {
      await page.locator('#process').scrollIntoViewIfNeeded();
      await expect(page.locator('#process')).toBeVisible();
    });

    test('process title is correct', async ({ page }) => {
      await page.locator('#process').scrollIntoViewIfNeeded();
      // Title spans two lines via <br>; check the first segment only.
      await expect(page.locator('.process-title')).toContainText('From signal');
    });

    test('5 process steps are present', async ({ page }) => {
      await page.locator('#process').scrollIntoViewIfNeeded();
      await expect(page.locator('.process-step')).toHaveCount(5);
    });

    test('process steps are numbered 01–05', async ({ page }) => {
      await page.locator('#process').scrollIntoViewIfNeeded();
      const nums = page.locator('.process-step-num');
      await expect(nums.nth(0)).toContainText('01');
      await expect(nums.nth(4)).toContainText('05');
    });
  });

  // ── Before/After Comparison ────────────────────────────────────────────────
  test.describe('Comparison', () => {
    test('comparison section renders', async ({ page }) => {
      await page.locator('#compare').scrollIntoViewIfNeeded();
      await expect(page.locator('#compare')).toBeVisible();
    });

    test('comparison title is correct', async ({ page }) => {
      await page.locator('#compare').scrollIntoViewIfNeeded();
      // Title spans two lines via <br>; check the first segment only.
      await expect(page.locator('.compare-title')).toContainText('Manual outreach');
    });

    test('"Without OutreachOS" column has 6 negative items', async ({ page }) => {
      await page.locator('#compare').scrollIntoViewIfNeeded();
      await expect(
        page.locator('.compare-col.before .compare-item')
      ).toHaveCount(6);
    });

    test('"With OutreachOS" column has 6 positive items', async ({ page }) => {
      await page.locator('#compare').scrollIntoViewIfNeeded();
      await expect(
        page.locator('.compare-col.after .compare-item')
      ).toHaveCount(6);
    });

    test('before column has cross icons', async ({ page }) => {
      await page.locator('#compare').scrollIntoViewIfNeeded();
      await expect(
        page.locator('.compare-col.before .compare-item-icon.cross')
      ).not.toHaveCount(0);
    });

    test('after column has tick icons', async ({ page }) => {
      await page.locator('#compare').scrollIntoViewIfNeeded();
      await expect(
        page.locator('.compare-col.after .compare-item-icon.tick')
      ).not.toHaveCount(0);
    });
  });

  // ── Trust ─────────────────────────────────────────────────────────────────
  test.describe('Trust', () => {
    test('trust section renders', async ({ page }) => {
      await page.locator('#trust').scrollIntoViewIfNeeded();
      await expect(page.locator('#trust')).toBeVisible();
    });

    test('5 trust logos are present', async ({ page }) => {
      await page.locator('#trust').scrollIntoViewIfNeeded();
      await expect(page.locator('.trust-logo')).toHaveCount(5);
    });
  });

  // ── Why Us ────────────────────────────────────────────────────────────────
  test.describe('Why Us', () => {
    test('why us section renders', async ({ page }) => {
      await page.locator('#why').scrollIntoViewIfNeeded();
      await expect(page.locator('#why')).toBeVisible();
    });

    test('why us title is correct', async ({ page }) => {
      await page.locator('#why').scrollIntoViewIfNeeded();
      // Title spans three lines via <br>; check first segment only.
      await expect(page.locator('.why-title')).toContainText('Built for');
    });

    test('why us cards have correct IDs', async ({ page }) => {
      await page.locator('#why').scrollIntoViewIfNeeded();
      const cardIds = ['#cnt1', '#cnt2', '#cnt3', '#cnt4'];
      for (const id of cardIds) {
        await expect(page.locator(id)).toBeVisible();
      }
    });

    test('4 why-us cards are present', async ({ page }) => {
      await page.locator('#why').scrollIntoViewIfNeeded();
      await expect(page.locator('.why-card')).toHaveCount(4);
    });
  });

  // ── Final CTA ─────────────────────────────────────────────────────────────
  test.describe('Final CTA', () => {
    test('final CTA section renders', async ({ page }) => {
      await page.locator('#cta').scrollIntoViewIfNeeded();
      await expect(page.locator('#cta')).toBeVisible();
    });

    test('final CTA primary button triggers modal', async ({ page }) => {
      await page.locator('#cta').scrollIntoViewIfNeeded();
      const cta = page.locator('#cta a.btn-primary[data-modal]');
      await expect(cta).toBeVisible();
      await cta.click();
      await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
    });
  });

  // ── Marquee ───────────────────────────────────────────────────────────────
  test.describe('Marquee', () => {
    test('marquee strip renders', async ({ page }) => {
      await expect(page.locator('.marquee-wrap')).toBeVisible();
    });

    test('marquee contains LinkedIn Intelligence text', async ({ page }) => {
      await expect(page.locator('.marquee-wrap')).toContainText('LinkedIn Intelligence');
    });

    test('marquee contains AI Voice Calls text', async ({ page }) => {
      await expect(page.locator('.marquee-wrap')).toContainText('AI Voice Calls');
    });
  });
});
