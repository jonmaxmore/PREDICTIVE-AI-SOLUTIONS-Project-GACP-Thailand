/**
 * Bespoke drivers for wizard steps whose choreography a generic filler cannot infer.
 *
 * Each of these follows a recipe read out of the step's own source (workflow
 * wf_447b2275-de2), because the two steps here have controls that lie to a generic tool:
 *
 *  - The dropdowns are Radix Select — a real `<button role="combobox">` whose label IS
 *    associated (form-field.tsx:34 + select.tsx:101), with options portalled as
 *    `role="option"`. They must be clicked, never selectOption()'d or typed into.
 *  - NumberInput and FileInput render their `<label>` with NO htmlFor and no wrapping
 *    (components/ui/form-controls.tsx:23-32, 60-76), so getByLabel cannot see them; the
 *    only stable route is the `.field-block` wrapper's text.
 *  - อำเภอ/ตำบล MORPH: they are disabled text inputs until the province's district list
 *    arrives, then get REPLACED by a Radix Select (farm-info-form-sections.tsx:173-222).
 *    The driver must wait for the combobox to exist, not grab whatever is there first.
 *
 * Same law as wizard-fill.ts: only answers the profile provides are ever entered, and a
 * gate that refuses is recorded and surfaced — never clicked past.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { documentFixture, type FarmerProfile } from './g4-helpers';

export async function pickRadix(page: Page, comboName: RegExp, optionName: RegExp, note: string) {
  const combo = page.getByRole('combobox', { name: comboName }).first();
  await combo.waitFor({ state: 'visible', timeout: 30_000 });
  await combo.click();
  const opt = page.getByRole('option', { name: optionName }).first();
  await opt.waitFor({ state: 'visible', timeout: 15_000 });
  const chosen = (await opt.textContent())?.trim() ?? '';
  await opt.click();
  return `${note}: ${chosen}`;
}

function numberField(page: Page, blockText: string) {
  return page.locator('div.field-block').filter({ hasText: blockText }).locator('input[type="number"]').first();
}

/**
 * Step 5 — สถานที่ปลูกและแปลง.
 *
 * What actually blocks ถัดไป (farm-info-step.tsx validate(), :426-521): farm name,
 * address, province/district/subdistrict, 5-digit postcode, total area > 0, GPS inside
 * Thailand, every plot named with area > 0 summing ≤ the farm total, and ≥1 land-document
 * type checked WITH a server-confirmed upload. The water section renders a จำเป็น chip but
 * is never validated — set it anyway so the record is not empty.
 */
