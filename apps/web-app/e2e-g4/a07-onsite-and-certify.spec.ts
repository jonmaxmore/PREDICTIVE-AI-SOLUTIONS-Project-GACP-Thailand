/**
 * G4 · A07 — the auditor walks the farm: GPS check-in, 24 checklist answers,
 * 5 evidence photos, the PASS decision — and the certificate the same write mints.
 *
 * Every press is the field app's own: 'เริ่มตรวจ' captures the device GPS (this
 * context's granted geolocation IS the farm's coordinates), each of the 24 items is
 * answered on its own card, photos go through each card's real 'แนบภาพ' chooser, and
 * the decision screen takes 'ผ่าน' plus a written summary — the auditor's actual
 * findings, not filler.
 *
 * What the PASS write does (operator ruling 2026-08-25 + code): the status writer's
 * cert hook mints the certificate AT AUDIT_PASSED, signed, active, publicly
 * verifiable; APPROVED→CERTIFIED are bookkeeping steps the same auditor walks after.
 * The onsite evidence gate stands in front of the mint: <24 items or <5 photos and
 * issuance refuses. So this spec's assertions are the whole point of the morning's
 * work: gate satisfied, PASS recorded, certificate row present WITH its RSA signature.
 */
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { FARMERS, REPO, seg, shot, readVars, g4psql, g4Login, pickFarmer } from './g4-helpers';
import { lqaCapture } from './lqa';

const OUT = seg('a07');
const P = FARMERS[pickFarmer()];

/** Five distinct labelled JPEGs — what each photo claims to show, stated on the frame. */
function photoFixtures(): string[] {
  const shots = [
    ['ภาพรวมแปลงปลูกกลางแจ้ง', 'แปลงกลางแจ้ง 1 · 200 ตร.ม.'],
    ['แหล่งน้ำ บ่อบาดาล และระบบน้ำหยด', 'ตามที่แจ้งในคำขอ'],
    ['พื้นที่ตากแห้งแบบแขวน', 'โรงตากในร่ม ลมธรรมชาติ'],
    ['พื้นที่จัดเก็บและบรรจุ', 'ถุงฟอยล์ · อุณหภูมิห้อง'],
    ['ป้ายฟาร์มและแนวเขตแปลง', P.farmName],
  ];
  return shots.map(([label, sub], i) => {
    const out = join(seg('a07/photos'), `photo-${i + 1}.jpg`);
    execFileSync('node', ['scripts/g4/make-photo-fixture.js', out, label, sub], {
      cwd: join(REPO, 'apps/backend'), encoding: 'utf8',
    });
    return out;
  });
}

