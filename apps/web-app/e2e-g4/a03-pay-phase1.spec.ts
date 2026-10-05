/**
 * G4 · A03 — farmer A pays งวดที่ 1 for real, and the webhook settles it.
 *
 * The applicant's part is pressed through the real UI: the payments screen, its own
 * checkout link, the "เริ่มขั้นตอนชำระเงิน" button. The customer's part — scanning the
 * PromptPay QR — is played by Stripe's own test-payment page ("Authorize test payment"),
 * the same rail the Phase-0 walk proved. Settlement then has exactly ONE path: Stripe's
 * signed payment_intent.succeeded webhook → checkout-settlement-service. Nothing here
 * writes money state; the walk only presses and then reads what the system wrote.
 *
 * Money pins (GOALS G4.2, farmer A = 1 scope):
 *   งวด 1 payable = 5,885  (state 5,000 + platform 500 + VAT 385)
 * The DB is scored, not the screen: checkout_orders' own money equation must balance and
 * the application must land on DOC_FEE_PAID — the SYSTEM-only edge the webhook holds.
 */
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { stripeConfirmPromptPay, stripeTestAuthorize } from '../e2e-phase0/helpers';
import { FARMERS, pw, seg, shot, readVars, g4psql, g4Login, pickFarmer, PRICED_ROW_ORDER, acceptCheckoutTermsIfShown } from './g4-helpers';
import { lqaCapture } from './lqa';

const P = FARMERS[pickFarmer()];
const OUT = seg('a03');

