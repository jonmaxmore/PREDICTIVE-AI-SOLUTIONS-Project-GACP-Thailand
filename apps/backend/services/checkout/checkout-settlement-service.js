'use strict';

/**
 * Checkout settlement — the atomic settle of the Wave-2 Stripe engine
 * (docs/payment-refactor/step2-data-model-design.md v2 §5.5, approved).
 *
 * On a verified `payment_intent.succeeded`, ONE database transaction covers:
 *   1. CheckoutOrder → SETTLED (+ settledAt).
 *   2. Invoice → paid, AND the invoice carries the settlement document's
 *      number in its receipt columns (receiptNumber / receiptStatus ISSUED /
 *      receiptIssuedAt / receiptIssuedBy) — so invoices.receiptNumber ==
 *      checkout_documents.documentNumber; PaymentTransaction → SUCCESS
 *   3. The one-fee journal entry:
 *        Dr 1110-001 Cash            total
 *          Cr 4110-001 Revenue          platform_net (the whole ค่าบริการ)
 *          Cr 2131-001 Output VAT       platform_vat
 *      No DTAM line: the company settles with DTAM offline and books it in its
 *      own accounts (operator 2026-09-29).
 *   4. W14 — the ONE settlement document:
 *        PLATFORM_TAX_INVOICE (TAX-PRD sequence) — the company's full tax
 *        invoice for the whole ค่าบริการ, VAT 7% on all of it. The
 *        DTAM_DISBURSAL_RECEIPT is retired with the collection-agent model.
 *        ONE number, two rows, one document: the checkout_documents row and
 *        the invoice's receipt columns (step 2) hold the same TAX-PRD number,
 *        so the accountant's pending-receipts queue never lists a settled
 *        checkout invoice and no second number is ever drawn for it.
 *   5. The workflow unlock, SYSTEM actor:
 *        M1 → DOC_FEE_PAID   (Step 2 — เจ้าหน้าที่กระจายงาน งวดที่ 1)
 *        M2 → AUDIT_FEE_PAID (Step 5 — เจ้าหน้าที่กระจายงาน งวดที่ 2)
 *      (The DISPATCHER_*_QUEUE names in the directive map onto these existing
 *      canonical states; renaming the vocabulary is Wave-3 work and would
 *      otherwise force every projection to move inside this PR.)
 *
 * The AMOUNT CROSS-CHECK runs before any side effect: amount_received must
 * equal the order's total in satang. A mismatch is an alert and a recorded
 * error — never a settlement.
 */

const { prisma } = require('../prisma-database');
const logger = require('../../shared/logger');
const { toSatang } = require('../../config/stripe');
const { writeApplicationStatus } = require('../application-status-writer');
const { recordPaymentEntry } = require('../journal-entry-service');
const { allocateReceiptNumber, ISSUER } = require('../receipt-numbering-service');
const { getInvoiceIssuer } = require('../../config/invoice-issuers');
const { SETTLEMENT } = require('../../config/business-rules');
const { retireCheckoutOrderInTx, RETIRE_REASONS } = require('./retire-checkout-order');
const {
    auditLogger, AuditCategory, AuditSeverity, ResourceType,
} = require('../../middleware/audit-logger');
// The two states that mean "the applicant's acceptance is on record", read from
// the ONE gate module rather than re-typed here (F-G4-64 §3.1). quotation-gate
// requires neither this file nor quotation-service at load time, so this import
// closes no cycle on the money path.
const { QUOTATION_ACCEPTED_STATES } = require('../billing/quotation-gate');

// The company's registered name and its VAT rate each have ONE home. This file
// used to keep its own copy of the name — which meant an operator who set
// PLATFORM_COMPANY_NAME_TH still saw the default on every settlement receipt,
// with nothing to explain why — and typed 0.07 straight into the tax invoice
// payload, so an environment that changed the rate would have charged one number
// and printed another on the document the customer keeps.
const { PLATFORM_ISSUER } = require('../../config/invoice-issuers');
const { serviceFor, isRenewalFiling } = require('../../shared/instalment-service-names');
// W14 — DTAM's legal name is no longer printed on any farmer-facing document.
// The company settles with DTAM outside this system and books it in its own
// accounts (operator 2026-09-29) — neither a document identity nor a journal
// line here.

