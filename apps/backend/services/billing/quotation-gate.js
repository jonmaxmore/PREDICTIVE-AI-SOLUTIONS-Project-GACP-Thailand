'use strict';
/**
 * The ONE quotation gate — services/billing/quotation-gate.js (F-G4-64, R1).
 *
 * Operator ruling 2026-08-28: a quotation is the PRICE OF RECORD of an
 * application, and the applicant pressing ยอมรับ on it (a human act, recorded
 * with the actor, the instant, and a snapshot of the figures they saw) is the
 * precondition for creating a payment for ANY instalment on EVERY rail.
 *
 * Why one module rather than two gates: until today the slip rail had a gate
 * (payment-slip-service.assertQuotationAcceptedForSlip) and the card rail
 * had none, and no decision record anywhere says the two were meant to differ
 * (synthesis.md 1.3). The rail that collected 176,550 THB and issued three
 * certificates is the one WITHOUT the gate.
 *
 * FAIL-CLOSED IN EVERY DIRECTION. This function has no branch that returns a
 * "skip". In particular the slip rail's legacy fail-open — "no quotation for
 * this side, allowing the slip" — is DELETED, not ported: that branch is the
 * shape of application A2, which paid 35,310 THB and holds an active
 * certificate with no pricing document in the register at all.
 */

const { createLogger } = require('../../shared/logger');
const { ERROR_CODES, getMessage } = require('../../shared/error-codes');
// Dependency-free (an AsyncLocalStorage and four accessors), so this stays safe
// at module top in a file every money rail requires lazily.
const { withoutTenantScope } = require('../tenant-context');

const logger = createLogger('quotation-gate');

/**
 * The two rails speak different vocabularies for the same two instalments: the
 * card rail says M1/M2 (checkout_orders.milestone), the slip rail says
 * PHASE_1/PHASE_2 (invoice.serviceType, paymentTransaction.phase).
 */
const MILESTONE_TO_PHASE = Object.freeze({
    M1: 'PHASE_1',
    M2: 'PHASE_2',
    PHASE_1: 'PHASE_1',
    PHASE_2: 'PHASE_2',
});

/**
 * Quotation states that count as "the applicant accepted". ACCEPTED is the
 * direct result of pressing ยอมรับใบเสนอราคา; INVOICED is the post-acceptance
 * terminal (every instalment on this quotation has been billed).
 */
const QUOTATION_ACCEPTED_STATES = Object.freeze(['ACCEPTED', 'INVOICED']);

/** The refusals this gate can raise. Every row lives in shared/error-codes.js. */
const GATE_CODES = Object.freeze({
    UNAVAILABLE: 'QUOTATION_GATE_UNAVAILABLE',
    NOT_ISSUED: 'QUOTATION_NOT_ISSUED',
    EXPIRED: 'QUOTATION_EXPIRED',
    NOT_ACCEPTED: 'QUOTATION_NOT_ACCEPTED',
});

/**
 * Build the refusal both rails' routes already understand: `status` AND
 * `statusCode`, carrying the applicant-facing Thai copy.
 *
 * The HTTP status and the copy are READ FROM shared/error-codes.js rather than
 * repeated here. Those four rows name THIS FILE in their `source` field, so the
 * catalogue is the record of what this gate says to an applicant; a second copy
 * of the same four sentences in this module could drift from the catalogue that
 * the FE map and the Thai copy review both read, with nothing to catch it.
 *
 * A code missing from the catalogue still REFUSES, as a 503 carrying the
 * catalogue's own generic message, because the one outcome this module may
 * never produce is a pass.
 */
function gateError(code) {
    const row = ERROR_CODES[code];
    if (!row) {
        logger.error('[quotation-gate] refusal code is not in the catalogue, refusing as 503', { code });
        return Object.assign(new Error(getMessage('INTERNAL_SERVER_ERROR', 'th')), {
            code: GATE_CODES.UNAVAILABLE, status: 503, statusCode: 503,
        });
    }
    return Object.assign(new Error(row.messageTh), {
        code, status: row.httpStatus, statusCode: row.httpStatus,
    });
}

/**
 * Refuse to create a payment unless this application's quotation(s) are accepted.
 *
 * @param {object} args
 * @param {string} args.applicationId
 * @param {'M1'|'M2'|'PHASE_1'|'PHASE_2'} args.milestone
 * @param {object} [args.client] — Prisma transaction handle, passed straight to
 *   quotation-service as `tx`. The gate itself never opens a transaction.
 * @returns {Promise<{quotation: object, phase: 'PHASE_1'|'PHASE_2', snapshot: object|null}>}
 *   the row that gates this payment, the instalment phase, and the frozen
 *   snapshot the applicant accepted. `snapshot` is null on a row accepted before
 *   snapshots existed or closed by the repair script; the caller decides what a
 *   null means for it (stripe-checkout-service refuses to drift-check against one).
 * @throws {Error & {code, status, statusCode}} — always. There is no skip.
 */
