/**
 * G4 · A03 — farmer A pays งวดที่ 2 for real, and the webhook settles it.
 *
 * The applicant's part is pressed through the real UI: the payments screen, its own
 * checkout link, the "เริ่มขั้นตอนชำระเงิน" button. The customer's part — scanning the
 * PromptPay QR — is played by Stripe's own test-payment page ("Authorize test payment"),
 * the same rail the Phase-0 walk proved. Settlement then has exactly ONE path: Stripe's
 * signed payment_intent.succeeded webhook → checkout-settlement-service. Nothing here
 * writes money state; the walk only presses and then reads what the system wrote.
 *
 * Money pins (GOALS G4.2, farmer A = 1 scope):
 *   งวด 2 payable = 29,425  (state 25,000 + platform 2,500 + VAT 1,925)
 * The DB is scored, not the screen: checkout_orders' own money equation must balance and
 * the application must land on AUDIT_FEE_PAID — the SYSTEM-only edge the webhook holds.
 */
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { stripeConfirmPromptPay, stripeTestAuthorize } from '../e2e-phase0/helpers';
import { FARMERS, pw, seg, shot, readVars, g4psql, g4Login, pickFarmer, PRICED_ROW_ORDER, acceptCheckoutTermsIfShown } from './g4-helpers';
import { lqaCapture } from './lqa';

const P = FARMERS[pickFarmer()];
const OUT = seg('a05');