/** milestone → the dispatcher-queue state the verified webhook unlocks. */
const SETTLED_TARGET_STATE = Object.freeze({
    M1: 'DOC_FEE_PAID',
    M2: 'AUDIT_FEE_PAID',
});

/**
 * W14 (operator ruling 2026-08-22, the change log c28355ea) — ONE document.
 *
 * The farmer receives a single full tax invoice / receipt from the company for
 * the WHOLE ค่าบริการ, with 7% VAT on all of it.
 *
 * What was removed, and why it could not just be left in place:
 *   - DTAM_DISBURSAL_RECEIPT was a receipt issued in DTAM's NAME to the payer,
 *     for a VAT-exempt state fee, carrying `collectedAsAgentFor: DTAM`. Under
 *     this ruling the farmer did not pay DTAM and the company did not collect
 *     as DTAM's agent, so each of those claims is now false.
 *   - The tax invoice covered only the platform portion. Issuing a document for
 *     5,310 against a 35,310 charge would leave 30,000 of a taxable supply
 *     undocumented.
 *
 * `documentType` stays 'PLATFORM_TAX_INVOICE' — a value the Wave-1 CHECK
 * constraint already permits (migration 20260802150000), and PLATFORM is the
 * company. No migration is needed, and historical DTAM_DISBURSAL_RECEIPT rows
 * stay readable.
 *
 * What the company pays DTAM is settled offline in the company's own accounts
 * (operator 2026-09-29): it is neither on this document nor in the journal.
 */
function buildSettlementDocumentPayload(order, numbers, issuedAtDate = new Date()) {
    // `issuedAtDate` is the settlement instant the caller stamps on every row
    // of the settle transaction, so the document and the invoice's
    // receiptIssuedAt agree to the millisecond.
    const issuedAt = issuedAtDate.toISOString();
    // The service fee is the platform_fee_net column, alone. There is no DTAM
    // portion to add (one fee since 2026-09-11; no DTAM accounting on this
    // platform since 2026-09-29).
    const serviceFeeNet = Number(order.platformFeeNet);

    const taxInvoice = {
        documentType: 'PLATFORM_TAX_INVOICE',
        issuer: 'PLATFORM',
        issuerName: PLATFORM_ISSUER.legalNameTH,
        documentNumber: numbers.company,
        issuedAt,
        buyer: { applicationId: order.applicationId },
        // ── หนึ่งบรรทัด (operator 2026-09-11) ────────────────────────────
        // เดิมพิมพ์สองบรรทัดเพื่อให้เห็นว่าราคาประกอบขึ้นจากอะไร: "ราคาเต็ม" กับ
        // "ค่าแพลตฟอร์ม 10%" · พอเลิกแยกส่วนรัฐ บรรทัดแรกเหลือ **0 บาท** และ
        // บรรทัดที่ชื่อ "ค่าแพลตฟอร์ม 10%" กลายเป็นตัวแบกราคาทั้งก้อน
        // นี่คือใบที่เกษตรกรเก็บไว้ ไม่ใช่ตัวแปรภายใน — ส่วนประกอบที่ไม่มีอยู่จริง
        // อีกแล้วจึงถูกถอด ไม่ใช่พิมพ์เป็นศูนย์ · ยอดรวมไม่ขยับ
        lines: [
            {
                code: 'PLATFORM_FEE',
                // ชื่อจากแค็ตตาล็อกเดียว (operator 2026-10-03), ตรงกับบรรทัดของใบแจ้งหนี้
                description: serviceFor(order.milestone, { isRenewal: isRenewalFiling(order.application) }).name,
                amount: String(serviceFeeNet),
            },
        ],
        serviceFee: String(serviceFeeNet),
        vat: { rate: PLATFORM_ISSUER.vatRate, amount: String(order.platformFeeVat), base: String(serviceFeeNet) },
        total: String(order.totalPayableAmount),
        checkoutOrderId: order.id,
    };

    return { taxInvoice };
}

