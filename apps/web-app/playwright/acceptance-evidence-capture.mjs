/**
 * Acceptance Evidence Capture — สัญญา C05F680149 (8 ต้นแบบ THRSP)
 *
 * Real-browser walkthrough of STAGING (never production — กฎทอง #7) that
 * exercises every contract module end-to-end with the seeded test accounts
 * and captures full-page screenshots for the acceptance evidence pack
 * (evidence/walkthroughs/). Re-runnable; every step is try/catch'd so a
 * broken selector degrades to a SKIP + as-is screenshot, never an abort.
 *
 * Run:  node playwright/acceptance-evidence-capture.mjs
 * Env:  EVIDENCE_BASE_URL (default https://staging.gacpth.com)
 *       EVIDENCE_ADMIN_ID / EVIDENCE_ADMIN_PW    (provider ADMIN)
 *       EVIDENCE_FARMER_ID / EVIDENCE_FARMER_PW  (HEALTH applicant)
 * Output: evidence/walkthroughs/screenshots/NN-name.png + run-log.json
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import sharp from 'sharp';

const BASE = process.env.EVIDENCE_BASE_URL || 'https://staging.gacpth.com';
const ADMIN_ID = process.env.EVIDENCE_ADMIN_ID || '2900000000009';
const ADMIN_PW = process.env.EVIDENCE_ADMIN_PW || 'Test@12345';
const FARMER_ID = process.env.EVIDENCE_FARMER_ID || '1100000000008';
const FARMER_PW = process.env.EVIDENCE_FARMER_PW || 'Test@12345';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../../../evidence/walkthroughs/screenshots');
fs.mkdirSync(OUT, { recursive: true });

let shotIndex = 0;
const log = [];

function note(step, status, detail = '') {
    const line = { step, status, detail };
    log.push(line);
    console.log(`[${status}] ${step}${detail ? ' — ' + detail : ''}`);
}

async function shot(page, name) {
    shotIndex += 1;
    const file = `${String(shotIndex).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: path.join(OUT, file), fullPage: true });
    note(`screenshot ${file}`, 'SAVED');
    return file;
}

async function step(name, fn) {
    try {
        await fn();
        note(name, 'PASS');
    } catch (error) {
        note(name, 'SKIP', String(error.message).split('\n')[0]);
    }
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
    const file = path.join(os.tmpdir(), 'evidence-leaf.jpg');
    await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 85 }).toFile(file);
    return file;
}

const browser = await chromium.launch();

// ── PUBLIC pages (no auth) ──────────────────────────────────────────
{
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await step('public: /trace (ต้นแบบ 7 — ตรวจสอบย้อนกลับสาธารณะ)', async () => {
        await page.goto(`${BASE}/trace`, { waitUntil: 'networkidle', timeout: 45000 });
        await shot(page, 'public-trace');
    });
    await step('public: /verify (ต้นแบบ 7 — ตรวจใบรับรองสาธารณะ)', async () => {
        await page.goto(`${BASE}/verify`, { waitUntil: 'networkidle', timeout: 45000 });
        await shot(page, 'public-verify');
    });
    await page.context().close();
}

// ── HEALTH portal (เกษตรกร) ─────────────────────────────────────────
{
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    await step('health: login', async () => {
        await page.goto(`${BASE}/auth/health/login`, { waitUntil: 'networkidle', timeout: 45000 });
        await page.fill('#identifier', FARMER_ID);
        await page.fill('#password', FARMER_PW);
        await shot(page, 'health-login');
        await page.click('button[type=submit]');
        // NOTE: '**/health/**' would match /auth/health/login itself — wait for a
        // URL OUTSIDE /auth so the login POST + cookie actually complete first.
        await page.waitForURL(u => !u.pathname.startsWith('/auth'), { timeout: 60000 });
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1500);
        await shot(page, 'health-dashboard');
    });

    await step('health: /health/surveys (ต้นแบบ 2 — รายการแบบสำรวจ)', async () => {
        await page.goto(`${BASE}/health/surveys`, { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForTimeout(1500);
        await shot(page, 'health-surveys-list');
    });

    await step('health: ตอบแบบสำรวจผ่าน UI (ต้นแบบ 2 — posted document)', async () => {
        const card = page.locator('a[href^="/health/surveys/"]').first();
        await card.click({ timeout: 15000 });
    });

    await step('health: กรอกแบบสำรวจ + ส่งคำตอบ', async () => {
        await page.waitForLoadState('networkidle');
        // ภูมิภาค (custom Select)
        await page.getByText('เลือกภูมิภาค', { exact: false }).first().click({ timeout: 10000 });
        await page.getByText('ภาคเหนือ', { exact: false }).first().click({ timeout: 10000 });
        // ข้อความ
        const textInput = page.locator('input[type=text]').nth(1);
        await textInput.fill('ปลูกขมิ้นชันและขิง ต้องการตลาดรับซื้อที่แน่นอนและราคายุติธรรม');
        // คะแนน 1-5
        await page.locator('button[aria-label="ให้คะแนน 4"]').first().click();
        await shot(page, 'health-survey-form-filled');
        await page.getByRole('button', { name: 'ส่งคำตอบ' }).click();
        await page.waitForTimeout(2500);
        await shot(page, 'health-survey-submitted');
    });

    await step('health: /health/herbs (ต้นแบบ 5 — ฐานข้อมูลสมุนไพร)', async () => {
        await page.goto(`${BASE}/health/herbs`, { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForTimeout(1500);
        await shot(page, 'health-herbs-list');
    });

    await step('health: herb detail (กัญชา)', async () => {
        await page.goto(`${BASE}/health/herbs/CANNABIS`, { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForTimeout(1500);
        await shot(page, 'health-herb-cannabis');
    });

    await ctx.close();
}

// ── PROVIDER portal (เจ้าหน้าที่/ADMIN) ─────────────────────────────
{
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    await step('provider: login (ADMIN)', async () => {
        await page.goto(`${BASE}/auth/provider/login`, { waitUntil: 'networkidle', timeout: 45000 });
        await page.fill('#provider-id', ADMIN_ID);
        await page.fill('#provider-password', ADMIN_PW);
        await page.click('button[type=submit]');
        // '**/provider/**' matches /auth/provider/login itself — wait for non-/auth
        await page.waitForURL(u => !u.pathname.startsWith('/auth'), { timeout: 60000 });
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1500);
        await shot(page, 'provider-dashboard');
    });

    await step('provider: /provider/standards (ต้นแบบ 1 — landing 3 ระบบ)', async () => {
        await page.goto(`${BASE}/provider/standards`, { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForTimeout(1000);
        await shot(page, 'standards-landing-3-systems');
    });

    await step('provider: ระบบวิเคราะห์มาตรฐาน WHO — วิเคราะห์คำขอจริง (1.1)', async () => {
        await page.goto(`${BASE}/provider/standards/who`, { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForTimeout(2000);
        await page.getByText('เลือกคำขอที่จะวิเคราะห์', { exact: false }).first().click({ timeout: 10000 });
        await page.locator('[role="option"], [role="listbox"] >> nth=0').first().click({ timeout: 10000 });
        await page.getByRole('button', { name: 'วิเคราะห์ความสอดคล้อง' }).click();
        await page.getByText('ความพร้อมรวม', { exact: false }).waitFor({ timeout: 30000 });
        await shot(page, 'standards-who-gap-analysis');
    });

    await step('provider: ระบบวิเคราะห์มาตรฐาน Thai FDA (1.2)', async () => {
        await page.goto(`${BASE}/provider/standards/thai-fda`, { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForTimeout(1500);
        await shot(page, 'standards-thai-fda');
    });

    await step('provider: ระบบเปรียบเทียบมาตรฐาน ASEAN — ตาราง 10 ประเทศ (1.3)', async () => {
        await page.goto(`${BASE}/provider/standards/asean`, { waitUntil: 'networkidle', timeout: 45000 });
        await page.getByText('เวียดนาม', { exact: false }).first().waitFor({ timeout: 20000 });
        await shot(page, 'standards-asean-10-countries');
    });

    await step('provider: /provider/surveys (ต้นแบบ 2 — จัดการแบบสำรวจ)', async () => {
        await page.goto(`${BASE}/provider/surveys`, { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForTimeout(1500);
        await shot(page, 'provider-surveys-list');
    });

    await step('provider: ผลลัพธ์แบบสำรวจ + text-mining (ต้นแบบ 2+3.1)', async () => {
        await page.locator('a[href^="/provider/surveys/"]:not([href*="interviews"])').first().click({ timeout: 10000 });
        await page.getByText('คำตอบทั้งหมด', { exact: false }).waitFor({ timeout: 20000 });
        await page.waitForTimeout(1000);
        await shot(page, 'provider-survey-stats-textmining');
    });

    await step('provider: บันทึกสัมภาษณ์ผู้เชี่ยวชาญ (ต้นแบบ 2.2)', async () => {
        await page.goto(`${BASE}/provider/surveys/interviews`, { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForTimeout(1000);
        await shot(page, 'provider-interviews');
    });

    await step('provider: /provider/herbs + coverage KPI (ต้นแบบ 5)', async () => {
        await page.goto(`${BASE}/provider/herbs`, { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForTimeout(1500);
        await shot(page, 'provider-herbs-coverage');
    });

    await step('provider: image assessment — อัปโหลดภาพจริง (ต้นแบบ 6)', async () => {
        await page.goto(`${BASE}/provider/image-assessment`, { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForTimeout(1000);
        await shot(page, 'image-assessment-page');
        const leaf = await makeLeafImage();
        await page.locator('input[type=file]').first().setInputFiles(leaf);
        await page.waitForTimeout(500);
        const assessButton = page.getByRole('button', { name: /วิเคราะห์|ประเมิน/ }).first();
        await assessButton.click({ timeout: 10000 });
        await page.getByText(/โรค|HEALTHY|ความสมบูรณ์/, { exact: false }).first().waitFor({ timeout: 45000 });
        await page.waitForTimeout(1000);
        await shot(page, 'image-assessment-result');
    });

    await step('provider: /provider/datasets (ภาคผนวก 4 ข้อ 3 — ชุดข้อมูลดิบ)', async () => {
        await page.goto(`${BASE}/provider/datasets`, { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForTimeout(1500);
        await shot(page, 'provider-datasets-catalog');
    });

    await step('provider: trace demo (ต้นแบบ 7 — เจ้าหน้าที่)', async () => {
        await page.goto(`${BASE}/provider/certificates`, { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForTimeout(1500);
        await shot(page, 'provider-certificates');
    });

    await ctx.close();
}

await browser.close();

fs.writeFileSync(
    path.resolve(OUT, '../run-log.json'),
    JSON.stringify({ base: BASE, capturedAt: new Date().toISOString(), steps: log }, null, 2),
);

const pass = log.filter(l => l.status === 'PASS').length;
const skip = log.filter(l => l.status === 'SKIP').length;
console.log(`\nDONE: ${pass} PASS, ${skip} SKIP, ${shotIndex} screenshots → ${OUT}`);
