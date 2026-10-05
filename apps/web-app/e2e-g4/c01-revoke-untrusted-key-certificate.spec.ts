/**
 * C01 — revoke GACP-TH-2569-CAE820 through the real admin door.
 *
 * Why this certificate: it was signed on 2026-08-26 by a key the deployment no longer
 * trusts (the key was rotated by a test run — the change log 2026-08-26, ledger
 * F-G4-24). The public verifier answers signed:true valid:false for it; the row is
 * still 'active'. Revoking it through the UI records the honest reason on the register
 * instead of teaching the deployment to trust the lost key.
 *
 * Two-state, like every G4 step: if the certificate is already revoked (an earlier run
 * did it), the spec VERIFIES the revoked panel and does not press again.
 *
 * Runs as the admin officer (G4_ADMIN_ID / G4_ADMIN_PW from the runner's env; the
 * runner reads them from the credentials file into the environment — never from source).
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { g4Login } from './g4-helpers';

const CERT_ID = 'a1e74a31-50f0-478e-9dc5-b841d0ff0bbe';
const CERT_NO = 'GACP-TH-2569-CAE820';
const REASON =
  'ใบรับรองนี้ลงนามด้วยคีย์ที่ระบบไม่เชื่อถือ (คีย์ถูกหมุนโดยการรันเทสเมื่อ 2026-08-26 ก่อนที่ระบบจะมีการป้องกัน) '
  + 'ผู้ตรวจสอบสาธารณะจึงตอบว่าลายเซ็นไม่ถูกต้อง เพิกถอนเพื่อให้ทะเบียนตรงกับความจริง และออกใบใหม่ด้วยคีย์ที่เชื่อถือได้เมื่อจำเป็น';

// __dirname = apps/web-app/e2e-g4 → repo root is three levels up.
const EVIDENCE = path.resolve(__dirname, '../../../evidence/g4-rebuild-2026-08-25/c01');

test('C01 admin revokes the untrusted-key certificate through the real door', async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(EVIDENCE, { recursive: true });

  const id = process.env.G4_ADMIN_ID || '';
  const pw = process.env.G4_ADMIN_PW || '';
  expect(id, 'G4_ADMIN_ID must be in the environment').not.toBe('');
  expect(pw, 'G4_ADMIN_PW must be in the environment').not.toBe('');

  await g4Login(page, { kind: 'provider', id, pw });

  await page.goto(`/admin/certificates/${CERT_ID}`);
  // The number appears twice on the page (heading + copy control); the heading is the anchor.
  await expect(page.getByRole('heading', { level: 1, name: CERT_NO })).toBeVisible({ timeout: 120_000 });
  await page.screenshot({ path: path.join(EVIDENCE, 'C01-01-detail-before.png'), fullPage: true });

  const alreadyRevoked = await page.getByText('ใบรับรองนี้ถูกเพิกถอน').isVisible().catch(() => false);
  if (alreadyRevoked) {
    console.log('[C01] certificate already revoked — verifying, not re-pressing');
    await expect(page.getByRole('button', { name: /เพิกถอนใบรับรอง/ })).toHaveCount(0);
    await page.screenshot({ path: path.join(EVIDENCE, 'C01-02-already-revoked.png'), fullPage: true });
    return;
  }

  await page.getByRole('button', { name: /เพิกถอนใบรับรอง/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE, 'C01-02-dialog-open.png'), fullPage: true });

  const confirm = dialog.getByRole('button', { name: /ยืนยันการเพิกถอน/ });
  await expect(confirm, 'confirm must be disabled until a reason is given').toBeDisabled();

  await dialog.locator('textarea').fill(REASON);
  await expect(confirm).toBeEnabled();
  await page.screenshot({ path: path.join(EVIDENCE, 'C01-03-reason-filled.png'), fullPage: true });

  await confirm.click();

  await expect(page.getByText('ใบรับรองนี้ถูกเพิกถอน')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(REASON.slice(0, 40))).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE, 'C01-04-revoked.png'), fullPage: true });
  console.log(`[C01] pressed: ${CERT_NO} revoked through /admin/certificates/${CERT_ID}`);
});