/**
 * F-G4-64 §3.3 — close the quotation of an order whose money has already
 * landed. Best-effort and TOTAL: this function never throws, because the money,
 * the receipt and the workflow status must not depend on it.
 *
 * It is called from OUTSIDE the settle transaction, and never from inside it.
 * That is not a style preference: a throw in there rolls back the invoice
 * `paid`, the receipt number, the CheckoutDocument, the journal entry and the
 * workflow status, and then settleEvent retries to DEAD_LETTER with Stripe
 * already holding the money. Pinned by
 * settlement-quotation-must-not-throw-in-tx.test.js, which also greps this file
 * to keep every call outside the transaction.
 *
 * Two call sites, on purpose (review r0, finding 2):
 *   1. after the commit, with the number just allocated and the instant just
 *      written — the normal path;
 *   2. the already-SETTLED fast path, with the number and instant already on
 *      the row — the HEAL path. Putting the close after the commit buys the
 *      money its safety and costs the quotation its atomicity: a process killed
 *      between the two leaves phaseXInvoicedAt NULL on a paid order, and
 *      without (2) every redelivery, retry and reconcile pass would answer
 *      "already settled" and walk past the gap forever. recordPhaseInvoiced
 *      keeps the FIRST instant per phase, so healing a row that is already
 *      correct costs one UPDATE and changes nothing.
 *
 * @returns {Promise<void>}
 */
async function closeQuotationForSettledOrder({ order, milestone, invoiceNumber, at, eventId }) {
    try {
        // Required here, not at the top of the file: quotation-service is only
        // needed on this one best-effort branch, and keeping it out of the
        // module's load-time graph means a fault in it can never stop the
        // settle path from loading at all.
        const quotationService = require('../quotation-service');
        const closed = await quotationService.recordPhaseInvoiced({
            quotationId: order.quotationId || null,
            applicationId: order.applicationId || null,
            milestone,
            invoiceNumber,
            // What this charge actually collected. Only the applicationId
            // fallback consults it, to refuse a document it does not match.
            chargedAmount: order.totalPayableAmount,
            at,
        });
        if (!closed) {
            logger.error('[checkout-settle] no quotation to close for a settled order', {
                eventId, checkoutOrderId: order.id, applicationId: order.applicationId, milestone,
            });
        } else if (closed.stamped === false) {
            logger.error('[checkout-settle] quotation figures do not match the charge, nothing stamped', {
                eventId,
                checkoutOrderId: order.id,
                quotationId: closed.quotationId,
                milestone,
                ...closed.mismatch,
            });
        } else if (!QUOTATION_ACCEPTED_STATES.includes(closed.status)) {
            logger.error('[checkout-settle] quotation not accepted at settlement', {
                eventId,
                checkoutOrderId: order.id,
                quotationId: closed.quotationId,
                status: closed.status,
                milestone,
            });
        }
    } catch (qtErr) {
        logger.error('[checkout-settle] quotation close failed — money and documents stand', {
            eventId, checkoutOrderId: order.id, milestone,
            errCode: qtErr?.code || null, errMessage: qtErr?.message || String(qtErr),
        });
        try {
            await auditLogger.log({
                category: AuditCategory.PAYMENT,
                action: 'QUOTATION_CLOSE_FAILED',
                severity: AuditSeverity.ERROR,
                actorId: 'stripe-webhook',
                actorRole: 'SYSTEM',
                resourceType: ResourceType.PAYMENT,
                resourceId: order.id,
                organizationId: order.organizationId,
                metadata: { milestone, applicationId: order.applicationId, errCode: qtErr?.code || null },
            });
        } catch (auditErr) {
            logger.error('[checkout-settle] could not record QUOTATION_CLOSE_FAILED', {
                eventId, errMessage: auditErr?.message || String(auditErr),
            });
        }
    }
}