async function assertQuotationAcceptedForPayment({ applicationId, milestone, client } = {}) {
    const phase = MILESTONE_TO_PHASE[String(milestone || '').toUpperCase()];
    if (!applicationId || !phase) {
        // A missing id or an unknown milestone is a programming error, not an
        // applicant error, and it must never become an accidental bypass.
        throw gateError(GATE_CODES.UNAVAILABLE);
    }

    let rows;
    try {
        // Lazy require: quotation-service pulls in document-numbering at load,
        // and requiring it at module top breaks slip suites that do not stub
        // that chain — the same reason payment-slip-service defers it.
        const quotationService = require('../quotation-service');
        // Resolved by the APPLICATION, never by whoever is pressing the button
        // (R6). 'Quotation' is in TENANT_SCOPED_MODELS, so with a tenant
        // context bound this read is narrowed to the CALLER's organization —
        // and this gate also runs under staff (slip approval) and under a
        // webhook worker. For an applicant outside that organization the row
        // would not be found and a legitimate payment would be refused as
        // QUOTATION_NOT_ISSUED: a fail-closed gate must fail closed on the
        // truth, not on who is asking. Ownership is settled by the callers
        // before they reach this line.
        rows = await withoutTenantScope(
            () => quotationService.findQuotationsByApplicationId(applicationId, { tx: client }),
        );
    } catch (err) {
        logger.error('[quotation-gate] lookup failed, refusing rather than opening', {
            applicationId, milestone, errMessage: err?.message || String(err),
        });
        throw Object.assign(gateError(GATE_CODES.UNAVAILABLE), { cause: err });
    }

    // W14 (operator ruling 2026-08-22): a newly quoted application has exactly
    // ONE row, issuerType 'PLATFORM' — the company issues the whole price. A
    // pre-W14 application legitimately has a DTAM row as well, and BOTH of those
    // priced part of the bill, so BOTH must be accepted.
    const gating = [rows?.dtam, rows?.platform].filter(Boolean);

    if (gating.length === 0) {
        logger.error('[quotation-gate] no quotation of record, payment refused', {
            applicationId, milestone,
        });
        // The copy on this refusal USED to tell the applicant to refresh, on
        // the strength of GET /api/applications/:id/quotations re-issuing under
        // control (quotation-issuance.ensureQuotationForIssuedApplication).
        // Fix round 1 of the final round: that read only mints inside
        // SELF_HEAL_STATUSES (M1 minus DRAFT), and an M2-payable application
        // with no row reaches THIS line — for it, refreshing can never produce
        // a quotation. An instruction the system cannot honour is worse than no
        // instruction, so the copy now states the cause and asks the applicant
        // to contact staff with the application number; the missing staff
        // issuance door is ledger F-G4-71.
        throw gateError(GATE_CODES.NOT_ISSUED);
    }

    const now = Date.now();
    for (const q of gating) {
        const status = String(q.status || '').toUpperCase();
        if (QUOTATION_ACCEPTED_STATES.includes(status)) { continue; }
        // A validity window binds an offer that has NOT been accepted; an
        // accepted quotation is an agreement, and agreements do not lapse
        // because the offer window closed. The 7-working-day window is ours
        // (config/business-rules.js PAYMENT.QUOTATION_VALIDITY_BUSINESS_DAYS,
        // operator ruling re-confirmed 2026-09-27) — the ป.พ.พ. wording in the
        // research is UNVERIFIED and is deliberately not cited in user copy.
        if (q.validUntil && new Date(q.validUntil).getTime() < now) {
            throw gateError(GATE_CODES.EXPIRED);
        }
        throw gateError(GATE_CODES.NOT_ACCEPTED);
    }

    // The company row carries the whole price and therefore the snapshot the
    // charge is checked against; a pre-W14 DTAM row is a gate, not the price of
    // record for the bundled charge.
    const primary = rows.platform || rows.dtam;
    return { quotation: primary, phase, snapshot: primary.acceptedSnapshot || null };
}

module.exports = {
    assertQuotationAcceptedForPayment,
    // The same catalogued refusal, for a money door that reads the quotation on
    // its own (payment-service-phase-flow.resolveLockedPhaseTotals, round 4).
    quotationGateRefusal: gateError,
    MILESTONE_TO_PHASE,
    QUOTATION_ACCEPTED_STATES,
    GATE_CODES,
};
