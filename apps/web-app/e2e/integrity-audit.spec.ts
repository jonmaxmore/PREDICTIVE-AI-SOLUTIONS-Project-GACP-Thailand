import { test, expect } from '@playwright/test';

const ROUTES = [
  '/',
  '/login',
  '/register',
  '/health/dashboard',
  '/health/applications',
  '/health/planting',
  '/health/tracking',
  '/health/tracking/lots',
  '/provider/dashboard',
  '/provider/applications',
  '/admin/dashboard',
  '/trace',
  '/privacy',
  '/terms'
];

test.describe('System-wide Page Integrity Audit', () => {
  for (const route of ROUTES) {
    test(`Checking page: ${route}`, async ({ page }) => {
      const errors: string[] = [];
      
      // Capture console errors
      page.on('console', msg => {
        if (msg.type() === 'error') errors.push(msg.text());
      });

      // Capture unhandled exceptions
      page.on('pageerror', err => {
        errors.push(`Page Error: ${err.message}`);
      });

      const url = process.env.E2E_BASE_URL || 'http://localhost';
      // eslint-disable-next-line no-console -- e2e diagnostic
      console.log(`Auditing: ${url}${route}`);
      
      await page.goto(`${url}${route}`, { waitUntil: 'networkidle', timeout: 30000 });

      // Check if "Error Boundary" or "Something went wrong" text is visible
      const bodyText = await page.innerText('body');
      const isBroken = bodyText.includes('Application error') || 
                       bodyText.includes('Something went wrong') ||
                       bodyText.includes('Unhandled Runtime Error');

      if (isBroken || errors.length > 0) {
        console.error(`BROKEN PAGE DETECTED: ${route}`);
        console.error(`Errors found:`, errors);
      } else {
        // eslint-disable-next-line no-console -- e2e diagnostic
        console.log(`Page seems healthy: ${route}`);
      }

      expect(isBroken).toBe(false);
    });
  }
});