/**
 * Settle a checkout order from a verified payment_intent.succeeded.
 * Idempotent: an already-settled order is a successful no-op.
 *
 * @returns {Promise<{settled: boolean, alreadySettled?: boolean, reason?: string}>}
 */
async function settleFromPaymentIntent({ paymentIntent, eventId }) {
    const orderId = paymentIntent?.metadata?.checkoutOrderId || null;

    const order = await prisma.checkoutOrder.findFirst({
        where: orderId
            ? { id: orderId }
            : { stripePaymentIntentId: paymentIntent.id },
        include: { application: true, invoice: true },
    });

    if (!order) {
        logger.error('[checkout-settle] no order for intent — investigate', {
            eventId, paymentIntentId: paymentIntent.id, orderId,
        });
        return { settled: false, reason: 'ORDER_NOT_FOUND' };
    }

    if (order.status === 'SETTLED') {
        // Nothing is re-settled here: no transaction, no second receipt number,
        // no status write. The ONE thing this path does do is heal the
        // quotation, because a settle killed between its commit and its
        // post-commit close leaves a paid order whose document is unstamped,
        // and every route back to it — Stripe redelivery, the settleEvent
        // retry, the reconcile job — arrives at exactly this line. It reuses
        // what the crashed settle already wrote: the instant on the row and the
        // number already bound to the invoice, never a fresh one.
        await closeQuotationForSettledOrder({
            order,
            milestone: order.milestone,
            invoiceNumber: order.invoice?.receiptNumber || null,
            at: order.settledAt || new Date(),
            eventId,
        });
        return { settled: true, alreadySettled: true };
    }

    // ── Amount cross-check BEFORE any side effect ──
    const expectedSatang = toSatang(order.totalPayableAmount);
    if (paymentIntent.amount_received !== expectedSatang) {
        logger.error('[checkout-settle] AMOUNT MISMATCH — alert, not a settlement', {
            eventId,
            checkoutOrderId: order.id,
            expectedSatang,
            receivedSatang: paymentIntent.amount_received,
        });
        return { settled: false, reason: 'AMOUNT_MISMATCH' };
    }

    // ── A CANCELLED order that still carries its old DTAM part cannot settle ──
    // Migration 20260929155037 keeps total_payable_amount on such rows and its
    // CHECK exempts CANCELLED only, so the SETTLED write below would be refused
    // inside the transaction — after a receipt number was drawn. Refused here
    // instead, before any side effect, with a named code: settleEvent records it
    // FAILED and dead-letters it for an operator (the payment was captured and
    // must be refunded or handled by hand). No amount is written.
    if (order.status === 'CANCELLED'
        && toSatang(order.totalPayableAmount) !== toSatang(order.platformFeeGross)) {
        logger.error('[checkout-settle] CANCELLED order with a legacy total — not settled, operator action required', {
            eventId,
            checkoutOrderId: order.id,
            paymentIntentId: paymentIntent.id,
            receivedSatang: paymentIntent.amount_received,
        });
        throw Object.assign(
            new Error(`CHECKOUT_CANCELLED_ORDER_LEGACY_TOTAL: order ${order.id} is CANCELLED and its total does not equal `
                + 'its service fee + VAT; the payment was captured, refund or handle it manually'),
            { code: 'CHECKOUT_CANCELLED_ORDER_LEGACY_TOTAL', checkoutOrderId: order.id },
        );
    }

    const milestone = order.milestone;
    const targetState = SETTLED_TARGET_STATE[milestone];

    // The document number comes from the company's receipt sequence. Allocated
    // OUTSIDE the settle transaction on purpose: the allocator runs its own
    // short transaction (sequence row FOR UPDATE), and holding it inside the
    // settle tx would serialize every settlement behind the counter lock. A
    // crashed settle burns a number — sequences may legally have gaps.
    //
    // W14 — ONE number for ONE document. The DTAM receipt sequence is no longer
    // drawn from at settlement, because the company no longer issues a document
    // in DTAM's name.
    //
    // ONE settlement instant for every timestamp written below (order
    // settledAt, invoice paidAt / receiptIssuedAt, charge paidAt, journal
    // paidAt, document issuedAt, phase paid-at) — one moment, not a scatter of
    // `new Date()` calls a few milliseconds apart. The number's year is read
    // from the same instant, in Bangkok, so TAX-PRD-{year} is the year the
    // document prints (operator 2026-09-26: "เวลาไทยทั้งหมด").
    const settledAt = new Date();
    const companyNo = await allocateReceiptNumber({ issuer: ISSUER.PLATFORM, dateOrYear: settledAt });
    const payloads = buildSettlementDocumentPayload(order, {
        company: companyNo.number,
    }, settledAt);

    const txOutcome = await prisma.$transaction(async (tx) => {
        // Concurrency-safe idempotency: lock the order row and re-check under the lock.
        // Concurrent settles (webhook kick, Stripe redelivery, reconcile) serialize here;
        // the losers see SETTLED and stop, so the whole bundle is exactly-once.
        const [locked] = await tx.$queryRaw`SELECT id, status FROM checkout_orders WHERE id = ${order.id} FOR UPDATE`;
        if (!locked || locked.status === 'SETTLED') {
            return { raced: true }; // a concurrent handler already settled this order
        }

        // 1. Order → SETTLED.
        await tx.checkoutOrder.update({
            where: { id: order.id },
            data: {
                status: 'SETTLED',
                settledAt,
            },
        });

        // 2. Invoice paid + charge SUCCESS.
        //
        // F-G4-36 — the invoice carries the settlement document's number.
        // The TAX-PRD number allocated above is the receipt / tax invoice for
        // this invoice (W14: ONE number for ONE document), so it is written
        // into the invoice's receipt columns in the same transaction as the
        // checkout_documents row. Without this, every invoice-based reader
        // (customer statement, daily cash report, bank reconciliation, the
        // invoice PDF, the farmer's payments page) is blind to the receipt,
        // and listPendingReceipts (status paid + receiptNumber null) keeps
        // offering the accountant an "issue receipt" button that would draw a
        // SECOND TAX-PRD number for the same supply.
        //
        // `status` stays 'paid' on purpose — NOT 'RECEIPT_ISSUED'. The raw
        // status vocabulary is read strictly as 'paid' by
        //   services/credit-note-service.js:191   (status !== 'paid')
        //   services/debit-note-service.js:160    (status !== 'paid')
        //   services/refund-service.js:296        (status !== 'paid')
        //   services/wht-service.js:396           (status !== 'paid')
        // so a different raw status would lock this invoice out of credit
        // notes, debit notes, refunds and WHT. The receipt state lives in the
        // receipt columns; invoice-service.js toErpStatus already derives
        // RECEIPT_ISSUED from them (hasReceipt), which is what the farmer's
        // payments page and the accountant's queues read.
        if (order.invoiceId) {
            await tx.invoice.update({
                where: { id: order.invoiceId },
                data: {
                    status: 'paid',
                    paidAt: settledAt,
                    paymentMethod: 'STRIPE',
                    receiptNumber: companyNo.number,
                    receiptStatus: 'ISSUED',
                    receiptIssuedAt: settledAt,
                    receiptIssuedBy: 'stripe-webhook',
                },
            });
        }
        if (order.paymentTransactionId) {
            await tx.paymentTransaction.update({
                where: { id: order.paymentTransactionId },
                data: {
                    status: 'SUCCESS',
                    gatewayRef: paymentIntent.id,
                    paidAt: settledAt,
                    webhookReceivedAt: settledAt,
                },
            });
        }

        // 3. The one-fee journal entry — atomic via the tx handle
        //    (meta.tx makes recordPaymentEntry throw into this transaction).
        //    Cash = service fee + VAT; nothing is booked for DTAM. The database
        //    holds total_payable_amount = platform_fee_gross for every order that
        //    can reach here (CHECK, migration 20260929155037), so it balances.
        await recordPaymentEntry(
            order.invoiceId,
            Number(order.totalPayableAmount),
            {
                platformFee: Number(order.platformFeeNet),
                vat: Number(order.platformFeeVat),
            },
            {
                tx,
                // Settlement provenance (defense-in-depth layer 2): sourceId
                // MUST be non-null — the partial unique index
                // journal_entries_settlement_once treats NULL as distinct,
                // so a null sourceId would silently defeat the
                // one-live-settlement-per-order guard. order.id is the PK,
                // always non-null.
                sourceType: 'CHECKOUT_SETTLEMENT',
                sourceId: order.id,
                // F-CHECKOUT-M2 (2026-08-18): mirrors the milestone-dimensioned
                // mint-time write (stripe-checkout-service.js) — journal
                // provenance consistency, not correctness-critical
                // (resolveIssuerType only needs the STATE_FEE/PLATFORM_FEE
                // substring, which this preserves either way). `milestone`
                // is already in scope above (order.milestone).
                serviceType: `CERTIFICATION_CHECKOUT_${milestone}`,
                invoiceNumber: order.invoice?.invoiceNumber || order.invoiceId,
                organizationId: order.organizationId,
                paidAt: settledAt,
            },
        );

        // 4. W14 — the ONE settlement document: the company's full tax invoice
        //    for the whole ค่าบริการ. The DTAM disbursal receipt is not issued.
        await tx.checkoutDocument.create({
            data: {
                checkoutOrderId: order.id,
                documentType: 'PLATFORM_TAX_INVOICE',
                documentNumber: payloads.taxInvoice.documentNumber,
                payload: payloads.taxInvoice,
                organizationId: order.organizationId,
            },
        });

        // 5. The workflow unlock — SYSTEM actor, canonical writer.
        if (order.applicationId && targetState) {
            await writeApplicationStatus({
                prisma: tx,
                applicationId: order.applicationId,
                fromStatus: order.application?.status,
                toStatus: targetState,
                actorId: 'stripe-webhook',
                actorRole: 'SYSTEM',
                reason: `CHECKOUT_${milestone}_SETTLED`,
                additionalData: milestone === 'M1'
                    ? { phase1Status: 'PAID', phase1PaidAt: settledAt }
                    : { phase2Status: 'PAID', phase2PaidAt: settledAt },
            });
        }

        return { raced: false };
    }, { timeout: SETTLEMENT.TX_TIMEOUT_MS, maxWait: SETTLEMENT.TX_MAX_WAIT_MS });

    if (txOutcome?.raced) {
        // The FOR-UPDATE recheck found the order already SETTLED — a
        // concurrent handler (webhook kick, Stripe redelivery, reconcile)
        // won the race. No writes happened in this call; report the same
        // alreadySettled shape as the outside-tx fast path instead of a
        // phantom fresh "settled" — this exact case is what an operator
        // reaches for during a concurrency incident.
        logger.info('[checkout-settle] already settled by a concurrent handler', {
            eventId,
            checkoutOrderId: order.id,
        });
        return { settled: true, alreadySettled: true };
    }

    // ── F-G4-64: close the quotation. AFTER the commit. Best-effort. ────────
    // The whole rationale, and the second (heal) call site, are on
    // closeQuotationForSettledOrder above. Here the number and the instant are
    // the ones this settle just produced.
    await closeQuotationForSettledOrder({
        order, milestone, invoiceNumber: companyNo.number, at: settledAt, eventId,
    });

    logger.info('[checkout-settle] settled', {
        eventId,
        checkoutOrderId: order.id,
        milestone,
        targetState,
    });

    return { settled: true };
}