export async function fillFarmInfoStep(
  page: Page,
  p: FarmerProfile,
  nationalId: string,
  outDir: string,
  fixtureDir: string,
): Promise<string[]> {
  const log: string[] = [];
  const addr = `${p.address.houseNo} ต.${p.address.subdistrict} อ.${p.address.district} จ.${p.address.province} ${p.address.postalCode}`;

  // The step swaps itself for a spinner while master data loads.
  await page.getByText('กำลังโหลดข้อมูล GACP...').waitFor({ state: 'detached', timeout: 60_000 }).catch(() => {});

  // 1) basics — TextInputs associate their labels properly, so getByLabel works.
  await page.getByLabel(/ชื่อฟาร์ม\/สถานที่เพาะปลูก/).fill(p.farmName);
  log.push(`ชื่อฟาร์ม = ${p.farmName} (เขียนทับค่าที่ระบบเดา "ฟาร์ม${p.firstName}")`);
  await page.getByLabel(/^ที่อยู่/).first().fill(addr);
  log.push(`ที่อยู่ = ${addr}`);

  log.push(await pickRadix(page, /จังหวัด/, new RegExp(`^${p.address.province}$`), 'จังหวัด'));
  // อำเภอ morphs into a combobox only after the district list arrives — wait for it.
  log.push(await pickRadix(page, /อำเภอ|เขต/, new RegExp(p.address.district), 'อำเภอ'));
  log.push(await pickRadix(page, /ตำบล|แขวง/, new RegExp(p.address.subdistrict), 'ตำบล'));

  await page.getByLabel(/รหัสไปรษณีย์/).fill(p.address.postalCode);
  const totalArea = numberField(page, 'พื้นที่รวมทั้งหมด');
  await totalArea.fill(String(p.totalAreaSqm));
  log.push(`พื้นที่รวม = ${p.totalAreaSqm} ตร.ม.`);

  // 2) GPS — the real press a farmer standing at the farm would make. Playwright's
  // context carries granted geolocation at the farm's coordinates, so this is honest.
  await page.getByRole('button', { name: /ใช้ตำแหน่งปัจจุบัน/ }).click();
  await page.waitForTimeout(3500);
  let gpsAlertGone = !(await page.getByText('กรุณาระบุพิกัด GPS ของฟาร์ม (บังคับ)').isVisible().catch(() => false));
  if (!gpsAlertGone) {
    // Fallback: with no tile server configured the map modal renders typed lat/lng
    // fields (ManualCoordinateEntry) — still the product's own door, still a real press.
    await page.getByRole('button', { name: /เลือกจากแผนที่/ }).click();
    await page.getByLabel(/ละติจูด/).fill('18.796143');
    await page.getByLabel(/ลองจิจูด/).fill('98.953608');
    await page.getByRole('button', { name: /ยืนยัน|บันทึก|ใช้พิกัด/ }).first().click().catch(() => {});
    await page.waitForTimeout(1500);
    gpsAlertGone = !(await page.getByText('กรุณาระบุพิกัด GPS ของฟาร์ม (บังคับ)').isVisible().catch(() => false));
    log.push(`GPS via typed coordinates — alert cleared: ${gpsAlertGone}`);
  } else {
    log.push('GPS via "ใช้ตำแหน่งปัจจุบัน" — granted device location at the farm');
  }

  // 3) water — not validated by the step, but an empty water record on a GACP
  // application is not a farm anyone certifies; answer it from the profile's world.
  log.push(await pickRadix(page, /ประเภทแหล่งน้ำ/, /บ่อบาดาล/, 'แหล่งน้ำ').catch(() => 'แหล่งน้ำ: (combobox not reachable)'));
  log.push(await pickRadix(page, /ระบบให้น้ำ/, /น้ำหยด/, 'ระบบให้น้ำ').catch(() => 'ระบบให้น้ำ: (combobox not reachable)'));

  // 4) plots — plot 1 pre-exists; extra plots are one press of เพิ่มแปลง each. The plot
  // count is the farm's SHAPE (GOALS G4.2), so it comes from the profile, never guessed.
  for (let i = 1; i < p.plots.length; i++) {
    await page.getByRole('button', { name: 'เพิ่มแปลง' }).click();
    await page.waitForTimeout(600);
  }
  const nameInputs = page.getByLabel(/ชื่อแปลง/);
  const areaBlocks = page.locator('div.field-block').filter({ hasText: 'ขนาดพื้นที่' }).locator('input[type="number"]');
  for (let i = 0; i < p.plots.length; i++) {
    await nameInputs.nth(i).fill(p.plots[i].name).catch(() => {});
    await areaBlocks.nth(i).fill(String(p.plots[i].areaSqm));
    // ประเภทพื้นที่ — one combobox per plot, offered only when the applicant chose more
    // than one growing environment in step 2 (a single-method farm renders it disabled).
    // Farmer B's first walk left all three plots at the default กลางแจ้ง because this
    // driver never set it; a greenhouse plot recorded as outdoor is a wrong record, not
    // a shortcut. The label comes from the profile, the same words the step-2 press used.
    const typeLabel = p.cultivationLabelsTH[p.cultivationMethods.indexOf(p.plots[i].method)];
    if (p.cultivationMethods.length > 1 && typeLabel) {
      try {
        const combo = page.getByRole('combobox', { name: /ประเภทพื้นที่/ }).nth(i);
        await combo.waitFor({ state: 'visible', timeout: 10_000 });
        await combo.click();
        // The product's option text may carry a gloss ('อาคารควบคุม/ในร่ม' — farm-info-config.tsx);
        // anchor on the start of the label, not on the whole string.
        const opt = page.getByRole('option', { name: new RegExp(`^${typeLabel}`) }).first();
        await opt.waitFor({ state: 'visible', timeout: 10_000 });
        await opt.click();
        log.push(`แปลง ${i + 1}: ${p.plots[i].name} = ${p.plots[i].areaSqm} ตร.ม. · ประเภทพื้นที่ ${typeLabel}`);
        continue;
      } catch (err) {
        log.push(`แปลง ${i + 1}: ประเภทพื้นที่ ${typeLabel} — combobox not reachable (${String((err as Error).message).split('\n')[0].slice(0, 80)})`);
      }
    }
    log.push(`แปลง ${i + 1}: ${p.plots[i].name} = ${p.plots[i].areaSqm} ตร.ม.`);
  }

  // 5) land document — CHANOTE arrives ALREADY CHECKED (farm-info-step.tsx:154), so its
  // dropzone is on screen; clicking its header would UNCHECK it and wipe the file.
  //
  // The upload is driven through the visible "คลิกเพื่อเลือกไฟล์" button and the file
  // chooser it opens — the press a real farmer makes. The previous attempt aimed
  // setInputFiles at a container located by text and hit a leaf <div> with no input in
  // it (the actual <input type=file> is hidden behind the styled button), then waited
  // 60s for nothing. The land-doc picker is the LAST such button on the page — the water
  // section's optional picker, when present, renders earlier in DOM order.
  const deed = documentFixture(fixtureDir, {
    code: 'โฉนดที่ดิน',
    title: 'สำเนาโฉนดที่ดิน',
    description: 'เอกสารสิทธิ์ที่ดินแปลงที่ตั้งฟาร์ม (ผู้ยื่นเป็นเจ้าของที่ดิน)',
  }, p, nationalId);
  // Leave the log behind BEFORE the upload: a driver failure here used to throw away
  // everything above it, and the stale file from the previous run then misreported
  // what this run had done (farmer B, 2026-08-27).
  writeFileSync(join(outDir, 'A02-step5-actions.txt'), log.join('\n') + '\n');

  // Two-state: a re-run against a draft whose deed already sits on the card must not
  // upload it again.
  if (await page.getByText('โฉนดที่ดิน.pdf').first().isVisible().catch(() => false)) {
    log.push('เอกสารสิทธิ์ที่ดิน: โฉนดที่ดิน.pdf อยู่บนการ์ดแล้วจากรอบก่อน — ไม่อัปโหลดซ้ำ');
    writeFileSync(join(outDir, 'A02-step5-actions.txt'), log.join('\n') + '\n');
    return log;
  }
  const posted = page.waitForResponse(
    (r) => r.url().includes('draft-documents') && r.request().method() === 'POST',
    { timeout: 90_000 },
  ).catch(() => null);
  // The picker is the last such button on the page; the wizard's sticky step bar can sit
  // over it at some scroll positions, so bring it into view first and give the chooser
  // the time a cold dev server needs (30 s timed out once with the click landing fine).
  const picker = page.getByRole('button', { name: /คลิกเพื่อเลือกไฟล์/ }).last();
  await picker.scrollIntoViewIfNeeded();
  let chooser = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 60_000 }).catch(() => null),
    picker.click(),
  ]).then(([c]) => c);
  if (!chooser) {
    log.push('เอกสารสิทธิ์ที่ดิน: กดครั้งแรกไม่เปิดหน้าต่างเลือกไฟล์ใน 60 วินาที — กดซ้ำ');
    chooser = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 60_000 }),
      picker.click({ force: true }),
    ]).then(([c]) => c);
  }
  await chooser.setFiles(deed);
  const uploadResp = await posted;
  // Server-confirmed = the card now shows the uploaded FILE NAME with its remove button.
  // (An earlier version waited for the word "อัปโหลดแล้ว", which this card never renders —
  // it timed out and discarded a step that had in fact completed.)
  await page.getByText('โฉนดที่ดิน.pdf').first().waitFor({ timeout: 60_000 });
  log.push(`เอกสารสิทธิ์ที่ดิน: โฉนดที่ดิน.pdf ขึ้นบนการ์ดแล้ว (server ${uploadResp ? (uploadResp as { status(): number }).status() : '?'})`);

  writeFileSync(join(outDir, 'A02-step5-actions.txt'), log.join('\n') + '\n');
  return log;
}

