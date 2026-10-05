/**
 * PHASE 0 — Task 7 — SETTLEMENT PROOF (real Postgres + view-in-the-loop).
 *
 * The C04 that failed before (F-SETTLE-TX-LOST: the settle tx timed out at
 * Prisma's 5s default over Supabase latency) is fixed on feat/settlement-
 * resilience — the settle tx now carries a 30s timeout + a SELECT…FOR UPDATE
 * order lock (checkout-settlement-service.js). This spec re-drives C03→C04 on a
 * fresh farmer's PENDING_DOC_FEE application and asserts the settle COMPLETES:
 *   checkout_orders=SETTLED, application=DOC_FEE_PAID,
 *   stripe_webhook_events(payment_intent.succeeded) processed (status=PROCESSED),
 *   and dumpErp shows a balanced journal (totalDebit==totalCredit, lines balance)
 *   + a receipt (invoices.receiptNumber). That is the money shot.
 *
 * Reads FARMER_MAIN_ID / FARMER_MAIN_APP from VARS (s01, at PENDING_DOC_FEE).
 * Farmer password via PHASE0_FARMER_PW (run command, never committed — G-3).
 * VERIFICATION ONLY — real UI + real Stripe test PromptPay + real webhook; if it
 * still does not settle, the DB signal (stripe_webhook_events.error) is captured
 * and reported truthfully — never faked.
 */
import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  login, dump, auditDump, dumpErp, psql, readVars, saveVars, EV,
  stripeConfirmPromptPay, stripeTestAuthorize, expectedPhaseFees, scopeCountOf,
  acceptCheckoutTermsIfShown,
  acceptQuotationsIfShown,
} from './helpers';

const SEG = 'settlement';
const OUT = join(EV, SEG);
mkdirSync(OUT, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, name), fullPage: true });

async function healthLanding(page: Page) {
  await page.waitForURL(/\/health\/(dashboard|payments|applications|onboarding|start|profile)/, { timeout: 120_000 });
  await page.waitForLoadState('domcontentloaded');
}

