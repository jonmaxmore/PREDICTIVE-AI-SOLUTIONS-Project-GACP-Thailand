/**
 * G4 · A06 — the scheduler books the ON-SITE audit through the queue door.
 *
 * This is the door whose evidence-arming this session repaired (arm-onsite-evidence.js,
 * merged as 01d972de): confirming an audit must create the AuditChecklist row the
 * certificate gate later counts. So this spec asserts BOTH outcomes of the press —
 * the state walk (AUDIT_FEE_PAID → AUDIT_CONFIRMED) and the armed evidence chain
 * (an IN_PROGRESS AuditChecklist bound to the application). The queue door sends no
 * inspectionMode; the service defaults it to ONSITE (audit-scheduling-service.js:424),
 * which is exactly the certifiable mode.
 *
 * Modal choreography from AssignAuditorModal.tsx: #assign-date (native date input),
 * a slot toggle, #assign-auditor (native select naming real auditors), then
 * "ยืนยันจัดตาราง".
 */
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { seg, shot, readVars, g4psql, g4Login, FARMERS, pickFarmer } from './g4-helpers';

const P = FARMERS[pickFarmer()];
import { lqaCapture } from './lqa';

const OUT = seg('a06');

test('A06 scheduler books the onsite audit; the evidence chain arms', async ({ page }) => {
  const vars = readVars();
  const APP = vars[`${P.varPrefix}_APP`];
  const schId = process.env.G4_SCHEDULER_ID || '';
  const schPw = process.env.G4_SCHEDULER_PW || '';
  expect(schId && schPw, 'scheduler creds exported (L2)').toBeTruthy();

  const before = JSON.parse(g4psql(`SELECT status, "applicationNumber" FROM applications WHERE id='${APP}';`))[0];
  const APP_NO = before.applicationNumber as string;

  // Two states are legitimate here — same reasoning as A03/A05. A completed run leaves the
  // application at AUDIT_CONFIRMED with an armed checklist; demanding AUDIT_FEE_PAID alone
  // made a re-run fail at line one. Scheduling twice is not harmless either: it would push
  // a second arming through the door this step exists to exercise.
  //
  // AUDIT_FEE_PAID  — the queue holds this application; this run schedules it.
  // AUDIT_CONFIRMED — an earlier run scheduled it; verify the armed evidence, do not re-book.
  // Anything else is a real finding: fail and name it.
  const startedAt = before?.status;
  expect(
    ['AUDIT_FEE_PAID', 'AUDIT_CONFIRMED'],
    `the application is at neither side of the scheduling step (found ${startedAt})`,
  ).toContain(startedAt);
  const alreadyScheduled = startedAt === 'AUDIT_CONFIRMED';
  if (alreadyScheduled) {
    // eslint-disable-next-line no-console
    console.log('[A06] onsite audit already scheduled by an earlier run — verifying the armed checklist, not re-booking');
  }

  if (!alreadyScheduled) {
  await g4Login(page, { kind: 'provider', id: schId, pw: schPw });
  await page.goto('/provider/scheduler/queue');
  await page.waitForLoadState('domcontentloaded');
  await page.getByText('กำลังโหลด').first().waitFor({ state: 'detached', timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await shot(page, OUT, 'A06-01-queue.png');
  await lqaCapture(page, OUT, 'A06-queue');

  const row = page.locator('tr, article, div').filter({ hasText: APP_NO }).last();
  await row.getByRole('button', { name: /จัดตาราง/ }).click();

  const dialog = page.getByRole('dialog').filter({ hasText: /จัดตารางตรวจประเมินภาคสนาม/ });
  await dialog.waitFor({ state: 'visible', timeout: 30_000 });
  await shot(page, OUT, 'A06-02-modal.png');
  await lqaCapture(page, OUT, 'A06-assign-modal');

  // Tomorrow — the input's min is today, and a next-day visit is what a real scheduler
  // books. (Business-date backdating in G4 applies to the certificate's issuedDate later,
  // never to when the audit physically happens.)
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  await dialog.locator('#assign-date').fill(tomorrow);

  // Morning slot — the first slot toggle.
  const slotBtn = dialog.locator('button[aria-pressed]').first();
  await slotBtn.click().catch(() => {});

  // The auditor — a NATIVE select naming real people; pick the one whose name marks the
  // farm-audit role (ประสิทธิ์ ตรวจแปลง), never by index.
  const select = dialog.locator('#assign-auditor');
  await expect(select).toBeEnabled({ timeout: 30_000 });
  const options = await select.locator('option').allTextContents();
  writeFileSync(join(OUT, 'A06-auditor-options.txt'), options.join('\n'));
  const target = options.findIndex((o) => /ตรวจแปลง|auditor/i.test(o));
  expect(target, 'an auditor is offered').toBeGreaterThan(0);
  await select.selectOption({ index: target });

  // Location — the place being audited is the farm itself.
  await dialog.locator('input#assign-location, textarea#assign-location, input[placeholder*="สถานที่"], textarea[placeholder*="สถานที่"]')
    .first().fill('ไร่ใจดีสมุนไพรไทย 119/4 หมู่ 3 ต.สุเทพ อ.เมือง จ.เชียงใหม่').catch(() => {});

  await dialog.getByRole('button', { name: /ยืนยันจัดตาราง/ }).click();
  await page.waitForTimeout(3000);
  await shot(page, OUT, 'A06-03-scheduled.png');

  // Outcome 1 — the state walked.
  let after: { status: string } | null = null;
  for (let i = 0; i < 12 && after?.status !== 'AUDIT_CONFIRMED'; i++) {
    after = JSON.parse(g4psql(`SELECT status FROM applications WHERE id='${APP}';`))[0] ?? null;
    if (after?.status !== 'AUDIT_CONFIRMED') await page.waitForTimeout(2500);
  }
  expect(after?.status, 'AUDIT_FEE_PAID→AUDIT_CONFIRMED by the scheduler').toBe('AUDIT_CONFIRMED');
  } // end of THE SCHEDULING

  // Re-read for both paths: the armed-evidence assertions below must hold whichever run
  // did the booking.
  const confirmedStatus = JSON.parse(
    g4psql(`SELECT status FROM applications WHERE id='${APP}';`),
  )[0]?.status;
  expect(confirmedStatus, 'the application sits at AUDIT_CONFIRMED').toBe('AUDIT_CONFIRMED');

  // Outcome 2 — the evidence chain armed (the repair this session shipped as 01d972de).
  const checklist = JSON.parse(g4psql(
    `SELECT id, status, "auditorId", "organizationId" FROM audit_checklists
     WHERE "applicationId"='${APP}' AND "isDeleted"=false ORDER BY "createdAt" DESC LIMIT 1;`,
  ));
  writeFileSync(join(OUT, 'A06-checklist.txt'), JSON.stringify(checklist, null, 2));
  expect(checklist.length, 'an AuditChecklist row exists — the certificate gate has something to count').toBe(1);
  expect(checklist[0].status, 'and it is IN_PROGRESS').toBe('IN_PROGRESS');
  expect(checklist[0].organizationId, 'carrying its organizationId (the calendar-door gap, fixed)').toBeTruthy();
});
