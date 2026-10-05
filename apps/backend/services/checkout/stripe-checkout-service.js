'use strict';

/**
 * Stripe checkout intent service — Wave 2
 * (docs/payment-refactor/step2-data-model-design.md v2, approved).
 *
 * One checkout = one CheckoutOrder = one Invoice = one PaymentIntent.
 *
 * The two milestones of the canonical 7-step workflow:
 *   M1 — Step 1 checkout (the company's service fee for phase 1 + 7% VAT),
 *        payable while the application is in a phase-1-payable state.
 *   M2 — Step 4 checkout (the company's service fee for phase 2 + 7% VAT),
 *        payable only after เอกสารผ่าน (DOC_APPROVED / PENDING_AUDIT_FEE).
 *
 * Idempotency, twice over:
 *   - the Wave-1 partial unique index guarantees ONE open order per
 *     (application, milestone); re-entry re-uses it.
 *   - the PaymentIntent is created with idempotency key `checkout:{orderId}`,
 *     so a retried create returns the SAME intent — never a second charge.
 *
 * Drain-then-purge (D2): this service is additive. The legacy slip path is
 * untouched; routing new checkouts here is gated by STRIPE_CHECKOUT_ENABLED.
 */

const { prisma } = require('../prisma-database');

// holder-access is required lazily: it loads farm-access and the permission
// engine, which the checkout suites that stub this module's chain do not carry.
const holderAccess = () => require('../holder-access');
const feeService = require('../fee-service');
const logger = require('../../shared/logger');
const { MILESTONES } = require('../../shared/checkout-status');
const { getPaymentAdapter } = require('../payment/payment-adapter');
const { toSatang, STATEMENT_DESCRIPTOR } = require('../../config/stripe');
const { computeDueDate } = require('./checkout-schedule-service');
const { storedCultivationScopeCount } = require('../../shared/application-scope');
// F-G4-64: the applicant-facing sentence of every refusal below is READ FROM
// the catalogue, never retyped here, so the copy the applicant sees and the
// copy the Thai-copy review reads are the same string.
const { ERROR_CODES } = require('../../shared/error-codes');

/**
 * Application states from which each milestone may be paid. M1 covers the
 * submission window; M2 opens only when the documents have passed. Mirrors
 * the canonical dictionary; the slip-era states stay listed so an in-flight
 * application that switches rails mid-window can still pay (drain window).
 *
 * F-G4-64 — DRAFT is GONE from M1. A quotation is issued on the way OUT of
 * DRAFT (routes/api/applications/applications.js submit doors), so a DRAFT
 * application has no price of record to accept and, with the acceptance gate
 * below fail-closed, every DRAFT checkout would refuse anyway. Removing it
 * turns an unexplained quotation refusal into the accurate one
 * (CHECKOUT_MILESTONE_NOT_PAYABLE: this milestone is not payable yet).
 */
const PAYABLE_STATES = Object.freeze({
    M1: Object.freeze(['SUBMITTED', 'PENDING_DOC_FEE']),
    M2: Object.freeze(['DOC_APPROVED', 'PENDING_AUDIT_FEE']),
});

/**
 * M2 (fix, 2026-08-23) — the milestone slot a certificate RENEWAL is billed in.
 *
 * A renewal is ONE charge (operator ruling 2026-08-22, the change log
 * 67ef3612 / 8b8d581f; billing change authorised as a one-time L3 exception,
 * eabfc020). It has no document-review stage and therefore no phase 1, and it
 * enters the workflow already at the site-visit payment gate — renewal-service
 * creates it at PENDING_AUDIT_FEE (services/renewal-service.js:232), which is
 * an M2-payable state above. So M2 is the only milestone a renewal can reach
 * this rail with, and it is the slot quotation-service already books the single
 * charge into (services/quotation-service.js:271-300) precisely so settlement's
 * M2 -> AUDIT_FEE_PAID mapping keeps working untouched.
 *
 * Hence a renewal-aware BREAKDOWN rather than a third milestone: a new
 * milestone would have to be taught to checkout-settlement-service, and
 * settlement is not in scope. What was wrong here was only the PRICE.
 */
const RENEWAL_MILESTONE = 'M2';

/**
 * The Invoice.serviceType this rail mints for a milestone — the ONE place the
 * value is built.
 *
 * Milestone-dimensioned so M1 and M2 are distinct rows under the partial
 * unique index uniq_invoice_app_service_active (applicationId, serviceType),
 * and deliberately free of 'STATE_FEE' (resolveIssuerType would flip to DTAM
 * and skip the revenue entry).
 *
 * Readers (e.g. the applicant preview's summarizeCheckoutInvoices) ask this
 * function instead of typing the string again, so a reader can never drift
 * from the minter.
 */
const { isRenewalFiling, serviceFor, vatLine } = require('../../shared/instalment-service-names');
// The rate the VAT line is captioned with — the same FEES.VAT_RATE the charge is computed at.
const { PLATFORM_ISSUER } = require('../../config/invoice-issuers');

function checkoutInvoiceServiceType(milestone) {
    return `CERTIFICATION_CHECKOUT_${milestone}`;
}

function httpError(status, code, message) {
    return Object.assign(new Error(message), { status, statusCode: status, code });
}

/**
 * The catalogued refusal for a code, with its own HTTP status and its own Thai
 * sentence (shared/error-codes.js). A code missing from the catalogue still
 * REFUSES, as a 500, because on a money path the one outcome a broken lookup
 * may never produce is a pass.
 */