/**
 * Step 6 — การเพาะปลูก.
 *
 * validate() (production-info-step.tsx:184-237) demands exactly four things: ≥1
 * propagation method, ≥1 harvested plant part, and the pre-seeded seed-source row's
 * type (already 'เมล็ด (Seed)') and supplier name — the supplier box is the silent
 * blocker, because nothing on screen says that row is mandatory. Everything else is
 * optional; the farm's record still gets honest values where the profile has them.
 */
export async function fillProductionStep(
  page: Page,
  p: FarmerProfile,
  outDir: string,
): Promise<string[]> {
  const log: string[] = [];

  // Choice cards are aria-pressed toggle buttons. Two cards on this screen carry the
  // SAME accessible name "เมล็ด (Seed)" — one under "1) วิธีการเพาะปลูก" (propagation),
  // one under "2) ส่วนของพืชที่เก็บเกี่ยว" (plant parts) — a recorded defect (F-LQA-09).
  // The sections render in heading order, so the FIRST เมล็ด button is propagation; the
  // plant-part answer uses ช่อดอก, whose name is unique. (Scoping by section text failed
  // here once: the rendered heading is "วิธีการเพาะปลูก", not the source's
  // "วิธีการขยายพันธุ์" — screen text wins over source text.)
  await page.getByRole('button', { name: 'เมล็ด (Seed)', exact: true }).first().click();
  log.push('วิธีการเพาะปลูก (ขยายพันธุ์) = เมล็ด');

  await page.getByRole('button', { name: /ช่อดอก/ }).click();
  log.push('ส่วนที่เก็บเกี่ยว = ช่อดอก (กัญชา GACP เก็บช่อดอกเป็นหลัก)');

  // The pre-seeded seed-source row: type is already 'เมล็ด (Seed)'; the supplier name is
  // the required box that stalls real users.
  await page.getByLabel(/^ชื่อผู้จำหน่าย/).first().fill('วิสาหกิจชุมชนเมล็ดพันธุ์สุเทพ');
  log.push('แหล่งที่มาเมล็ดพันธุ์: ผู้จำหน่าย = วิสาหกิจชุมชนเมล็ดพันธุ์สุเทพ');

  // Optional but honest — the cultivation record should say how this farm actually grows.
  await pickRadix(page, /วัสดุปลูก/, /ดิน/, 'วัสดุปลูก').then((s) => log.push(s)).catch(() => {});
  await pickRadix(page, /ชนิดดิน/, /ดินร่วน/, 'ชนิดดิน').then((s) => log.push(s)).catch(() => {});
  await page.getByLabel('ระยะปลูก').fill('1.5m × 1.5m').then(() => log.push('ระยะปลูก = 1.5m × 1.5m')).catch(() => {});
  await numberField(page, 'จำนวนต้นที่ปลูก').fill('80').then(() => log.push('จำนวนต้น = 80 (200 ตร.ม. ที่ระยะ 1.5×1.5)')).catch(() => {});
  await numberField(page, 'รอบการเก็บเกี่ยว/ปี').fill('3').then(() => log.push('รอบเก็บเกี่ยว/ปี = 3')).catch(() => {});
  await numberField(page, 'ผลผลิตคาดการณ์').fill('120').then(() => log.push('ผลผลิตคาดการณ์ = 120 กก./ปี')).catch(() => {});

  writeFileSync(join(outDir, 'A02-step6-actions.txt'), log.join('\n') + '\n');
  return log;
}

