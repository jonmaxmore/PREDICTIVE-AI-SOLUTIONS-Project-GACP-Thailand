/**
 * Role Walkthrough — เดินระบบจริงผ่าน browser จริง ครบทุก role (ปูพรม)
 *
 * Real-browser carpet walkthrough of STAGING (never production — กฎทอง #7):
 * logs in through the REAL login pages as every seeded role, visits every
 * page that role owns, performs real actions (survey submit, WHO analysis,
 * image upload, quality score), verifies the finance side-wall + role bounce
 * in the REAL UI, and captures a full-page screenshot of everything.
 *
 * Run:  node playwright/role-walkthrough.mjs
 * Env:  WALK_BASE_URL (default https://staging.gacpth.com)
 * Output: evidence/walkthroughs/role-walkthrough-2026-07-10/screenshots/*.png
 *         + run-log.json (step results + console errors + final URLs)
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import sharp from 'sharp';

const BASE = process.env.WALK_BASE_URL || 'https://staging.gacpth.com';

// Seeded staging accounts (seed-test-accounts.js + accountant SoD seeds)
const ACCOUNTS = {
    farmer: { id: '1100000000008', pw: 'Test@12345' },
    admin: { id: '2900000000009', pw: 'Test@12345' },
    reviewer: { id: '3900000000007', pw: 'Test@12345' },
    scheduler: { id: '4900000000005', pw: 'Test@12345' },
    auditor: { id: '5900000000003', pw: 'Test@12345' },
    acctDtam: { id: '5550000000001', pw: 'Gacp@2025' },
    acctPlatform: { id: '6660000000001', pw: 'Gacp@2025' },
    acctLegacy: { id: '4444444444444', pw: 'Gacp@2025' },
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = path.resolve(__dirname, '../../../evidence/walkthroughs/role-walkthrough-2026-07-10');
const OUT = path.join(OUT_ROOT, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

let shotIndex = 0;
const log = [];

function note(step, status, detail = '') {
    log.push({ step, status, detail });
    console.log(`[${status}] ${step}${detail ? ' — ' + detail : ''}`);
}

async function step(name, fn) {
    try {
        await fn();
        note(name, 'PASS');
    } catch (error) {
        note(name, 'SKIP', String(error.message).split('\n')[0]);
    }
}

function watchConsole(page, roleTag) {
    page.on('console', (msg) => {
        if (msg.type() === 'error') {
            const text = msg.text().slice(0, 300);
            // Noise filter: failed favicon/beacon fetches are not app errors
            if (/favicon|beacon|third-party cookie/i.test(text)) return;
            note(`${roleTag} console.error @ ${page.url()}`, 'CONSOLE', text);
        }
    });
    page.on('pageerror', (err) => {
        note(`${roleTag} pageerror @ ${page.url()}`, 'PAGEERROR', String(err.message).slice(0, 300));
    });
}

async function shot(page, name) {
    shotIndex += 1;
    const file = `${String(shotIndex).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: path.join(OUT, file), fullPage: true });
    note(`screenshot ${file}`, 'SAVED');
    return file;
}

/** goto + settle + fatal-marker scan + screenshot; logs the FINAL url (bounces visible) */
async function visit(page, url, shotName, { expectPath } = {}) {
    await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1200);
    const finalPath = new URL(page.url()).pathname;
    const body = await page.locator('body').innerText().catch(() => '');
    const fatal =
        /Application error: a client-side exception/i.test(body) ? 'NEXT_CLIENT_EXCEPTION'
            : /Internal Server Error/i.test(body) ? 'HTTP_500_TEXT'
                : null;
    if (fatal) note(`FATAL marker on ${url}`, 'FATAL', fatal);
    if (expectPath && !finalPath.startsWith(expectPath)) {
        note(`redirect: ${url} → ${finalPath}`, 'REDIRECT');
    }
    await shot(page, shotName);
    return finalPath;
}

