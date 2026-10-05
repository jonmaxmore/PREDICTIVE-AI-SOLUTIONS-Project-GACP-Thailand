/**
 * C02 — the farmer's payments screen after the two repair scripts (F-G4-35 / F-G4-36).
 *
 * The scripts (apps/backend/scripts/void-phase-split-ghost-invoices.js --apply --expect=8,
 * bind-checkout-receipts-to-invoices.js --apply --expect=4) are the operator's to run (L3).
 * This spec does not run them. It reads the database first and says which world it is in:
 *
 *   NOT REPAIRED — ghost PHASE_* invoices are still pending → fail, naming the count.
 *   REPAIRED     — 0 pending ghosts, receipt columns bound → walk the real screen and
 *                  require ยอดรอชำระ ฿0 and one "ออกใบเสร็จแล้ว" row per settled milestone.
 *
 * Runs as the G4_FARMER (A default, B with G4_FARMER=B); ids from VARS, password from the runner's env.
 */
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { FARMERS, pw, seg, readVars, g4psql, g4Login, pickFarmer } from './g4-helpers';

const P = FARMERS[pickFarmer()];
// One evidence folder per farmer: farmer B's run once overwrote farmer A's screenshots
// under a shared 'c02' (both are on main — A's from commit 47087170).
const OUT = seg(P.key === 'A' ? 'c02' : `c02-${P.key.toLowerCase()}`);

