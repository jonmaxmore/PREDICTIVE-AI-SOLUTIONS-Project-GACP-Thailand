/**
 * C03 — issue "ฉบับแก้ไขครั้งที่ 1" for the two live certificates whose location was recorded
 * as the literal Unknown (ledger F-G4-52), through the real admin door, under the same
 * certificate number. Spec: design note 2026-08-27-certificate-revision-design.
 *
 * Two-state per certificate: a certificate already at revisionNo >= 2 is VERIFIED (page
 * shows the revision line), never re-pressed. Runs as the admin officer (G4_ADMIN_ID /
 * G4_ADMIN_PW from the runner's env).
 */
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { g4Login, g4psql, seg, shot } from './g4-helpers';

const OUT = seg('c03');
const CERTS = ['GACP-TH-2569-E5960D', 'GACP-TH-2569-4C3761'];
const REASON =
  'ระบบบันทึกที่ตั้งฟาร์มเป็น Unknown ตอนออกใบ (F-G4-52) ทั้งที่ผู้ขอกรอกจังหวัด อำเภอ ตำบล ครบ '
  + 'ออกฉบับแก้ไขจากบันทึกฟาร์ม ผู้ขอไม่ได้ทำอะไรผิด';

type Row = { id: string; revisionNo: number; province: string; district: string; subDistrict: string; status: string };

function readCert(no: string): Row {
  const rows = JSON.parse(g4psql(
    `SELECT id, "revisionNo", province, district, "subDistrict", status FROM certificates WHERE "certificateNumber"='${no}';`,
  )) as Row[];
  expect(rows.length, `${no} exists`).toBe(1);
  return rows[0];
}

test('C03 admin issues revision 1 for the two Unknown-location certificates', async ({ page }) => {
  test.setTimeout(600_000);
  const id = process.env.G4_ADMIN_ID || '';
  const pw = process.env.G4_ADMIN_PW || '';
  expect(id, 'G4_ADMIN_ID must be in the environment').not.toBe('');
  expect(pw, 'G4_ADMIN_PW must be in the environment').not.toBe('');
  await g4Login(page, { kind: 'provider', id, pw });

  for (const no of CERTS) {
    const before = readCert(no);
    expect(before.status, `${no} is in force`).toBe('active');
    const tag = no.slice(-6);

    await page.goto(`/admin/certificates/${before.id}`);
    await expect(page.getByRole('heading', { level: 1, name: no })).toBeVisible({ timeout: 120_000 });
    await shot(page, OUT, `C03-${tag}-01-before.png`);

    if (before.revisionNo >= 2) {
      console.log(`[C03] ${no} already at revision ${before.revisionNo} — verifying, not re-pressing`);
      await expect(page.getByText(`ฉบับแก้ไขครั้งที่ ${before.revisionNo - 1}`).first()).toBeVisible();
      expect(before.province).not.toBe('Unknown');
      continue;
    }
    expect(before.province, `${no} still carries the literal Unknown before the press`).toBe('Unknown');

    await page.getByRole('button', { name: /ออกฉบับแก้ไขจากบันทึกต้นทาง/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The diff the admin is asked to confirm: the farm record vs the certificate.
    await expect(dialog).toContainText('Unknown');
    await expect(dialog).toContainText('เชียงใหม่');
    await shot(page, OUT, `C03-${tag}-02-diff.png`);

    const confirm = dialog.getByRole('button', { name: /ยืนยันออกฉบับแก้ไข/ });
    await expect(confirm, 'confirm stays disabled until a reason is given').toBeDisabled();
    await dialog.locator('textarea').fill(REASON);
    await expect(confirm).toBeEnabled();
    await confirm.click();

    // Wait for the DOOR to finish: the dialog closes only after the backend answered and the
    // row was reloaded. (The dialog's own title already reads 'ออกฉบับแก้ไขครั้งที่ 1', so a
    // text anchor fired mid-submit on the first run and photographed the spinner.)
    await expect(dialog).toBeHidden({ timeout: 90_000 });
    await expect(page.getByText(/ออกฉบับแก้ไขครั้งที่ 1 ของใบรับรอง/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('ฉบับแก้ไขครั้งที่ 1').first()).toBeVisible();
    await shot(page, OUT, `C03-${tag}-03-revised.png`);

    // The register, read back — polled: the success notice can paint before the
    // commit is visible to a fresh connection (E5960D on 2026-08-27 read revisionNo 1
    // a moment after the page already said ฉบับแก้ไขครั้งที่ 1, then 2 on the next read).
    let after = readCert(no);
    for (let i = 0; i < 15 && after.revisionNo < 2; i++) { await page.waitForTimeout(2000); after = readCert(no); }
    expect(after.revisionNo).toBe(2);
    expect(after.province).toBe('เชียงใหม่');
    expect(after.district).toBe('เมืองเชียงใหม่');
    expect(after.subDistrict).toBe('สุเทพ');
    const archived = JSON.parse(g4psql(
      `SELECT "revisionNo", "documentHash", "reasonCode", "correctedFields" FROM certificate_revisions WHERE "certificateId"='${before.id}' ORDER BY "revisionNo";`,
    )) as Array<{ revisionNo: number; documentHash: string; reasonCode: string; correctedFields: string[] }>;
    expect(archived.length).toBe(1);
    expect(archived[0].revisionNo).toBe(1);
    expect(archived[0].reasonCode).toBe('SYSTEM_DATA_CORRECTION');
    expect(archived[0].correctedFields).toEqual(expect.arrayContaining(['province', 'district', 'subDistrict']));

    // The public verifier: same number, revision line, real province, never Unknown.
    await page.goto(`/verify/${no}`);
    await expect(page.getByText('ฉบับแก้ไขครั้งที่ 1').first()).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText('เชียงใหม่').first()).toBeVisible();
    await expect(page.getByText('Unknown')).toHaveCount(0);
    await shot(page, OUT, `C03-${tag}-04-verify.png`);
    console.log(`[C03] pressed: ${no} → revision 2 (province เชียงใหม่), revision 1 archived`);
  }
});