function catalogError(code) {
    const row = ERROR_CODES[code];
    if (!row) {
        return httpError(500, code, ERROR_CODES.INTERNAL_SERVER_ERROR.messageTh);
    }
    return httpError(row.httpStatus, row.code, row.messageTh);
}

/**
 * The acceptance hash to stamp on a new order (F-G4-64).
 *
 * The row's stored `acceptedSnapshotHash` is the acceptance record itself and
 * wins whenever it exists. A row that carries a snapshot but no hash was
 * accepted before that column existed; hashing the snapshot the drift check
 * actually compared against records what this charge was checked against, which
 * is the honest answer and is reproducible from the stored snapshot. A row with
 * neither gets null: nothing was agreed to in a form this rail can point at, and
 * a fabricated hash would read like evidence.
 */
function quotationSnapshotHash(quotation, snapshot) {
    if (quotation?.acceptedSnapshotHash) { return quotation.acceptedSnapshotHash; }
    if (!snapshot) { return null; }
    // Lazy require: quotation-service is already loaded by the gate that ran
    // immediately above this call.
    const { canonicalSnapshotHash } = require('../quotation-service');
    return canonicalSnapshotHash(snapshot);
}

/**
 * Money equality at two decimals (F-G4-64 R2).
 *
 * BOTH sides are normalised through Number before the fixed-point compare, so
 * the answer depends on the value and not on how either side happened to be
 * serialised. Comparing the live figure against `String(frozen)` — which this
 * did first — answered "different" for any snapshot whose money fields are
 * numbers rather than the 2-decimal strings quotation-service._thb writes,
 * because String() of a whole-baht number carries no two-decimal tail: a
 * self-inflicted payment outage for that applicant, plus a CRITICAL audit row
 * asserting a mismatch that does not exist. (The literal example that used to
 * stand here made the ratchet hardcode counter rise by one, on a comment.)
 *
 * A side that is not a finite number is never "the same": on a money path an
 * unreadable figure is a refusal, not a pass.
 */
function sameMoney(live, frozen) {
    const liveNumber = Number(live);
    const frozenNumber = Number(frozen);
    if (!Number.isFinite(liveNumber) || !Number.isFinite(frozenNumber)) { return false; }
    return liveNumber.toFixed(2) === frozenNumber.toFixed(2);
}

/**
 * R2 — charge to the satang what the applicant accepted, or charge nothing.
 *
 * ONE implementation for BOTH doors, the mint and the re-entry (coordinator
 * ruling 5: "re-entry is gated too"). A drain-window order — minted before this
 * gate existed, so `quotation_id` is NULL — holds whatever figure was live on
 * the day it was created; if the application was revised after issuance (open
 * F-G4-70) that figure can be thousands of baht below the document the
 * applicant has since accepted, and handing back its PaymentIntent would charge
 * a price nobody agreed to. A comparison written twice is a comparison that
 * will differ once, so there is exactly one.
 *
 * The formula is untouched. `figures` is whatever THIS request would charge —
 * the fresh fee-service decomposition on a mint, the figures STORED on the
 * order on a re-entry — and this function only ever refuses.
 *
 * Three cases, deliberately distinct:
 *   - no snapshot at all: nothing to compare. The row was accepted before
 *     snapshots existed, or closed by the repair script; inventing a comparison
 *     would be inventing a record.
 *   - a snapshot that does not price this instalment: CHECKOUT_PHASE_NOT_PRICED.
 *     Skipping the check here would create a charge against a document that
 *     never named a price for the phase being charged — a fail-open branch
 *     inside a check whose entire purpose is to be fail-closed. It is reachable
 *     by construction: a renewal quotation carries PHASE_2 only. The renderer
 *     refuses the same data defect under QUOTATION_PHASE_NOT_PRICED; that row's
 *     copy tells the applicant no DOCUMENT was issued and sends them to open a
 *     different instalment's document, which is the wrong cause and an
 *     unreachable next action when what was refused is a PAYMENT.
 *   - a snapshot that prices it differently: CHECKOUT_PRICE_DRIFT.
 *
 * @param {object} args
 * @param {{platformFeeNet:number, platformFeeVat:number,
 *          totalPayableAmount:number}} args.figures — what would be charged
 * @param {object|null} args.snapshot — the frozen document, from the gate
 * @param {'PHASE_1'|'PHASE_2'} args.phase
 * @param {object} args.quotation
 * @param {object} args.application
 * @param {'M1'|'M2'} args.milestone
 * @param {string|null} args.actorId
 * @param {string|null} args.actorRole — the caller's role, threaded from the
 *   route (`req.user.canonicalRole || req.user.role`). AuditLog.actorRole is
 *   NOT NULL (prisma/schema/audit.prisma), so omitting it dropped the whole
 *   CRITICAL row inside auditLogger.log's catch — the refusal stood but left no
 *   permanent trace at all (whole-branch review C6).
 * @param {'MINT'|'RE_ENTRY'} args.entry — which door asked, recorded on the
 *   audit row so a human can tell a stale order from a fresh charge
 * @returns {Promise<void>} resolves having done nothing, or throws
 * @throws {Error & {code, status, statusCode}}
 */