/**
 * Step 7 — เก็บเกี่ยว & คุณภาพ.
 *
 * validateHarvestForm (quality-control-utils.ts:34-43) demands exactly four answers:
 * harvest method, drying method, storage system, packaging type. The answers below are
 * a coherent post-harvest chain for a 200 m² outdoor cannabis farm — hand harvest, hang
 * dry, ambient storage, foil bags — not four random valid options. The six GACP control
 * self-declarations are all switched on: this farm will face a REAL on-site audit later
 * in the same walk, which is exactly where those claims get checked.
 */
export async function fillQualityControlStep(page: Page, outDir: string): Promise<string[]> {
  const log: string[] = [];

  await page.getByRole('button', { name: /เก็บด้วยมือ/ }).click();
  log.push('วิธีเก็บเกี่ยว = เก็บด้วยมือ');

  log.push(await pickRadix(page, /วิธีทำแห้ง/, /แขวนแห้ง/, 'วิธีทำแห้ง'));
  await pickRadix(page, /ระบบระบายอากาศ/, /ลมธรรมชาติ/, 'ระบายอากาศ').then((s) => log.push(s)).catch(() => {});
  log.push(await pickRadix(page, /ระบบจัดเก็บ/, /อุณหภูมิห้องปกติ/, 'ระบบจัดเก็บ'));

  await page.getByRole('button', { name: /ถุงฟอยล์|อะลูมิเนียม/ }).click();
  log.push('บรรจุภัณฑ์ = ถุงฟอยล์/อะลูมิเนียม');

  for (const control of [
    'มีขั้นตอนปฏิบัติงานมาตรฐาน', 'มีบันทึกคุณภาพ', 'มีมาตรการป้องกันการปนเปื้อน',
    'มีแผนจัดการศัตรูพืช', 'มีระบบจัดการของเสีย', 'มีระบบตามสอบย้อนกลับ',
  ]) {
    await page.getByRole('button', { name: new RegExp(control) }).first().click().catch(() => {});
  }
  log.push('มาตรการ GACP: เปิดครบ 6 ข้อ (จะถูกตรวจจริงตอนลงพื้นที่ในการเดินเดียวกันนี้)');

  writeFileSync(join(outDir, 'A02-step7-actions.txt'), log.join('\n') + '\n');
  return log;
}