test.describe.serial('G4 A03 — งวด 1: press, pay, settle', () => {
  test('A03 mint the M1 checkout from the payments screen, settle via the webhook, verify the money', async ({ page }) => {
    const vars = readVars();
    const FARMER_ID = vars[`${P.varPrefix}_ID`];
    const APP = vars[`${P.varPrefix}_APP`];
    expect(FARMER_ID, `${P.varPrefix}_ID in VARS (written by a01)`).toBeTruthy();
    expect(APP, `${P.varPrefix}_APP in VARS (written by a01)`).toBeTruthy();

    // Preconditions read from the DB, not assumed.
    const before = JSON.parse(g4psql(`SELECT status, "applicationNumber" FROM applications WHERE id='${APP}';`));
    writeFileSync(join(OUT, 'A03-before.txt'), JSON.stringify(before[0], null, 2));

    // TWO states are legitimate here, and demanding only the first made this spec unable to
    // survive its own success: a completed run leaves the application at DOC_FEE_PAID, so
    // the next run failed at line one having proved nothing. That is not a product finding,
    // it is a walk that assumes the world holds still between runs.
    //
    // PENDING_DOC_FEE — the gate is open and this run does the paying.
    // DOC_FEE_PAID    — an earlier run already paid; the money assertions below still have
    //                   to hold, so the walk verifies rather than re-pays.
    // Anything else means the application is not where this step belongs, and that IS a
    // finding: fail, and name what was found.
    const startedAt = before[0]?.status;
    expect(
        ['PENDING_DOC_FEE', 'DOC_FEE_PAID'],
        `the application is at neither side of the phase-1 gate (found ${startedAt})`,
    ).toContain(startedAt);
    const alreadyPaid = startedAt === 'DOC_FEE_PAID';
    if (alreadyPaid) {
        // Say it out loud. A step that silently becomes a no-op is how a walk starts
        // reporting green for work it never did.
        // eslint-disable-next-line no-console
        console.log('[A03] phase-1 fee already settled by an earlier run — verifying the money, not re-paying');
    }

    await g4Login(page, { kind: 'health', id: FARMER_ID, pw: pw(P) });

    // Everything from here to the settle wait is THE PAYING. It runs only when the gate is
    // still open; a re-run against an already-settled application skips to the money
    // assertions below, which are the part that must hold either way.
    if (!alreadyPaid) {
    // ── the farmer's own payments screen ────────────────────────────────────────
    await page.goto(`/health/payments?app=${APP}&phase=1`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
    await shot(page, OUT, 'A03-01-payments.png');
    await lqaCapture(page, OUT, 'A03-payments', [P.firstName, P.lastName, P.farmName]);

    // ── F-G4-64 · the acceptance ────────────────────────────────────────────
    // งวดที่ 1 cannot be created until the applicant accepts the quotation
    // (services/billing/quotation-gate.js — no branch returns a skip). This is a
    // real press on the real card, not a DB nudge: the whole point of the gate is
    // the human act it records.
    //
    // EVERY acceptable card is pressed, not the first one. A pre-W14 application
    // legitimately carries two rows (DTAM + PLATFORM) and the gate demands BOTH,
    // so a walk that pressed only one would report the product refusing a payment
    // the applicant had "accepted".
    //
    // The card's LOADING branch carries the SAME data-testid as the loaded one
    // (QuotationReviewSection renders the skeleton with aria-busy="true"), and
    // this page mounts it with `quotations` still null, so waiting for the
    // section to be "visible" is satisfied by the skeleton. Counting the buttons
    // on the skeleton reads 0, the else-branch below would then print "already
    // accepted" about a quotation that is still PENDING, press nothing, and
    // fifteen seconds later the register poll would fail as "the quotation
    // records the acceptance" — blaming the acceptance route for a press this
    // walk never made, on the money path. So the branch is decided only after
    // the section stops saying it is busy. A section that never loads (no
    // quotation row at all) fails here by name, which is itself the finding:
    // the gate refuses a payment for exactly that reason.
    const quotationCard = page.locator('[data-testid="quotation-review-section"]:not([aria-busy="true"])');
    await expect(
      quotationCard,
      'the quotation card answered — a quotation of record exists for this application',
    ).toBeVisible({ timeout: 60_000 });
    const acceptBtns = quotationCard.getByRole('button', { name: /ยอมรับใบเสนอราคา/ });
    const acceptCount = await acceptBtns.count();
    if (acceptCount > 0) {
      // Always index 0: the pressed button is replaced by the ✓ ยอมรับแล้ว pill,
      // so the next unpressed one becomes the first again.
      for (let i = 0; i < acceptCount; i++) {
        await acceptBtns.first().click();
        await page.waitForTimeout(1500);
      }
    } else {
      // Already accepted by an earlier run. Say so out loud — a step that
      // silently becomes a no-op is how a walk starts reporting green for work
      // it never did (the same rule this spec already applies to alreadyPaid).
      // eslint-disable-next-line no-console
      console.log('[A03] quotation already accepted by an earlier run — verifying, not re-accepting');
    }

    // The register is what is scored, not the screen.
    let quotation: { status: string; acceptedAt: string | null; accepted_by: string | null } | null = null;
    for (let i = 0; i < 10 && quotation?.status !== 'ACCEPTED' && quotation?.status !== 'INVOICED'; i++) {
      const rows = JSON.parse(g4psql(
        `SELECT status, "acceptedAt", "acceptedBy" AS accepted_by FROM quotations
          WHERE "applicationId"='${APP}' AND "isDeleted"=false ${PRICED_ROW_ORDER};`));
      quotation = rows[0] ?? null;
      if (!quotation || !['ACCEPTED', 'INVOICED'].includes(quotation.status)) await page.waitForTimeout(1500);
    }
    writeFileSync(join(OUT, 'A03-quotation.txt'), JSON.stringify(quotation, null, 2));
    expect(['ACCEPTED', 'INVOICED'], 'the quotation records the acceptance').toContain(quotation?.status);
    expect(quotation?.acceptedAt, 'acceptedAt is stamped').toBeTruthy();
    expect(quotation?.accepted_by, 'the acting user is recorded').toBeTruthy();
    await shot(page, OUT, 'A03-01b-quotation-accepted.png');

    // The screen's own checkout door. The product emits the link with ?app= only
    // (client-view.tsx:354) — the milestone is the server's business, not the URL's.
    const checkoutLink = page.locator('a[href*="/health/payments/checkout"]').first();
    if (await checkoutLink.isVisible().catch(() => false)) {
      await checkoutLink.click();
    } else {
      // Fall back to the direct checkout URL the Phase-0 rail proved — still the
      // product's own page, still the farmer's own session.
      await page.goto(`/health/payments/checkout?app=${APP}&milestone=M1`);
    }
    await page.waitForURL('**/health/payments/checkout**', { timeout: 200_000 });
    await page.waitForLoadState('domcontentloaded');
    await shot(page, OUT, 'A03-02-checkout.png');
    await lqaCapture(page, OUT, 'A03-checkout', [P.firstName, P.lastName, P.farmName]);

    // Q4 — the payment-terms acknowledgment, now on this rail too. Before this
    // change no applicant had ever been shown this text (payment_slips has 0
    // rows), so this press is the first time it is actually disclosed.
    //
    // TWO shapes, because coordinator ruling 2 keeps ONE consent namespace: the
    // grant is a UserConsent row per (user, PAYMENT_TERMS), so the FIRST charge
    // shows the tick box and every later one shows "คุณได้ยอมรับเงื่อนไขนี้ไว้แล้ว"
    // instead (checkout/client-view.tsx). A walk that knew only the first shape
    // would time out on its second charge and report a walk failure as a product
    // failure — which is exactly what a05 would have done.
    await acceptCheckoutTermsIfShown(page, 'A03 M1 press');

    const startBtn = page.getByRole('button', { name: /เริ่มขั้นตอนชำระเงิน/ });
    await startBtn.waitFor({ state: 'visible', timeout: 60_000 });
    await startBtn.click();

    // The order row with its PaymentIntent is what the press must produce.
    let order: { id: string; status: string; milestone: string; stripe_payment_intent_id: string | null; total_payable_amount: string } | null = null;
    for (let i = 0; i < 15 && !order?.stripe_payment_intent_id; i++) {
      const rows = JSON.parse(g4psql(
        `SELECT id, status, milestone, stripe_payment_intent_id, total_payable_amount
         FROM checkout_orders WHERE "applicationId"='${APP}' AND milestone='M1' ORDER BY "createdAt" DESC LIMIT 1;`,
      ));
      if (rows.length) order = rows[0];
      if (!order?.stripe_payment_intent_id) await page.waitForTimeout(2000);
    }
    writeFileSync(join(OUT, 'A03-order.txt'), JSON.stringify(order, null, 2));
    expect(order?.stripe_payment_intent_id, 'the press minted a checkout order with a PaymentIntent').toBeTruthy();
    // G4 money pin — the bill for one scope, to the satang.
    expect(Number(order!.total_payable_amount), `งวด 1 payable = 5,885 × ${P.cultivationMethods.length} scope(s)`).toBe(5_885 * P.cultivationMethods.length);

    // ── the customer pays (Stripe test PromptPay), the webhook settles ─────────
    const authorizeUrl = stripeConfirmPromptPay(order!.stripe_payment_intent_id!);
    await stripeTestAuthorize(page, authorizeUrl);
    await shot(page, OUT, 'A03-03-authorized.png');

    // Wait for the ONLY settle path to land: application → DOC_FEE_PAID.
    let after: { status: string } | null = null;
    for (let i = 0; i < 30 && after?.status !== 'DOC_FEE_PAID'; i++) {
      const rows = JSON.parse(g4psql(`SELECT status FROM applications WHERE id='${APP}';`));
      after = rows[0] ?? null;
      if (after?.status !== 'DOC_FEE_PAID') await page.waitForTimeout(3000);
    }
    expect(after?.status, 'the verified webhook walked PENDING_DOC_FEE→DOC_FEE_PAID (SYSTEM edge)').toBe('DOC_FEE_PAID');

    // The quotation's งวดที่ 1 instalment is stamped by settlement, and the
    // document is NOT closed yet, because งวดที่ 2 has not been billed.
    //
    // Polled, not read once: recordPhaseInvoiced runs AFTER the settle
    // transaction commits and deliberately never throws back into it
    // (quotation-service.recordPhaseInvoiced), so the stamp lands a beat after
    // the application status this loop above already waited for.
    //
    // Inside THE PAYING on purpose: it scores what THIS run's settlement wrote.
    // A re-run skips it because a document closed by an earlier, pre-gate
    // payment (or by the repair script, which closes to INVOICED with acceptedAt
    // null) legitimately fails these three lines.
    let closed: { status: string; p1: string | null; p2: string | null } | null = null;
    for (let i = 0; i < 10 && !closed?.p1; i++) {
      const rows = JSON.parse(g4psql(
        `SELECT status, "phase1InvoicedAt" AS p1, "phase2InvoicedAt" AS p2 FROM quotations
          WHERE "applicationId"='${APP}' AND "isDeleted"=false ${PRICED_ROW_ORDER};`));
      closed = rows[0] ?? null;
      if (!closed?.p1) await page.waitForTimeout(2000);
    }
    writeFileSync(join(OUT, 'A03-quotation-after-settle.txt'), JSON.stringify(closed, null, 2));
    expect(closed?.p1, 'งวดที่ 1 stamped at settlement').toBeTruthy();
    expect(closed?.p2, 'งวดที่ 2 not stamped yet').toBeFalsy();
    expect(closed?.status, 'the quotation stays ACCEPTED until every instalment is billed').toBe('ACCEPTED');
    } // end of THE PAYING

    // Re-read for both paths, so the assertions below judge the same thing whether this run
    // paid or an earlier one did.
    const settledStatus = JSON.parse(
      g4psql(`SELECT status FROM applications WHERE id='${APP}';`),
    )[0]?.status;
    expect(settledStatus, 'the application sits past the phase-1 money gate').toBe('DOC_FEE_PAID');

    // ── score the money on the DB ──────────────────────────────────────────────
    // Selected by APPLICATION and milestone rather than by the id this run happened to
    // mint, so the money is judged the same whether this run paid or an earlier one did.
    const settled = JSON.parse(g4psql(
      `SELECT status, milestone, platform_fee_net, platform_fee_vat, platform_fee_gross, total_payable_amount,
              (total_payable_amount = platform_fee_gross) AS eq_total,
              (platform_fee_gross = platform_fee_net + platform_fee_vat) AS eq_gross
       FROM checkout_orders WHERE "applicationId"='${APP}' AND milestone='M1'
       ORDER BY "createdAt" DESC LIMIT 1;`,
    ))[0];
    expect(Number(settled.total_payable_amount), `งวด 1 payable = 5,885 × ${P.cultivationMethods.length} scope(s)`).toBe(5_885 * P.cultivationMethods.length);
    writeFileSync(join(OUT, 'A03-settled-order.txt'), JSON.stringify(settled, null, 2));
    expect(settled.status, 'checkout order SETTLED').toBe('SETTLED');
    expect(settled.eq_total, 'money equation holds on the order row').toBe(true);
    expect(settled.eq_gross, 'gross = net + VAT holds').toBe(true);

    const invoices = JSON.parse(g4psql(
      `SELECT "invoiceNumber", status, "totalAmount", "receiptNumber" FROM invoices WHERE "applicationId"='${APP}' ORDER BY "invoiceNumber";`,
    ));
    writeFileSync(join(OUT, 'A03-invoices.txt'), JSON.stringify(invoices, null, 2));

    const journal = JSON.parse(g4psql(
      `SELECT je.reference, je."totalDebit", je."totalCredit", (je."totalDebit" = je."totalCredit") AS balanced
       FROM journal_entries je WHERE je.reference IN (SELECT "invoiceNumber" FROM invoices WHERE "applicationId"='${APP}');`,
    ));
    writeFileSync(join(OUT, 'A03-journal.txt'), JSON.stringify(journal, null, 2));
    for (const j of journal) expect(j.balanced, `journal ${j.reference} balanced`).toBe(true);

    await page.goto(`/health/payments?app=${APP}&phase=1`);
    await page.waitForTimeout(2500);
    await shot(page, OUT, 'A03-04-paid.png');
  });
});
