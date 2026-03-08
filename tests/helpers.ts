import { Page } from '@playwright/test';

/** Disable CSS transitions/animations AND force reveal-animated elements visible.
 *  IntersectionObserver never fires in headless Playwright runs, so `.reveal`
 *  elements stay at opacity:0 forever unless we override their initial state. */
export async function disableAnimations(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
      .reveal {
        opacity: 1 !important;
        transform: none !important;
      }
    `,
  });
}

/** Navigate to the landing page and wait for it to be ready. */
export async function gotoLanding(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('nav#nav').waitFor({ state: 'visible', timeout: 15000 });
  await disableAnimations(page);
}

/** Navigate to the dashboard and wait for it to be ready. */
export async function gotoDashboard(page: Page): Promise<void> {
  await page.goto('/dashboard.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  // .sidebar is in static HTML — once DOM is ready it exists; assert visibility quickly
  await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 15000 });
  await disableAnimations(page);
}
