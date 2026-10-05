/**
 * G4 · B01 — farmer A's FIRST planting cycle, walked end to end through the real
 * planting UI: create (backdated to the G4 timeline) → plot QR → plant units →
 * care activities → the harvest modal that creates batches AND bags in one press →
 * the public trace read-back.
 *
 * G4.3/G4.7: business dates are backdated (day 1 = 2024-01-01; cycle 1 starts
 * 2024-01-15); createdAt stays real — the scan page saying "บันทึกย้อนหลัง N วัน" is
 * the system working, not failing. The DateInputs are native type=date with no min,
 * so every backdate here is a REAL keyboard entry a farmer could make.
 *
 * This first cycle doubles as the recipe prover for the remaining eight: every
 * surface is control-dumped and LQA-captured, and each modal's exact fields are
 * recorded before filling. Stalls stop the walk and name the control (จุดต่อจุด).
 */
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { FARMERS, seg, shot, readVars, saveVar, g4psql, g4Login, dumpControls, captureConsole, pickFarmer } from './g4-helpers';
import { lqaCapture } from './lqa';

const OUT = seg('b01');
const P = FARMERS[pickFarmer()];

const CYCLE: { name: string; start: string; expectedHarvest: string; targetPlants: number } = {
  name: 'รอบที่ 1/2567 ฤดูแล้ง',
  start: '2024-01-15',
  expectedHarvest: '2024-04-25', // ~100 days — cannabis full cycle (G4.7)
  targetPlants: 80,
};