async function assertChargeMatchesAcceptedFigures({
    figures, snapshot, phase, quotation, application, milestone, actorId, actorRole, entry,
}) {
    if (!snapshot) { return; }

    const accepted = Array.isArray(snapshot.installments)
        ? snapshot.installments.find((i) => i.phase === phase)
        : null;
    if (!accepted) {
        logger.error('[checkout] the accepted document does not price this instalment, refusing', {
            applicationId: application.id,
            milestone,
            phase,
            quotationId: quotation.id,
            quotationNumber: quotation.quotationNumber,
        });
        throw catalogError('CHECKOUT_PHASE_NOT_PRICED');
    }

    const matches = sameMoney(figures.platformFeeNet, accepted.serviceFeeAmount)
        && sameMoney(figures.platformFeeVat, accepted.vatAmount)
        && sameMoney(figures.totalPayableAmount, accepted.phaseTotal);
    if (matches) { return; }

    const acceptedPhaseTotal = Number(accepted.phaseTotal).toFixed(2);
    const livePhaseTotal = Number(figures.totalPayableAmount).toFixed(2);
    logger.error('[checkout] PRICE DRIFT, refusing to charge a figure the applicant did not accept', {
        applicationId: application.id,
        milestone,
        entry,
        quotationId: quotation.id,
        quotationNumber: quotation.quotationNumber,
        accepted,
        live: figures,
    });

    // Two independent best-effort records, in two separate try blocks on
    // purpose: the audit row is the permanent trace, the notification is the
    // human. If the audit sink is down the staff alert must still go out, and
    // neither failure may downgrade a fail-closed 409 into a 500 that reads
    // like a bug in the applicant's request.
    try {
        // Lazy require: the audit chain is not needed on any successful path.
        const { auditLogger, AuditCategory, AuditSeverity, ResourceType } =
            require('../../middleware/audit-logger');
        await auditLogger.log({
            category: AuditCategory.PAYMENT,
            action: 'CHECKOUT_PRICE_DRIFT',
            severity: AuditSeverity.CRITICAL,
            actorId: actorId || null,
            // NOT NULL in schema, and the writer does not default it: a row
            // without it is not written at all. 'UNKNOWN' is the same fallback
            // the payments route already uses for its own audit events.
            actorRole: actorRole || 'UNKNOWN',
            resourceType: ResourceType.APPLICATION,
            resourceId: application.id,
            organizationId: application.organizationId,
            metadata: {
                milestone,
                entry,
                quotationId: quotation.id,
                quotationNumber: quotation.quotationNumber,
                acceptedPhaseTotal,
                livePhaseTotal,
            },
        });
    } catch (auditErr) {
        logger.error('[checkout] price-drift audit row could not be written (refusal stands)', {
            applicationId: application.id,
            errMessage: auditErr?.message || String(auditErr),
        });
    }

    // The refusal's copy ends "เจ้าหน้าที่ได้รับแจ้งแล้ว" and offers the
    // applicant no other action. An audit row is not a person: auditLogger.log
    // returns null when it cannot resolve the organization, and even a written
    // row only reaches a console line. This is what makes that sentence true.
    try {
        const { notifyAdminCheckoutPriceDrift } = require('../notification/domain-helpers');
        await notifyAdminCheckoutPriceDrift({
            applicationId: application.id,
            applicationNumber: application.applicationNumber || null,
            quotationNumber: quotation.quotationNumber || null,
            acceptedPhaseTotal,
            livePhaseTotal,
            milestone,
        });
    } catch (notifyErr) {
        logger.error('[checkout] price-drift alert could not be sent (refusal stands)', {
            applicationId: application.id,
            errMessage: notifyErr?.message || String(notifyErr),
        });
    }

    throw catalogError('CHECKOUT_PRICE_DRIFT');
}

/**
 * modules/billing decomposition for one milestone.
 *
 * ROUNDING RULE (design v2 §5.5) — pinned by money-equation-property.test.js;
 * VAT base per W14 (operator ruling 2026-08-22, the change log c28355ea):
 * every component is rounded on its own and the total is the sum of the
 * rounded components, never a rounded sum:
 *
 *   platform   = Math.round(state × PLATFORM_RATE)   ← rounded per component
 *   serviceFee = state + platform                    ← ค่าบริการ, the VAT base
 *   vat        = Math.round(serviceFee × VAT_RATE)   ← VAT 7% on the WHOLE
 *                                                      ค่าบริการ, from the
 *                                                      ROUNDED parts
 *   total      = state + platform + vat              ← sum of rounded parts
 *
 * The SSOT is buildPhaseFee (modules/billing/internal/fee-service.js); this
 * service only re-labels its output, so the equation the Wave-1 DB CHECK
 * enforces holds by construction. Computing VAT on an unrounded base, or
 * rounding the total, breaks that CHECK on the first odd amount.
 *
 * A RENEWAL takes calculateRenewalFee instead of fees.phase2 — the same
 * buildPhaseFee at the renewal rate, so the returned shape, the rounding and
 * the sum-check below are identical; only the rate differs (30,000 vs 25,000
 * state per scope → 35,310 vs 29,425 payable). See RENEWAL_MILESTONE above.
 */
/**
 * 2026-09-07: the same question was answered here and again in the quotation renderer,
 * which is how a price and the document that prints it get to disagree. One answer now —
 * shared/instalment-service-names.isRenewalFiling.
 */
const isRenewal = isRenewalFiling;

