'use strict';

/**
 * What a renewal costs THIS application — the one place a health-facing payload asks.
 *
 * fix/fee-line-descriptions round 4 (operator 2026-10-03: prices are real costs, shown
 * completely and correctly). A renewal is one charge billed on the PHASE_2 / M2 slot; a
 * payload that priced every application as a new filing showed a renewal the phase-2
 * figure. Resolution order (the same as the web detail page):
 *   1. its checkout invoice (CERTIFICATION_CHECKOUT_M2, not cancelled) — what was billed;
 *   2. its quotation's PHASE_2 instalment (the accepted snapshot when there is one);
 *   3. the engine's renewal price for its billable types — calculateRenewalFee with
 *      billableScopes(application), exactly as quotation-service prices a renewal.
 * Reads only. Nothing here charges, writes or rounds anything new.
 *
 * @module services/billing/renewal-amount
 */

const { isRenewalFiling } = require('../../shared/instalment-service-names');
const { billableScopes } = require('../../shared/application-scope');

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

function fromInvoice(invoices) {
    const inv = (Array.isArray(invoices) ? invoices : []).find((i) => i
        && String(i.serviceType || '').toUpperCase() === 'CERTIFICATION_CHECKOUT_M2'
        && !/CANCEL|VOID/i.test(String(i.status || '')));
    if (!inv || num(inv.totalAmount) === null) { return null; }
    return {
        serviceFeeAmount: num(inv.subtotal),
        vatAmount: num(inv.vat),
        phaseTotal: num(inv.totalAmount),
        source: 'invoice',
    };
}

function fromQuotation(row) {
    if (!row) { return null; }
    const snapshot = row.acceptedSnapshot && Array.isArray(row.acceptedSnapshot.installments)
        ? row.acceptedSnapshot.installments
        : null;
    const lines = snapshot || (Array.isArray(row.installments) ? row.installments : []);
    const line = lines.find((it) => it && it.phase === 'PHASE_2');
    if (!line) { return null; }
    const total = num(line.phaseTotal) ?? num(line.amount);
    if (total === null) { return null; }
    return {
        serviceFeeAmount: num(line.serviceFeeAmount),
        vatAmount: num(line.vatAmount),
        phaseTotal: total,
        source: 'quotation',
    };
}

function fromEngine(application) {
    const { calculateRenewalFee } = require('../fee-service');
    const scopes = billableScopes(application);
    const fee = calculateRenewalFee(application?.formData || {}, { scopes });
    return {
        serviceFeeAmount: fee.serviceFeeAmount,
        vatAmount: fee.vatAmount,
        phaseTotal: fee.phaseTotal,
        scopeCount: scopes.length,
        source: 'engine',
    };
}

/**
 * @param {object} args
 * @param {object} args.application
 * @param {Array}  [args.invoices]     the application's invoices (subtotal, vat, totalAmount, serviceType, status)
 * @param {object} [args.quotationRow] its PLATFORM quotation row
 * @returns {{serviceFeeAmount:?number, vatAmount:?number, phaseTotal:number, source:string}}
 */
function resolveRenewalAmount({ application, invoices = [], quotationRow = null } = {}) {
    return fromInvoice(invoices) || fromQuotation(quotationRow) || fromEngine(application);
}

/** The engine figure only (pure) — for payloads that have no invoice/quotation at hand. */
function renewalPriceEstimate(application) {
    return isRenewalFiling(application) ? fromEngine(application).phaseTotal : null;
}

/**
 * The preview's per-instalment amounts. A new filing: both instalments from the engine,
 * unchanged. A renewal: no instalment 1, and its one charge resolved as above.
 */
function previewPhaseAmounts({ application, invoices = [], quotationRow = null } = {}) {
    if (!isRenewalFiling(application)) {
        const { calculateApplicationFees } = require('../fee-service');
        const fees = calculateApplicationFees(application?.formData || {}, { scopes: billableScopes(application) });
        return {
            isRenewal: false,
            scopeCount: fees.scopeCount,
            phase1: { serviceFeeAmount: fees.phase1.serviceFeeAmount, vatAmount: fees.phase1.vatAmount, phaseTotal: fees.phase1.phaseTotal },
            phase2: { serviceFeeAmount: fees.phase2.serviceFeeAmount, vatAmount: fees.phase2.vatAmount, phaseTotal: fees.phase2.phaseTotal },
            totals: { serviceFeeTotal: fees.serviceFeeTotal, vatTotal: fees.vatTotal, grandTotal: fees.grandTotal },
        };
    }
    const r = resolveRenewalAmount({ application, invoices, quotationRow });
    return {
        isRenewal: true,
        scopeCount: billableScopes(application).length,
        phase1: null,
        phase2: { serviceFeeAmount: r.serviceFeeAmount, vatAmount: r.vatAmount, phaseTotal: r.phaseTotal, source: r.source },
        totals: { serviceFeeTotal: r.serviceFeeAmount, vatTotal: r.vatAmount, grandTotal: r.phaseTotal },
    };
}

module.exports = {
    resolveRenewalAmount,
    renewalPriceEstimate,
    previewPhaseAmounts,
};
