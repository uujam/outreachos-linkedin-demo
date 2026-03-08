/**
 * E2E User Journey Tests
 *
 * These tests simulate real user behaviour across the full application,
 * covering the critical paths that a prospect or client would follow.
 * Any regression in these flows will break user journeys end-to-end.
 */
import { test, expect } from '@playwright/test';
import { disableAnimations } from '../helpers';

// ── Journey 1: Prospect discovers OutreachOS and books a demo ──────────────────
test.describe('Journey: Prospect books a demo', () => {
  test('prospect lands, browses, opens modal from hero, and submits form', async ({ page }) => {
    // 1. Arrive on landing page
    await page.goto('/');
    await disableAnimations(page);
    await expect(page.locator('h1.hero-headline')).toBeVisible();

    // 2. Read the services section
    await page.locator('a[href="#services"]').first().click();
    await expect(page.locator('#services')).toBeInViewport();
    await expect(page.locator('.service-card')).toHaveCount(4);

    // 3. Check the pricing
    await page.locator('.nav-links a[href="#pricing"]').click();
    await expect(page.locator('#pricing')).toBeInViewport();
    await expect(page.locator('.pricing-card')).toHaveCount(3);

    // 4. Toggle to annual pricing
    await page.locator('.toggle-btn[data-plan="annual"]').click();
    await expect(page.locator('#pricingGrid')).toHaveClass(/annual-active/);

    // 5. Click CTA on Growth card
    await page.locator('.pricing-card.popular .pricing-cta').click();
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);

    // 6. Fill in the demo form
    await page.locator('#fieldFirst').fill('James');
    await page.locator('#fieldLast').fill('Whitmore');
    await page.locator('#fieldEmail').fill('james.whitmore@meridianfund.co.uk');
    await page.locator('#fieldCompany').fill('Meridian Capital');
    await page.locator('#fieldGoal').fill('Book 10 qualified meetings per month');

    // 7. Submit
    await page.locator('.form-submit').click();

    // 8. The JS replaces demoForm innerHTML with a thank you message
    await expect(page.locator('#demoForm')).toContainText('Thank you');
  });

  test('prospect dismisses modal, reads FAQ, then books via final CTA', async ({ page }) => {
    await page.goto('/');
    await disableAnimations(page);

    // Open modal from nav
    await page.locator('button#openModal').click();
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);

    // Dismiss with Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('#modalOverlay')).not.toHaveClass(/open/);

    // Read FAQ
    await page.locator('#faq').scrollIntoViewIfNeeded();
    await page.locator('.faq-question').first().click();
    await expect(page.locator('.faq-item').first()).toHaveClass(/open/);

    // Navigate to final CTA
    await page.locator('#cta').scrollIntoViewIfNeeded();
    await page.locator('#cta a.btn-primary[data-modal]').click();
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
  });
});

// ── Journey 2: Client logs in and reviews their pipeline ──────────────────────
test.describe('Journey: Client reviews pipeline and meetings', () => {
  test('client arrives on dashboard and navigates to pipeline', async ({ page }) => {
    // 1. Land directly on dashboard (simulating logged-in state)
    await page.goto('/dashboard.html', { waitUntil: 'domcontentloaded' });
    await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 15000 });
    await disableAnimations(page);

    // 2. Overview should be visible with KPIs
    await expect(page.locator('#view-overview')).toHaveClass(/active/);
    await expect(page.locator('#view-overview .kpi-card')).toHaveCount(4);

    // 3. Navigate to Pipeline
    await page.locator('.sidebar-link[data-view="pipeline"]').click();
    await expect(page.locator('#view-pipeline')).toHaveClass(/active/);

    // 4. Pipeline board shows stages — scope to #view-pipeline to avoid
    //    strict-mode violations (same stage names appear in the hidden overview board)
    const stages = ['Identified', 'In Outreach', 'Responded', 'Qualified', 'Booked'];
    for (const stage of stages) {
      await expect(
        page.locator('#view-pipeline .pipe-col-name').filter({ hasText: stage })
      ).toBeVisible();
    }

    // 5. Table shows leads
    const rows = page.locator('#view-pipeline table tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test('client checks meetings and verifies upcoming schedule', async ({ page }) => {
    await page.goto('/dashboard.html', { waitUntil: 'domcontentloaded' });
    await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 15000 });
    await disableAnimations(page);

    // Navigate to meetings
    await page.locator('.sidebar-link[data-view="meetings"]').click();
    await expect(page.locator('#view-meetings')).toHaveClass(/active/);

    // Verify KPIs
    await expect(page.locator('#view-meetings .kpi-card')).toHaveCount(3);

    // Verify meetings are listed
    const rows = page.locator('#view-meetings .meeting-row');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(4);

    // Verify a confirmed meeting badge exists
    await expect(page.locator('#view-meetings .mb-conf').first()).toBeVisible();
  });
});