/**
 * Retry backoff for a given attempt count — last entry repeats for further
 * attempts. `attempts` is already 1-based (post-incremented by the caller
 * before this is called), so the first failure (attempts=1) must index
 * b[0], not b[1] — hence attempts - 1.
 */
function nextBackoff(attempts) {
    const b = SETTLEMENT.RETRY_BACKOFF_MS;
    return b[Math.min(attempts - 1, b.length - 1)];
}

/**
 * Event-level wrapper around `settleFromPaymentIntent`: loads the stored
 * webhook-event row, extracts the PaymentIntent from its payload, attempts
 * the settle, and stamps the event's own status/attempts/nextRetryAt so a
 * crash or a slow settle is retryable instead of silently lost. After
 * `SETTLEMENT.MAX_ATTEMPTS` failures the event is DEAD_LETTER — logged
 * loudly for operator action, no further automatic retry.
 *
 * @param {string} eventId
 * @returns {Promise<{status: 'PROCESSED'|'FAILED'|'DEAD_LETTER', reason?: string}>}
 */
async function settleEvent(eventId) {
    const ev = await prisma.stripeWebhookEvent.findUnique({ where: { id: eventId } });
    if (!ev) {
        return { status: 'FAILED', reason: 'EVENT_NOT_FOUND' };
    }
    if (ev.status === 'PROCESSED') {
        return { status: 'PROCESSED', reason: 'ALREADY' };
    }
    // DEAD_LETTER is terminal — past MAX_ATTEMPTS, logged for operator
    // action. Without this short-circuit, a re-drive (e.g. a manual Stripe
    // resend of a dead-lettered event) would fall through and re-attempt
    // the settle, defeating the dead-letter stop.
    if (ev.status === 'DEAD_LETTER') {
        return { status: 'DEAD_LETTER', reason: 'ALREADY_TERMINAL' };
    }
    const paymentIntent = ev.payload?.data?.object;
    try {
        const result = await settleFromPaymentIntent({ paymentIntent, eventId });
        const terminal = result.settled === false && result.reason; // AMOUNT_MISMATCH / ORDER_NOT_FOUND
        await prisma.stripeWebhookEvent.update({
            where: { id: eventId },
            data: { status: 'PROCESSED', processedAt: new Date(), error: terminal || null, nextRetryAt: null },
        });
        return { status: 'PROCESSED', reason: terminal || undefined };
    } catch (err) {
        const attempts = (ev.attempts || 0) + 1;
        const dead = attempts >= SETTLEMENT.MAX_ATTEMPTS;
        await prisma.stripeWebhookEvent.update({
            where: { id: eventId },
            data: {
                status: dead ? 'DEAD_LETTER' : 'FAILED',
                attempts,
                error: err.message,
                nextRetryAt: dead ? null : new Date(Date.now() + nextBackoff(attempts)),
            },
        });
        if (dead) {
            logger.error('[settle] DEAD_LETTER — operator action required', { eventId, attempts, error: err.message });
        }
        return { status: dead ? 'DEAD_LETTER' : 'FAILED', reason: err.message };
    }
}