/**
 * Step 8 — หลักฐาน (the documents wall).
 *
 * isComplete (documents-step.tsx:89) requires EVERY required slot filled before ถัดไป
 * does anything, and this step — unlike steps 2/4/5 — really checks file types
 * (isFileTypeAllowed, documents-step.tsx:107-116): a PDF slot takes application/pdf
 * only. Each slot is an <article> whose transparent <input type=file> covers a dashed
 * drop area, so the input can be fed directly.
 *
 * Every slot gets a REAL one-page Thai PDF titled as that slot's own document — a
 * reviewer opening any of them sees the paper the slot asked for, carrying this
 * applicant's details. Slots the de-dupe already satisfied from earlier steps simply
 * do not render (documents-step.tsx:78) and are skipped naturally.
 */
export async function fillDocumentsStep(
  page: Page,
  p: FarmerProfile,
  nationalId: string,
  outDir: string,
  fixtureDir: string,
): Promise<string[]> {
  const log: string[] = [];
  // A successful upload REPLACES the slot's <input type=file> with the uploaded-file
  // chip, which removes the article from this filtered set. Iterating it by index
  // therefore skips every other slot as the list shrinks under the loop — the first
  // attempt filled 11 of 23 that way and the step then refused to advance (silently —
  // that silence is its own recorded finding). So: always take the FIRST still-open
  // slot, upload, wait for its input to detach, repeat until none remain.
  const openSlots = page.locator('article').filter({ has: page.locator('input[type="file"]') });
  const initial = await openSlots.count();
  log.push(`ช่องเอกสารที่ยังเปิดรับบนหน้านี้: ${initial}`);

  for (let guard = 0; guard < initial + 5; guard++) {
    if ((await openSlots.count()) === 0) break;
    // PIN the DOM node. `openSlots.first()` is a LIVE locator: the moment a slot closes
    // it re-resolves to the next open article, so any "wait until this input is gone"
    // check silently watches a different input. That mistake made the previous run
    // declare a slot broken right after the server had accepted its file.
    const handle = await openSlots.first().elementHandle();
    if (!handle) break;
    const title = ((await handle.$eval('h3, h4, p, strong', (el) => el.textContent || '').catch(() => '')) || `เอกสารช่องที่ ${guard + 1}`)
      .replace(/\s+/g, ' ').trim().slice(0, 80);
    const inputHandle = await handle.$('input[type="file"]');
    if (!inputHandle) { log.push(`  ข้าม: "${title}" ไม่มี input`); await handle.dispose(); continue; }

    const pdf = documentFixture(fixtureDir, { code: `หลักฐาน-${guard + 1}`, title, description: title }, p, nationalId);
    const posted = page.waitForResponse(
      (r) => r.url().includes('draft-documents') && r.request().method() === 'POST',
      { timeout: 120_000 },
    ).catch(() => null);
    await inputHandle.setInputFiles(pdf);
    const resp = await posted;
    const status = resp ? (resp as { status(): number }).status() : 0;
    // Done = THIS pinned article no longer contains a file input (the chip replaced it).
    const closed = await page.waitForFunction(
      (el) => !el.isConnected || !el.querySelector('input[type="file"]'),
      handle,
      { timeout: 30_000 },
    ).then(() => true).catch(() => false);
    log.push(`  ${title} ← PDF (server ${status || 'no response'} · slot ${closed ? 'ปิดแล้ว' : 'ยังเปิดอยู่!'})`);
    await handle.dispose();
    if (!closed) {
      log.push(`  → หยุด: ช่อง "${title}" server ตอบ ${status} แต่การ์ดไม่ปิด — ต้องดูด้วยตา ไม่วนซ้ำ`);
      break;
    }
  }
  log.push(`ช่องที่ยังเหลือเปิดอยู่หลังจบ: ${await openSlots.count()}`);

  writeFileSync(join(outDir, 'A02-step8-actions.txt'), log.join('\n') + '\n');
  return log;
}

