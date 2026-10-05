/**
 * ============================================================================
 * E2E — การเงินสองบทบาทเห็นหน้าเดียวกัน: finance_officer_dtam + finance_officer_platform
 * ============================================================================
 * เดิมไฟล์นี้ชื่อ account-split-journey.spec.ts และพิสูจน์ "การแยกฝั่ง": ฝั่งกรมเห็น
 * Wallet A ไม่เห็น Wallet B, หน้าใบเสร็จกรองแถวของอีกฝั่งออก · คำตัดสินสองข้อลบแนวคิดนั้น:
 *   - operator 2026-09-11 "finance ต้องเห็นเหมือนกัน ... เพื่อแสดงความโปร่งใส"
 *   - operator 2026-09-27 "กรมฯ ดูอย่างเดียว" — การเงินกรมเห็นทุกอย่าง แต่ไม่มีปุ่มเขียน
 * ไฟล์นี้จึงพิสูจน์สิ่งตรงข้าม:
 *   1. แดชบอร์ดบัญชีมีหัวข้อกลางเดียวกันสำหรับทั้งสองบทบาท
 *   2. หน้าใบเสร็จแสดงทั้งสองแถว (ไม่มีการกรองตามบทบาท)
 *   3. ปุ่ม "ออกใบเสร็จ" ขึ้นเฉพาะการเงินบริษัท
 *
 * Run:
 *   cd apps/web-app
 *   npx playwright test playwright/finance-one-view-journey.spec.ts --project=chromium
 */

import { test, expect } from '@playwright/test';
import { loginAsAccountDtam, loginAsAccountPlatform } from './fixtures';
import {
    accountDtamMocks,
    accountPlatformMocks,
    seedProviderTokenCookie,
    DTAM_RECEIPT_ROW,
    PLATFORM_RECEIPT_ROW,
} from './account-fixtures';

// Per-stage visual evidence. `screenshot: 'on'` in the config captures too late
// for these specs — each stage re-authenticates, so the auto-capture landed on
// the login page rather than the screen under test. afterEach runs while the
// page is still on the stage's final state, which is the frame worth keeping.
// Opt in with STAGE_SHOT_DIR; unset, the specs behave exactly as before.
test.afterEach(async ({ page }, testInfo) => {
    const dir = process.env.STAGE_SHOT_DIR;
    if (!dir) return;
    const slug = testInfo.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 70);
    const prefix = testInfo.file.split('/').pop()?.replace(/\.spec\.ts$/, '') ?? 'spec';
    await page.screenshot({ path: `${dir}/${prefix}__${String(testInfo.line).padStart(4, '0')}__${slug}.png`, fullPage: true }).catch(() => {});
});


// ────────────────────────────────────────────────────────────────────────────
// ทั้งสองบทบาท — ขั้นเดียวกัน ผลอ่านเดียวกัน
// ────────────────────────────────────────────────────────────────────────────

const ROLES = [
    { name: 'finance_officer_dtam', login: loginAsAccountDtam, cookie: 'ACCOUNT_DTAM' as const, mocks: accountDtamMocks, canIssue: false },
    { name: 'finance_officer_platform', login: loginAsAccountPlatform, cookie: 'ACCOUNT_PLATFORM' as const, mocks: accountPlatformMocks, canIssue: true },
];

for (const role of ROLES) {
    test.describe(`หน้าบัญชีเดียวกัน — ${role.name}`, () => {
        test.beforeEach(async ({ page }) => {
            await role.login(page);
            await seedProviderTokenCookie(page, role.cookie);
            await role.mocks(page);
        });

        test('แดชบอร์ดบัญชี — หัวข้อกลาง ไม่มีคำว่าฝั่ง', async ({ page }) => {
            await page.goto('/provider/accounting');
            await page.waitForLoadState('domcontentloaded');
            await expect(page.getByRole('heading', { name: 'บัญชีและใบเสร็จ' }).first()).toBeVisible({ timeout: 20_000 });
            await expect(page.getByText(/บัญชี DTAM|บัญชี Platform|ฝั่งรัฐ \(DTAM\)|ฝั่งแพลตฟอร์ม/)).toHaveCount(0);
        });

        test('หน้าใบเสร็จ — ทั้งสองแถว · ปุ่มออกใบเสร็จเฉพาะผู้มีสิทธิ์เขียน', async ({ page }) => {
            await page.goto('/provider/receipts');
            await page.waitForLoadState('domcontentloaded');
            await expect(page.getByText(DTAM_RECEIPT_ROW.invoiceNumber).first()).toBeVisible({ timeout: 15_000 });
            await expect(page.getByText(PLATFORM_RECEIPT_ROW.invoiceNumber).first()).toBeVisible();
            await expect(page.getByTestId('receipts-side-banner')).toHaveCount(0);
            await expect(page.getByRole('button', { name: 'ออกใบเสร็จ' })).toHaveCount(role.canIssue ? 2 : 0);
        });
    });
}