/**
 * Fix round 2 (feat/promptpay-qr, 2026-09-27). An order can outlive its first
 * PaymentIntent: when intent A is canceled, the checkout create path mints ONE
 * replacement B and moves checkoutOrder.stripePaymentIntentId to B
 * (stripe-checkout-service resolveExistingIntent). A's canceled or failed
 * event can arrive after that, and both handlers find the order by
 * metadata.checkoutOrderId — so without this guard a late event for A would
 * cancel the order B belongs to, or stamp B's charge row with A's failure.
 *
 * They act ONLY when the event's intent IS the order's current one. An order
 * that records no intent is not current for any event. payment_intent.succeeded
 * is not routed through here and is unchanged (its stale-intent alert is a
 * separate backlog item).
 */
const SUPERSEDED_INTENT = 'SUPERSEDED_INTENT';

function isCurrentIntent(order, intent) {
    return Boolean(order.stripePaymentIntentId) && order.stripePaymentIntentId === intent?.id;
}

/**
 * Record the event as ignored and change nothing. The reason rides on the
 * event row's `error` column (the webhook route stamps the row PROCESSED next;
 * settleEvent writes its own terminal reasons the same way) and in the log. A
 * failed stamp is logged and swallowed: the decision to ignore stands, and a
 * throw here would make Stripe redeliver an event whose only effect is none.
 */