test('A07 onsite inspection → PASS → certificate minted with its signature', async ({ page }) => {
  test.setTimeout(25 * 60 * 1000);
  const vars = readVars();
  const APP = vars[`${P.varPrefix}_APP`];
  const audId = process.env.G4_AUDITOR_ID || '';
  const audPw = process.env.G4_AUDITOR_PW || '';
  expect(audId && audPw, 'auditor creds exported (L2)').toBeTruthy();

  const before = JSON.parse(g4psql(`SELECT status FROM applications WHERE id='${APP}';`))[0];

  // Two states are legitimate here — same reasoning as A03/A05/A06, and here it matters
  // most: a completed run has RECORDED A DECISION. Pressing the visit again would try to
  // decide an audit that already decided, which the product refuses; and the whole point of
  // today's evidence work is that the decision, the photographs and the pin are bound to
  // ONE visit. A re-run verifies that binding; it does not stage a second visit.
  //
  // AUDIT_CONFIRMED — the visit is booked; this run performs it and decides.
  // AUDIT_PASSED    — an earlier run decided; verify the evidence and the certificate.
  // Anything else is a real finding: fail and name it.
  const startedAt = before?.status;
  expect(
    ['AUDIT_CONFIRMED', 'AUDIT_PASSED'],
    `the application is at neither side of the onsite visit (found ${startedAt})`,
  ).toContain(startedAt);
  const alreadyDecided = startedAt === 'AUDIT_PASSED';
  if (alreadyDecided) {
    // eslint-disable-next-line no-console
    console.log('[A07] onsite decision already recorded by an earlier run — verifying evidence and certificate, not re-visiting');
  }

  if (!alreadyDecided) {
  await g4Login(page, { kind: 'provider', id: audId, pw: audPw });

  // ── the job sheet, then the field app ──────────────────────────────────────
  await page.goto(`/provider/audits/${APP}`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);
  await shot(page, OUT, 'A07-01-jobsheet.png');
  await lqaCapture(page, OUT, 'A07-jobsheet');

  // Wait, press, PROVE the switch. The `if (isVisible)` guard pattern has now silently
  // skipped a press three times in this harness when the control had not hydrated yet —
  // a conditional around a mandatory action is a lie waiting to be told.
  const fieldTab = page.getByRole('tab', { name: /เครื่องมือภาคสนาม/ });
  await fieldTab.waitFor({ state: 'visible', timeout: 60_000 });
  await fieldTab.click();
  await expect(fieldTab).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
  const entry = page.getByTestId('onsite-inspect-entry');
  await entry.waitFor({ state: 'visible', timeout: 30_000 });
  await entry.click();
  await page.waitForURL('**/inspect**', { timeout: 200_000 });
  await page.waitForLoadState('domcontentloaded');

  // ── start: the GPS check-in — unless the visit was started earlier ─────────
  // The field app RESUMES a visit that already has a start marker (a gpsVerificationLog
  // row of type AUDIT_INSPECTION_START; proven live 2026-08-19: reload lands on the
  // checklist). So "no เริ่มตรวจ button" is not a broken screen — it is the product
  // remembering that the auditor already checked in. On 2026-08-27 this spec waited 60 s
  // for a button the product was right not to show, because the previous day's run had
  // checked in and then lost every photograph to an unapplied migration (F-G4-30).
  //
  // Wait for whichever appears first: the start button (fresh visit → press it) or the
  // checklist cards (resumed visit → carry on). Say which, out loud.
  const startBtn = page.getByRole('button', { name: /เริ่มตรวจ/ }).first();
  const firstCard = page.locator('article[data-checklist-id]').first();
  const arrived = await Promise.race([
    startBtn.waitFor({ state: 'visible', timeout: 60_000 }).then(() => 'start' as const),
    firstCard.waitFor({ state: 'visible', timeout: 60_000 }).then(() => 'resumed' as const),
  ]);
  if (arrived === 'start') {
    await shot(page, OUT, 'A07-02-start.png');
    await startBtn.click();
    await page.waitForTimeout(4000);
    await shot(page, OUT, 'A07-03-started.png');
  } else {
    // eslint-disable-next-line no-console
    console.log('[A07] visit already started by an earlier run — resuming at the checklist, no second check-in');
    await shot(page, OUT, 'A07-03-resumed.png');
  }
  await lqaCapture(page, OUT, 'A07-checklist');

  // ── the 24 items, answered on their own cards ─────────────────────────────
  const cards = page.locator('article[data-checklist-id]');
  await cards.first().waitFor({ state: 'visible', timeout: 60_000 });
  const total = await cards.count();
  writeFileSync(join(OUT, 'A07-item-count.txt'), `checklist cards: ${total}\n`);
  expect(total, 'the 2026 template carries 24 items').toBe(24);

  for (let i = 0; i < total; i++) {
    const card = cards.nth(i);
    await card.scrollIntoViewIfNeeded();
    await card.getByRole('radio', { name: 'ใช่', exact: true }).click();
    await page.waitForTimeout(150);
  }
  await shot(page, OUT, 'A07-04-answered.png');

  // ── five photos, through five different cards' real choosers ───────────────
  const photos = photoFixtures();
  for (let i = 0; i < photos.length; i++) {
    const card = cards.nth(i * 4); // spread across the checklist
    await card.scrollIntoViewIfNeeded();
    const input = card.locator('input[aria-label="แนบภาพหลักฐาน"]');
    const posted = page.waitForResponse(
      (r) => /\/photo/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 90_000 },
    ).catch(() => null);
    await input.setInputFiles(photos[i]);
    const resp = await posted;
    expect(resp && resp.status() < 300, `photo ${i + 1} accepted (${resp ? resp.status() : 'no response'})`).toBeTruthy();
    await page.waitForTimeout(500);
  }
  await shot(page, OUT, 'A07-05-photos.png');

  // ── review → decision ─────────────────────────────────────────────────────
  await page.getByRole('button', { name: /ทบทวนผลการตรวจ/ }).click();
  await page.waitForTimeout(2000);
  await shot(page, OUT, 'A07-06-review.png');
  await lqaCapture(page, OUT, 'A07-review');
  // The review screen's continue control leads to the decision screen.
  await page.getByRole('button', { name: /ตัดสินผล|ไปหน้าตัดสิน|ถัดไป|ต่อไป/ }).first().click().catch(() => {});
  await page.waitForTimeout(2000);

  const passBtn = page.getByRole('button', { name: 'ผ่าน', exact: true });
  await passBtn.waitFor({ state: 'visible', timeout: 30_000 });
  await passBtn.click();
  await page.getByPlaceholder('สรุปผลการตรวจประเมินภาคสนาม').fill(
    'ตรวจประเมินภาคสนาม ณ ไร่ใจดีสมุนไพรไทย: แปลงกลางแจ้ง 200 ตร.ม. ตรงตามคำขอ '
    + 'แหล่งน้ำบ่อบาดาลพร้อมระบบน้ำหยดตามที่แจ้ง พื้นที่ตากและจัดเก็บแยกสัดส่วนชัดเจน '
    + 'เอกสาร SOP และบันทึกคุณภาพครบตามที่ประกาศไว้ทั้ง 6 มาตรการ ผลการตรวจทั้ง 24 ข้อผ่านครบ '
    + 'เห็นควรออกใบรับรอง GACP',
  );
  await shot(page, OUT, 'A07-07-decision.png');
  await lqaCapture(page, OUT, 'A07-decision');
  await page.getByRole('button', { name: /ส่งผลการตรวจ/ }).click();
  await page.getByText(/ส่งผลการตรวจเรียบร้อย/).waitFor({ timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await shot(page, OUT, 'A07-08-submitted.png');

  // ── what the write actually did ────────────────────────────────────────────
  let status = '';
  for (let i = 0; i < 15 && status !== 'AUDIT_PASSED'; i++) {
    status = JSON.parse(g4psql(`SELECT status FROM applications WHERE id='${APP}';`))[0]?.status ?? '';
    if (status !== 'AUDIT_PASSED') await page.waitForTimeout(2500);
  }
  expect(status, 'the decision walked AUDIT_CONFIRMED→AUDIT_PASSED').toBe('AUDIT_PASSED');
  } // end of THE VISIT

  // Re-read for both paths: the evidence and certificate assertions below are the part
  // that must hold whichever run performed the visit.
  const decidedStatus = JSON.parse(
    g4psql(`SELECT status FROM applications WHERE id='${APP}';`),
  )[0]?.status;
  expect(decidedStatus, 'the application sits at AUDIT_PASSED').toBe('AUDIT_PASSED');

  const evidence = JSON.parse(g4psql(
    `SELECT (SELECT count(*)::int FROM farm_audit_photos p JOIN audit_checklists c ON p."auditId"=c.id WHERE c."applicationId"='${APP}') AS photos,
            (SELECT count(*)::int FROM farm_audit_checklist_items i JOIN audit_checklists c ON i."auditId"=c.id WHERE c."applicationId"='${APP}') AS items;`,
  ))[0];
  writeFileSync(join(OUT, 'A07-evidence-counts.txt'), JSON.stringify(evidence, null, 2));
  expect(Number(evidence.photos), '≥5 photos behind the gate').toBeGreaterThanOrEqual(5);
  expect(Number(evidence.items), '24 recorded answers').toBeGreaterThanOrEqual(24);

  const cert = JSON.parse(g4psql(
    `SELECT "certificateNumber", status, "issuedDate", "expiryDate",
            (signature IS NOT NULL) AS signed, ("documentHash" IS NOT NULL) AS hashed
     FROM certificates WHERE "applicationId"='${APP}';`,
  ));
  writeFileSync(join(OUT, 'A07-certificate.txt'), JSON.stringify(cert, null, 2));
  expect(cert.length, 'exactly one certificate minted').toBe(1);
  expect(cert[0].signed, 'carrying its RSA signature (RULING 2 — never unsigned)').toBe(true);
  expect(cert[0].hashed, 'and its document hash').toBe(true);
  expect(cert[0].status, 'active').toBe('active');
});
