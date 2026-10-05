/**
 * C06 — the public QR verifier explains a non-valid certificate in Thai (ledger F-G4-57).
 *
 * Before: /verify/<revoked> printed 'ใบรับรองไม่ถูกต้อง' over the backend's English sentence
 * ('Certificate has been revoked'). Now the backend sends a machine `reasonCode` and the page
 * maps it to Thai copy; a superseded certificate points at its successor.
 *
 * Public page, no login. Read-only: nothing is pressed that changes the register.
 *   CAE820 — revoked by the C01 press (2026-08-27) → 'ใบรับรองถูกเพิกถอนแล้ว'
 *   E5960D — in force → the green hero, and no revoked/expired copy anywhere
 *   NOSUCH — never issued → 'ไม่พบใบรับรองเลขที่นี้ในทะเบียน' (fix round 2, C2-3a)
 *   E5960D?code=WRONGCODE — the wrong-code QR (fix round 2, C2-3b): the backend classifies it
 *     CODE_MISMATCH, but the page drops the query param, so this press pins the GAP, not the copy
 * The demo register holds no 'renewed' certificate, so the successor link is proven by unit
 * test only (apps/web-app/src/app/(public)/verify/[cert-number]/__tests__/verify-status-reason.test.tsx).
 */
import { test, expect } from '@playwright/test';
import { seg, shot } from './g4-helpers';

const OUT = seg('c06');
const REVOKED = 'GACP-TH-2569-CAE820';
const ACTIVE = 'GACP-TH-2569-E5960D';
/** A number that was never issued: the not-found path, no fixture needed. */
const MISSING = 'GACP-TH-2569-NOSUCH';

test('C06 verifier: revoked certificate is explained in Thai, active certificate stays green', async ({ page }) => {
  test.setTimeout(300_000);

  await page.goto(`/verify/${REVOKED}`);
  await expect(page.getByText('ใบรับรองถูกเพิกถอนแล้ว')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('หน่วยรับรองเพิกถอนใบรับรองฉบับนี้แล้ว ใช้อ้างอิงไม่ได้อีก')).toBeVisible();
  await expect(page.getByText('Certificate Invalid', { exact: true })).toHaveCount(0);
  await expect(page.getByText('ใบรับรองไม่ถูกต้อง', { exact: true })).toHaveCount(0);
  await expect(page.getByText('ใบรับรองถูกต้องและยังมีผลบังคับใช้')).toHaveCount(0);
  await shot(page, OUT, 'C06-01-revoked-thai-reason.png');

  await page.goto(`/verify/${ACTIVE}`);
  await expect(page.getByText('ใบรับรองถูกต้องและยังมีผลบังคับใช้')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('ใบรับรองถูกเพิกถอนแล้ว')).toHaveCount(0);
  await expect(page.getByText('ใบรับรองหมดอายุแล้ว')).toHaveCount(0);
  await shot(page, OUT, 'C06-02-active-green.png');

  // (C2-3a) The commonest citizen failure of all: a number that is not in the
  // register at all. Proven on the live backend before this was written
  // (2026-08-28, GET :8000/api/v1/public/verify/GACP-TH-2569-NOSUCH):
  //   200 {"verified":false,"data":{"status":"invalid",
  //        "reason":"Certificate not found","reasonCode":"NOT_FOUND"}}
  // A definitive verdict, not an outage — so the page must say WHICH failure it
  // is ('ไม่พบใบรับรองเลขที่นี้ในทะเบียน'), never the generic 'ใบรับรองไม่ถูกต้อง'
  // it used to fall back to, and never the backend's English sentence.
  await page.goto(`/verify/${MISSING}`);
  await expect(page.getByText('ไม่พบใบรับรองเลขที่นี้ในทะเบียน')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('Certificate not found', { exact: true })).toHaveCount(0);
  await expect(page.getByText('ใบรับรองไม่ถูกต้อง', { exact: true })).toHaveCount(0);
  await shot(page, OUT, 'C06-03-not-found.png');

  // (C2-3b) A QR whose verification code does not match the document.
  //
  // This press documents a GAP, and asserts what the product really does today
  // rather than what the copy table can do. Two facts, both checked before this
  // was written:
  //   1. the BACKEND classifies it. Live, 2026-08-28:
  //      GET :8000/api/v1/public/verify/GACP-TH-2569-E5960D?code=WRONGCODE →
  //      200 {"verified":false,"data":{"status":"invalid",
  //           "reason":"Invalid verification code","reasonCode":"CODE_MISMATCH"}}
  //      (200 + verified:false, never a 4xx the page would read as an outage;
  //       apps/backend/routes/api/auth/public.js:146 compares `req.query.code`
  //       to certificate.verificationCode with !==, and E5960D does have one —
  //       an absent verificationCode would have skipped the branch and returned
  //       the valid payload instead.)
  //   2. the PAGE never asks the question. Its server component takes `params`
  //      only, and fetchCertificate builds the backend URL from the cert number
  //      alone (page.tsx:71-107 → buildPublicVerifyUrl(base, certNumber)), so
  //      `?code=` is dropped at the door and the citizen is shown the ordinary
  //      valid hero for a QR carrying the wrong code.
  // So CODE_MISMATCH is reachable in the API and in the unit test, and NOT
  // reachable through the page. Pinned as-is: when the page starts forwarding
  // the code, this block must invert (mismatch copy visible, green hero absent)
  // and the screenshot below stops being a picture of the gap.
  await page.goto(`/verify/${ACTIVE}?code=WRONGCODE`);
  await expect(page.getByText('ใบรับรองถูกต้องและยังมีผลบังคับใช้')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('รหัสตรวจสอบไม่ตรงกับใบรับรอง', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Invalid verification code', { exact: true })).toHaveCount(0);
  // Not the outage branch either: a dropped query param must not look like a
  // backend that could not answer.
  await expect(page.getByText('ไม่สามารถตรวจสอบได้ในขณะนี้', { exact: true })).toHaveCount(0);
  await shot(page, OUT, 'C06-04-code-mismatch.png');

  console.log(`[C06] pressed: ${REVOKED} → Thai revoked copy; ${ACTIVE} → green hero`);
  console.log(`[C06] pressed: ${MISSING} → 'ไม่พบใบรับรองเลขที่นี้ในทะเบียน'`);
  console.log(`[C06] pressed: ${ACTIVE}?code=WRONGCODE → page ignores ?code=, green hero (GAP: CODE_MISMATCH unreachable from the page)`);
});