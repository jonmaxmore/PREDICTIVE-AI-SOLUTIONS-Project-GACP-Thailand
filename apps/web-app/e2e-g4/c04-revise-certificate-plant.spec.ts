/**
 * C04 — "ฉบับแก้ไขครั้งที่ 2" for the two live certificates whose plant was recorded as the
 * literal Herb (ledger F-G4-58), through the same admin door as C03, under the same number.
 *
 * Two-state per certificate: a certificate already at revisionNo >= 3 (or whose cropType is
 * no longer Herb) is VERIFIED, never re-pressed. Runs as the admin officer.
 */
import { test, expect } from '@playwright/test';
import { g4Login, g4psql, seg, shot } from './g4-helpers';

const OUT = seg('c04');
const CERTS = ['GACP-TH-2569-E5960D', 'GACP-TH-2569-4C3761'];
const REASON =
  'ระบบบันทึกพืชเป็น Herb ตอนออกใบ (F-G4-58) ทั้งที่คำขอระบุ กัญชา ตามทะเบียนพืช '
  + 'ออกฉบับแก้ไขจากทะเบียนพืช ผู้ขอไม่ได้ทำอะไรผิด';

type Row = { id: string; revisionNo: number; cropType: string; status: string };

function readCert(no: string): Row {
  const rows = JSON.parse(g4psql(
    `SELECT id, "revisionNo", "cropType", status FROM certificates WHERE "certificateNumber"='${no}';`,
  )) as Row[];
  expect(rows.length, `${no} exists`).toBe(1);
  return rows[0];
}

test('C04 admin issues the plant revision for the two Herb certificates', async ({ page }) => {
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

    if (before.cropType !== 'Herb') {
      console.log(`[C04] ${no} already names the plant (${before.cropType}, revision ${before.revisionNo}) — verifying, not re-pressing`);
      await expect(page.getByText(`ฉบับแก้ไขครั้งที่ ${before.revisionNo - 1}`).first()).toBeVisible();
      continue;
    }
    const expectedRevisionNo = before.revisionNo + 1;

    await page.getByRole('button', { name: /ออกฉบับแก้ไขจาก/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('พืชสมุนไพร');
    await expect(dialog).toContainText('Herb');
    await expect(dialog).toContainText('กัญชา');
    await shot(page, OUT, `C04-${tag}-01-diff.png`);

    const confirm = dialog.getByRole('button', { name: /ยืนยันออกฉบับแก้ไข/ });
    await expect(confirm).toBeDisabled();
    await dialog.locator('textarea').fill(REASON);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog).toBeHidden({ timeout: 90_000 });
    await expect(page.getByText(new RegExp(`ออกฉบับแก้ไขครั้งที่ ${expectedRevisionNo - 1} ของใบรับรอง`))).toBeVisible({ timeout: 30_000 });
    await shot(page, OUT, `C04-${tag}-02-revised.png`);

    let after = readCert(no);
    for (let i = 0; i < 15 && after.revisionNo < expectedRevisionNo; i++) { await page.waitForTimeout(2000); after = readCert(no); }
    expect(after.revisionNo).toBe(expectedRevisionNo);
    expect(after.cropType).toBe('กัญชา');
    const archived = JSON.parse(g4psql(
      `SELECT "revisionNo", "correctedFields", snapshot->>'cropType' AS crop FROM certificate_revisions WHERE "certificateId"='${before.id}' ORDER BY "revisionNo";`,
    )) as Array<{ revisionNo: number; correctedFields: string[]; crop: string }>;
    expect(archived.length).toBe(expectedRevisionNo - 1);
    expect(archived[archived.length - 1].correctedFields).toContain('cropType');
    expect(archived[archived.length - 1].crop).toBe('Herb');

    await page.goto(`/verify/${no}`);
    await expect(page.getByText(`ฉบับแก้ไขครั้งที่ ${expectedRevisionNo - 1}`).first()).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText('กัญชา').first()).toBeVisible();
    await expect(page.getByText('Herb')).toHaveCount(0);
    await shot(page, OUT, `C04-${tag}-03-verify.png`);
    console.log(`[C04] pressed: ${no} → revision ${expectedRevisionNo} (พืชสมุนไพร กัญชา), revision ${expectedRevisionNo - 1} archived with Herb`);
  }
});
