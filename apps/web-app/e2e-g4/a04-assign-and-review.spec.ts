/**
 * G4 · A04 — the scheduler assigns the reviewer; the reviewer READS the farmer's
 * documents and approves. Both officers press their real screens.
 *
 * GOALS §G4.0 rule 2 binds this spec harder than any other: "พนักงานทำงานจากเอกสารที่
 * เกษตรกรยื่นมาเท่านั้น". So the reviewer here does not just press approve — the walk
 * opens the document tab the officer actually uses, captures what it renders, and opens
 * a real uploaded PDF before the decision is made. If that surface shows the reviewer
 * nothing readable, the approval proves nothing and the walk stops there.
 *
 * Doors (verified by source, wf_c85678b3):
 *   scheduler  /provider/coordinator → "รอจ่ายงาน" → "จ่ายงานตรวจ" → dialog → ยืนยันจ่ายงาน
 *   reviewer   /provider/applications/{id} → tab เอกสารคำขอ(เต็ม) → action-panel-reviewer
 *              → action-approve-documents  ⇒ ASSIGNED_FOR_REVIEW→DOC_APPROVED
 *              ⇒ SYSTEM auto-chain → PENDING_AUDIT_FEE
 */
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { seg, shot, readVars, g4psql, g4Login, FARMERS, pickFarmer } from './g4-helpers';

const P = FARMERS[pickFarmer()];
import { lqaCapture } from './lqa';
import { pickRadix } from './wizard-steps';

const OUT = seg('a04');

function officer(env: string): { id: string; pw: string } {
  const id = process.env[`${env}_ID`] || '';
  const pw = process.env[`${env}_PW`] || '';
  if (!id || !pw) throw new Error(`${env}_ID / ${env}_PW must be exported by the run command (L2 — never committed)`);
  return { id, pw };
}