test.describe.serial('Phase0 Task7 — Stripe settlement completes (C03 checkout → C04 SETTLED + ERP)', () => {
  test('C03 checkout PI → C04 settle to SETTLED/DOC_FEE_PAID + balanced journal + receipt', async ({ page }) => {
    const V = readVars();
    const APP = V.FARMER_MAIN_APP;
    const FARMER_ID = V.FARMER_MAIN_ID;
    const FARMER_PW = process.env.PHASE0_FARMER_PW || '';
    expect(APP, 'FARMER_MAIN_APP present in VARS (from s01)').toBeTruthy();
    expect(FARMER_ID, 'FARMER_MAIN_ID present in VARS (from s01)').toBeTruthy();
    expect(FARMER_PW, 'PHASE0_FARMER_PW set in run command').toBeTruthy();

    // ── C03 — farmer creates the Stripe checkout order (PENDING_PAYMENT + PI) ──
    dump(SEG, 'C03', 'before', APP); // expect PENDING_DOC_FEE
    await login(page, { kind: 'health', id: FARMER_ID, pw: FARMER_PW });
    await healthLanding(page);
    // F-G4-64 final round R24: the checkout door runs the quotation gate
    // BEFORE the terms gate (stripe-checkout-service.js) and the gate has no
    // skip branch, so the acceptance is pressed on the farmer own screen first.
    await acceptQuotationsIfShown(page, APP!, 'C03 M1 press');
    await page.goto(`/health/payments/checkout?app=${APP}&milestone=M1`, { timeout: 200_000 });
    await page.waitForLoadState('domcontentloaded');
    await shot(page, 'C03-01-checkout-idle.png');
    const startBtn = page.getByRole('button', { name: /เริ่มขั้นตอนชำระเงิน/ });
    await expect(startBtn, 'checkout UI open with the start button').toBeVisible({ timeout: 30_000 });
    // F-G4-64: the press is disabled until the payment-terms disclosure is
    // answered (checkout/client-view.tsx).
    await acceptCheckoutTermsIfShown(page, 'C03 M1 press');
    const checkoutResp = page.waitForResponse(
      (r) => r.url().includes('/payments/checkout') && r.request().method() === 'POST', { timeout: 90_000 },
    ).catch(() => null);
    await startBtn.click();
    const cr = await checkoutResp;
    writeFileSync(join(OUT, 'C03-checkout-response.txt'), `POST /payments/checkout → status ${cr ? cr.status() : 'none'}`);
    await page.waitForTimeout(3000);
    await shot(page, 'C03-02-checkout-created.png');

    let order: { id: string; status: string; stripe_payment_intent_id: string } | null = null;
    for (let i = 0; i < 10 && !order; i++) {
      const rows = JSON.parse(psql(
        `SELECT id, status, stripe_payment_intent_id FROM checkout_orders WHERE "applicationId"='${APP}' ORDER BY "createdAt" DESC LIMIT 1;`,
      ));
      if (rows.length) order = rows[0];
      else await page.waitForTimeout(2000);
    }
    writeFileSync(join(OUT, 'C03-checkout-order.txt'), JSON.stringify(order, null, 2));
    expect(order!.status, 'C03 checkout_orders = PENDING_PAYMENT').toBe('PENDING_PAYMENT');
    const PI = order!.stripe_payment_intent_id;
    expect(PI, 'PaymentIntent id minted (apiVersion fix)').toBeTruthy();

    // ── C04 — settle via PromptPay test authorize → webhook → SETTLED/DOC_FEE_PAID ──
    dump(SEG, 'C04', 'before', APP);
    const authorizeUrl = stripeConfirmPromptPay(PI);
    await shot(page, 'C04-01-before-authorize.png');
    await stripeTestAuthorize(page, authorizeUrl); // click "Authorize test payment" → PI succeeds
    await shot(page, 'C04-02-after-authorize.png');

    // Let the async settle run uncontended (F-SETTLE-TX-LOST context), then poll slowly.
    await page.waitForTimeout(12_000);
    let orderStatus = '';
    let appStatus = '';
    let settled = false;
    for (let i = 0; i < 20 && !settled; i++) {
      const st = JSON.parse(psql(
        `SELECT (SELECT status FROM checkout_orders WHERE stripe_payment_intent_id='${PI}') AS ord,
                (SELECT status FROM applications WHERE id='${APP}') AS app;`,
      ))[0];
      orderStatus = st?.ord ?? '';
      appStatus = st?.app ?? '';
      settled = orderStatus === 'SETTLED' && appStatus === 'DOC_FEE_PAID';
      if (!settled) await page.waitForTimeout(5000);
    }
    writeFileSync(join(OUT, 'C04-settle.txt'), `checkout_orders=${orderStatus} · application=${appStatus} · settled=${settled}`);

    // Evidence dumps (retry helper psql on pooler flake).
    dump(SEG, 'C04', 'after', APP);
    auditDump(SEG, 'C04', APP);
    dumpErp(SEG, 'C04', APP);
    await page.goto('/health/payments', { timeout: 200_000 }).catch(() => null);
    await page.waitForLoadState('domcontentloaded').catch(() => null);
    await shot(page, 'C04-03-payments-after.png');

    const journal = JSON.parse(psql(
      `SELECT je.id, je."totalDebit", je."totalCredit", (je."totalDebit" = je."totalCredit") AS entry_balanced,
        COALESCE((SELECT SUM(jl.debit) FROM journal_lines jl WHERE jl."entryId"=je.id),0) AS lines_debit,
        COALESCE((SELECT SUM(jl.credit) FROM journal_lines jl WHERE jl."entryId"=je.id),0) AS lines_credit
       FROM journal_entries je
       WHERE je.reference IN (SELECT "invoiceNumber" FROM invoices WHERE "applicationId"='${APP}');`,
    ));
    const invoices = JSON.parse(psql(`SELECT id, status, "receiptNumber" FROM invoices WHERE "applicationId"='${APP}';`));
    // The Stripe rail records receipts as split checkout_documents
    // (PLATFORM_TAX_INVOICE + DTAM_DISBURSAL_RECEIPT), NOT on invoices.receiptNumber
    // (that is the slip rail's field) — checkout-settlement-service.js:212-229.
    const receiptDocs = JSON.parse(psql(
      `SELECT "documentType", "documentNumber" FROM checkout_documents WHERE "checkoutOrderId"='${order!.id}' ORDER BY "documentType";`,
    ));
    const eq = JSON.parse(psql(
      `SELECT (total_payable_amount = platform_fee_gross) AS eq_total,
        (platform_fee_gross = platform_fee_net + platform_fee_vat) AS eq_gross,
        platform_fee_net, platform_fee_vat, total_payable_amount
       FROM checkout_orders WHERE stripe_payment_intent_id='${PI}';`,
    ));
    // Those two equations are STRUCTURAL: they balanced under the retired
    // platform-only-VAT formula too (5,535 = 5,000 + 500 + 35 balances exactly as
    // well as 5,885 = 5,000 + 500 + 385). Only the figures say which formula ran,
    // so the exact งวด-1 amounts are asserted alongside them. scopeCount is read
    // from the column the backend stamped at submit — 1 scope → 5,885,
    // 3 scopes → 17,655.
    const scopeCount = scopeCountOf(String(APP));
    const fee = expectedPhaseFees('PHASE_1', scopeCount);
    const webhook = JSON.parse(psql(
      `SELECT id, type, status, ("processedAt" IS NOT NULL) AS processed, COALESCE(error,'') AS error
       FROM stripe_webhook_events WHERE payload::text LIKE '%${PI}%' AND type='payment_intent.succeeded' ORDER BY "receivedAt" DESC LIMIT 1;`,
    ));
    const succ = webhook[0] || {};
    // Persist the settled event id for the resilience re-drive (PRIORITY 2).
    if (succ.id) saveVars('SETTLED_EVENT_ID', succ.id);
    writeFileSync(
      join(OUT, 'C04-erp-summary.txt'),
      `settle: order=${orderStatus} app=${appStatus}\n` +
        `webhook payment_intent.succeeded: status=${succ.status} processed=${succ.processed} error=${succ.error}\n` +
        `journal entries: ${journal.length}\n${JSON.stringify(journal, null, 2)}\n` +
        `money equation: ${JSON.stringify(eq)}\n` +
        `invoices (status/receipt): ${JSON.stringify(invoices)}\n` +
        `receipt documents (checkout_documents): ${JSON.stringify(receiptDocs)}\n`,
    );

    // Money-shot assertions.
    expect(settled, 'SETTLE COMPLETES: checkout_orders=SETTLED AND application=DOC_FEE_PAID').toBe(true);
    expect(succ.processed, 'payment_intent.succeeded webhook processed (status=PROCESSED)').toBe(true);
    expect(String(succ.error || ''), 'webhook processed with no error').toBe('');
    expect(journal.length, 'ERP journal entries exist for the phase-1 invoices').toBeGreaterThanOrEqual(1);
    expect(
      journal.every((j: { entry_balanced: boolean }) => j.entry_balanced),
      'every journal entry balanced (totalDebit == totalCredit)',
    ).toBe(true);
    expect(
      journal.every((j: { lines_debit: number; lines_credit: number }) => Number(j.lines_debit) === Number(j.lines_credit)),
      'journal lines balance (SUM debit == SUM credit) per entry',
    ).toBe(true);
    expect(eq[0]?.eq_total, 'money equation total_payable = platform_gross (no DTAM part since migration 20260929155037)').toBe(true);
    expect(eq[0]?.eq_gross, 'money equation platform_gross = platform_net + platform_vat').toBe(true);
    // One service fee since 2026-09-11: the whole ค่าบริการ sits in platform_fee_net.
    expect(Number(eq[0]?.platform_fee_net), `งวด-1 ค่าบริการ = ${fee.state + fee.platform}`).toBe(fee.state + fee.platform);
    expect(Number(eq[0]?.platform_fee_vat), `งวด-1 VAT = 7% of the WHOLE service fee = ${fee.vat}; the retired platform-only formula would say ${Math.round(fee.platform * 0.07)}`)
      .toBe(fee.vat);
    expect(Number(eq[0]?.total_payable_amount), `งวด-1 ยอดชำระ = ${fee.total} — the number the farmer actually paid on the Stripe rail`)
      .toBe(fee.total);
    expect(
      receiptDocs.length,
      'settlement issued the split receipt documents (PLATFORM_TAX_INVOICE + DTAM_DISBURSAL_RECEIPT) in checkout_documents',
    ).toBeGreaterThanOrEqual(2);
    // Sanity: the settlement also flips the CHECKOUT invoice to paid.
    expect(
      invoices.filter((i: { status: string }) => i.status === 'paid').length,
      'the checkout invoice is marked paid by the settlement',
    ).toBeGreaterThanOrEqual(1);
  });
});