async function ignoreSupersededIntent(event, order, intent) {
    logger.warn('[checkout-settle] event for a superseded PaymentIntent ignored; the order is untouched', {
        eventId: event.id,
        type: event.type,
        checkoutOrderId: order.id,
        paymentIntentId: intent?.id,
        currentPaymentIntentId: order.stripePaymentIntentId || null,
        reason: SUPERSEDED_INTENT,
    });
    try {
        await prisma.stripeWebhookEvent.update({
            where: { id: event.id },
            data: { error: `IGNORED:${SUPERSEDED_INTENT}` },
        });
    } catch (err) {
        logger.error('[checkout-settle] could not stamp the ignored event (non-fatal)', {
            eventId: event.id, error: err.message,
        });
    }
    return { handled: true, ignored: true, reason: SUPERSEDED_INTENT };
}

/**
 * Dispatch a verified, deduplicated Stripe event.
 * @returns {Promise<{handled: boolean, settled?: boolean, reason?: string}>}
 */
async function handleStripeEvent(event) {
    const object = event?.data?.object || {};

    switch (event.type) {
        case 'payment_intent.succeeded': {
            // Routed through the event-bookkeeping wrapper (not
            // settleFromPaymentIntent directly) so status/attempts/
            // nextRetryAt stay consistent for every succeeded event.
            const result = await settleEvent(event.id);
            return { handled: true, ...result };
        }

        case 'payment_intent.payment_failed': {
            // The order stays PENDING_PAYMENT — the applicant retries against
            // the same intent. Record the failure on the charge row.
            const order = await prisma.checkoutOrder.findFirst({
                where: object?.metadata?.checkoutOrderId
                    ? { id: object.metadata.checkoutOrderId }
                    : { stripePaymentIntentId: object.id },
            });
            if (order && !isCurrentIntent(order, object)) {
                return ignoreSupersededIntent(event, order, object);
            }
            if (order?.paymentTransactionId) {
                await prisma.paymentTransaction.update({
                    where: { id: order.paymentTransactionId },
                    data: {
                        errorCode: 'PAYMENT_FAILED',
                        errorMessage: object?.last_payment_error?.message || 'payment_failed',
                        webhookReceivedAt: new Date(),
                    },
                });
            }
            logger.warn('[checkout-settle] payment failed (retryable)', {
                eventId: event.id, paymentIntentId: object.id,
            });
            return { handled: true };
        }

        case 'payment_intent.canceled': {
            const order = await prisma.checkoutOrder.findFirst({
                where: object?.metadata?.checkoutOrderId
                    ? { id: object.metadata.checkoutOrderId }
                    : { stripePaymentIntentId: object.id },
            });
            if (order && !isCurrentIntent(order, object)) {
                return ignoreSupersededIntent(event, order, object);
            }
            // Order, unpaid invoice and PENDING charge together, in one
            // transaction, through the helper the checkout door uses (PR2 review
            // I-1). Cancelling the order alone left its invoice live, and
            // uniq_invoice_app_service_active then refused every later mint.
            // CANCELLED is retired too, so a redelivery heals an order the old
            // handler (or the checkout door's failed transaction) left behind.
            if (order && (order.status === 'PENDING_PAYMENT' || order.status === 'CANCELLED')) {
                await prisma.$transaction((tx) => retireCheckoutOrderInTx(tx, {
                    order, reason: RETIRE_REASONS.INTENT_CANCELED,
                }));
            }
            return { handled: true };
        }

        default:
            // Acknowledged, not ours — Stripe stops redelivering.
            return { handled: false };
    }
}

module.exports = {
    SETTLED_TARGET_STATE,
    settleFromPaymentIntent,
    settleEvent,
    handleStripeEvent,
    // exported for the document engine's later PDF renderer
    buildSettlementDocumentPayload,
    _internals: { getInvoiceIssuer },
};
