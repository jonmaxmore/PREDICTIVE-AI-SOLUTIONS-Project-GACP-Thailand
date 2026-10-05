/**
 * Playwright E2E Test Configuration
 * For GACP Certification Platform
 */

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './e2e',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: [
        ['list'],
        ['html', { outputFolder: 'playwright-report' }],
    ],
    use: {
        baseURL: process.env.API_URL || 'http://localhost:3000',
        trace: 'on-first-retry',
        extraHTTPHeaders: {
            'Content-Type': 'application/json',
        },
    },
    projects: [
        {
            name: 'api-tests',
            testMatch: /.*\.api\.test\.js/,
        },
    ],
    timeout: 30000,
    expect: {
        timeout: 5000,
    },
});
