/**
 * PHASE 0 — S4 — งวดที่ 2 (ค่าตรวจประเมิน) บน Stripe rail — C09 → C10
 *
 * Plan: design note 2026-08-15-phase0-flow-proof
 *   §III C09/C10 (slip wording) is SUPERSEDED by **Amendment D** (plan:480-494,
 *   operator 2026-08-16): the real rail is the Stripe gateway, the slip surface
 *   is legacy being drained. This spec therefore never touches payment_slips.
 *   C09 = milestone M2 checkout order minted from the farmer's own screen
 *         (checkout_orders PENDING_PAYMENT + a PromptPay PaymentIntent).
 *   C10 = the verified webhook settles it: checkout_orders SETTLED,
 *         application PENDING_AUDIT_FEE → **AUDIT_FEE_PAID**
 *         (checkout-settlement-service.js:43-46 SETTLED_TARGET_STATE.M2),
 *         balanced journal + the two split receipt documents.
 *
 * Same rail as e2e-phase0/settlement-resilience.spec.ts (proven for M1/C04):
 *   farmer screen → POST /payments/checkout → stripeConfirmPromptPay(pi) →
 *   stripeTestAuthorize(page, url) → stripe listen forwards
 *   payment_intent.succeeded → /api/webhooks/stripe → settle.
 *
 * ORCHESTRATOR PREREQUISITES (this spec CANNOT settle without them — the
 * webhook is the ONLY settle path in this topology; the route ACKs 200 and
 * settles out of band, routes/api/webhooks/stripe.js:100-109, and there is no
 * reconcile cron running here):
 *   - backend :8000 with STRIPE_CHECKOUT_ENABLED=true, STRIPE_SECRET_KEY=sk_test…,
 *     STRIPE_WEBHOOK_SECRET=<whsec_ printed by stripe listen>, PAYMENT_ADAPTER=stripe
 *   - frontend :3000 (next dev) with NEXT_PUBLIC_CHECKOUT_UI_ENABLED=true
 *     — with the flag off the checkout route is notFound() (checkout/page.tsx:33-36)
 *   - `stripe listen --forward-to localhost:8000/api/webhooks/stripe` running
 *   - upstream segment left FARMER_MAIN_APP in an M2-payable state
 *     (DOC_APPROVED | PENDING_AUDIT_FEE — stripe-checkout-service.js:40-42)
 *
 * VERIFICATION ONLY. No /api/e2e/* (G-6), no money-row mutation (G-4 — psql() is
 * SELECT-only), no secret in any evidence file (G-3: the PaymentIntent client
 * secret from the checkout response is never read nor written; only DB ids are).
 * Every checkpoint keeps the §II protocol: dump before → real UI action → dump
 * after + auditDump + screenshot, plus dumpErp (Amendment C-1) on the settle.
 * If the rail is stuck, this spec FAILS with the real DB signal attached — the
 * webhook row's own error field — and never fakes a settle.
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

const SEG = 's04';
const OUT = join(EV, SEG);
mkdirSync(OUT, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, name), fullPage: true });

/** stripe-checkout-service.js:40-42 — the states M2 may be paid from. */
const M2_PAYABLE = ['DOC_APPROVED', 'PENDING_AUDIT_FEE'];

async function healthLanding(page: Page) {
  await page.waitForURL(/\/health\/(dashboard|payments|applications|onboarding|start|profile)/, { timeout: 120_000 });
  await page.waitForLoadState('domcontentloaded');
}

