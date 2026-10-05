/**
 * Reviewer-distribution queue drive — scheduler มอบหมายผู้ตรวจเอกสารจริง (STAGING).
 * ปิดลูป "รันคิว" ให้ครบทั้ง auditor + reviewer distribution ผ่านการกดปุ่มจริง.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const BASE = process.env.WALK_BASE_URL || 'https://staging.gacpth.com';
const SCHED = { id: '4900000000005', pw: 'Test@12345' };
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../../../evidence/walkthroughs/queue-drive-2026-07-10/screenshots');
fs.mkdirSync(OUT, { recursive: true });
let n = 22;
const shot = async (page, name) => { n++; await page.screenshot({ path: path.join(OUT, `${n}-${name}.png`), fullPage: true }); console.log(`[SAVED] ${n}-${name}.png`); };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('console', m => { if (m.type() === 'error' && !/favicon|beacon/i.test(m.text())) console.log('[CONSOLE]', m.text().slice(0, 160)); });

try {
  await page.goto(`${BASE}/auth/provider/login`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.fill('#provider-id', SCHED.id); await page.fill('#provider-password', SCHED.pw);
  await page.click('button[type=submit]');
  await page.waitForURL(u => !u.pathname.startsWith('/auth'), { timeout: 60000 });
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200);
  console.log('[PASS] scheduler login');

  await page.goto(`${BASE}/provider/scheduler/reviewer-reassign`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1500);
  await shot(page, 'reviewer-distribute-queue');

  const rowBtn = page.getByRole('button', { name: 'มอบหมายใหม่' }).first();
  if (!(await rowBtn.count())) { console.log('[INFO] ไม่มีคำขอให้มอบหมายผู้ตรวจเอกสารใหม่'); }
  else {
    await rowBtn.click({ timeout: 8000 });
    await page.waitForTimeout(800);
    await shot(page, 'reviewer-distribute-modal');
    await page.getByText('เลือกผู้ตรวจเอกสาร', { exact: false }).first().click({ timeout: 8000 });
    await page.locator('[role="option"]').first().click({ timeout: 8000 });
    await page.locator('textarea').first().fill('queue-drive: มอบหมายผู้ตรวจเอกสารคนใหม่ผ่าน UI จริง');
    await page.waitForTimeout(400);
    await shot(page, 'reviewer-distribute-ready');
    await page.getByRole('button', { name: 'ยืนยันการมอบหมาย' }).click({ timeout: 8000 });
    await page.waitForTimeout(2500);
    await shot(page, 'reviewer-distribute-done');
    console.log('[PASS] reviewer distribution confirmed via real click');
  }
} catch (e) { console.log('[FAIL]', String(e.message).split('\n')[0]); }
await browser.close();
console.log('DONE reviewer-distribute');