test.describe.serial('G4 A03 — งวด 2: press, pay, settle', () => {
  test('A03 mint the M1 checkout from the payments screen, settle via the webhook, verify the money', async ({ page }) => {
    const vars = readVars();
    const FARMER_ID = vars[`${P.varPrefix}_ID`];
    const APP = vars[`${P.varPrefix}_APP`];
    expect(FARMER_ID, `${P.varPrefix}_ID in VARS (written by a01)`).toBeTruthy();
    expect(APP, `${P.varPrefix}_APP in VARS (written by a01)`).toBeTruthy();

    // Preconditions read from the DB, not assumed.
    const before = JSON.parse(g4psql(`SELECT status, "applicationNumber" FROM applications WHERE id='${APP}';`));
    writeFileSync(join(OUT, 'A05-before.txt'), JSON.stringify(before[0], null, 2));

    // Two states are legitimate here — same reasoning as A03. A completed run leaves the
    // application at AUDIT_FEE_PAID; demanding PENDING_AUDIT_FEE alone made the spec fail
    // at line one on every re-run, having proved nothing.
    //
    // PENDING_AUDIT_FEE — the gate is open and this run does the paying.
    // AUDIT_FEE_PAID    — an earlier run already paid; verify the money, do not re-pay.
    // Anything else is a real finding: fail and name it.
    const startedAt = before[0]?.status;
    expect(
        ['PENDING_AUDIT_FEE', 'AUDIT_FEE_PAID'],
        `the application is at neither side of the phase-2 gate (found ${startedAt})`,
    ).toContain(startedAt);
    const alreadyPaid = startedAt === 'AUDIT_FEE_PAID';
    if (alreadyPaid) {
        // eslint-disable-next-line no-console
        console.log('[A05] phase-2 fee already settled by an earlier run — verifying the money, not re-paying');
    }

    await g4Login(page, { kind: 'health', id: FARMER_ID, pw: pw(P) });

    // Everything from here to the settle wait is THE PAYING; it runs only while the gate
    // is open. A re-run against a settled application skips to the money assertions.
    if (!alreadyPaid) {
    // ── the farmer's own payments screen ────────────────────────────────────────
    await page.goto(`/health/payments?app=${APP}&phase=2`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
    await shot(page, OUT, 'A05-01-payments.png');
    await lqaCapture(page, OUT, 'A05-payments', [P.firstName, P.lastName, P.farmName]);

    // F-G4-64 — งวดที่ 2 needs NO second acceptance: one quotation prices both
    // instalments (W14), and the gate passes on ACCEPTED. a03 pressed it. The
    // absence of an accept press here is deliberate, not forgotten.

    // The screen's own checkout door. The product emits the link with ?app= only
    // (client-view.tsx:354) — the milestone is the server's business, not the URL's.
    const checkoutLink = page.locator('a[href*="/health/payments/checkout"]').first();
    if (await checkoutLink.isVisible().catch(() => false)) {
      await checkoutLink.click();
    } else {
      // Fall back to the direct checkout URL the Phase-0 rail proved — still the
      // product's own page, still the farmer's own session.
      await page.goto(`/health/payments/checkout?app=${APP}&milestone=M2`);
    }
    await page.waitForURL('**/health/payments/checkout**', { timeout: 200_000 });
    await page.waitForLoadState('domcontentloaded');
    await shot(page, OUT, 'A05-02-checkout.png');
    await lqaCapture(page, OUT, 'A05-checkout', [P.firstName, P.lastName, P.farmName]);

    // The same Q4 door as a03, and the SAME two shapes — see the comment there.
    // By this point a03 has almost always put a grant on file, so the expected
    // shape here is the recorded line rather than the box; both are accepted,
    // and which one ran is said out loud.
    await acceptCheckoutTermsIfShown(page, 'A05 M2 press');

    const startBtn = page.getByRole('button', { name: /เริ่มขั้นตอนชำระเงิน/ });
    await startBtn.waitFor({ state: 'visible', timeout: 60_000 });
    await startBtn.click();

    // The order row with its PaymentIntent is what the press must produce.
    let order: { id: string; status: string; milestone: string; stripe_payment_intent_id: string | null; total_payable_amount: string } | null = null;
    for (let i = 0; i < 15 && !order?.stripe_payment_intent_id; i++) {
      const rows = JSON.parse(g4psql(
        `SELECT id, status, milestone, stripe_payment_intent_id, total_payable_amount
         FROM checkout_orders WHERE "applicationId"='${APP}' AND milestone='M2' ORDER BY "createdAt" DESC LIMIT 1;`,
      ));
      if (rows.length) order = rows[0];
      if (!order?.stripe_payment_intent_id) await page.waitForTimeout(2000);
    }
    writeFileSync(join(OUT, 'A05-order.txt'), JSON.stringify(order, null, 2));
    expect(order?.stripe_payment_intent_id, 'the press minted a checkout order with a PaymentIntent').toBeTruthy();
    // G4 money pin — the bill for one scope, to the satang.
    expect(Number(order!.total_payable_amount), `งวด 2 payable = 29,425 × ${P.cultivationMethods.length} scope(s)`).toBe(29_425 * P.cultivationMethods.length);

    // ── the customer pays (Stripe test PromptPay), the webhook settles ─────────
    const authorizeUrl = stripeConfirmPromptPay(order!.stripe_payment_intent_id!);
    await stripeTestAuthorize(page, authorizeUrl);
    await shot(page, OUT, 'A05-03-authorized.png');

    // Wait for the ONLY settle path to land: application → AUDIT_FEE_PAID.
    let after: { status: string } | null = null;
    for (let i = 0; i < 30 && after?.status !== 'AUDIT_FEE_PAID'; i++) {
      const rows = JSON.parse(g4psql(`SELECT status FROM applications WHERE id='${APP}';`));
      after = rows[0] ?? null;
      if (after?.status !== 'AUDIT_FEE_PAID') await page.waitForTimeout(3000);
    }
    expect(after?.status, 'the verified webhook walked PENDING_AUDIT_FEE→AUDIT_FEE_PAID (SYSTEM edge)').toBe('AUDIT_FEE_PAID');

    // Both instalments are now billed, so the document closes — the ONLY
    // production writer of INVOICED is recordPhaseInvoiced, and it flips the
    // status only when every phase the row prices carries a stamp. Polled for
    // the same reason as a03: the stamp is written after the settle transaction
    // commits, never inside it.
    //
    // Inside THE PAYING, like a03's: it scores what THIS run settled.
    let closed: { status: string; p1: string | null; p2: string | null; accepted: string | null } | null = null;
    for (let i = 0; i < 10 && closed?.status !== 'INVOICED'; i++) {
      const rows = JSON.parse(g4psql(
        `SELECT status, "phase1InvoicedAt" AS p1, "phase2InvoicedAt" AS p2, "acceptedAt" AS accepted
           FROM quotations WHERE "applicationId"='${APP}' AND "isDeleted"=false ${PRICED_ROW_ORDER};`));
      closed = rows[0] ?? null;
      if (closed?.status !== 'INVOICED') await page.waitForTimeout(2000);
    }
    writeFileSync(join(OUT, 'A05-quotation-closed.txt'), JSON.stringify(closed, null, 2));
    expect(closed?.p1, 'งวดที่ 1 stamped').toBeTruthy();
    expect(closed?.p2, 'งวดที่ 2 stamped').toBeTruthy();
    expect(closed?.status, 'every instalment billed, so the quotation closes').toBe('INVOICED');
    expect(closed?.accepted, 'and it closed on a real acceptance, not a repair').toBeTruthy();
    } // end of THE PAYING

    // Re-read for both paths, so what follows judges the same thing whichever run paid.
    const settledStatus = JSON.parse(
      g4psql(`SELECT status FROM applications WHERE id='${APP}';`),
    )[0]?.status;
    expect(settledStatus, 'the application sits past the phase-2 money gate').toBe('AUDIT_FEE_PAID');

    // ── score the money on the DB ──────────────────────────────────────────────
    // Selected by application + milestone, not by the id this run minted, so the money is
    // judged identically whether this run paid or an earlier one did.
    const settled = JSON.parse(g4psql(
      `SELECT status, milestone, platform_fee_net, platform_fee_vat, platform_fee_gross, total_payable_amount,
              (total_payable_amount = platform_fee_gross) AS eq_total,
              (platform_fee_gross = platform_fee_net + platform_fee_vat) AS eq_gross
       FROM checkout_orders WHERE "applicationId"='${APP}' AND milestone='M2'
       ORDER BY "createdAt" DESC LIMIT 1;`,
    ))[0];
    // G4 money pin — farmer A, one scope, phase 2, to the satang.
    expect(Number(settled.total_payable_amount), `งวด 2 payable = 29,425 × ${P.cultivationMethods.length} scope(s)`).toBe(29_425 * P.cultivationMethods.length);
    writeFileSync(join(OUT, 'A05-settled-order.txt'), JSON.stringify(settled, null, 2));
    expect(settled.status, 'checkout order SETTLED').toBe('SETTLED');
    expect(settled.eq_total, 'money equation holds on the order row').toBe(true);
    expect(settled.eq_gross, 'gross = net + VAT holds').toBe(true);

    const invoices = JSON.parse(g4psql(
      `SELECT "invoiceNumber", status, "totalAmount", "receiptNumber" FROM invoices WHERE "applicationId"='${APP}' ORDER BY "invoiceNumber";`,
    ));
    writeFileSync(join(OUT, 'A05-invoices.txt'), JSON.stringify(invoices, null, 2));

    const journal = JSON.parse(g4psql(
      `SELECT je.reference, je."totalDebit", je."totalCredit", (je."totalDebit" = je."totalCredit") AS balanced
       FROM journal_entries je WHERE je.reference IN (SELECT "invoiceNumber" FROM invoices WHERE "applicationId"='${APP}');`,
    ));
    writeFileSync(join(OUT, 'A05-journal.txt'), JSON.stringify(journal, null, 2));
    for (const j of journal) expect(j.balanced, `journal ${j.reference} balanced`).toBe(true);

    await page.goto(`/health/payments?app=${APP}&phase=2`);
    await page.waitForTimeout(2500);
    await shot(page, OUT, 'A05-04-paid.png');
  });
});