test.describe.serial('Phase0 S4 — phase-2 fee on the Stripe rail (C09 checkout M2 → C10 AUDIT_FEE_PAID + ERP)', () => {
  test('C09 mint M2 checkout from the farmer screen, C10 settle to AUDIT_FEE_PAID with a balanced journal', async ({ page }) => {
    const V = readVars();
    const APP = V.FARMER_MAIN_APP;
    const FARMER_ID = V.FARMER_MAIN_ID;
    const FARMER_PW = process.env.PHASE0_FARMER_PW || '';
    expect(APP, 'FARMER_MAIN_APP present in VARS (from s01)').toBeTruthy();
    expect(FARMER_ID, 'FARMER_MAIN_ID present in VARS (from s01)').toBeTruthy();
    expect(FARMER_PW, 'PHASE0_FARMER_PW set in the run command (never committed — G-3)').toBeTruthy();

    // ═══════════════════════════════════════════════════════════════
    // C09 — the farmer opens phase 2 and mints the M2 checkout order
    // ═══════════════════════════════════════════════════════════════
    dump(SEG, 'C09', 'before', APP); // expect PENDING_AUDIT_FEE (from C08)
    const before = JSON.parse(psql(`SELECT id, status FROM applications WHERE id='${APP}';`))[0];
    const invoicesBefore = JSON.parse(psql(
      `SELECT id, "invoiceNumber", status, "totalAmount" FROM invoices WHERE "applicationId"='${APP}' ORDER BY "invoiceNumber";`,
    ));
    writeFileSync(
      join(OUT, 'C09-precondition.txt'),
      `application status before C09: ${before?.status}\n` +
        `M2 payable states (stripe-checkout-service.js:40-42): ${M2_PAYABLE.join(' | ')}\n` +
        `invoices already on the application:\n${JSON.stringify(invoicesBefore, null, 2)}\n`,
    );
    // Honest precondition: the phase-2 gate is upstream work (C08). If the app
    // is not M2-payable, this segment must fail here and name the real state —
    // not force the rail open.
    expect(M2_PAYABLE, `C09 precondition — application is M2-payable (observed ${before?.status}); the phase-2 gate is C08's job`)
      .toContain(before?.status);

    await login(page, { kind: 'health', id: FARMER_ID, pw: FARMER_PW });
    await healthLanding(page);

    // F-G4-64 final round R24: the quotation gate runs BEFORE the terms gate
    // on the checkout door (stripe-checkout-service.js), so the acceptance is
    // pressed on the farmer's own screen first. This also lands the browser on
    // /health/payments?app=<APP> — the farmer's real phase-2 screen
    // (งวดที่ 2 section — client-view.tsx:443-463).
    await acceptQuotationsIfShown(page, APP!, 'S04 C09');
    await shot(page, 'C09-01-payments-phase2.png');

    // ── The real front door: the online-payment entry button on /health/payments
    // (client-view.tsx:298-316, rendered as an <a> by Button href — button.tsx:74-86).
    // Its href carries ONLY ?app= and NO milestone (client-view.tsx:310), so the
    // farmer's own door cannot say "งวดที่ 2". This is recorded, not asserted:
    // it is FINDING material (F-CHECKOUT-ENTRY-NO-MILESTONE), and the backend
    // rejects an unknown milestone before any row is minted
    // (stripe-checkout-service.js:91-93) so pressing it is side-effect free.
    // Labelled "ชำระเงินออนไลน์" until operator decision 6 (2026-09-17, audit
    // UXUI-X01): the checkout screen cannot show the PromptPay QR yet.
    const entryLink = page.getByRole('link', { name: 'สร้างรายการชำระเงิน', exact: true }).first();
    await expect(entryLink, 'farmer-facing online-payment entry link present (needs NEXT_PUBLIC_CHECKOUT_UI_ENABLED=true)')
      .toBeVisible({ timeout: 30_000 });
    const entryHref = await entryLink.getAttribute('href');
    await entryLink.click();
    await page.waitForURL('**/health/payments/checkout**', { timeout: 200_000 });
    await page.waitForLoadState('domcontentloaded');
    const doorStart = page.getByRole('button', { name: /เริ่มขั้นตอนชำระเงิน/ });
    await expect(doorStart, 'checkout page reachable from the entry link').toBeVisible({ timeout: 60_000 });
    // F-G4-64: the press is disabled until the payment-terms disclosure is
    // answered (checkout/client-view.tsx), so answer it here — otherwise this
    // side-effect-free probe dies on actionTimeout against a disabled control
    // and names nothing.
    await acceptCheckoutTermsIfShown(page, 'S04 entry-door probe');
    const doorResp = page.waitForResponse(
      (r) => r.url().includes('/payments/checkout') && r.request().method() === 'POST', { timeout: 90_000 },
    ).catch(() => null);
    await doorStart.click();
    const dr = await doorResp;
    await page.waitForTimeout(2000);
    const doorMessages = await page.locator('section').allInnerTexts().catch(() => []);
    await shot(page, 'C09-02-entry-door-no-milestone.png');
    writeFileSync(
      join(OUT, 'C09-entry-door.txt'),
      `FINDING material — the farmer's own entry link on /health/payments\n` +
        `href: ${entryHref}\n` +
        `landed url: ${page.url()}\n` +
        `POST /payments/checkout → status ${dr ? dr.status() : 'none'}\n` +
        `screen text after pressing "เริ่มขั้นตอนชำระเงิน":\n${doorMessages.join('\n---\n')}\n`,
    );

    // ── The M2 checkout the farmer cannot reach from that link: same real page,
    // milestone supplied on the URL (the FE passes ?milestone through verbatim —
    // checkout/client-view.tsx:124,137-141). Still 100% UI: the order is minted
    // by pressing the page's own button, never by an API call from this spec.
    // R24 — before each press, not once per walk: a run that starts here (or an
    // application whose quotation was replaced meanwhile) must still meet the
    // gate. Idempotent, and it says out loud when there was nothing to press.
    await acceptQuotationsIfShown(page, APP!, 'S04 M2 press');
    await page.goto(`/health/payments/checkout?app=${APP}&milestone=M2`, { timeout: 200_000 });
    await page.waitForLoadState('domcontentloaded');
    await shot(page, 'C09-03-checkout-m2-idle.png');
    const startBtn = page.getByRole('button', { name: /เริ่มขั้นตอนชำระเงิน/ });
    await expect(startBtn, 'M2 checkout page open with the start button').toBeVisible({ timeout: 30_000 });
    await acceptCheckoutTermsIfShown(page, 'S04 M2 press');
    const checkoutResp = page.waitForResponse(
      (r) => r.url().includes('/payments/checkout') && r.request().method() === 'POST', { timeout: 90_000 },
    ).catch(() => null);
    await startBtn.click();
    const cr = await checkoutResp;
    // Status only — the response body carries the PaymentIntent client secret
    // and must never be written to evidence (G-3 / L2).
    writeFileSync(join(OUT, 'C09-checkout-response.txt'), `POST /payments/checkout (milestone=M2) → status ${cr ? cr.status() : 'none'}`);
    await page.waitForTimeout(3000);
    await expect(
      page.getByText('สร้างรายการสำเร็จ รอชำระเงิน'),
      'checkout UI reached the created state (checkout/client-view.tsx:186) — the farmer sees the fee breakdown, and NO pay step exists (F-GATEWAY-UI)',
    ).toBeVisible({ timeout: 30_000 });
    await shot(page, 'C09-04-checkout-m2-created.png');

    let order: { id: string; status: string; milestone: string; stripe_payment_intent_id: string; invoiceId: string } | null = null;
    for (let i = 0; i < 10 && !order; i++) {
      const rows = JSON.parse(psql(
        `SELECT id, status, milestone, stripe_payment_intent_id, "invoiceId"
         FROM checkout_orders WHERE "applicationId"='${APP}' AND milestone='M2' ORDER BY "createdAt" DESC LIMIT 1;`,
      ));
      if (rows.length) order = rows[0];
      else await page.waitForTimeout(2000);
    }
    writeFileSync(join(OUT, 'C09-checkout-order.txt'), JSON.stringify(order, null, 2));
    expect(order, 'C09 minted an M2 checkout_orders row').toBeTruthy();
    expect(order!.status, 'C09 checkout_orders(M2) = PENDING_PAYMENT').toBe('PENDING_PAYMENT');
    const PI = order!.stripe_payment_intent_id;
    expect(PI, 'PromptPay PaymentIntent id minted for the M2 order').toBeTruthy();
    saveVars('FARMER_MAIN_M2_ORDER', order!.id);

    // C09 checkpoint closes: DB after + audit + screen (already shot above).
    // The application status does NOT move at C09 — the order is minted while
    // the app waits at PENDING_AUDIT_FEE; the after-dump proves exactly that.
    dump(SEG, 'C09', 'after', APP);
    auditDump(SEG, 'C09', APP); // observe — record whatever audit the mint leaves

    // ═══════════════════════════════════════════════════════════════
    // C10 — settle: PromptPay test authorize → webhook → AUDIT_FEE_PAID
    // ═══════════════════════════════════════════════════════════════
    dump(SEG, 'C10', 'before', APP); // expect PENDING_AUDIT_FEE, order PENDING_PAYMENT
    const authorizeUrl = stripeConfirmPromptPay(PI);
    await shot(page, 'C10-01-before-authorize.png');
    await stripeTestAuthorize(page, authorizeUrl); // the view-in-the-loop equivalent of scanning the QR
    await shot(page, 'C10-02-after-authorize.png');

    // The route ACKs 200 and settles out of the request path (setImmediate),
    // so poll slowly and let the settle tx run uncontended.
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
      settled = orderStatus === 'SETTLED' && appStatus === 'AUDIT_FEE_PAID';
      if (!settled) await page.waitForTimeout(5000);
    }
    writeFileSync(join(OUT, 'C10-settle.txt'), `checkout_orders(M2)=${orderStatus} · application=${appStatus} · settled=${settled}`);

    // Evidence dumps (protocol §II + Amendment C-1).
    dump(SEG, 'C10', 'after', APP);
    auditDump(SEG, 'C10', APP);
    dumpErp(SEG, 'C10', APP);

    // The farmer's screens — the side that must see the result.
    await page.goto(`/health/payments?app=${APP}`, { timeout: 200_000 }).catch(() => null);
    await page.waitForLoadState('domcontentloaded').catch(() => null);
    await shot(page, 'C10-03-payments-after.png');
    await page.goto('/health/applications', { timeout: 200_000 }).catch(() => null);
    await page.waitForLoadState('domcontentloaded').catch(() => null);
    await shot(page, 'C10-04-applications-after.png');

    // ── ERP verification scoped to THIS settle (the app also carries the M1
    // invoice + journal from C03/C04, so every money assertion below keys on the
    // M2 order's own invoice — stripe-checkout-service.js:160-176). ──
    const m2Invoice = JSON.parse(psql(
      `SELECT id, "invoiceNumber", status, "totalAmount", "receiptNumber", "receiptStatus"
       FROM invoices WHERE id='${order!.invoiceId}';`,
    ))[0];
    const journal = JSON.parse(psql(
      `SELECT je.id, je.reference, je."totalDebit", je."totalCredit",
        (je."totalDebit" = je."totalCredit") AS entry_balanced,
        COALESCE((SELECT SUM(jl.debit) FROM journal_lines jl WHERE jl."entryId"=je.id),0) AS lines_debit,
        COALESCE((SELECT SUM(jl.credit) FROM journal_lines jl WHERE jl."entryId"=je.id),0) AS lines_credit
       FROM journal_entries je WHERE je.reference='${m2Invoice?.invoiceNumber}';`,
    ));
    // The Stripe rail issues receipts as split checkout_documents
    // (PLATFORM_TAX_INVOICE + DTAM_DISBURSAL_RECEIPT), not on invoices.receiptNumber
    // (that column belongs to the legacy slip rail) — checkout-settlement-service.js:212-229.
    const receiptDocs = JSON.parse(psql(
      `SELECT "documentType", "documentNumber" FROM checkout_documents WHERE "checkoutOrderId"='${order!.id}' ORDER BY "documentType";`,
    ));
    const eq = JSON.parse(psql(
      `SELECT (total_payable_amount = platform_fee_gross) AS eq_total,
        (platform_fee_gross = platform_fee_net + platform_fee_vat) AS eq_gross,
        platform_fee_net, platform_fee_vat, total_payable_amount,
        "settledAt"
       FROM checkout_orders WHERE stripe_payment_intent_id='${PI}';`,
    ));
    // The two equations above are STRUCTURAL: they held on the retired
    // platform-only-VAT formula too (27,535 = 25,000 + 2,500 + 35 balances exactly
    // as well as 29,425 = 25,000 + 2,500 + 1,925). Only the figures say which
    // formula actually ran, so exact amounts are asserted alongside them below.
    // scopeCount is read from the column the backend stamped at submit.
    const scopeCount = scopeCountOf(String(APP));
    const fee = expectedPhaseFees('PHASE_2', scopeCount);
    const webhook = JSON.parse(psql(
      `SELECT id, type, status, ("processedAt" IS NOT NULL) AS processed, COALESCE(error,'') AS error
       FROM stripe_webhook_events WHERE payload::text LIKE '%${PI}%' AND type='payment_intent.succeeded'
       ORDER BY "receivedAt" DESC LIMIT 1;`,
    ));
    const succ = webhook[0] || {};
    if (succ.id) saveVars('M2_SETTLED_EVENT_ID', succ.id);
    // The canonical hop the settle must write (SYSTEM actor, application-status-writer).
    const canonicalAudit = JSON.parse(psql(
      `SELECT id, "actorId", "actorRole", metadata FROM audit_logs
       WHERE "resourceId"='${APP}' AND action='APPLICATION_STATUS_TRANSITION'
         AND metadata::text LIKE '%toStatus%AUDIT_FEE_PAID%' ORDER BY timestamp DESC LIMIT 3;`,
    ));
    writeFileSync(
      join(OUT, 'C10-erp-summary.txt'),
      `settle: order(M2)=${orderStatus} app=${appStatus}\n` +
        `webhook payment_intent.succeeded: status=${succ.status} processed=${succ.processed} error=${succ.error}\n` +
        `M2 invoice: ${JSON.stringify(m2Invoice)}\n` +
        `journal entries for that invoice: ${journal.length}\n${JSON.stringify(journal, null, 2)}\n` +
        `money equation: ${JSON.stringify(eq)}\n` +
        `receipt documents (checkout_documents): ${JSON.stringify(receiptDocs)}\n` +
        `canonical AUDIT_FEE_PAID audit rows: ${canonicalAudit.length}\n${JSON.stringify(canonicalAudit, null, 2)}\n`,
    );

    // ── Money-shot assertions (Amendment C-1: a missing/unbalanced journal, a
    // broken equation or a missing receipt = payment checkpoint FAIL). ──
    expect(settled, 'C10 SETTLES: checkout_orders(M2)=SETTLED AND application=AUDIT_FEE_PAID').toBe(true);
    expect(succ.processed, 'payment_intent.succeeded webhook processed (needs stripe listen → :8000/api/webhooks/stripe)').toBe(true);
    expect(String(succ.error || ''), 'webhook processed with no error').toBe('');
    expect(canonicalAudit.length, 'canonical APPLICATION_STATUS_TRANSITION row for →AUDIT_FEE_PAID (0 = the fail-open audit hole, application-status-writer.js:74-87)')
      .toBeGreaterThanOrEqual(1);
    expect(journal.length, 'ERP journal entry exists for the M2 checkout invoice').toBeGreaterThanOrEqual(1);
    expect(
      journal.every((j: { entry_balanced: boolean }) => j.entry_balanced),
      'every M2 journal entry balanced (totalDebit == totalCredit)',
    ).toBe(true);
    expect(
      journal.every((j: { lines_debit: number; lines_credit: number }) => Number(j.lines_debit) === Number(j.lines_credit)),
      'M2 journal lines balance (SUM debit == SUM credit) per entry',
    ).toBe(true);
    expect(eq[0]?.eq_total, 'money equation total_payable = platform_gross (no DTAM part since migration 20260929155037)').toBe(true);
    expect(eq[0]?.eq_gross, 'money equation platform_gross = platform_net + platform_vat').toBe(true);
    // One service fee since 2026-09-11: the whole ค่าบริการ sits in platform_fee_net.
    expect(Number(eq[0]?.platform_fee_net), `งวด-2 ค่าบริการ = ${fee.state + fee.platform}`).toBe(fee.state + fee.platform);
    expect(Number(eq[0]?.platform_fee_vat), `งวด-2 VAT = 7% of the WHOLE service fee = ${fee.vat}; the retired platform-only formula would say ${Math.round(fee.platform * 0.07)}`)
      .toBe(fee.vat);
    expect(Number(eq[0]?.total_payable_amount), `งวด-2 ยอดชำระ = ${fee.total} — the number the farmer actually paid on the Stripe rail`)
      .toBe(fee.total);
    expect(
      receiptDocs.length,
      'settlement issued the split receipt documents (PLATFORM_TAX_INVOICE + DTAM_DISBURSAL_RECEIPT) for the M2 order',
    ).toBeGreaterThanOrEqual(2);
    expect(m2Invoice?.status, 'the M2 checkout invoice is marked paid by the settlement').toBe('paid');
  });
});