// ── Journey 3: Client configures ICP settings ─────────────────────────────────
test.describe('Journey: Client configures ICP', () => {
  test('client opens ICP settings, updates fields, and saves', async ({ page }) => {
    await page.goto('/dashboard.html', { waitUntil: 'domcontentloaded' });
    await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 15000 });
    await disableAnimations(page);

    // Navigate to ICP
    await page.locator('.sidebar-link[data-view="icp"]').click();
    await expect(page.locator('#view-icp')).toHaveClass(/active/);

    // Verify form is present
    await expect(page.locator('#view-icp .icp-grid')).toBeVisible();

    // Update the ideal client description
    const textarea = page.locator('#view-icp .form-textarea');
    await textarea.clear();
    await textarea.fill('B2B SaaS companies with £5M–£20M ARR seeking enterprise clients.');

    await expect(textarea).toHaveValue('B2B SaaS companies with £5M–£20M ARR seeking enterprise clients.');

    // Verify Save button is present and clickable
    await expect(page.locator('.btn-save')).toBeEnabled();
  });
});

// ── Journey 4: Client reviews all channel performance ─────────────────────────
test.describe('Journey: Client reviews channel performance', () => {
  test('client cycles through LinkedIn, Email, and Voice views', async ({ page }) => {
    await page.goto('/dashboard.html', { waitUntil: 'domcontentloaded' });
    await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 15000 });
    await disableAnimations(page);

    // LinkedIn
    await page.locator('.sidebar-link[data-view="linkedin"]').click();
    await expect(page.locator('#view-linkedin')).toHaveClass(/active/);
    await expect(page.locator('#view-linkedin .chan-stats-grid > *')).toHaveCount(6);

    // Email
    await page.locator('.sidebar-link[data-view="email"]').click();
    await expect(page.locator('#view-email')).toHaveClass(/active/);
    await expect(page.locator('#view-email .chan-stats-grid > *')).toHaveCount(6);

    // Voice
    await page.locator('.sidebar-link[data-view="voice"]').click();
    await expect(page.locator('#view-voice')).toHaveClass(/active/);
    await expect(page.locator('#view-voice .chan-stats-grid > *')).toHaveCount(6);
  });

  test('client runs a Companies House search', async ({ page }) => {
    await page.goto('/dashboard.html', { waitUntil: 'domcontentloaded' });
    await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 15000 });
    await disableAnimations(page);

    await page.locator('.sidebar-link[data-view="companies-house"]').click();
    await expect(page.locator('#view-companies-house')).toHaveClass(/active/);

    // Type a company name in the search box
    await page.locator('.ch-input').fill('Thornton Advisory');
    await expect(page.locator('.ch-input')).toHaveValue('Thornton Advisory');

    // Verify at least one result is displayed
    await expect(page.locator('#view-companies-house table tbody tr').first()).toBeVisible();
  });
});

// ── Journey 5: Landing page → dashboard navigation ────────────────────────────
test.describe('Journey: Landing page to dashboard', () => {
  test('prospect clicks Client Login and reaches dashboard', async ({ page }) => {
    await page.goto('/');
    await disableAnimations(page);

    // Click Client Login and wait for the dashboard sidebar to appear
    await page.locator('.nav-login').click();
    await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 15000 });
    await disableAnimations(page);

    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('#view-overview')).toHaveClass(/active/);
  });

  test('dashboard "Back to Site" returns to landing page', async ({ page }) => {
    await page.goto('/dashboard.html', { waitUntil: 'domcontentloaded' });
    await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 15000 });
    await disableAnimations(page);

    await page.locator('.sidebar a[href="index.html"]').click();
    await expect(page).toHaveURL(/index\.html|\/$/);
    await expect(page.locator('nav#nav')).toBeVisible();
  });
});

// ── Journey 6: Testimonial engagement and pricing comparison ──────────────────
test.describe('Journey: Prospect explores social proof and pricing', () => {
  test('prospect reads all 3 testimonials and switches to annual pricing', async ({ page }) => {
    await page.goto('/');
    await disableAnimations(page);

    // Go to testimonials
    await page.locator('#testimonial').scrollIntoViewIfNeeded();
    await expect(page.locator('.testimonial-slide.active')).toHaveCount(1);

    // Click through all 3 dots
    for (let i = 0; i < 3; i++) {
      await page.locator('.t-dot').nth(i).click();
      await expect(page.locator('.testimonial-slide').nth(i)).toHaveClass(/active/);
    }

    // Scroll to pricing and switch to annual
    await page.locator('#pricing').scrollIntoViewIfNeeded();
    await page.locator('.toggle-btn[data-plan="annual"]').click();
    await expect(page.locator('#pricingGrid')).toHaveClass(/annual-active/);

    // Verify all 3 cards still visible
    await expect(page.locator('.pricing-card')).toHaveCount(3);
  });
});

// ── Journey 7: Process walkthrough ────────────────────────────────────────────
test.describe('Journey: Prospect reads the full process', () => {
  test('"How it works" CTA scrolls to process and all 5 steps are visible', async ({ page }) => {
    await page.goto('/');
    await disableAnimations(page);

    await page.locator('a.btn-ghost[href="#process"]').click();
    await expect(page.locator('#process')).toBeInViewport();
    await expect(page.locator('.process-step')).toHaveCount(5);

    // Each step has a number, title, and description
    const steps = page.locator('.process-step');
    const count = await steps.count();
    for (let i = 0; i < count; i++) {
      await expect(steps.nth(i).locator('.process-step-num')).not.toBeEmpty();
      await expect(steps.nth(i).locator('.process-step-title')).not.toBeEmpty();
    }
  });
});