function breakdownForMilestone(application, milestone) {
    const feeContext = {
        ...(typeof application.formData === 'object' && application.formData ? application.formData : {}),
        // Inert: nothing in modules/billing reads this key off the payload — a
        // stored scope count only takes effect through `options.scopeCount`.
        // Renamed with the column rather than made live, because making it live
        // would change what applicants are charged (L3: an agent flags a money
        // path, it does not mutate one). Open finding: reports/sku/design-event.md.
        cultivationScopeCount: storedCultivationScopeCount(application),
    };
    let phase;
    if (isRenewal(application)) {
        // A renewal is not a phased application, so `fees.phase2` is the wrong
        // price for it: 25,000 state per scope instead of 30,000 — 29,425 paid
        // instead of 35,310, a 5,885 shortfall per scope on every renewal that
        // reached this rail.
        if (milestone !== RENEWAL_MILESTONE) {
            throw httpError(409, 'CHECKOUT_RENEWAL_SINGLE_CHARGE',
                `A renewal is a single charge billed as ${RENEWAL_MILESTONE}; ${milestone} has no instalment to pay`);
        }
        phase = feeService.calculateRenewalFee(feeContext);
    } else {
        const fees = feeService.calculateApplicationFees(feeContext);
        phase = milestone === 'M1' ? fees.phase1 : fees.phase2;
    }
    // ── ค่าบริการก้อนเดียว ลงคอลัมน์ฝั่งบริษัททั้งหมด (operator 2026-09-11) ──
    // ไม่มีส่วนของกรมฯ: เกษตรกรซื้อบริการจากบริษัท และบริษัทชำระกับกรมฯ นอกระบบ
    // ลงบัญชีในสมุดบัญชีของบริษัทเอง (operator 2026-09-29) · ยอดที่คิด = ค่าบริการ + VAT
    //
    // ชื่อ `platformFee*` ยังเป็นของคอลัมน์ ไม่ใช่ของความหมายใหม่ — ตอนนี้มันคือ
    // "ค่าบริการ" กับ "VAT ของค่าบริการ" ตรง ๆ · ชื่อจะถูกแก้พร้อมการดรอปคอลัมน์
    const platformFeeNet = phase.serviceFeeAmount;
    const platformFeeVat = phase.vatAmount;
    const platformFeeGross = platformFeeNet + platformFeeVat;
    const totalPayableAmount = platformFeeGross;
    if (totalPayableAmount !== phase.phaseTotal) {
        // The DB CHECK would refuse the row anyway; fail here with a clearer
        // message so a fee-service drift is caught at the source.
        throw httpError(500, 'CHECKOUT_BREAKDOWN_DRIFT',
            `breakdown total ${totalPayableAmount} != fee-service phaseTotal ${phase.phaseTotal}`);
    }
    return { platformFeeNet, platformFeeVat, platformFeeGross, totalPayableAmount };
}

/**
 * Create (or re-enter) the checkout for an application milestone.
 *
 * F-G4-64 — the order of the doors, exactly as spec §3.1 states it:
 *   ownership → payable status → quotation acceptance gate → payment-terms
 *   disclosure → re-entry lookup (a READ) → the figures this request would
 *   charge → snapshot drift check → adapter.assertReady() → the re-entry
 *   binding, then any DB write and any gateway mutation.
 *
 * The re-entry lookup and the fee decomposition sit inside that order because
 * the drift check guards the RE-ENTRY door too (coordinator ruling 5) and the
 * figures a re-entry would charge are the ones stored on the order the lookup
 * returns; both are side-effect-free.
 *
 * Why the drift check must precede assertReady() and not merely precede the
 * writes: assertReady() throws whenever the gateway is unconfigured or
 * mis-keyed, and running it first meant that during exactly that window an
 * application whose live figure disagreed with the accepted document produced a
 * gateway error and NO CRITICAL audit row and NO admin alert. The one condition
 * this check exists to surface would stay invisible for as long as the gateway
 * was down. Ordering it first costs nothing and keeps the invariant intact:
 * nothing is minted and nothing is asked of the gateway before every refusal
 * this function can raise has had its chance.
 *
 * @param {object} args
 * @param {string} args.applicationId
 * @param {'M1'|'M2'} args.milestone
 * @param {{id?: string, holderScope?: object, role?: string}} args.actor —
 *   `id` is the User.id the payment-terms consent is recorded against;
 *   the read uses `holderScope` (holder-access; required); `role` is written on
 *   the price-drift audit row (NOT NULL).
 * @returns {Promise<{checkoutOrderId, paymentIntentId, clientSecret, milestone,
 *                    breakdown, quotationNumber: string|null,
 *                    publishableKey: string|null, invoiceId: string|null,
 *                    payerEmail: string|null}>}
 */