/**
 * Step 9 — ตรวจทานและส่ง, then the REAL submit on the preview page.
 *
 * The review page carries its own completeness verdict ("สถานะการตรวจทาน") and a
 * per-section fix list. This driver does not fight that verdict: it reads the page's own
 * numbers off the DOM, reports them, presses the three confirmation cards, and presses
 * "ยืนยันและไปหน้าพรีวิว" ONLY if the page enables it. A submit button that stays
 * disabled is the product speaking, and what it says goes into the report verbatim
 * (operator ruling: ไม่ผ่าน = มาคุยกัน ไม่ใช่สั่งให้ผ่าน).
 *
 * The preview page's "สร้างรายการชำระงวดที่ 1" is the door that walks
 * DRAFT→SUBMITTED→PENDING_DOC_FEE in one transaction. Its 500-flakiness under pooler
 * pressure is documented (F-SUBMIT-500-FLAKY, root-caused this session to session-pooler
 * exhaustion); the backend now runs on the transaction pooler, so this walk presses ONCE
 * and retries only on a NON-200 response, never blindly.
 *
 * F-G4-64 (final round, last items): with the checkout UI flag on, that press no longer
 * asks for a phase-1 payment record at all — the quotation gate now guards
 * POST /payments/create, and no applicant can have accepted a document that did not
 * exist one HTTP call ago (preview/client-view.tsx). The press files the application and
 * routes to /health/payments, where the ยอมรับ tick and the pay door are. This driver's
 * verdict is unchanged because it always read the SUBMIT response: 200 = the two-hop
 * committed, and a01 then asks the database for PENDING_DOC_FEE and the quotation row.
 */
