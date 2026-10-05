import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
    timeout: 300000, // 5 minutes for full lifecycle
    // Iter 23: include both legacy /e2e (live backend) and new /playwright
    // (API-mocked, no Docker required). Root resolves both transparently.
    testDir: '.',
    testMatch: ['e2e/**/*.spec.ts', 'playwright/**/*.spec.ts'],
    /* Run tests in files in parallel */
    fullyParallel: true,
    /* Fail the build on CI if you accidentally left test.only in the source code. */
    forbidOnly: !!process.env.CI,
    /* Retry on CI only */
    retries: process.env.CI ? 2 : 0,
    /* Opt out of parallel tests on CI. */
    workers: process.env.CI ? 1 : undefined,
    /* Reporter to use. See https://playwright.dev/docs/test-reporters */
    reporter: [['list'], ['html']],
    /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
    use: {
        /* Base URL to use in actions like `await page.goto('/')`. */
        /* Production: Use nginx on port 80 */
        baseURL: process.env.E2E_BASE_URL || 'http://localhost',
        ignoreHTTPSErrors: process.env.E2E_IGNORE_HTTPS_ERRORS === 'true',

        /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
        trace: 'on-first-retry',
    },

    /* Configure projects for major browsers */
    projects: [
        // Auth setup: logs in once + saves storageState (see e2e/auth.setup.ts).
        // Specs opt in via test.use({ storageState }) to reuse the session and
        // avoid the per-test login rate-limit. Runs before chromium (dependency).
        {
            name: 'setup',
            testMatch: /auth\.setup\.ts/,
        },
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
            dependencies: ['setup'],
        },
        {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
        },
        {
            name: 'webkit',
            use: { ...devices['Desktop Safari'] },
        },
        /* Test against mobile viewports. */
        {
            name: 'Mobile Chrome',
            use: { ...devices['Pixel 5'] },
        },
        {
            name: 'Mobile Safari',
            use: { ...devices['iPhone 12'] },
        },
    ],

    /* Run your local dev server before starting the tests */
    /* Disabled for production testing - use Docker containers instead */
    // webServer: {
    //     command: 'npm run dev',
    //     url: 'http://localhost:3000',
    //     reuseExistingServer: !process.env.CI,
    // },
});