async function createCheckoutForApplication({ applicationId, milestone, actor }) {
    if (!MILESTONES.includes(milestone)) {
        throw httpError(400, 'CHECKOUT_INVALID_MILESTONE', `Unknown milestone: ${milestone}`);
    }

    // Visibility is part of the lookup: a caller outside the holder gets 404,
    // never 403 — the same collapse-avoidance the preview routes use. Spec
    // 2026-09-30 §3.1: the read is within the payer's holder scope
    // (actor.holderScope; none = closed, no query), with no filer pin, so any
    // member the checkout door let through (SUBMIT_APPLICATION on the holder,
    // operator Q3) reads the filing. A read filter only: nothing below changes.
    const holderScope = actor?.holderScope;
    const hasScope = Boolean(holderScope) && typeof holderScope === 'object' && Array.isArray(holderScope.readIds);
    const application = hasScope
        ? await prisma.application.findFirst({
            where: {
                id: applicationId,
                ...holderAccess().holderReadWhere(holderScope, 'Application'),
                isDeleted: false,
            },
        })
        : null;
    if (!application) {
        throw httpError(404, 'APPLICATION_NOT_FOUND', 'Application not found');
    }
    if (!PAYABLE_STATES[milestone].includes(application.status)) {
        throw httpError(409, 'CHECKOUT_MILESTONE_NOT_PAYABLE',
            `Milestone ${milestone} is not payable from status ${application.status}`);
    }

    // ── F-G4-64: the acceptance gate ────────────────────────────────────────
    // Ownership and payable status are settled above. Everything below runs
    // BEFORE the adapter is touched and BEFORE any row is minted, so a refusal
    // leaves the database exactly as it was.
    //
    // The gate runs before the re-entry lookup as well (coordinator ruling 5):
    // an order minted during the drain window, when the gate did not exist,
    // must not become a door that re-enters without it.
    //
    // Lazy require: quotation-gate pulls in quotation-service and the numbering
    // chain, and requiring it at module top breaks checkout suites that do not
    // stub that chain — the same reason payment-slip-service defers it.
    const { assertQuotationAcceptedForPayment } = require('../billing/quotation-gate');
    const { quotation, phase, snapshot } = await assertQuotationAcceptedForPayment({
        applicationId: application.id,
        milestone,
    });

    // Q4 pre-payment disclosure (owner ruling 2026-07-08), which until now bound
    // the slip rail only — and payment_slips has zero rows, so no applicant has
    // ever actually seen this text (register.md G).
    //
    // Coordinator ruling 2 (2026-08-28): ONE consent namespace. This is the same
    // assertion, the same UserConsent ledger and the same
    // ConsentVersions.PAYMENT_TERMS the slip rail runs — NOT a version string
    // taken from the request body, which would be the client asserting that the
    // client showed the applicant a document.
    const { assertPaymentTermsAccepted } = require('../billing/payment-terms-gate');
    const paymentTerms = await assertPaymentTermsAccepted({ actorUserId: actor?.id });

    // Re-entry: the Wave-1 partial unique index means at most one open order
    // exists; reuse it so the applicant always lands on the same charge. A
    // READ, and it runs before the adapter so the price comparison below can
    // run before the adapter too.
    let order = await prisma.checkoutOrder.findFirst({
        where: {
            applicationId: application.id,
            ...holderAccess().holderReadWhere(holderScope, 'CheckoutOrder'),
            milestone,
            status: 'PENDING_PAYMENT',
        },
    });

    // What THIS request would charge: the figures frozen on the existing order
    // when re-entering it, a fresh fee-service decomposition when minting. The
    // formula is untouched — breakdownForMilestone is the same call it always
    // was, and it still raises CHECKOUT_RENEWAL_SINGLE_CHARGE for a renewal
    // asked for the instalment it does not have, before anything below runs.
    const breakdown = order
        ? {
            platformFeeNet: Number(order.platformFeeNet),
            platformFeeVat: Number(order.platformFeeVat),
            platformFeeGross: Number(order.platformFeeGross),
            totalPayableAmount: Number(order.totalPayableAmount),
        }
        : breakdownForMilestone(application, milestone);

    // R2, ONE call for BOTH doors (coordinator ruling 5). A post-gate order
    // always matches — it was checked at mint and the snapshot is immutable —
    // so this is a no-op for every order minted from here on, and it fires only
    // on a drain-window row whose stored figure is not what the applicant has
    // since accepted. Still nothing minted, still nothing asked of the gateway.
    await assertChargeMatchesAcceptedFigures({
        figures: breakdown,
        snapshot,
        phase,
        quotation,
        application,
        milestone,
        actorId: actor?.id || null,
        actorRole: actor?.role || null,
        entry: order ? 'RE_ENTRY' : 'MINT',
    });

    // W2-01 adapter seam: no SDK here. Fail fast BEFORE any DB row is minted
    // when the gateway is unconfigured (same fail-closed posture as before) —
    // and, since the drift check has already run, a mis-priced charge is
    // reported even while the gateway is down.
    const adapter = getPaymentAdapter();
    if (typeof adapter.assertReady === 'function') {
        adapter.assertReady();
    }
    // PromptPay QR step (operator ruling 2026-09-27): the browser confirms this
    // intent with Stripe.js, which needs the publishable key of the same account
    // and the same test/live mode. Asked here, beside assertReady() and before
    // any row is minted, so a missing or mismatched key (503
    // STRIPE_PUBLISHABLE_KEY_NOT_CONFIGURED / STRIPE_KEY_MODE_MISMATCH) leaves
    // no order that nobody could pay. An adapter that has no browser step hands
    // out no key, and the screen then says the QR cannot be shown.
    const clientConfig = typeof adapter.getClientConfig === 'function'
        ? adapter.getClientConfig()
        : { publishableKey: null };

    if (order && order.quotationId !== quotation.id) {
        // A drain-window order: minted before this gate existed, so nothing on
        // the row says which priced document it collects against. The
        // comparison immediately above has just PROVED which document and which
        // figures this charge answers to, and without writing that down the
        // order is paid and settled with quotation_id still NULL — which loses
        // it from T6's closure step and from the closure probe's INNER JOIN
        // (checkout_orders o JOIN quotations q ON q.id = o.quotation_id), so the
        // probe would report PASS while that quotation never reaches INVOICED.
        //
        // The condition is the IDENTITY check, not `!order.quotationId` (fix
        // round 3, reviewer r2 minor 2). A non-null pointer naming a DIFFERENT
        // row than the gate just returned is the more dangerous case of the
        // two: the charge was compared against the document above, while the
        // row still says it collects for a superseded one. That is reachable
        // through the path the catalogue prescribes — CHECKOUT_PRICE_DRIFT
        // tells staff to re-issue, and quotations_application_issuer_live_uq
        // (partial on isDeleted = false) makes a re-issue a soft-delete plus a
        // NEW id — and it ends with the closure step and the closure probe
        // joining the wrong document. Re-stamping is safe precisely here:
        // reaching this line means the figures on the row and the figures the
        // new document froze already agree to the satang, or the refusal above
        // fired instead. An order that already names this same document is
        // left alone, so a re-entry is not an UPDATE per press.
        //
        // Provenance columns only: not one money column is in this payload, so
        // the figure the applicant is asked for cannot move here.
        const binding = {
            quotationId: quotation.id,
            quotationSnapshotHash: quotationSnapshotHash(quotation, snapshot),
            paymentTermsVersion: paymentTerms.version,
            paymentTermsAcceptedAt: paymentTerms.acceptedAt,
        };
        // updateMany with the status predicate, not update: settlement can
        // commit between the read above and this write, and a SETTLED order
        // must not be re-opened. count === 0 means exactly that happened; the
        // local row is then left as it was read rather than claiming a binding
        // the database does not hold.
        const bound = await prisma.checkoutOrder.updateMany({
            where: { id: order.id, status: 'PENDING_PAYMENT' },
            data: binding,
        });
        if (bound?.count) {
            order = { ...order, ...binding };
        } else {
            logger.warn('[checkout] the open order changed state before it could be bound', {
                checkoutOrderId: order.id,
                applicationId: application.id,
                milestone,
            });
        }
    }

    if (!order) {
        // W2-02 §3.4 + F-CHECKOUT-M2 (2026-08-18, reports/payment-policy/
        // 2026-08-18-invoice-family-M2-collision.md): two requests can both
        // pass the findFirst gate before either commits, AND the invoice's
        // own partial unique index can independently reject a genuine same-
        // (app,milestone) resubmit — so the whole create sequence (order +
        // invoice + line items + charge + the link-back update) runs as ONE
        // transaction. Either every row commits or none do: an invoice-side
        // failure can never leave an orphan PENDING_PAYMENT order
        // (invoiceId=null) for a retry to later hand to settlement. The
        // P2002 translation below covers the ENTIRE block, not just the
        // order create — never a raw 500.
        try {
            order = await prisma.$transaction(async (tx) => {
                const newOrder = await tx.checkoutOrder.create({
                    data: {
                        applicationId: application.id,
                        milestone,
                        ...breakdown,
                        status: 'PENDING_PAYMENT',
                        organizationId: application.organizationId,
                        // F-G4-64 — the other half of the binding: which priced
                        // document this charge collects against, and the hash of
                        // the exact figures it was checked against. The row's own
                        // stored hash is the acceptance record and wins; a row
                        // that carries a snapshot but no hash (accepted before
                        // the column existed) gets the canonical hash of the
                        // snapshot this charge was actually compared with, and a
                        // row with neither gets null, because there is nothing
                        // that was agreed to record.
                        quotationId: quotation.id,
                        quotationSnapshotHash: quotationSnapshotHash(quotation, snapshot),
                        // Ruling 2: the disclosure that authorised THIS charge,
                        // copied from the UserConsent row — not a second version
                        // namespace and not the instant this request ran.
                        paymentTermsVersion: paymentTerms.version,
                        paymentTermsAcceptedAt: paymentTerms.acceptedAt,
                    },
                });

                // The ONE invoice for this checkout, with the itemized three-line
                // breakdown (replaces the per-phase STATE+PLATFORM invoice pair).
                const invoice = await tx.invoice.create({
                    data: {
                        invoiceNumber: `INV-CO-${newOrder.id.slice(0, 8).toUpperCase()}-${milestone}`,
                        applicationId: application.id,
                        healthId: application.healthId,
                        // Built by the shared helper above — the same one every
                        // reader of this invoice family asks.
                        serviceType: checkoutInvoiceServiceType(milestone),
                        subtotal: breakdown.platformFeeNet,
                        vat: breakdown.platformFeeVat,
                        totalAmount: breakdown.totalPayableAmount,
                        // Q2-D1 (W3-41): billing.prisma requires dueDate NOT NULL —
                        // mint stamps it from the schedule service (config-driven
                        // business-day window on the canonical Thai calendar).
                        dueDate: computeDueDate(new Date(), milestone),
                        status: 'pending',
                        organizationId: application.organizationId,
                    },
                });

                // ── สองบรรทัด ไม่ใช่สาม (operator 2026-09-11) ─────────────────
                //
                // เดิมออกสามบรรทัด: STATE_FEE (ราคาเต็ม) · PLATFORM_FEE (10%) · VAT
                // พอเลิกแยกส่วนรัฐ บรรทัดแรกกลายเป็น **0 บาทชื่อ "ราคาเต็ม"** และ
                // บรรทัดสองชื่อ "ค่าบริการแพลตฟอร์ม" แบกราคาทั้งก้อน — อ่านแล้วผิด
                // ทั้งคู่ และมันคือเอกสารที่เกษตรกรเก็บไว้ ไม่ใช่ตัวแปรภายใน
                // (fee-service.js ประกาศไว้เองแล้วว่า "บรรทัดที่บรรยายสูตรที่ไม่ได้ใช้
                // = ข้อความเท็จ" ตอนถอด stateItems/platformItems — ตรงนี้คือที่เดียว
                // ที่ยังไม่ได้ตามไปแก้)
                //
                // ไม่มีส่วนของกรมฯ ในราคาแล้ว จึงไม่มีบรรทัดของมัน
                // ชื่อ code ยังขึ้นต้น PLATFORM_ เพราะผูกกับคอลัมน์ที่จะดรอปในใบ
                // migration ถัดไป (ขยายก่อนหด) — ยอดรวมไม่ขยับแม้แต่สตางค์เดียว
                await tx.invoiceLineItem.createMany({
                    data: [
                        {
                            invoiceId: invoice.id,
                            organizationId: application.organizationId,
                            lineNumber: 1,
                            code: 'PLATFORM_FEE',
                            // ชื่อจากแค็ตตาล็อกเดียว (operator 2026-10-03) — งวดของ milestone นี้
                            // หรือบริการต่ออายุ · ใช้กับใบที่ออกใหม่เท่านั้น แถวเดิมไม่ถูกเขียนทับ
                            description: serviceFor(milestone, { isRenewal: isRenewal(application) }).name,
                            quantity: 1,
                            unitPrice: breakdown.platformFeeNet,
                            amount: breakdown.platformFeeNet,
                            isTaxable: true,
                        },
                        {
                            invoiceId: invoice.id,
                            organizationId: application.organizationId,
                            lineNumber: 2,
                            code: 'PLATFORM_VAT',
                            // ฐานคือค่าบริการทั้งก้อน ซึ่งตอนนี้คือบรรทัดเดียวข้างบน
                            // คำอธิบายเดิมเขียนว่า "ราคาเต็ม + ค่าแพลตฟอร์ม" ซึ่งเป็น
                            // การบวกสองอย่างที่ไม่มีอยู่แล้ว
                            description: vatLine(PLATFORM_ISSUER.vatRate).name,
                            quantity: 1,
                            unitPrice: breakdown.platformFeeVat,
                            amount: breakdown.platformFeeVat,
                            isTaxable: false,
                        },
                    ],
                });

                const charge = await tx.paymentTransaction.create({
                    data: {
                        applicationId: application.id,
                        phase: milestone === 'M1' ? 'PHASE_1' : 'PHASE_2',
                        gateway: 'STRIPE',
                        amount: toSatang(breakdown.totalPayableAmount),
                        currency: 'THB',
                        status: 'PENDING',
                        idempotencyKey: `checkout:${newOrder.id}`,
                        organizationId: application.organizationId,
                    },
                });

                return tx.checkoutOrder.update({
                    where: { id: newOrder.id },
                    data: { invoiceId: invoice.id, paymentTransactionId: charge.id },
                });
            });
        } catch (err) {
            if (err && err.code === 'P2002') {
                throw httpError(409, 'CHECKOUT_ALREADY_IN_PROGRESS',
                    'มีรายการชำระเงินของงวดนี้กำลังดำเนินการอยู่แล้ว กรุณาเปิดหน้าชำระเงินเดิมหรือลองใหม่อีกครั้ง');
            }
            throw err;
        }
    }

    // One order, one LIVE intent (review I-1, 2026-09-27). The idempotency key
    // alone is not enough: Stripe prunes keys after about 24 h, and a pruned key
    // quietly mints a second intent. With the QR step live that is a double
    // charge — the first intent's QR can still be paid after the second settles
    // the order, and settlement answers alreadySettled with no alert. So an
    // order that already names an intent asks the gateway what it is first
    // (resolveExistingIntent, foot of this file). A retrieval that fails
    // throws: nothing is minted on a guess.
    const existing = order.stripePaymentIntentId
        ? await resolveExistingIntent(adapter, order.stripePaymentIntentId)
        : null;

    const session = existing && existing.reuse
        ? existing.session
        : await adapter.createCheckoutSession({
            amountSatang: toSatang(breakdown.totalPayableAmount),
            currency: 'thb',
            // PromptPay QR only (mandate D3 2026-08-04). The card path is
            // intentionally NOT offered — see CHECKOUT_PAYMENT_METHOD_TYPES at the
            // foot of this file (declared there so no file:line citation moves).
            paymentMethodTypes: [...CHECKOUT_PAYMENT_METHOD_TYPES],
            statementDescriptor: STATEMENT_DESCRIPTOR,
            description: `GACP ${milestone} — ${application.applicationNumber}`,
            metadata: {
                checkoutOrderId: order.id,
                applicationId: application.id,
                milestone,
                organizationId: application.organizationId,
            },
            // First mint: the order id, so a retried create is the SAME intent.
            // Replacing a canceled intent: a key of its own, derived from the
            // intent it replaces, so the retry of THIS replacement is idempotent
            // too and the plain key cannot hand the canceled one back.
            idempotencyKey: existing
                ? `checkout:${order.id}:after:${order.stripePaymentIntentId}`
                : `checkout:${order.id}`,
        });

    if (order.stripePaymentIntentId !== session.id) {
        // Compare-and-set on the value READ above (fix round 3, N-1), the same
        // idiom as the binding write: the order may have been cancelled by a
        // webhook, or moved to a later replacement by a concurrent press, while
        // this request talked to the gateway. A blind update by id would write
        // this intent over that. No row matched → refuse, hand out no client
        // secret, and cancel nothing (the intent just minted is left to lapse).
        const moved = await prisma.checkoutOrder.updateMany({
            where: { id: order.id, status: 'PENDING_PAYMENT', stripePaymentIntentId: order.stripePaymentIntentId },
            data: { stripePaymentIntentId: session.id },
        });
        if (!moved?.count) {
            logger.warn('[checkout] the order changed before its intent could be recorded; refused', {
                checkoutOrderId: order.id, readPaymentIntentId: order.stripePaymentIntentId, newPaymentIntentId: session.id,
            });
            throw httpError(409, 'CHECKOUT_ORDER_CHANGED',
                `Checkout order ${order.id} changed while its payment was being prepared; nothing was recorded`);
        }
        order = { ...order, stripePaymentIntentId: session.id };
    }

    logger.info('[checkout] intent ready', {
        checkoutOrderId: order.id,
        applicationId: application.id,
        milestone,
        actorId: actor?.id || null,
    });

    return {
        checkoutOrderId: order.id,
        paymentIntentId: session.id,
        // null when the intent has already succeeded: there is nothing left for
        // a browser to confirm, and the screen watches for the webhook instead.
        clientSecret: session.clientSecret,
        // The gateway's own status of the intent handed back (a fresh intent is
        // requires_payment_method). The screen goes straight to waiting for the
        // webhook on 'succeeded' / 'processing'; it never marks anything paid.
        paymentIntentStatus: session.status || session.raw?.status || 'requires_payment_method',
        milestone,
        breakdown,
        // F-G4-64: so the checkout screen can NAME the document the applicant
        // accepted instead of showing a price with no provenance.
        quotationNumber: quotation.quotationNumber || null,
        // PromptPay QR step: the key Stripe.js loads with (null = no browser
        // step on this adapter), the one invoice the webhook settles and writes
        // the receipt onto (the screen watches it; it never marks it paid), and
        // the email Stripe requires for PromptPay (null = the screen asks).
        publishableKey: clientConfig.publishableKey || null,
        invoiceId: order.invoiceId || null,
        // Lazy require, down here rather than at the top, so no line above
        // moves: shared/error-codes.js cites this file by line number.
        payerEmail: await require('./payer-contact-email')
            .resolvePayerContactEmail({ application, userId: actor?.id }),
    };
}

