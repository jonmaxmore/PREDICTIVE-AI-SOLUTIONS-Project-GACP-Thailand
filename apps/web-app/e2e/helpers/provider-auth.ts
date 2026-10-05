import { Page } from '@playwright/test';

/** Provider portal credentials from environment variables */
export const PROVIDER_CREDENTIALS = {
    username: process.env.E2E_PROVIDER_USERNAME || 'reviewer',
    password: process.env.E2E_PROVIDER_PASSWORD || 'Test@12345',
};

/**
 * Login via the provider (DTAM Provider) login page.
 * Fills the form, submits, and waits until redirected to /provider/dashboard.
 */
export async function loginAsProvider(page: Page): Promise<void> {
    await page.goto('/auth/provider/login');
    // Redesigned provider login (auth/_components/provider-login-page.tsx) uses
    // #provider-id / #provider-password — the old #username/#password ids are gone.
    await page.waitForSelector('#provider-id', { timeout: 10_000 });

    await page.fill('#provider-id', PROVIDER_CREDENTIALS.username);
    await page.fill('#provider-password', PROVIDER_CREDENTIALS.password);
    await page.click('button[type="submit"]');

    await page.waitForURL('**/provider/dashboard', { timeout: 20_000 });
}

/**
 * Scheduler ("คนแจกงาน" / work-distributor) credentials. Defaults to the seeded
 * staging scheduler; override via env for another environment.
 */
export const SCHEDULER_CREDENTIALS = {
    username: process.env.E2E_SCHEDULER_USERNAME || '3333333333333',
    password: process.env.E2E_SCHEDULER_PASSWORD || 'Gacp@2025',
};

/**
 * Login as a SCHEDULER. Unlike a generic provider (which lands on
 * /provider/dashboard), the scheduler is auto-routed to /provider/coordinator
 * by PROVIDER_LANDING (provider-role-config.ts), so we wait for any /provider/*
 * page (not the login page) rather than a specific dashboard path.
 */
export async function loginAsScheduler(page: Page): Promise<void> {
    await page.goto('/auth/provider/login');
    await page.waitForSelector('#provider-id', { timeout: 10_000 });

    await page.fill('#provider-id', SCHEDULER_CREDENTIALS.username);
    await page.fill('#provider-password', SCHEDULER_CREDENTIALS.password);
    await page.click('button[type="submit"]');

    await page.waitForURL(
        (url) => /\/provider\//.test(url.pathname) && !/\/auth\//.test(url.pathname),
        { timeout: 20_000 },
    );
}

/**
 * Document reviewer (ผู้ตรวจเอกสาร) credentials. Seeded staging account is a
 * REVIEWER_AUDITOR (canonical document_reviewer). Override via env for another env.
 */
export const REVIEWER_CREDENTIALS = {
    username: process.env.E2E_REVIEWER_USERNAME || '1111111111111',
    password: process.env.E2E_REVIEWER_PASSWORD || 'Gacp@2025',
};

/**
 * Login as a DOCUMENT_REVIEWER. No dedicated landing in provider-role-config, so
 * the dashboard switch keeps them on a generic /provider/* page — wait for any
 * /provider/* (not the login page).
 */
export async function loginAsReviewer(page: Page): Promise<void> {
    await page.goto('/auth/provider/login');
    await page.waitForSelector('#provider-id', { timeout: 10_000 });

    await page.fill('#provider-id', REVIEWER_CREDENTIALS.username);
    await page.fill('#provider-password', REVIEWER_CREDENTIALS.password);
    await page.click('button[type="submit"]');

    await page.waitForURL(
        (url) => /\/provider\//.test(url.pathname) && !/\/auth\//.test(url.pathname),
        { timeout: 20_000 },
    );
}

/**
 * Account (บัญชี / finance) credentials. Seeded staging account is the legacy
 * ACCOUNT (reads both money-flow sides). Override via env for the split
 * ACCOUNT_DTAM / ACCOUNT_PLATFORM seeds.
 */
export const ACCOUNT_CREDENTIALS = {
    username: process.env.E2E_ACCOUNT_USERNAME || '4444444444444',
    password: process.env.E2E_ACCOUNT_PASSWORD || 'Gacp@2025',
};

/**
 * Login as an ACCOUNT user. ACCOUNT_DTAM/PLATFORM land on /provider/accounting;
 * legacy ACCOUNT falls to the generic dashboard — wait for any /provider/*.
 */
export async function loginAsAccount(page: Page): Promise<void> {
    await page.goto('/auth/provider/login');
    await page.waitForSelector('#provider-id', { timeout: 10_000 });

    await page.fill('#provider-id', ACCOUNT_CREDENTIALS.username);
    await page.fill('#provider-password', ACCOUNT_CREDENTIALS.password);
    await page.click('button[type="submit"]');

    await page.waitForURL(
        (url) => /\/provider\//.test(url.pathname) && !/\/auth\//.test(url.pathname),
        { timeout: 20_000 },
    );
}
