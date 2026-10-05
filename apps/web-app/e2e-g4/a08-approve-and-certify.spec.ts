/**
 * G4 · A08 — the two bookkeeping steps that close the status chain:
 * AUDIT_PASSED → APPROVED (the auditor's final-approval queue button), then
 * APPROVED → CERTIFIED (the work inbox's next-state door, the surface Phase-0
 * established as the real UI for this hop).
 *
 * The certificate itself already exists — minted at AUDIT_PASSED per the operator's
 * ruling. These steps change the APPLICATION's state only; the spec also proves that
 * walking them does NOT touch the certificate row (same number, same signature,
 * same dates) — a second issuance step is exactly what must NOT exist.
 */
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { seg, shot, readVars, g4psql, g4Login, FARMERS, pickFarmer } from './g4-helpers';

const P = FARMERS[pickFarmer()];
import { lqaCapture } from './lqa';

const OUT = seg('a08');

test('A08 AUDIT_PASSED→APPROVED→CERTIFIED, certificate untouched', async ({ page }) => {
  test.setTimeout(15 * 60 * 1000);
  const vars = readVars();
  const APP = vars[`${P.varPrefix}_APP`];
  const audId = process.env.G4_AUDITOR_ID || '';
  const audPw = process.env.G4_AUDITOR_PW || '';
  expect(audId && audPw, 'auditor creds exported (L2)').toBeTruthy();

  const certBefore = JSON.parse(g4psql(
    `SELECT "certificateNumber", "issuedDate", signature FROM certificates WHERE "applicationId"='${APP}';`,
  ))[0];
  expect(certBefore?.certificateNumber, 'the certificate already exists before these steps').toBeTruthy();

  const appRow = JSON.parse(g4psql(`SELECT status, "applicationNumber" FROM applications WHERE id='${APP}';`))[0];
  const APP_NO = appRow.applicationNumber as string;

  await g4Login(page, { kind: 'provider', id: audId, pw: audPw });

  // ── AUDIT_PASSED → APPROVED: the final-approval queue's own อนุมัติ button ──
  if (appRow.status === 'AUDIT_PASSED') {
    await page.goto('/provider/audits');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    await shot(page, OUT, 'A08-01-audits-queue.png');
    await lqaCapture(page, OUT, 'A08-auditor-home');

    // The final-approval queue lives behind the dashboard's "อนุมัติ (N)" tab.
    const approveTab = page.getByRole('tab', { name: /^อนุมัติ/ });
    await approveTab.waitFor({ state: 'visible', timeout: 30_000 });
    await approveTab.click();
    await expect(approveTab).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    await page.waitForTimeout(1500);
    await shot(page, OUT, 'A08-01b-approve-tab.png');

    const queueRow = page.locator('tr, article, div')
      .filter({ hasText: APP_NO })
      .filter({ has: page.getByRole('button', { name: 'อนุมัติ', exact: true }) })
      .last();
    await queueRow.waitFor({ state: 'visible', timeout: 60_000 });
    await queueRow.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: /ยืนยัน|อนุมัติ/ }).first().click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await shot(page, OUT, 'A08-02-approved.png');

    let s = '';
    for (let i = 0; i < 12 && s !== 'APPROVED'; i++) {
      s = JSON.parse(g4psql(`SELECT status FROM applications WHERE id='${APP}';`))[0]?.status ?? '';
      if (s !== 'APPROVED') await page.waitForTimeout(2500);
    }
    expect(s, 'AUDIT_PASSED→APPROVED via the final-approval queue').toBe('APPROVED');
  }

  // ── APPROVED → CERTIFIED: the work item's own detail page ──────────────────
  // The FINAL_APPROVAL work activity exists (created at AUDIT_PASSED, group auditor);
  // its list row does not carry the application number, so the walk opens the item's
  // real detail page directly and uses the next-state select + "ปิดงาน + เลื่อน" —
  // the door s06 established as the genuine UI for this hop.
  const now = JSON.parse(g4psql(`SELECT status FROM applications WHERE id='${APP}';`))[0]?.status;
  if (now === 'APPROVED') {
    const act = JSON.parse(g4psql(
      `SELECT id FROM work_activities WHERE "applicationId"='${APP}' AND "workType"='FINAL_APPROVAL' ORDER BY "createdAt" DESC LIMIT 1;`,
    ))[0];
    expect(act?.id, 'the FINAL_APPROVAL work activity exists').toBeTruthy();

    await page.goto(`/provider/work/${act.id}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    await shot(page, OUT, 'A08-04-work-detail.png');
    await lqaCapture(page, OUT, 'A08-work-detail');

    const select = page.getByTestId('next-state-select');
    await select.waitFor({ state: 'visible', timeout: 60_000 });
    const values = await select.locator('option').evaluateAll(
      (els) => els.map((el) => (el as HTMLOptionElement).value),
    );
    writeFileSync(join(OUT, 'A08-next-state-options.txt'), values.join('\n') + '\n');
    expect(values, 'CERTIFIED is offered as the next state').toContain('CERTIFIED');
    await select.selectOption('CERTIFIED');
    const commentBox = page.getByPlaceholder('ระบุเหตุผล / รายละเอียด');
    if (await commentBox.count()) {
      await commentBox.fill('G4 — ปิดงานอนุมัติขั้นสุดท้ายและบันทึกสถานะออกใบรับรอง (ใบรับรองออกแล้วตอนผลตรวจผ่าน)');
    }
    const doneResp = page.waitForResponse(
      (r) => r.url().includes('/work/') && r.url().includes('/done') && r.request().method() === 'POST',
      { timeout: 120_000 },
    ).catch(() => null);
    await page.getByRole('button', { name: /ปิดงาน \+ เลื่อน/ }).click();
    const dr = await doneResp;
    writeFileSync(join(OUT, 'A08-work-door.txt'), `POST /work/${act.id}/done → ${dr ? dr.status() : 'no response'}\n`);
    await page.waitForTimeout(3000);
    await shot(page, OUT, 'A08-05-advanced.png');
  }

  let finalStatus = '';
  for (let i = 0; i < 12 && finalStatus !== 'CERTIFIED'; i++) {
    finalStatus = JSON.parse(g4psql(`SELECT status FROM applications WHERE id='${APP}';`))[0]?.status ?? '';
    if (finalStatus !== 'CERTIFIED') await page.waitForTimeout(2500);
  }
  writeFileSync(join(OUT, 'A08-final-status.txt'), `status=${finalStatus}\n`);
  expect(finalStatus, 'the chain closes at CERTIFIED').toBe('CERTIFIED');

  // ── the certificate must be EXACTLY the one minted at AUDIT_PASSED ─────────
  const certAfter = JSON.parse(g4psql(
    `SELECT "certificateNumber", "issuedDate", signature, status FROM certificates WHERE "applicationId"='${APP}';`,
  ));
  writeFileSync(join(OUT, 'A08-cert-after.txt'), JSON.stringify(
    certAfter.map((c: Record<string, unknown>) => ({ ...c, signature: c.signature ? '(present)' : null })), null, 2));
  expect(certAfter.length, 'still exactly one certificate').toBe(1);
  expect(certAfter[0].certificateNumber, 'same number — no second issuance').toBe(certBefore.certificateNumber);
  expect(certAfter[0].issuedDate, 'same issuedDate — untouched by the bookkeeping steps').toBe(certBefore.issuedDate);
  expect(certAfter[0].signature, 'same signature').toBe(certBefore.signature);
});