export async function fillReviewAndSubmit(
  page: Page,
  outDir: string,
): Promise<{ log: string[]; submitted: boolean }> {
  const log: string[] = [];

  // The page's own completeness numbers, read off the screen.
  const readStat = async (label: string) => {
    const row = page.getByText(label, { exact: false }).first();
    if (!(await row.isVisible().catch(() => false))) return '(ไม่พบ)';
    return (await row.evaluate((el) => {
      const parent = el.closest('div');
      return parent?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    })).slice(0, 120);
  };
  log.push(`สถานะการตรวจทาน: ${await readStat('สถานะการตรวจทาน')}`);
  log.push(`เอกสารบังคับ: ${await readStat('จำนวนเอกสารบังคับ')}`);
  log.push(`ยังขาด: ${await readStat('จำนวนเอกสารบังคับที่ยังขาด')}`);

  // The three confirmations are the applicant's own act. They render as
  // role="checkbox" toggle cards (review-step.tsx:366-368) — an earlier version
  // looked them up as role="button", missed all three, swallowed the miss in a
  // catch(), and then logged "pressed" anyway. So: match the real role, and after
  // every press VERIFY aria-checked went true. A press is a claim; the attribute
  // is the evidence.
  for (const name of [/ยืนยันว่าข้อมูลและเอกสารถูกต้อง/, /ยอมรับเงื่อนไขและมาตรฐาน GACP/, /รับทราบขั้นตอนพรีวิว/]) {
    const box = page.getByRole('checkbox', { name }).first();
    await box.click();
    await page.waitForTimeout(250);
    const checked = await box.getAttribute('aria-checked');
    log.push(`ยินยอม "${String(name).slice(1, 30)}..." → aria-checked=${checked}`);
    if (checked !== 'true') {
      log.push('  → หยุด: กดแล้วแต่ค่าไม่ติด — ต้องดูด้วยตา');
      writeFileSync(join(outDir, 'A02-step9-actions.txt'), log.join('\n') + '\n');
      return { log, submitted: false };
    }
  }

  const confirmBtn = page.getByRole('button', { name: /ยืนยันและไปหน้าพรีวิว/ });
  const enabled = await confirmBtn.isEnabled().catch(() => false);
  log.push(`ปุ่ม "ยืนยันและไปหน้าพรีวิว": ${enabled ? 'กดได้' : 'ยัง DISABLED'}`);
  if (!enabled) {
    const alerts = await page.locator('[role=alert]').allInnerTexts().catch(() => []);
    log.push(`สิ่งที่หน้าจอบอกว่าขวางอยู่: ${alerts.join(' | ') || '(ไม่มีข้อความ)'}`);
    writeFileSync(join(outDir, 'A02-step9-actions.txt'), log.join('\n') + '\n');
    return { log, submitted: false };
  }

  await confirmBtn.click();
  await page.waitForURL('**/health/applications/preview**', { timeout: 200_000 });
  await page.waitForLoadState('domcontentloaded');
  log.push(`ถึงหน้าพรีวิว: ${page.url()}`);

  // The submit door. 200 = the 2-hop transition committed; anything else = report.
  const submitBtn = page.getByRole('button', { name: /ยื่นคำขอแล้วไปหน้าชำระเงินงวดที่s*1|สร้างรายการชำระงวดที่\s*1/ });
  await submitBtn.waitFor({ state: 'visible', timeout: 60_000 });
  let submitted = false;
  for (let attempt = 1; attempt <= 3 && !submitted; attempt++) {
    const resp = page.waitForResponse(
      (r) => r.url().includes('/applications/submit') && r.request().method() === 'POST',
      { timeout: 120_000 },
    ).catch(() => null);
    await submitBtn.click();
    const r = await resp;
    const status = r ? r.status() : 0;
    log.push(`กดยื่น (ครั้งที่ ${attempt}): POST /applications/submit → ${status || 'ไม่มี response'}`);
    submitted = status === 200;
    if (!submitted) {
      const body = r ? await r.text().catch(() => '') : '';
      log.push(`  ตอบกลับ: ${body.slice(0, 300)}`);
      await page.waitForTimeout(5000);
    }
  }
  writeFileSync(join(outDir, 'A02-step9-actions.txt'), log.join('\n') + '\n');
  return { log, submitted };
}