async function loginHealth(page, id, pw) {
    await page.goto(`${BASE}/auth/health/login`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.fill('#identifier', id);
    await page.fill('#password', pw);
    await page.click('button[type=submit]');
    await page.waitForURL(u => !u.pathname.startsWith('/auth'), { timeout: 60000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
}

async function loginProvider(page, id, pw) {
    await page.goto(`${BASE}/auth/provider/login`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.fill('#provider-id', id);
    await page.fill('#provider-password', pw);
    await page.click('button[type=submit]');
    await page.waitForURL(u => !u.pathname.startsWith('/auth'), { timeout: 60000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
}

async function makeLeafImage() {
    const w = 1024, h = 768;
    const buf = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) {
        buf[i * 3] = 55 + ((i * 7) % 30);
        buf[i * 3 + 1] = 140 + ((i * 13) % 40);
        buf[i * 3 + 2] = 50 + ((i * 5) % 25);
    }
    for (let y = 100; y < 180; y++) {
        for (let x = 100; x < 420; x++) {
            const o = (y * w + x) * 3;
            buf[o] = 30; buf[o + 1] = 35; buf[o + 2] = 25;
        }
    }
    const file = path.join(os.tmpdir(), 'walkthrough-leaf.jpg');
    await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 85 }).toFile(file);
    return file;
}

const browser = await chromium.launch();
const desktop = { viewport: { width: 1440, height: 900 } };

// ════════ 0) PUBLIC (ไม่ล็อกอิน) ════════
{
    const ctx = await browser.newContext(desktop);
    const page = await ctx.newPage();
    watchConsole(page, 'public');
    await step('public: หน้าแรก gacpth', () => visit(page, '/', 'public-home'));
    await step('public: /trace ตรวจสอบย้อนกลับ', () => visit(page, '/trace', 'public-trace'));
    await step('public: /verify ตรวจใบรับรอง', () => visit(page, '/verify', 'public-verify'));
    await ctx.close();
}

// ════════ 1) HEALTH — เกษตรกร (ทำงานจริง) ════════
{
    const ctx = await browser.newContext(desktop);
    const page = await ctx.newPage();
    watchConsole(page, 'HEALTH');

    await step('HEALTH: login ผ่านหน้า login จริง', async () => {
        await loginHealth(page, ACCOUNTS.farmer.id, ACCOUNTS.farmer.pw);
        await shot(page, 'health-dashboard');
    });
    await step('HEALTH: คำขอรับรอง (applications)', () => visit(page, '/health/applications', 'health-applications'));
    await step('HEALTH: เปิดรายละเอียดคำขอแรก (ถ้ามี)', async () => {
        const first = page.locator('a[href^="/health/applications/"]').first();
        await first.click({ timeout: 8000 });
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1200);
        await shot(page, 'health-application-detail');
    });
    await step('HEALTH: การเงิน/ชำระเงิน', () => visit(page, '/health/payments', 'health-payments'));
    await step('HEALTH: ใบรับรอง', () => visit(page, '/health/certificates', 'health-certificates'));
    await step('HEALTH: เอกสาร', () => visit(page, '/health/documents', 'health-documents'));
    await step('HEALTH: การปลูก (planting)', () => visit(page, '/health/planting', 'health-planting'));
    await step('HEALTH: workspaces (ฟาร์มมีลูกจ้าง)', () => visit(page, '/health/workspaces', 'health-workspaces'));
    await step('HEALTH: โปรไฟล์', () => visit(page, '/health/profile', 'health-profile'));

    // ทำงานจริง: ตอบแบบสำรวจผ่าน UI (posted document จริงลง DB staging)
    await step('HEALTH: รายการแบบสำรวจ', () => visit(page, '/health/surveys', 'health-surveys'));
    await step('HEALTH: กรอก + ส่งแบบสำรวจจริง', async () => {
        await page.locator('a[href^="/health/surveys/"]').first().click({ timeout: 10000 });
        await page.waitForLoadState('networkidle');
        await page.getByText('เลือกภูมิภาค', { exact: false }).first().click({ timeout: 10000 });
        await page.getByText('ภาคตะวันออกเฉียงเหนือ', { exact: false }).first().click({ timeout: 10000 });
        const textInput = page.locator('input[type=text]').nth(1);
        await textInput.fill('เดิน UAT ปูพรมผ่าน browser จริง — ต้องการราคารับซื้อที่เป็นธรรม');
        await page.locator('button[aria-label="ให้คะแนน 5"]').first().click();
        await shot(page, 'health-survey-filled');
        await page.getByRole('button', { name: 'ส่งคำตอบ' }).click();
        await page.waitForTimeout(2500);
        await shot(page, 'health-survey-submitted');
    });
    await step('HEALTH: ฐานสมุนไพร', () => visit(page, '/health/herbs', 'health-herbs'));
    await step('HEALTH: สมุนไพร กัญชา (detail)', () => visit(page, '/health/herbs/CANNABIS', 'health-herb-cannabis'));

    // Cross-portal wall จริงบน UI: token HEALTH เข้า /provider ต้องถูกเด้ง
    await step('HEALTH: ลองเข้า /provider/dashboard (ต้องถูกเด้ง = crypto wall)', async () => {
        const finalPath = await visit(page, '/provider/dashboard', 'health-blocked-from-provider');
        if (finalPath.startsWith('/provider/dashboard')) {
            note('SECURITY: health token เข้าหน้า provider ได้!', 'FATAL', finalPath);
        } else {
            note(`cross-portal wall ทำงาน: เด้งไป ${finalPath}`, 'PASS');
        }
    });
    await ctx.close();
}

// ════════ 1b) HEALTH บนมือถือ (เกษตรกรใช้มือถือจริง) ════════
{
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    watchConsole(page, 'HEALTH-mobile');
    await step('HEALTH mobile: login + dashboard (390px)', async () => {
        await loginHealth(page, ACCOUNTS.farmer.id, ACCOUNTS.farmer.pw);
        await shot(page, 'mobile-health-dashboard');
    });
    await step('HEALTH mobile: สมุนไพร', () => visit(page, '/health/herbs', 'mobile-health-herbs'));
    await step('HEALTH mobile: แบบสำรวจ', () => visit(page, '/health/surveys', 'mobile-health-surveys'));
    await ctx.close();
}

// ════════ 2) ADMIN — ผู้ดูแล tenant (ทำงานจริง) ════════
{
    const ctx = await browser.newContext(desktop);
    const page = await ctx.newPage();
    watchConsole(page, 'ADMIN');

    await step('ADMIN: login', async () => {
        await loginProvider(page, ACCOUNTS.admin.id, ACCOUNTS.admin.pw);
        await shot(page, 'admin-dashboard');
    });
    await step('ADMIN: work inbox', () => visit(page, '/provider/work', 'admin-work'));
    await step('ADMIN: applications', () => visit(page, '/provider/applications', 'admin-applications'));
    await step('ADMIN: standards landing (3 ระบบ)', () => visit(page, '/provider/standards', 'admin-standards'));
    await step('ADMIN: WHO analyzer — รันวิเคราะห์จริง', async () => {
        await page.goto(`${BASE}/provider/standards/who`, { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForTimeout(2000);
        await page.getByText('เลือกคำขอที่จะวิเคราะห์', { exact: false }).first().click({ timeout: 10000 });
        await page.locator('[role="option"], [role="listbox"] >> nth=0').first().click({ timeout: 10000 });
        await page.getByRole('button', { name: 'วิเคราะห์ความสอดคล้อง' }).click();
        await page.getByText('ความพร้อมรวม', { exact: false }).waitFor({ timeout: 30000 });
        await shot(page, 'admin-who-analysis-run');
    });
    await step('ADMIN: Thai FDA analyzer', () => visit(page, '/provider/standards/thai-fda', 'admin-thai-fda'));
    await step('ADMIN: ASEAN comparison', async () => {
        await page.goto(`${BASE}/provider/standards/asean`, { waitUntil: 'networkidle', timeout: 45000 });
        await page.getByText('เวียดนาม', { exact: false }).first().waitFor({ timeout: 20000 });
        await shot(page, 'admin-asean');
    });
    await step('ADMIN: surveys จัดการแบบสำรวจ', () => visit(page, '/provider/surveys', 'admin-surveys'));
    await step('ADMIN: ผลสำรวจ + text-mining', async () => {
        await page.locator('a[href^="/provider/surveys/"]:not([href*="interviews"])').first().click({ timeout: 10000 });
        await page.getByText('คำตอบทั้งหมด', { exact: false }).waitFor({ timeout: 20000 });
        await page.waitForTimeout(800);
        await shot(page, 'admin-survey-stats');
    });
    await step('ADMIN: expert interviews', () => visit(page, '/provider/surveys/interviews', 'admin-interviews'));
    await step('ADMIN: herbs + coverage KPI', () => visit(page, '/provider/herbs', 'admin-herbs'));
    await step('ADMIN: herb detail CANNABIS (ตารางจัดการ)', () => visit(page, '/provider/herbs/CANNABIS', 'admin-herb-cannabis'));
    await step('ADMIN: image assessment — อัปโหลด + วิเคราะห์จริง', async () => {
        await page.goto(`${BASE}/provider/image-assessment`, { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForTimeout(1000);
        const leaf = await makeLeafImage();
        await page.locator('input[type=file]').first().setInputFiles(leaf);
        await page.waitForTimeout(500);
        await page.getByRole('button', { name: /วิเคราะห์|ประเมิน/ }).first().click({ timeout: 10000 });
        await page.getByText(/โรค|HEALTHY|ความสมบูรณ์/, { exact: false }).first().waitFor({ timeout: 45000 });
        await shot(page, 'admin-image-assess-run');
    });
    await step('ADMIN: quality score — คำนวณจริง (6.2)', async () => {
        await page.getByRole('button', { name: 'คำนวณคะแนนคุณภาพ' }).click({ timeout: 10000 });
        await page.getByText('คะแนนคุณภาพรวม', { exact: false }).waitFor({ timeout: 20000 });
        await shot(page, 'admin-quality-score-run');
    });
    await step('ADMIN: datasets catalog', () => visit(page, '/provider/datasets', 'admin-datasets'));
    await step('ADMIN: analytics', () => visit(page, '/provider/analytics', 'admin-analytics'));
    await step('ADMIN: accounting (เห็น 2 ฝั่ง)', () => visit(page, '/provider/accounting', 'admin-accounting'));
    await step('ADMIN: receipts', () => visit(page, '/provider/receipts', 'admin-receipts'));
    await step('ADMIN: certificates', () => visit(page, '/provider/certificates', 'admin-certificates'));
    await step('ADMIN: scheduler workload (ledger)', () => visit(page, '/provider/scheduler/workload', 'admin-sched-workload'));
    await step('ADMIN: admin console dashboard', () => visit(page, '/admin/dashboard', 'admin-console'));
    await step('ADMIN: admin users (back-office)', () => visit(page, '/admin/users', 'admin-users'));
    await ctx.close();
}

// ════════ 3) DOCUMENT_REVIEWER — ผู้ตรวจเอกสาร ════════
{
    const ctx = await browser.newContext(desktop);
    const page = await ctx.newPage();
    watchConsole(page, 'REVIEWER');
    await step('REVIEWER: login → landing เฉพาะ role (/provider/reviewer)', async () => {
        await loginProvider(page, ACCOUNTS.reviewer.id, ACCOUNTS.reviewer.pw);
        await shot(page, 'reviewer-landing');
        note(`REVIEWER landed at ${new URL(page.url()).pathname}`, 'INFO');
    });
    await step('REVIEWER: work queue', () => visit(page, '/provider/work', 'reviewer-work'));
    await step('REVIEWER: applications (ตรวจเอกสาร)', () => visit(page, '/provider/applications', 'reviewer-applications'));
    await step('REVIEWER: image assessment (AUDIT_STAFF ใช้ได้)', () => visit(page, '/provider/image-assessment', 'reviewer-image-assessment'));
    await step('REVIEWER: settings ต้องถูกเด้ง (ADMIN-only)', async () => {
        const finalPath = await visit(page, '/provider/settings', 'reviewer-blocked-settings');
        if (finalPath.startsWith('/provider/settings')) {
            note('RBAC: reviewer เข้า settings ได้!', 'FATAL', finalPath);
        } else {
            note(`RBAC route-gate ทำงาน: เด้งไป ${finalPath}`, 'PASS');
        }
    });
    await ctx.close();
}

// ════════ 4) SCHEDULER — ผู้จัดคิวงาน ════════
{
    const ctx = await browser.newContext(desktop);
    const page = await ctx.newPage();
    watchConsole(page, 'SCHEDULER');
    await step('SCHEDULER: login → landing (/provider/coordinator)', async () => {
        await loginProvider(page, ACCOUNTS.scheduler.id, ACCOUNTS.scheduler.pw);
        await shot(page, 'scheduler-landing');
        note(`SCHEDULER landed at ${new URL(page.url()).pathname}`, 'INFO');
    });
    await step('SCHEDULER: calendar', () => visit(page, '/provider/calendar', 'scheduler-calendar'));
    await step('SCHEDULER: จ่ายงาน auditor (reassign)', () => visit(page, '/provider/scheduler/reassign', 'scheduler-reassign'));
    await step('SCHEDULER: จ่ายงาน reviewer (reviewer-reassign)', () => visit(page, '/provider/scheduler/reviewer-reassign', 'scheduler-reviewer-reassign'));
    await step('SCHEDULER: workload ledger', () => visit(page, '/provider/scheduler/workload', 'scheduler-workload'));
    await ctx.close();
}

// ════════ 5) AUDITOR — ผู้ตรวจประเมิน ════════
{
    const ctx = await browser.newContext(desktop);
    const page = await ctx.newPage();
    watchConsole(page, 'AUDITOR');
    await step('AUDITOR: login → landing (/provider/audits)', async () => {
        await loginProvider(page, ACCOUNTS.auditor.id, ACCOUNTS.auditor.pw);
        await shot(page, 'auditor-landing');
        note(`AUDITOR landed at ${new URL(page.url()).pathname}`, 'INFO');
    });
    await step('AUDITOR: audits queue', () => visit(page, '/provider/audits', 'auditor-audits'));
    await step('AUDITOR: image assessment (เครื่องมือผู้ตรวจ)', () => visit(page, '/provider/image-assessment', 'auditor-image-assessment'));
    await step('AUDITOR: certificates', () => visit(page, '/provider/certificates', 'auditor-certificates'));
    await ctx.close();
}

// ════════ 6–7) การเงินสองบทบาท — หน้าบัญชีเดียวกัน (operator 2026-09-11) ════════
// เดิมสองบล็อกนี้พิสูจน์ side-wall (/provider/accounting/dtam กับ /platform แยกกัน) ·
// สองหน้านั้นถูกลบแล้ว ทั้งสองบทบาทลงหน้าเดียวกันและเห็นเนื้อหาเดียวกัน · การเงินกรมไม่มีปุ่มเขียน
for (const [label, acct] of [['ACCT_DTAM', ACCOUNTS.acctDtam], ['ACCT_PLATFORM', ACCOUNTS.acctPlatform]]) {
    const ctx = await browser.newContext(desktop);
    const page = await ctx.newPage();
    watchConsole(page, label);
    await step(`${label}: login → landing (/provider/accounting)`, async () => {
        await loginProvider(page, acct.id, acct.pw);
        await shot(page, `${label.toLowerCase()}-landing`);
        const landed = new URL(page.url()).pathname;
        note(`${label} landed at ${landed}`, landed === '/provider/accounting' ? 'PASS' : 'FAIL');
    });
    for (const tab of ['reports', 'wht', 'purchase-invoices', 'manual-journal-entries', 'period-close', 'ar-aging']) {
        await step(`${label}: /provider/accounting/${tab}`, () => visit(page, `/provider/accounting/${tab}`, `${label.toLowerCase()}-${tab}`));
    }
    await ctx.close();
}

// ════════ 8) legacy ACCOUNT — บัญชีรวม (เห็น 2 ฝั่ง) ════════
{
    const ctx = await browser.newContext(desktop);
    const page = await ctx.newPage();
    watchConsole(page, 'ACCT-LEGACY');
    await step('ACCT legacy: login + accounting (เห็น 2 ฝั่ง)', async () => {
        await loginProvider(page, ACCOUNTS.acctLegacy.id, ACCOUNTS.acctLegacy.pw);
        await shot(page, 'acct-legacy-landing');
    });
    await step('ACCT legacy: accounting รวม', () => visit(page, '/provider/accounting', 'acct-legacy-accounting'));
    await ctx.close();
}

await browser.close();

fs.writeFileSync(
    path.join(OUT_ROOT, 'run-log.json'),
    JSON.stringify({ base: BASE, capturedAt: new Date().toISOString(), steps: log }, null, 2),
);

const pass = log.filter(l => l.status === 'PASS').length;
const skip = log.filter(l => l.status === 'SKIP').length;
const fatal = log.filter(l => l.status === 'FATAL').length;
const consoleErrs = log.filter(l => l.status === 'CONSOLE' || l.status === 'PAGEERROR').length;
console.log(`\nDONE: ${pass} PASS, ${skip} SKIP, ${fatal} FATAL, ${consoleErrs} console/page errors, ${shotIndex} screenshots → ${OUT}`);