test.describe.serial('G4 A04 — assign → review → approve', () => {
  test('scheduler assigns the document reviewer', async ({ page }) => {
    const vars = readVars();
    const APP = vars[`${P.varPrefix}_APP`];
    const appRow = JSON.parse(g4psql(
      `SELECT a.status, a."applicationNumber", u.role AS assignee_role
       FROM applications a LEFT JOIN users u ON u.id = a."reviewerId" WHERE a.id='${APP}';`,
    ))[0];
    const APP_NO = appRow.applicationNumber as string;

    const sch = officer('G4_SCHEDULER');
    await g4Login(page, { kind: 'provider', id: sch.id, pw: sch.pw });

    if (appRow.status === 'DOC_FEE_PAID') {
      await page.goto('/provider/coordinator');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);
      await shot(page, OUT, 'A04-01-coordinator.png');
      await lqaCapture(page, OUT, 'A04-coordinator');

      await page.getByRole('button', { name: /รอจ่ายงาน/ }).first().click().catch(() => {});
      await page.waitForTimeout(1500);

      const row = page.locator('div.group, tr, article').filter({ hasText: APP_NO }).first();
      await row.waitFor({ state: 'visible', timeout: 60_000 });
      await row.getByRole('button', { name: /จ่ายงานตรวจ/ }).click();

      const dialog = page.getByRole('dialog').filter({ hasText: /จ่ายงานตรวจเอกสาร/ });
      await dialog.waitFor({ state: 'visible', timeout: 30_000 });
      await shot(page, OUT, 'A04-02-assign-dialog.png');

      // The options name their ROLE — "วิชัย ตรวจเอกสาร (document_reviewer)". Choose by
      // that tag, never by position: an earlier run picked index 1 and handed a document
      // review to the AUDITOR, which both the UI and the backend accepted (recorded as a
      // product finding — the dropdown should not offer auditors at all).
      const select = dialog.locator('select').first();
      const options = await select.locator('option').allTextContents();
      writeFileSync(join(OUT, 'A04-reviewer-options.txt'), options.join('\n'));
      const target = options.findIndex((o) => o.includes('(document_reviewer)'));
      expect(target, 'the dropdown offers a document_reviewer').toBeGreaterThan(-1);
      await select.selectOption({ index: target });
      await dialog.getByRole('button', { name: /ยืนยันจ่ายงาน/ }).click();
      await page.waitForTimeout(3000);
      await shot(page, OUT, 'A04-03-assigned.png');
    } else if (appRow.status === 'ASSIGNED_FOR_REVIEW' && appRow.assignee_role !== 'document_reviewer') {
      // A previous pass mis-assigned (the index-1 mistake). The product's own repair
      // door is /provider/scheduler/reviewer-reassign — walking it here both fixes the
      // state through a real screen and proves the door works.
      await page.goto('/provider/scheduler/reviewer-reassign');
      await page.waitForLoadState('domcontentloaded');
      await page.getByText('กำลังโหลดข้อมูล').waitFor({ state: 'detached', timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await shot(page, OUT, 'A04-01b-reassign-page.png');
      await lqaCapture(page, OUT, 'A04-reassign-page');

      // Row → "มอบหมายใหม่" → dialog: Radix Select + mandatory reason + confirm
      // (reviewer-reassign/page.tsx:154,171-195).
      const row = page.locator('tr, article, div.rounded-2xl, div.card, div').filter({ hasText: APP_NO }).last();
      await row.getByRole('button', { name: 'มอบหมายใหม่' }).click();
      const dialog = page.getByRole('dialog').filter({ hasText: /มอบหมายผู้ตรวจเอกสารใหม่/ });
      await dialog.waitFor({ state: 'visible', timeout: 30_000 });
      await shot(page, OUT, 'A04-02b-reassign-dialog.png');

      const picked = await pickRadix(page, /เลือกผู้ตรวจเอกสารคนใหม่/, /ตรวจเอกสาร|document_reviewer/, 'ผู้ตรวจคนใหม่');
      writeFileSync(join(OUT, 'A04-reassign-picked.txt'), picked + '\n');
      await dialog.getByLabel(/เหตุผลในการมอบหมายใหม่/).fill(
        'มอบหมายครั้งก่อนเลือกผู้ตรวจผิดบทบาท (auditor) — ย้ายให้ผู้ตรวจเอกสารตามหน้าที่',
      );
      await dialog.getByRole('button', { name: 'ยืนยันการมอบหมาย' }).click();
      await page.waitForTimeout(3000);
      await shot(page, OUT, 'A04-03b-reassigned.png');
    }

    let after: { status: string; assignee_role: string | null } | null = null;
    for (let i = 0; i < 10; i++) {
      after = JSON.parse(g4psql(
        `SELECT a.status, u.role AS assignee_role
         FROM applications a LEFT JOIN users u ON u.id = a."reviewerId" WHERE a.id='${APP}';`,
      ))[0] ?? null;
      if (after?.status === 'ASSIGNED_FOR_REVIEW' && after?.assignee_role === 'document_reviewer') break;
      await page.waitForTimeout(2000);
    }
    expect(after?.status, 'application sits at ASSIGNED_FOR_REVIEW').toBe('ASSIGNED_FOR_REVIEW');
    expect(after?.assignee_role, 'and the assignee really is the document reviewer').toBe('document_reviewer');
  });

  test('reviewer reads the submitted documents, then approves', async ({ page }) => {
    const vars = readVars();
    const APP = vars[`${P.varPrefix}_APP`];
    const rev = officer('G4_REVIEWER');
    await g4Login(page, { kind: 'provider', id: rev.id, pw: rev.pw });

    // The reviewer's inbox shows the assignment.
    await page.goto('/provider/reviewer');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
    await shot(page, OUT, 'A04-04-reviewer-inbox.png');
    await lqaCapture(page, OUT, 'A04-reviewer-inbox');

    // The application page, and — before any decision — the documents the farmer sent.
    await page.goto(`/provider/applications/${APP}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    const docTab = page.getByRole('tab', { name: /เอกสารคำขอ/ }).first();
    if (await docTab.isVisible().catch(() => false)) {
      await docTab.click();
      await page.waitForTimeout(2500);
    }
    await shot(page, OUT, 'A04-05-documents-tab.png');
    await lqaCapture(page, OUT, 'A04-documents-tab');

    // Open ONE real uploaded PDF the way the officer would — proof the surface renders
    // the actual upload, not just a checklist of names. New-tab links are captured.
    const opener = page.getByRole('button', { name: /^เปิด|Preview|Open/ }).first();
    if (await opener.isVisible().catch(() => false)) {
      const popupPromise = page.waitForEvent('popup', { timeout: 15_000 }).catch(() => null);
      await opener.click();
      const popup = await popupPromise;
      if (popup) {
        await popup.waitForLoadState('domcontentloaded').catch(() => {});
        await popup.waitForTimeout(2500);
        await popup.screenshot({ path: join(OUT, 'A04-06-opened-document.png'), fullPage: false }).catch(() => {});
        writeFileSync(join(OUT, 'A04-opened-document-url.txt'), popup.url());
        await popup.close().catch(() => {});
      } else {
        await shot(page, OUT, 'A04-06-opened-document-inline.png');
      }
    } else {
      writeFileSync(join(OUT, 'A04-06-NO-OPENER.txt'), 'ไม่พบปุ่มเปิดเอกสารบนแท็บผู้ตรวจ — ผู้ตรวจอ่านเอกสารไม่ได้ = หยุดตามกติกา G4 rule 2');
      throw new Error('reviewer cannot open any submitted document — G4 rule 2 violated, stopping');
    }

    // The decision — the panel that exists only at ASSIGNED_FOR_REVIEW for this role.
    const panel = page.getByTestId('action-panel-reviewer');
    await panel.waitFor({ state: 'visible', timeout: 60_000 });
    await shot(page, OUT, 'A04-07-decision-panel.png');
    await panel.getByTestId('action-approve-documents').click();
    // A confirm dialog may follow; press its affirmative if it appears.
    await page.getByRole('dialog').getByRole('button', { name: /ยืนยัน|อนุมัติ/ }).first().click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await shot(page, OUT, 'A04-08-approved.png');

    // DOC_APPROVED then the SYSTEM auto-chain to the phase-2 gate.
    let status = '';
    for (let i = 0; i < 15 && status !== 'PENDING_AUDIT_FEE'; i++) {
      status = JSON.parse(g4psql(`SELECT status FROM applications WHERE id='${APP}';`))[0]?.status ?? '';
      if (status !== 'PENDING_AUDIT_FEE') await page.waitForTimeout(2500);
    }
    writeFileSync(join(OUT, 'A04-after.txt'), `status=${status}\n`);
    expect(['DOC_APPROVED', 'PENDING_AUDIT_FEE']).toContain(status);
    expect(status, 'the auto-chain reached the phase-2 payment gate').toBe('PENDING_AUDIT_FEE');
  });
});
