/**
 * Canonical money-flow side classifier (Bug 6.2).
 *
 * ONE source of truth for "which money-flow side does this invoice belong to?"
 * — STATE/DTAM (ค่าธรรมเนียมรัฐ, ยกเว้น VAT) vs PLATFORM (ค่าบริการ Predictive
 * AI, +VAT 7%). Every reporting/classification consumer MUST route through this
 * helper so the split-payment calculator, customer statement, daily-cash report,
 * bank reconciliation and the hold/release write guard never disagree. (No read
 * path narrows by the viewer's role any more — operator 2026-09-11.)
 *
 * Rule (owner decision, bug-hunt Batch 6):
 *   - The legacy pre-split state fees `APPLICATION_FEE` and `AUDIT_FEE`
 *     (+ aliases PHASE_2_AUDIT / PHASE2_AUDIT) are STATE. Before this fix
 *     split-payment-calculator classified them GOV while three other services
 *     classified them PLATFORM — the same invoice landed on different books.
 *   - The canonical `*_STATE_FEE` types are STATE.
 *   - Everything else — platform fees (`*_PLATFORM_FEE`) + subscriptions —
 *     is PLATFORM. DTAM does not issue subscription/platform receipts.
 *
 * Implementation: normalise the legacy serviceType to its canonical form via
 * phase-billing-service.normalizeInvoiceServiceType (APPLICATION_FEE →
 * PHASE_1_STATE_FEE, AUDIT_FEE → PHASE_2_STATE_FEE), THEN key on the
 * `_STATE_FEE` suffix. This is the single place the legacy→state mapping lives.
 *
 * @module services/finance/invoice-side
 */

'use strict';

const { normalizeInvoiceServiceType } = require('../phase-billing-service');
const { normalizeRole, CANONICAL_ROLES } = require('../../shared/canonical-rbac');

const INVOICE_SIDES = Object.freeze({
    STATE: 'STATE',
    PLATFORM: 'PLATFORM',
});

/**
 * Classify an invoice serviceType into its canonical money-flow side.
 *
 * @param {string} serviceType — raw or canonical invoice.serviceType.
 * @returns {'STATE' | 'PLATFORM' | null} STATE for state/DTAM fees (incl. legacy
 *   APPLICATION_FEE/AUDIT_FEE), PLATFORM for platform fees + subscriptions,
 *   null for an empty/absent serviceType.
 */
function classifyInvoiceSide(serviceType) {
    const canonical = normalizeInvoiceServiceType(serviceType);
    if (!canonical) {
        return null;
    }
    // normalizeInvoiceServiceType rewrites the legacy state fees to their
    // canonical `*_STATE_FEE` form, so a single suffix check covers both.
    if (canonical.endsWith('_STATE_FEE') || canonical.includes('STATE_FEE')) {
        return INVOICE_SIDES.STATE;
    }
    return INVOICE_SIDES.PLATFORM;
}

// ── Issuer/reviewer side wall (relocated here 2026-09-06 from payment-slip-service
// when the slip subsystem was removed) ──────────────────────────────────────
// The ACCOUNT segregation-of-duties wall speaks ISSUER_SIDE (DTAM vs PLATFORM),
// a thin re-labelling of INVOICE_SIDES.STATE→DTAM used by the invoice/waiver
// side gates (routes/api/finance/invoice-helpers.js, services/waiver-reopen-
// service.js). It lived in payment-slip-service only for historical reasons; it
// classifies invoices, not slips, so it belongs with the canonical side module.
const ISSUER_SIDE = Object.freeze({ DTAM: 'DTAM', PLATFORM: 'PLATFORM' });

/**
 * Classify an invoice serviceType into the ISSUER side (DTAM | PLATFORM | null).
 * STATE maps to the DTAM issuer side; PLATFORM (platform fees + subscriptions)
 * stays PLATFORM; an empty serviceType returns null (contract preserved).
 */
function classifyIssuerSide(serviceType) {
    const canonical = classifyInvoiceSide(serviceType);
    if (canonical === null) {
        return null;
    }
    return canonical === INVOICE_SIDES.STATE ? ISSUER_SIDE.DTAM : ISSUER_SIDE.PLATFORM;
}

/**
 * Resolve which issuer side(s) a reviewer may act on, by canonical role.
 * การเงินฝั่งกรม→[DTAM] · การเงินฝั่งบริษัท→[PLATFORM] · ผู้ดูแล→ทั้งสองฝั่ง (ผู้ตรวจแปลงไม่มีเรื่องเงิน — operator 2026-09-27)
 * อย่างอื่น→[] (fail closed) · คำเปล่า `account` ที่เคยเห็นทั้งสองฝั่งถูกปลดระวาง 2026-09-10
 */
function resolveAllowedIssuerSides(reviewer) {
    const role = normalizeRole(reviewer?.role || reviewer?.canonicalRole);
    switch (role) {
        case CANONICAL_ROLES.FINANCE_OFFICER_DTAM:
            return [ISSUER_SIDE.DTAM];
        case CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM:
            return [ISSUER_SIDE.PLATFORM];
        case CANONICAL_ROLES.SYSTEM_ADMIN_DTAM:
        case CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM:
            return [ISSUER_SIDE.DTAM, ISSUER_SIDE.PLATFORM];
        default:
            return [];
    }
}

module.exports = {
    INVOICE_SIDES,
    classifyInvoiceSide,
    ISSUER_SIDE,
    classifyIssuerSide,
    resolveAllowedIssuerSides,
};