test('B01 cycle 1: create (backdated) → QR → plant units → activities → harvest+lots → trace', async ({ page }) => {
  test.setTimeout(25 * 60 * 1000);
  const vars = readVars();
  const FARMER_ID = vars[`${P.varPrefix}_ID`];
  const dumpConsole = captureConsole(page, OUT, 'B01');

  await g4Login(page, { kind: 'health', id: FARMER_ID, pw: process.env.G4_PW_A || '' });

  // Resume-aware: cycle 1 may already exist from a prior pass (its create returned 201
  // before a later stage failed). Re-creating would also be refused by R15 — one open
  // cycle per plot — so an existing row short-circuits straight to the detail stages.
  const existing = JSON.parse(g4psql(
    `SELECT id, "startDate" FROM planting_cycles WHERE "cycleName"='${CYCLE.name}' ORDER BY "createdAt" DESC LIMIT 1;`,
  ));

  let cycle: { id: string; startDate: string } | null = existing[0] ?? null;
  if (!cycle) {
  // ── the planting home, then the create form ────────────────────────────────
  await page.goto('/health/planting');
  await page.waitForLoadState('domcontentloaded');
  // Skeleton loaders own this screen until data lands — wait for the REAL control,
  // not a fixed delay (the fixed-delay version screenshotted a skeleton and died).
  const createEntry = page.getByRole('link', { name: /เริ่มรอบการปลูกใหม่|สร้างรอบปลูก/ }).or(page.getByRole('button', { name: /เริ่มรอบการปลูกใหม่|สร้างรอบปลูก/ })).first();
  await createEntry.waitFor({ state: 'visible', timeout: 200_000 });
  await shot(page, OUT, 'B01-01-planting-home.png');
  await lqaCapture(page, OUT, 'B01-planting-home', [P.farmName]);

  await createEntry.click();
  await page.waitForURL('**/health/planting/new**', { timeout: 200_000 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);
  await dumpControls(page, OUT, 'B01-new-cycle-controls.json');
  await lqaCapture(page, OUT, 'B01-new-cycle', [P.farmName]);

  // ── the form: farm → certificate → species → name → dates → plots ──────────
  const pickCombo = async (label: RegExp, option: RegExp, note: string) => {
    const combo = page.getByRole('combobox', { name: label }).first();
    await combo.waitFor({ state: 'visible', timeout: 30_000 });
    await combo.click();
    const opt = page.getByRole('option', { name: option }).first();
    await opt.waitFor({ state: 'visible', timeout: 15_000 });
    const text = (await opt.textContent())?.trim() ?? '';
    await opt.click();
    return `${note}: ${text}`;
  };
  const log: string[] = [];
  log.push(await pickCombo(/ฟาร์ม/, new RegExp(P.farmName), 'ฟาร์ม'));
  log.push(await pickCombo(/ใบรับรองที่ใช้งานได้/, /GACP-TH-2569-CAE820/, 'ใบรับรอง'));
  log.push(await pickCombo(/ชนิดพืช/, /กัญชา/, 'ชนิดพืช'));

  await page.getByLabel('ชื่อรอบปลูก').fill(CYCLE.name);
  await page.getByLabel('วันเริ่มปลูก').fill(CYCLE.start);
  await page.getByLabel('วันคาดเก็บเกี่ยว').fill(CYCLE.expectedHarvest).catch(() => {});
  log.push(`ชื่อรอบ=${CYCLE.name} เริ่ม=${CYCLE.start} (ย้อนหลังผ่าน DateInput จริง — ไม่มี min)`);

  // Plot assignment — driven on the TABLE row, the surface that actually feeds the
  // submit. The page renders the assignment TWICE (a desktop table with unlabeled
  // spinbuttons and a labeled card list); filling the labeled card left the table's
  // target at 0 and the server refused with plannedPlantCount=0. The row's last
  // spinbutton is จำนวนต้นเป้าหมาย (column order: พื้นที่ใช้งาน, เป้าหมาย).
  const plotRow = page.getByRole('row', { name: new RegExp(P.plots[0].name) }).first();
  await plotRow.waitFor({ state: 'visible', timeout: 30_000 });
  const rowCheckbox = plotRow.getByRole('checkbox').first();
  await rowCheckbox.check();
  await expect(rowCheckbox).toBeChecked({ timeout: 10_000 });
  // Ticking the row auto-fills the RECOMMENDED plant count, and the screen says so
  // ("ระบบคำนวณค่าแนะนำจากพื้นที่และรูปแบบการปลูกให้ก่อน"). MANUALLY EDITING that number is
  // broken in this build — fill() gets bounced back to 0 by the controlled onChange and
  // real keystrokes come out as "00" (two distinct failure signatures, recorded as a
  // product finding) — so the walk does what a real farmer does when the box resists:
  // accepts the system's own recommendation, and carries THAT number forward.
  const targetSpin = plotRow.getByRole('spinbutton').last();
  await expect(targetSpin, 'the recommendation landed (>0)').not.toHaveValue('0', { timeout: 15_000 });
  const recommended = await targetSpin.inputValue();
  CYCLE.targetPlants = Math.max(1, Number(recommended) || CYCLE.targetPlants);
  log.push(`เป้าหมายต้น: ใช้ค่าแนะนำของระบบ = ${CYCLE.targetPlants} (ช่องแก้ตัวเลขพัง — บันทึกเป็นบั๊กสินค้าแยก)`);
  log.push(`แปลง: ${P.plots[0].name} · เป้าหมาย ${CYCLE.targetPlants} ต้น (ยืนยันค่าบนแถวตารางแล้ว)`);
  await shot(page, OUT, 'B01-02-form-filled.png');

  const createResp = page.waitForResponse(
    (r) => r.url().includes('/planting-cycles') && r.request().method() === 'POST',
    { timeout: 120_000 },
  ).catch(() => null);
  await page.getByRole('button', { name: /สร้างรอบปลูก|บันทึก/ }).last().click();
  const cr = await createResp;
  log.push(`POST /planting-cycles → ${cr ? cr.status() : 'no response'}`);
  writeFileSync(join(OUT, 'B01-create-log.txt'), log.join('\n') + '\n');
  expect(cr && cr.status() < 300, 'cycle created').toBeTruthy();

  // The row is the proof — and the QR should have been minted in the same press.
  for (let i = 0; i < 10 && !cycle; i++) {
    const rows = JSON.parse(g4psql(
      `SELECT id, "startDate", status FROM planting_cycles WHERE "cycleName"='${CYCLE.name}' ORDER BY "createdAt" DESC LIMIT 1;`,
    ));
    if (rows.length) cycle = rows[0];
    else await page.waitForTimeout(2000);
  }
  expect(cycle, 'planting_cycles row exists').toBeTruthy();
  expect(cycle!.startDate.slice(0, 10), 'startDate backdated to the G4 timeline').toBe(CYCLE.start);
  } else {
    writeFileSync(join(OUT, 'B01-resumed.txt'), 'cycle already existed — resumed at detail stages\n');
  }
  saveVar(`${P.varPrefix}_CYCLE1`, cycle!.id);

  const cyclePlots = JSON.parse(g4psql(
    `SELECT cp.id, q."qrCode", p."plotCode" FROM planting_cycle_plots cp JOIN plots p ON p.id = cp."plotId" LEFT JOIN trace_qr_security q ON q."entityType"='PLOT_CYCLE' AND q."entityId"=cp.id WHERE cp."cycleId"='${cycle!.id}';`,
  ));
  writeFileSync(join(OUT, 'B01-cycle-plots.txt'), JSON.stringify(cyclePlots, null, 2));
  expect(cyclePlots.length, 'the plot is bound to the cycle').toBe(1);

  // ── cycle detail: plot QR tab + plant units ────────────────────────────────
  await page.goto(`/health/planting/${cycle!.id}`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);
  await shot(page, OUT, 'B01-03-cycle-detail.png');
  await lqaCapture(page, OUT, 'B01-cycle-detail', [P.farmName, CYCLE.name]);

  const qrTab = page.getByRole('tab', { name: /แปลงและ QR/ });
  if (await qrTab.isVisible().catch(() => false)) {
    await qrTab.click();
    await expect(qrTab).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    await page.waitForTimeout(1500);
    await shot(page, OUT, 'B01-04-plot-qr.png');
    await lqaCapture(page, OUT, 'B01-plot-qr-tab');
  }

  // R8 (approved spec): per-plant tracking is RETIRED, and as of 2026-08-25 the
  // removal is done — there is no สร้างรายต้น door left to avoid. Finding F-G4-20
  // ("the server still auto-mints PlantUnits on cycle create") is CLOSED: the
  // generator, its routes and its UI are deleted, and cycle create now issues no
  // PlantUnit write at all. Pinned by
  // apps/backend/__tests__/integration/cycle-create-mints-zero-plant-units.test.js.

  // ── two care activities, backdated inside the cycle window ─────────────────
  await page.goto(`/health/planting/${cycle!.id}/activities`);
  await page.waitForLoadState('domcontentloaded');
  // The page compiles+fetches before rendering its form — wait for a real control.
  await page.locator('input, select, textarea, button:has-text("บันทึก"), button:has-text("เพิ่ม")').first().waitFor({ state: 'visible', timeout: 200_000 });
  await dumpControls(page, OUT, 'B01-activities-controls.json');
  await lqaCapture(page, OUT, 'B01-activities');

  // The quick-log form (dumped anatomy): press the PLOT button, press the ACTIVITY-TYPE
  // button, fill the dated details, then "บันทึกกิจกรรม" — which stays disabled until
  // plot+type are chosen (why the earlier generic press timed out).
  const activities = [
    { date: '2024-02-01', type: 'ให้ปุ๋ย', qty: '5', unit: 'กก.', method: 'หว่านรอบโคนต้นแล้วรดน้ำตาม', weather: 'แจ่มใส', note: 'ปุ๋ยอินทรีย์รอบแรก ระยะเลี้ยงต้น' },
    { date: '2024-03-05', type: 'ตรวจประเมินแปลง', qty: '', unit: '', method: 'เดินตรวจทุกแถว เก็บตัวอย่างใบ', weather: 'ครึ้มฟ้า', note: 'เข้าระยะออกดอก ไม่พบศัตรูพืช กำจัดวัชพืชร่วมด้วย' },
  ];
  const actLog: string[] = [];
  // Fail FAST on the error boundary. Without this the walk spends 60s waiting for a
  // control on a page that has already crashed, and reports "not found" for what is
  // really "the screen died" — the same lie the user is told ("ลองใหม่อีกครั้ง").
  const guard = async (step: string) => {
    if (await page.getByRole('heading', { name: 'เกิดข้อผิดพลาด' }).isVisible().catch(() => false)) {
      await shot(page, OUT, 'B01-CRASH-activities.png');
      const errs = dumpConsole();
      const shown = await page.locator('p').allInnerTexts().catch(() => []);
      writeFileSync(join(OUT, 'B01-CRASH-activities.txt'),
        `crashed right after: ${step}\non-screen: ${shown.slice(0, 6).join(' | ')}\nconsole:\n${errs.join('\n')}\n`);
      throw new Error(`activities page crashed right after "${step}" — see B01-CRASH-activities.txt`);
    }
  };

  for (const act of activities) {
    // เลือกแปลง is a Radix COMBOBOX already defaulted to this farm's only plot — it was
    // never a button (my dumpControls lists [role=button] and comboboxes together, which
    // is how the walk went looking for the wrong control and waited 60s for it). The
    // activity type IS a button row.
    const plotCombo = page.getByRole('combobox', { name: 'เลือกแปลง' });
    await expect(plotCombo).toContainText(P.plots[0].name, { timeout: 30_000 });
    await guard('opened the activities form');
    await page.getByRole('button', { name: act.type, exact: true }).click();
    await guard(`chose activity type ${act.type}`);
    await page.getByLabel('วันที่ทำกิจกรรม').fill(act.date, { timeout: 15_000 });
    await guard(`filled the date ${act.date}`);
    if (act.qty) {
      await page.getByLabel('ปริมาณ').fill(act.qty, { timeout: 15_000 });
      await guard('filled ปริมาณ');
      await page.getByLabel('หน่วย').fill(act.unit, { timeout: 15_000 });
      await guard('filled หน่วย');
    }
    await page.getByLabel('วิธีดำเนินการ').fill(act.method, { timeout: 15_000 });
    await guard('filled วิธีดำเนินการ');
    await page.getByLabel('สภาพอากาศ').fill(act.weather, { timeout: 15_000 });
    await page.getByLabel('หมายเหตุ').fill(act.note, { timeout: 15_000 });
    await guard('filled the remaining details');
    // The page has crashed here before (React error boundary + "Cannot read properties
    // of null"). Catch it the moment it happens, with the console attached, instead of
    // waiting 60s for a control that no longer exists.
    if (await page.getByText('เกิดข้อผิดพลาด').first().isVisible().catch(() => false)) {
      await shot(page, OUT, 'B01-CRASH-activities.png');
      const errs = dumpConsole();
      throw new Error(`activities page crashed while filling ${act.type}: ${errs.slice(-3).join(' || ').slice(0, 400)}`);
    }
    const saveBtn = page.getByRole('button', { name: 'บันทึกกิจกรรม' });
    await expect(saveBtn, 'save enables once plot+type are chosen').toBeEnabled({ timeout: 15_000 });
    const saveResp = page.waitForResponse(
      (r) => /activities|cultivation/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 60_000 },
    ).catch(() => null);
    await saveBtn.click();
    const sr = await saveResp;
    actLog.push(`${act.date} ${act.type} → ${sr ? sr.status() : 'no response'}`);
    await page.waitForTimeout(2000);
  }
  writeFileSync(join(OUT, 'B01-activities-log.txt'), actLog.join('\n') + '\n');
  await shot(page, OUT, 'B01-06-activities.png');

  // ── the harvest modal: batch + bags in one real press ──────────────────────
  await page.goto(`/health/planting/${cycle!.id}`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /เก็บเกี่ยว|สร้างลอต/ }).first().click();
  const hDialog = page.getByRole('dialog');
  await hDialog.waitFor({ state: 'visible', timeout: 30_000 });
  await dumpControls(page, OUT, 'B01-harvest-modal.json');
  await shot(page, OUT, 'B01-07-harvest-modal.png');
  await lqaCapture(page, OUT, 'B01-harvest-modal');

  // Batch 1 — the upper colas cut on 2024-04-20. The modal's anatomy (dumped above):
  // a dated harvest row whose weight/grade inputs carry NO label, then a packaging row
  // (ชนิดบรรจุภัณฑ์ + two unlabeled numbers) and a computed total. Unlabeled number
  // inputs are addressed by position within the dialog, in DOM order:
  //   [0] น้ำหนักสด (kg)   [1] จำนวนหน่วย   [2] น้ำหนักต่อหน่วย
  // 24 kg fresh → 4 bags × 1.5 kg: comfortably inside the ceiling, so the mass-balance
  // control should ACCEPT this one (a deliberate overrun is tested separately).
  await hDialog.getByLabel(/วันที่เก็บเกี่ยว/).first().fill('2024-04-20');
  const numbers = hDialog.locator('input[type="number"]');
  await numbers.nth(0).fill('24');
  await hDialog.getByLabel('เกรดคุณภาพ').fill('A');
  await hDialog.getByLabel('หมายเหตุย่อย').fill('ตัดช่อบนก่อน ระยะสุกเต็มที่').catch(() => {});
  await hDialog.getByLabel('ชนิดบรรจุภัณฑ์').fill('ถุงฟอยล์');
  await numbers.nth(1).fill('4');
  await numbers.nth(2).fill('1.5');
  await shot(page, OUT, 'B01-08-harvest-filled.png');
  const hResp = page.waitForResponse(
    (r) => r.url().includes('/harvest-batches') && r.request().method() === 'POST',
    { timeout: 120_000 },
  ).catch(() => null);
  await hDialog.getByRole('button', { name: 'ยืนยันเก็บเกี่ยวและสร้างล็อต' }).click();
  const hr = await hResp;
  writeFileSync(join(OUT, 'B01-harvest-response.txt'), `POST harvest-batches → ${hr ? hr.status() : 'no response'}\n${hr ? (await hr.text().catch(() => '')).slice(0, 500) : ''}`);
  expect(hr && hr.status() < 300, 'harvest batch + lots created').toBeTruthy();
  await page.waitForTimeout(3000);
  await shot(page, OUT, 'B01-09-harvested.png');

  // ── the chain in the database ──────────────────────────────────────────────
  const chain = JSON.parse(g4psql(
    `SELECT hb.id, hb."batchNumber", hb."harvestDate", hb."freshWeight", hb."dryWeight",
            (SELECT count(*)::int FROM lots l WHERE l."batchId"=hb.id) AS lots,
            (SELECT COALESCE(SUM(l.quantity * l."unitWeight"),0) FROM lots l WHERE l."batchId"=hb.id) AS packed
     FROM harvest_batches hb WHERE hb."cycleId"='${cycle!.id}';`,
  ));
  writeFileSync(join(OUT, 'B01-chain.txt'), JSON.stringify(chain, null, 2));
  expect(chain.length, 'one harvest batch').toBe(1);
  expect(Number(chain[0].lots), 'bags created with the harvest').toBeGreaterThanOrEqual(1);
  expect(chain[0].harvestDate.slice(0, 10), 'harvestDate backdated').toBe('2024-04-20');
  expect(Number(chain[0].packed) <= Number(chain[0].freshWeight), 'mass balance: packed ≤ harvested').toBe(true);

  // ── the public trace read-back: bag → farmer, no login ─────────────────────
  const lot = JSON.parse(g4psql(`SELECT "qrCode" FROM lots WHERE "batchId"='${chain[0].id}' LIMIT 1;`))[0];
  if (lot?.qrCode) {
    await page.context().clearCookies();
    await page.goto(`/trace/lot/${lot.qrCode}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
    await shot(page, OUT, 'B01-10-public-trace.png');
    await lqaCapture(page, OUT, 'B01-public-trace');
  }
  writeFileSync(join(OUT, 'B01-lot-qr.txt'), JSON.stringify(lot ?? null));
});