test('C02 payments screen shows no ghost debt and the issued receipts', async ({ page }) => {
  test.setTimeout(300_000);
  const vars = readVars();
  const FARMER_ID = vars[`${P.varPrefix}_ID`];
  const APP = vars[`${P.varPrefix}_APP`];
  expect(FARMER_ID, `${P.varPrefix}_ID in VARS (written by a01)`).toBeTruthy();
  expect(APP, `${P.varPrefix}_APP in VARS (written by a01)`).toBeTruthy();

  const ghosts = JSON.parse(g4psql(
    `SELECT count(*)::int AS n, coalesce(sum("totalAmount"),0)::text AS sum FROM invoices `
    + `WHERE "applicationId"='${APP}' AND "isDeleted"=false AND status IN ('pending','PENDING') `
    + `AND "serviceType" LIKE 'PHASE\\_%\\_FEE';`,
  ))[0];
  const receipts = JSON.parse(g4psql(
    `SELECT "serviceType" AS st, "receiptNumber" AS rcpt, "receiptStatus" AS rs, "receiptIssuedAt" AS issued FROM invoices `
    + `WHERE "applicationId"='${APP}' AND "serviceType" LIKE 'CERTIFICATION\\_CHECKOUT\\_%' ORDER BY "serviceType";`,
  ));
  console.log(`[C02] DB: ghost pending PHASE_* invoices = ${ghosts.n} (sum ${ghosts.sum}); checkout receipts = ${JSON.stringify(receipts)}`);

  if (Number(ghosts.n) > 0 || receipts.some((r: { rcpt: string | null }) => !r.rcpt)) {
    console.log('[C02] NOT REPAIRED — the operator has not run the --apply scripts yet');
  }
  expect(Number(ghosts.n), 'ghost split invoices still pending (void --apply not run)').toBe(0);
  expect(receipts.length, 'settled checkout invoices for this application').toBeGreaterThanOrEqual(1);
  for (const r of receipts) {
    expect(r.rcpt, `${r.st} has no receipt number (bind --apply not run)`).toMatch(/^TAX-PRD-/);
    expect(r.rs).toBe('ISSUED');
    // The date is read from the same register as the number. If it is missing,
    // that is the state of the row, not a screen that failed to print it — the
    // message says so, so nobody debugs the UI for a bind that never ran.
    expect(r.issued, `${r.st} has no receiptIssuedAt (bind --apply not run)`).toBeTruthy();
  }

  await g4Login(page, { kind: 'health', id: FARMER_ID, pw: pw(P) });
  await page.goto(`/health/payments?app=${APP}`);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByText('ยอดรอชำระ')).toBeVisible({ timeout: 120_000 });
  // Wait for the LIST, not a timer: the first run screenshotted the skeleton (฿0 / ฿0
  // and grey bars) 2.5 s in, while the real rows arrived later — a picture of "loading"
  // is not evidence of anything. The paid checkout rows are the anchor.
  // Since F-G4-48 a checkout invoice renders as the phase's own card (heading งวดที่ N),
  // not as an INV-CO-… row in the legacy table; the phase heading is the anchor now.
  await expect(page.getByRole('heading', { name: /^งวดที่ 1/ }).first()).toBeVisible({ timeout: 120_000 });
  await page.screenshot({ path: join(OUT, 'C02-01-payments-after-repair.png'), fullPage: true });

  // The KPI card: label "ยอดรอชำระ" with the amount in its own element right above it.
  const pendingCard = page.getByText('ยอดรอชำระ').locator('xpath=..');
  await expect(pendingCard).toContainText('฿0');

  // The paid card must carry the two settled milestones: (5,885 + 29,425) × scope = 35,310 per scope.
  const paidTotal = (35_310 * P.cultivationMethods.length).toLocaleString('en-US');
  const paidCard = page.getByText('ยอดที่ชำระแล้ว').locator('xpath=..');
  await expect(paidCard).toContainText(paidTotal);

  // Every settled checkout invoice shows as "ออกใบเสร็จแล้ว" (the page renders the chip
  // once per layout — desktop table and mobile card — so count rows, not chips);
  // no "รอชำระเงิน" chip is left anywhere for the voided ghosts.
  // Each settled milestone's card carries its amount (5,885 / 29,425 per scope) and reads
  // ชำระแล้ว; the receipt number itself is asserted from the DB above (the card shows the
  // receipt state only in its detail modal — ledger F-G4-53).
  const scope = P.cultivationMethods.length;
  for (const r of receipts) {
    const phase = r.st.endsWith('_M2') ? 2 : 1;
    const amount = ((phase === 2 ? 29_425 : 5_885) * scope).toLocaleString('en-US');
    const section = page.getByRole('heading', { name: new RegExp(`^งวดที่ ${phase}`) }).first().locator('xpath=ancestor::section[1] | ancestor::div[contains(@class,"rounded")][1]').first();
    await expect(section).toContainText(amount);
    await expect(section).toContainText('ชำระแล้ว');
  }
  await expect(page.getByText('รอชำระเงิน', { exact: true })).toHaveCount(0);
  await expect(page.getByText('ไม่ระบุงวด')).toHaveCount(0);

  // F-G4-53 (finish): the detail modal lists the receipt number and its issue date, so the
  // applicant can quote the TAX-PRD number from the screen, not only from the card chip.
  const m1 = (receipts as Array<{ st: string; rcpt: string | null }>).find((r) => r.st.endsWith('_M1'));
  // Not optional: a run without a settled _M1 has nothing to prove here, and a
  // silently skipped block would report that as a pass.
  expect(m1, 'a settled _M1 checkout invoice for this application').toBeTruthy();
  const m1Section = page.getByRole('heading', { name: /^งวดที่ 1/ }).first().locator('xpath=ancestor::section[1] | ancestor::div[contains(@class,"rounded")][1]').first();
  await m1Section.getByRole('button', { name: 'ดูรายละเอียด' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  // The row label is the card's own document name ('ใบเสร็จ/ใบกำกับภาษี' for the
  // company side, 'ใบเสร็จรับเงิน' for the state) glued to เลขที่. Matching bare
  // /เลขที่/ proved nothing: the dialog always carries a เลขที่เอกสาร row, so that
  // pattern passed on a modal with no receipt at all. 'เลขที่ใบเสร็จ' is the
  // shared head of both per-side names and matches neither เลขที่เอกสาร nor
  // เลขที่ใบแจ้งหนี้.
  await expect(dialog).toContainText(/เลขที่ใบเสร็จ/);
  await expect(dialog).toContainText((m1 as { rcpt: string | null }).rcpt as string);
  await expect(dialog).toContainText('วันที่ออกใบเสร็จ');
  await expect(dialog).toContainText('2569');
  await page.screenshot({ path: join(OUT, 'C02-03-detail-modal-receipt.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'ปิดหน้าต่างรายละเอียดใบแจ้งหนี้' }).first().click();
  await expect(dialog).toBeHidden();
  console.log(`[C02] detail modal of งวดที่ 1 lists receipt ${(m1 as { rcpt: string | null }).rcpt}`);

  // The cancelled ghosts are still visible under ทั้งหมด, labelled honestly.
  const cancelledChips = await page.getByText('ยกเลิกแล้ว').count();
  console.log(`[C02] cancelled chips on ทั้งหมด: ${cancelledChips}`);
  await page.screenshot({ path: join(OUT, 'C02-02-payments-all-tab.png'), fullPage: true });
  console.log(`[C02] REPAIRED — ยอดรอชำระ ฿0, ${receipts.length} receipt row(s), ${cancelledChips} cancelled row(s)`);
});