/**
 * The payment methods the one live rail offers. PromptPay QR only (mandate D3
 * 2026-08-04). The card path is intentionally NOT offered: do not add a method
 * without an operator ruling; the FE confirm step and refund flow assume
 * PromptPay. Exported so the web copy that names the channel
 * (apps/web-app/src/constants/service-facts.ts PAYMENT_CHANNEL_TH) is pinned to
 * this list, not to a second literal (__tests__/unit/frontend-service-facts-mirror.test.js).
 * Read only when a checkout is created, i.e. after this module has loaded.
 */
const CHECKOUT_PAYMENT_METHOD_TYPES = Object.freeze(['promptpay']);

/**
 * PaymentIntent statuses under which the order's existing intent is handed back
 * as it is (review I-1). An expired PromptPay QR returns its intent to
 * requires_payment_method, so "expired" lands here too: confirming again shows
 * a fresh QR on the SAME intent.
 */
const REUSABLE_INTENT_STATUSES = Object.freeze(['requires_payment_method', 'requires_action', 'processing']);

/**
 * What to do with the intent an open order already names.
 *   reusable  → { reuse: true, session } (its own client secret)
 *   succeeded → { reuse: true, session } with clientSecret null: never mint a
 *               second intent for money already taken; the webhook settles.
 *   canceled  → { reuse: false }: the caller mints the one replacement.
 *   anything else (requires_confirmation / requires_capture — states this
 *   automatic-capture PromptPay flow never produces) → refused. Not canceled
 *   and replaced: payment_intent.canceled cancels the ORDER while the canceled
 *   intent is still the order's current one (settlement guard, fix round 2),
 *   and a cancel issued here lands before the replacement is recorded — so it
 *   would cancel the order this request is about to hand a new intent to.
 * The adapter's getPaymentIntent throws on a gateway failure; that propagates.
 * A null answer (the mock adapter after a restart) is treated as "no intent",
 * which re-mints under the plain key — deterministic on the mock.
 */
async function resolveExistingIntent(adapter, intentId) {
    if (typeof adapter.getPaymentIntent !== 'function') { return null; }
    const intent = await adapter.getPaymentIntent(intentId);
    if (!intent) { return null; }
    const status = intent.status;
    if (REUSABLE_INTENT_STATUSES.includes(status)) {
        return { reuse: true, session: { id: intent.id, clientSecret: intent.client_secret, status } };
    }
    if (status === 'succeeded') {
        return { reuse: true, session: { id: intent.id, clientSecret: null, status } };
    }
    if (status === 'canceled') {
        return { reuse: false };
    }
    throw httpError(409, 'CHECKOUT_INTENT_UNUSABLE',
        `PaymentIntent ${intentId} is ${status}; refusing to mint a second intent for the same order`);
}

module.exports = {
    CHECKOUT_PAYMENT_METHOD_TYPES,
    PAYABLE_STATES,
    checkoutInvoiceServiceType,
    createCheckoutForApplication,
};
