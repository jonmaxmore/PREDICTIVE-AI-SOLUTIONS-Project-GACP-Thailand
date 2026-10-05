/**
 * Workflow Queue Drive — กดปุ่มจริง รันคิวจริงผ่าน UI (STAGING).
 *
 * ต่างจาก role-walkthrough (แค่เปิดหน้า): สคริปต์นี้ **กดปุ่มที่ทำให้เกิด
 * mutation จริงลง DB** — เกษตรกรเดิน wizard จริง, admin บันทึกสัมภาษณ์จริง,
 * scheduler มอบหมายงานใหม่จริง (คิว workflow), admin รันวิเคราะห์/ประเมินจริง.
 * ทุก mutation ยืนยันด้วยการนับแถวใน DB ก่อน/หลัง (แยกรัน SSH).
 * มุ่ง STAGING เท่านั้น (กฎทอง #7). resilient: ทุก step try/catch + screenshot.
 *
 * Run:  node playwright/workflow-queue-drive.mjs
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import sharp from 'sharp';

const BASE = process.env.WALK_BASE_URL || 'https://staging.gacpth.com';
const A = {
  farmer: { id: '1100000000008', pw: 'Test@12345' },
  admin: { id: '2900000000009', pw: 'Test@12345' },
  scheduler: { id: '4900000000005', pw: 'Test@12345' },
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = path.resolve(__dirname, '../../../evidence/walkthroughs/queue-drive-2026-07-10');
const OUT = path.join(OUT_ROOT, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

let shotIndex = 0;
const log = [];
const note = (step, status, detail = '') => { log.push({ step, status, detail }); console.log(`[${status}] ${step}${detail ? ' — ' + detail : ''}`); };
async function shot(page, name) {
  shotIndex += 1;
  const file = `${String(shotIndex).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  note(`screenshot ${file}`, 'SAVED');
  return file;
}
async function step(name, fn) {
  try { await fn(); note(name, 'PASS'); } catch (e) { note(name, 'FAIL', String(e.message).split('\n')[0]); }
}
function watchConsole(page, tag) {
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|beacon/i.test(m.text())) note(`${tag} console.error @ ${page.url()}`, 'CONSOLE', m.text().slice(0, 200)); });
  page.on('pageerror', (e) => note(`${tag} pageerror @ ${page.url()}`, 'PAGEERROR', String(e.message).slice(0, 200)));
}
async function loginHealth(page, id, pw) {
  await page.goto(`${BASE}/auth/health/login`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.fill('#identifier', id); await page.fill('#password', pw);
  await page.click('button[type=submit]');
  await page.waitForURL(u => !u.pathname.startsWith('/auth'), { timeout: 60000 });
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200);
}
async function loginProvider(page, id, pw) {
  await page.goto(`${BASE}/auth/provider/login`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.fill('#provider-id', id); await page.fill('#provider-password', pw);
  await page.click('button[type=submit]');
  await page.waitForURL(u => !u.pathname.startsWith('/auth'), { timeout: 60000 });
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200);
}

const browser = await chromium.launch();
const desktop = { viewport: { width: 1440, height: 900 } };

// ═══ PHASE 1 — FARMER เดิน wizard จริง (กดปุ่ม ถัดไป จริง) ═══
{
  const ctx = await browser.newContext(desktop);
  const page = await ctx.newPage();
  watchConsole(page, 'FARMER');
  await step('FARMER: login', () => loginHealth(page, A.farmer.id, A.farmer.pw));
  await step('FARMER: เปิด wizard ยื่นคำขอใหม่', async () => {
    await page.goto(`${BASE}/health/applications/new`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1500);
    await shot(page, 'wizard-step1-consent');
  });
  await step('FARMER: STEP 1 ยินยอม — ติ๊ก 2 ช่อง + กด ถัดไป (จริง)', async () => {
    const boxes = page.locator('input[type=checkbox]');
    const n = await boxes.count();
    for (let i = 0; i < n; i++) { await boxes.nth(i).check({ force: true }).catch(() => {}); }
    await page.waitForTimeout(400);
    await shot(page, 'wizard-step1-checked');
    await page.getByRole('button', { name: 'ถัดไป' }).click({ timeout: 8000 });
    await page.waitForTimeout(2000);
    note(`หลังกด ถัดไป STEP1 → URL ${new URL(page.url()).pathname}`, 'INFO');
    await shot(page, 'wizard-step2-after-consent');
  });
  // เดินต่อ best-effort: ติ๊ก/กรอกสิ่งที่เห็น + กด ถัดไป ทีละ step, screenshot ทุก step
  for (let s = 2; s <= 8; s++) {
    await step(`FARMER: STEP ${s} — กรอกที่กรอกได้ + กด ถัดไป`, async () => {
      const before = new URL(page.url()).pathname;
      // ติ๊ก checkbox/radio ที่เห็น (best-effort)
      const boxes = page.locator('input[type=checkbox]:visible, input[type=radio]:visible');
      const bn = Math.min(await boxes.count(), 12);
      for (let i = 0; i < bn; i++) { await boxes.nth(i).check({ force: true }).catch(() => {}); }
      // กรอก text/number ที่ว่าง (best-effort)
      const texts = page.locator('input[type=text]:visible, input[type=number]:visible, input:not([type]):visible');
      const tn = Math.min(await texts.count(), 15);
      for (let i = 0; i < tn; i++) {
        const el = texts.nth(i);
        const val = await el.inputValue().catch(() => 'x');
        if (!val) await el.fill(await el.getAttribute('type') === 'number' ? '1' : 'ทดสอบ').catch(() => {});
      }
      await page.waitForTimeout(300);
      await shot(page, `wizard-step${s}`);
      const nextBtn = page.getByRole('button', { name: 'ถัดไป' }).first();
      if (await nextBtn.count()) {
        await nextBtn.click({ timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(1800);
      }
      const after = new URL(page.url()).pathname;
      note(`STEP ${s}: ${before} → ${after}${before === after ? ' (validation บล็อก — ต้องอัปโหลดไฟล์/กรอกครบ)' : ''}`, before === after ? 'BLOCKED' : 'ADVANCED');
    });
  }
  await ctx.close();
}

// ═══ PHASE 2 — FARMER ตอบแบบสำรวจจริง (posted document → survey_responses +1) ═══
{
  const ctx = await browser.newContext(desktop);
  const page = await ctx.newPage();
  watchConsole(page, 'FARMER2');
  await step('FARMER: login + เปิดแบบสำรวจ', async () => {
    await loginHealth(page, A.farmer.id, A.farmer.pw);
    await page.goto(`${BASE}/health/surveys`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1200);
    await page.locator('a[href^="/health/surveys/"]').first().click({ timeout: 10000 });
    await page.waitForLoadState('networkidle');
  });
  await step('FARMER: กรอกแบบสำรวจ + กดส่งจริง', async () => {
    await page.getByText('เลือกภูมิภาค', { exact: false }).first().click({ timeout: 10000 });
    await page.getByText('ภาคกลาง', { exact: false }).first().click({ timeout: 10000 });
    const textInput = page.locator('input[type=text]').nth(1);
    await textInput.fill('queue-drive: กดส่งแบบสำรวจจริงผ่าน UI').catch(() => {});
    await page.locator('button[aria-label="ให้คะแนน 5"]').first().click().catch(() => {});
    await shot(page, 'farmer-survey-filled');
    await page.getByRole('button', { name: 'ส่งคำตอบ' }).click({ timeout: 8000 });
    await page.waitForTimeout(2500);
    await shot(page, 'farmer-survey-submitted');
  });
  await ctx.close();
}

// ═══ PHASE 3 — ADMIN บันทึกสัมภาษณ์จริง (ต้นแบบ 2.2 → expert_interviews +1) ═══
{
  const ctx = await browser.newContext(desktop);
  const page = await ctx.newPage();
  watchConsole(page, 'ADMIN');
  await step('ADMIN: login + เปิดหน้าสัมภาษณ์', async () => {
    await loginProvider(page, A.admin.id, A.admin.pw);
    await page.goto(`${BASE}/provider/surveys/interviews`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1200);
    await shot(page, 'admin-interviews-before');
  });
  await step('ADMIN: กดบันทึกการสัมภาษณ์ + กรอก + กดบันทึกจริง', async () => {
    await page.getByRole('button', { name: 'บันทึกการสัมภาษณ์' }).first().click({ timeout: 8000 });
    await page.waitForTimeout(800);
    await page.locator('input[type=text]').first().fill('สัมภาษณ์ความต้องการระบบ — queue-drive UAT');
    // ชื่อผู้ให้สัมภาษณ์ = text input ตัวที่ 2 ใน dialog
    await page.locator('input[type=text]').nth(1).fill('นพ. ทดสอบ ผู้เชี่ยวชาญ');
    await page.locator('input[type=date]').first().fill('2026-07-10');
    await page.locator('#interview-transcript').fill('บันทึกสัมภาษณ์จริงจากการกดปุ่มผ่าน UI — ผู้เชี่ยวชาญเสนอให้เพิ่มระบบแจ้งเตือนและฐานข้อมูลสมุนไพรที่ครอบคลุม');
    await page.locator('#interview-insights').fill('ต้องการระบบแจ้งเตือน\nต้องการฐานข้อมูลสมุนไพรครบ').catch(() => {});
    await shot(page, 'admin-interview-form-filled');
    await page.getByRole('button', { name: 'บันทึก' }).click({ timeout: 8000 });
    await page.waitForTimeout(2500);
    await shot(page, 'admin-interview-saved');
  });
  await step('ADMIN: WHO analyzer — กดวิเคราะห์จริง', async () => {
    await page.goto(`${BASE}/provider/standards/who`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1800);
    await page.getByText('เลือกคำขอที่จะวิเคราะห์', { exact: false }).first().click({ timeout: 10000 });
    await page.locator('[role="option"], [role="listbox"] >> nth=0').first().click({ timeout: 10000 });
    await page.getByRole('button', { name: 'วิเคราะห์ความสอดคล้อง' }).click({ timeout: 8000 });
    await page.getByText('ความพร้อมรวม', { exact: false }).waitFor({ timeout: 30000 });
    await shot(page, 'admin-who-analysis-run');
  });
  await step('ADMIN: image-assessment — อัปโหลด + วิเคราะห์ + คำนวณคะแนนจริง', async () => {
    await page.goto(`${BASE}/provider/image-assessment`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1000);
    const w = 640, h = 480, buf = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) { buf[i * 3] = 60 + (i % 30); buf[i * 3 + 1] = 150 + (i % 40); buf[i * 3 + 2] = 55 + (i % 20); }
    const leaf = path.join(os.tmpdir(), 'qd-leaf.jpg');
    await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).jpeg().toFile(leaf);
    await page.locator('input[type=file]').first().setInputFiles(leaf);
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /วิเคราะห์|ประเมิน/ }).first().click({ timeout: 10000 });
    await page.getByText(/โรค|HEALTHY|ความสมบูรณ์/, { exact: false }).first().waitFor({ timeout: 45000 });
    await shot(page, 'admin-image-assessed');
    await page.getByRole('button', { name: 'คำนวณคะแนนคุณภาพ' }).click({ timeout: 8000 }).catch(() => {});
    await page.getByText('คะแนนคุณภาพรวม', { exact: false }).waitFor({ timeout: 20000 }).catch(() => {});
    await shot(page, 'admin-quality-scored');
  });
  await ctx.close();
}

// ═══ PHASE 4 — SCHEDULER มอบหมายงานใหม่จริง (คิว workflow → assignment_ledger +1) ═══
{
  const ctx = await browser.newContext(desktop);
  const page = await ctx.newPage();
  watchConsole(page, 'SCHEDULER');
  await step('SCHEDULER: login + เปิดคิวมอบหมายงาน', async () => {
    await loginProvider(page, A.scheduler.id, A.scheduler.pw);
    await page.goto(`${BASE}/provider/scheduler/reassign`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1500);
    await shot(page, 'scheduler-reassign-queue');
  });
  await step('SCHEDULER: กดมอบหมายใหม่ + เลือกผู้ตรวจ + เหตุผล + ยืนยันจริง', async () => {
    const rowBtn = page.getByRole('button', { name: 'มอบหมายใหม่' }).first();
    if (!(await rowBtn.count())) { note('ไม่มีงานให้มอบหมายใหม่ในคิวขณะนี้', 'INFO'); return; }
    await rowBtn.click({ timeout: 8000 });
    await page.waitForTimeout(800);
    await shot(page, 'scheduler-reassign-modal');
    // Select ผู้ตรวจใหม่ (Radix trigger)
    await page.getByText('เลือกผู้ตรวจประเมิน', { exact: false }).first().click({ timeout: 8000 });
    await page.locator('[role="option"]').first().click({ timeout: 8000 });
    await page.locator('textarea').first().fill('queue-drive UAT: ผู้ตรวจเดิมไม่ว่าง มอบหมายผู้ตรวจใหม่');
    await page.waitForTimeout(400);
    await shot(page, 'scheduler-reassign-ready');
    await page.getByRole('button', { name: 'ยืนยันการมอบหมาย' }).click({ timeout: 8000 });
    await page.waitForTimeout(2500);
    await shot(page, 'scheduler-reassign-done');
  });
  await ctx.close();
}

await browser.close();
fs.writeFileSync(path.join(OUT_ROOT, 'run-log.json'), JSON.stringify({ base: BASE, capturedAt: new Date().toISOString(), steps: log }, null, 2));
const pass = log.filter(l => l.status === 'PASS').length;
const fail = log.filter(l => l.status === 'FAIL').length;
const adv = log.filter(l => l.status === 'ADVANCED').length;
const blk = log.filter(l => l.status === 'BLOCKED').length;
console.log(`\nDONE: ${pass} PASS, ${fail} FAIL, wizard ${adv} ADVANCED / ${blk} BLOCKED, ${shotIndex} screenshots → ${OUT}`);
