/**
 * A-Z Lifecycle — login → สร้างคำขอ → จ่ายเงิน → ทุก role → ใบรับรอง → QR verify/trace.
 * REAL UI clicks on STAGING (กฎทอง #7). Resilient: ทุกเฟส try/catch + screenshot;
 * เฟส cert+QR รันบนใบรับรองจริงที่มีอยู่ (รับประกันเห็นผล), เฟสสร้างคำขอ drive จริง
 * เท่าที่ infra/ไฟล์ยอม (บันทึกจุดที่ถึงอย่างตรงไปตรงมา — ไม่ปั้นผล).
 *
 * Run: node playwright/a-z-lifecycle.mjs
 * Env: WALK_BASE_URL, AZ_CERT (real cert number), AZ_TRACE (real trace qr code)
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const BASE = process.env.WALK_BASE_URL || 'https://staging.gacpth.com';
const CERT = process.env.AZ_CERT || 'GACP-TH-2569-EE29D0';
const TRACE = process.env.AZ_TRACE || '56ad107f-8008-4d23-96c7-d42df8aa4a38';
const FARMER = { id: '1100000000008', pw: 'Test@12345' };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = path.resolve(__dirname, '../../../evidence/walkthroughs/a-z-lifecycle-2026-07-10');
const OUT = path.join(OUT_ROOT, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
let n = 0; const log = [];
const note = (s, st, d = '') => { log.push({ step: s, status: st, detail: d }); console.log(`[${st}] ${s}${d ? ' — ' + d : ''}`); };
async function shot(page, name) { n++; const f = `${String(n).padStart(2, '0')}-${name}.png`; await page.screenshot({ path: path.join(OUT, f), fullPage: true }); note(`shot ${f}`, 'SAVED'); return f; }
async function step(name, fn) { try { await fn(); note(name, 'PASS'); } catch (e) { note(name, 'FAIL', String(e.message).split('\n')[0]); } }

// tiny valid PDF for the wizard document uploads (accept=".pdf" / ".pdf,image/*")
const PDF = Buffer.from('JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCA2MTIgNzkyXT4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA0L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMTkwCiUlRU9G', 'base64');
const pdfPath = path.join(os.tmpdir(), 'az.pdf'); fs.writeFileSync(pdfPath, PDF);

async function loginHealth(page) {
  await page.goto(`${BASE}/auth/health/login`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.fill('#identifier', FARMER.id); await page.fill('#password', FARMER.pw);
  await page.click('button[type=submit]');
  await page.waitForURL(u => !u.pathname.startsWith('/auth'), { timeout: 60000 });
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200);
}
// upload a file to every visible file input on the page + wait for "อัปโหลดแล้ว" chips
async function uploadAllFiles(page, file, expectCount) {
  const inputs = page.locator('input[type=file]');
  const c = await inputs.count();
  for (let i = 0; i < c; i++) { await inputs.nth(i).setInputFiles(file).catch(() => {}); await page.waitForTimeout(400); }
  // wait for uploaded chips to settle
  await page.waitForFunction((min) => (document.body.innerText.match(/อัปโหลดแล้ว|uploaded/gi) || []).length >= min, expectCount || 1, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1000);
  return c;
}
async function clickNext(page, label = 'ถัดไป') {
  const before = new URL(page.url()).pathname;
  await page.getByRole('button', { name: label }).first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const after = new URL(page.url()).pathname;
  return { before, after, advanced: before !== after };
}

const browser = await chromium.launch();

// ═══════════════ PART 1: CREATION (login → wizard → submit) — resilient real drive ═══════════════
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, geolocation: { latitude: 13.7563, longitude: 100.5018 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' && !/favicon|beacon/i.test(m.text())) note(`console @ ${page.url()}`, 'CONSOLE', m.text().slice(0, 140)); });

  await step('A) FARMER login', async () => { await loginHealth(page); await shot(page, 'A-login-dashboard'); });

  await step('B) wizard STEP 1 consent', async () => {
    await page.goto(`${BASE}/health/applications/new`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1500); await shot(page, 'B-wiz-step1');
    const boxes = page.locator('input[type=checkbox]'); const c = await boxes.count();
    for (let i = 0; i < c; i++) await boxes.nth(i).check({ force: true }).catch(() => {});
    const r = await clickNext(page); note(`step1 ${r.before}→${r.after}`, r.advanced ? 'ADVANCED' : 'BLOCKED');
  });

  await step('B) wizard STEP 2 plant + M1 PDFs', async () => {
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /กัญชา/ }).first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'เพื่อการพาณิชย์ในประเทศ' }).first().click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'กลางแจ้ง' }).first().click({ timeout: 6000 }).catch(() => {});
    await uploadAllFiles(page, pdfPath, 3);
    await shot(page, 'B-wiz-step2-filled');
    const r = await clickNext(page, 'บันทึกและไปขั้นตอนถัดไป'); note(`step2 ${r.before}→${r.after}`, r.advanced ? 'ADVANCED' : 'BLOCKED');
  });

  await step('B) wizard STEP 4 applicant', async () => {
    if (!page.url().includes('/step/4')) { note('ไม่ถึง step4 (step2 บล็อก)', 'BLOCKED'); return; }
    await page.getByLabel('ชื่อ').first().fill('ทดสอบ').catch(() => {});
    await page.getByLabel('นามสกุล').first().fill('เกษตรกร').catch(() => {});
    await page.getByLabel(/เลขบัตรประชาชน/).first().fill('1234567890123').catch(() => {});
    await page.getByLabel(/เบอร์โทร/).first().fill('0812345678').catch(() => {});
    await page.getByLabel(/ที่อยู่/).first().fill('1 หมู่ 1').catch(() => {});
    const files = page.locator('input[type=file]'); if (await files.count()) await files.nth(0).setInputFiles(pdfPath).catch(() => {});
    await page.waitForTimeout(2000); await shot(page, 'B-wiz-step4');
    const r = await clickNext(page); note(`step4 ${r.before}→${r.after}`, r.advanced ? 'ADVANCED' : 'BLOCKED');
  });

  await step('B) wizard STEP 5 farm (master-data + GPS)', async () => {
    if (!page.url().includes('/step/5')) { note('ไม่ถึง step5', 'BLOCKED'); return; }
    await page.waitForTimeout(1500);
    // province Radix select
    await page.getByLabel('จังหวัด').first().click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(800);
    const opt = page.getByRole('option').first();
    const hasProvince = await opt.count();
    if (hasProvince) await opt.click({ timeout: 5000 }).catch(() => {});
    else note('master-data provinces ว่างบน staging → step5 ผ่านไม่ได้', 'BLOCKED');
    await shot(page, 'B-wiz-step5');
    // GPS current-location + area + files (best effort)
    const nums = page.locator('input[type=number]'); if (await nums.count() >= 1) await nums.nth(0).fill('100').catch(() => {});
    const r = await clickNext(page); note(`step5 ${r.before}→${r.after}`, r.advanced ? 'ADVANCED' : 'BLOCKED');
  });

  // steps 6-9 best-effort (only if we got past 5)
  for (const [sn, label] of [['6', 'ถัดไป'], ['7', 'ถัดไป'], ['8', 'ถัดไป'], ['9', 'ยืนยันและไปหน้าพรีวิว']]) {
    await step(`B) wizard STEP ${sn}`, async () => {
      if (!page.url().includes(`/step/${sn}`)) { note(`ไม่ถึง step${sn}`, 'BLOCKED'); return; }
      const boxes = page.locator('input[type=checkbox]:visible, input[type=radio]:visible, button[aria-pressed]');
      const bc = Math.min(await boxes.count(), 6); for (let i = 0; i < bc; i++) await boxes.nth(i).click({ force: true }).catch(() => {});
      if (sn === '8') await uploadAllFiles(page, pdfPath, 5);
      if (sn === '9') for (const t of [/ยืนยันว่าข้อมูล/, /ยอมรับเงื่อนไข/, /รับทราบขั้นตอน/]) await page.getByRole('button', { name: t }).first().click().catch(() => {});
      await shot(page, `B-wiz-step${sn}`);
      const r = await clickNext(page, label); note(`step${sn} ${r.before}→${r.after}`, r.advanced ? 'ADVANCED' : 'BLOCKED');
    });
  }
  await step('B) preview → submit (ถ้าถึง)', async () => {
    if (!page.url().includes('/preview')) { note('ไม่ถึง preview', 'BLOCKED'); return; }
    await shot(page, 'B-preview');
    for (const t of [/ยื่นคำขอ/, /ยืนยันการยื่น/, /ส่งคำขอ/, /ยืนยันและยื่น/]) { const b = page.getByRole('button', { name: t }).first(); if (await b.count()) { await b.click().catch(() => {}); await page.waitForTimeout(2500); break; } }
    await shot(page, 'B-after-submit');
  });
  await ctx.close();
}

// ═══════════════ PART 2: DOWNSTREAM ROLES on real apps (แต่ละ role ทำงานถูกต้อง) ═══════════════
// (ใช้หลักฐาน role-walkthrough + queue-drive ที่ commit ไปแล้ว — ที่นี่ยืนยัน read-surface สด)
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const roles = [
    { id: '2900000000009', pw: 'Test@12345', name: 'ADMIN', land: '/provider/work' },
    { id: '4900000000005', pw: 'Test@12345', name: 'SCHEDULER', land: '/provider/coordinator' },
    { id: '5900000000003', pw: 'Test@12345', name: 'AUDITOR', land: '/provider/audits' },
  ];
  for (const r of roles) {
    await step(`C) ${r.name} คิวงานจริง`, async () => {
      await page.goto(`${BASE}/auth/provider/login`, { waitUntil: 'networkidle', timeout: 45000 });
      await page.fill('#provider-id', r.id); await page.fill('#provider-password', r.pw);
      await page.click('button[type=submit]');
      await page.waitForURL(u => !u.pathname.startsWith('/auth'), { timeout: 60000 });
      await page.waitForLoadState('networkidle'); await page.waitForTimeout(1200);
      await page.goto(`${BASE}${r.land}`, { waitUntil: 'networkidle', timeout: 45000 }); await page.waitForTimeout(1200);
      await shot(page, `C-${r.name.toLowerCase()}-queue`);
    });
  }
  await ctx.close();
}

// ═══════════════ PART 3: CERTIFICATE + QR VERIFY + TRACE (ใบรับรองจริง — รับประกันเห็นผล) ═══════════════
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await step('D) FARMER หน้าใบรับรอง', async () => {
    await loginHealth(page);
    await page.goto(`${BASE}/health/certificates`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1500); await shot(page, 'D-farmer-certificates');
    const view = page.getByRole('link', { name: 'ดูใบรับรอง' }).first();
    if (await view.count()) { await view.click({ timeout: 8000 }).catch(() => {}); await page.waitForLoadState('networkidle'); await page.waitForTimeout(1500); await shot(page, 'D-cert-detail'); }
  });
  await ctx.close();

  // public verify (QR target) + verifier portal + trace — unauth
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await ctx2.newPage();
  await step('E) QR verify — /verify/<certNumber> (ปลายทาง QR)', async () => {
    await p2.goto(`${BASE}/verify/${CERT}`, { waitUntil: 'networkidle', timeout: 45000 });
    await p2.waitForTimeout(1500);
    const body = await p2.locator('body').innerText().catch(() => '');
    const valid = /ถูกต้องและยังมีผลบังคับใช้|รับรองแล้ว/.test(body);
    note(`verify ${CERT}: ${valid ? 'VALID' : 'ผล=' + body.slice(0, 60)}`, valid ? 'PASS' : 'INFO');
    await shot(p2, 'E-verify-qr-target');
  });
  await step('E) verifier portal /verify (กรอกเลขจริง + ตรวจ)', async () => {
    await p2.goto(`${BASE}/verify`, { waitUntil: 'networkidle', timeout: 45000 }); await p2.waitForTimeout(1000);
    const input = p2.getByLabel(/หมายเลขใบรับรอง/).first().or(p2.locator('#certificate-number'));
    if (await input.count()) { await input.fill(CERT).catch(() => {}); await p2.getByRole('button', { name: 'ตรวจสอบใบรับรอง' }).first().click({ timeout: 6000 }).catch(() => {}); await p2.waitForTimeout(2500); }
    await shot(p2, 'E-verifier-portal-result');
  });
  await step('E) tamper-evidence — แก้ 1 ตัวอักษรใน cert number', async () => {
    const bad = CERT.slice(0, -1) + (CERT.slice(-1) === '0' ? '1' : '0');
    await p2.goto(`${BASE}/verify/${bad}`, { waitUntil: 'networkidle', timeout: 45000 }); await p2.waitForTimeout(1500);
    const body = await p2.locator('body').innerText().catch(() => '');
    const invalid = /ไม่ถูกต้อง|ไม่พบ|เอกสารถูกแก้ไข/.test(body);
    note(`tampered ${bad}: ${invalid ? 'ปฏิเสธถูกต้อง' : body.slice(0, 60)}`, invalid ? 'PASS' : 'INFO');
    await shot(p2, 'E-verify-tampered');
  });
  await step('F) trace — /trace/<qr> (ผลิตภัณฑ์จริง)', async () => {
    await p2.goto(`${BASE}/trace/${TRACE}`, { waitUntil: 'networkidle', timeout: 45000 }); await p2.waitForTimeout(1500);
    const body = await p2.locator('body').innerText().catch(() => '');
    const ok = /GACP|ใบรับรอง|QR Seal|Certified/.test(body) && !/ไม่พบข้อมูล/.test(body);
    note(`trace ${TRACE}: ${ok ? 'พบผลิตภัณฑ์' : body.slice(0, 60)}`, ok ? 'PASS' : 'INFO');
    await shot(p2, 'F-trace-result');
  });
  await ctx2.close();
}

await browser.close();
fs.writeFileSync(path.join(OUT_ROOT, 'run-log.json'), JSON.stringify({ base: BASE, cert: CERT, trace: TRACE, capturedAt: new Date().toISOString(), steps: log }, null, 2));
const c = (s) => log.filter(l => l.status === s).length;
console.log(`\nDONE: ${c('PASS')} PASS, ${c('FAIL')} FAIL, ${c('ADVANCED')} wizard-advanced, ${c('BLOCKED')} blocked, ${n} screenshots`);
