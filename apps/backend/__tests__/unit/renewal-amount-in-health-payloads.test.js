'use strict';
/**
 * fix/fee-line-descriptions round 4 (operator 2026-10-03: prices are real costs, shown
 * completely and correctly). Every payload that carries a per-application fee figure to a
 * health user sends a renewal's RENEWAL amount — invoice, then quotation, then the engine's
 * renewal price for the application's billable types (the quotation's own rule) — or does
 * not carry the figure at all.
 *
 * Inventory (grep of routes/api/{applications,helpers,preview} for fee/amount fields):
 *   GET /applications/my        `fees` {phase1, phase2}  — no reader on web or mobile → removed
 *   list items (mapHealthApplication) `estimatedFee`      — no reader → removed
 *   GET /applications/:id       `phase1Amount`/`phase2Amount` (stored columns) — no reader → removed;
 *                               `renewalPriceEstimate` added (engine figure, renewals only)
 *   GET /applications/:id/preview  payment.{phase1Amount, phase2Amount, breakdown, totalEstimated}
 *                               — computed as a new filing for every application → renewal-aware
 *   official snapshot applicationMeta.phase{1,2}Amount — no reader → removed
 */

const { FEES } = require('../../config/business-rules');
const { mapHealthApplication, mapMyApplication } = require('../../routes/api/helpers/applications-helpers');
const { buildApplicationDetailPayload } = require('../../routes/api/helpers/application-payload-builders');
const { resolveRenewalAmount, previewPhaseAmounts } = require('../../services/billing/renewal-amount');

const RENEWAL_PER_SCOPE_TOTAL = FEES.RENEWAL_PER_SCOPE + Math.round(FEES.RENEWAL_PER_SCOPE * FEES.VAT_RATE);
const renewal = { id: 'a1', applicationNumber: 'APP-R', status: 'PENDING_AUDIT_FEE', totalAreaTypes: 2, formData: { renewalOf: 'cert-1', cultivationMethods: ['OUTDOOR', 'INDOOR'] } };
const fresh = { id: 'a2', applicationNumber: 'APP-N', status: 'PENDING_AUDIT_FEE', formData: { cultivationMethods: ['OUTDOOR'] } };

describe('figures with no reader are not sent', () => {
    test('GET /applications/my items carry no `fees` and no `estimatedFee`', () => {
        for (const app of [renewal, fresh]) {
            const item = mapMyApplication({ ...app, estimatedFee: 5885 });
            expect(item).not.toHaveProperty('fees');
            expect(item).not.toHaveProperty('estimatedFee');
            expect(mapHealthApplication({ ...app, estimatedFee: 5885 })).not.toHaveProperty('estimatedFee');
        }
    });

    test('the detail payload drops the stored phase columns', () => {
        const d = buildApplicationDetailPayload({ ...renewal, phase1Amount: 5000, phase2Amount: 25000 });
        expect(d).not.toHaveProperty('phase1Amount');
        expect(d).not.toHaveProperty('phase2Amount');
    });
});

describe('a renewal is priced as a renewal', () => {
    test('the detail payload carries the engine renewal price for its types (2 × per-type total)', () => {
        expect(buildApplicationDetailPayload(renewal).renewalPriceEstimate).toBe(2 * RENEWAL_PER_SCOPE_TOTAL);
        expect(buildApplicationDetailPayload(fresh).renewalPriceEstimate).toBeNull();
    });

    test('resolution order: invoice, then quotation, then engine', () => {
        const invoice = { serviceType: 'CERTIFICATION_CHECKOUT_M2', subtotal: '60000.00', vat: '4200.00', totalAmount: '64200.00', status: 'pending' };
        const quotationRow = { installments: [{ phase: 'PHASE_2', amount: 70620, serviceFeeAmount: 66000, vatAmount: 4620 }] };
        expect(resolveRenewalAmount({ application: renewal, invoices: [invoice], quotationRow })).toMatchObject({ phaseTotal: 64200, source: 'invoice' });
        expect(resolveRenewalAmount({ application: renewal, invoices: [], quotationRow })).toMatchObject({ phaseTotal: 70620, serviceFeeAmount: 66000, vatAmount: 4620, source: 'quotation' });
        expect(resolveRenewalAmount({ application: renewal })).toMatchObject({ phaseTotal: 2 * RENEWAL_PER_SCOPE_TOTAL, source: 'engine' });
        // a cancelled invoice is not the figure of record
        expect(resolveRenewalAmount({ application: renewal, invoices: [{ ...invoice, status: 'cancelled' }], quotationRow }).source).toBe('quotation');
    });

    test('preview amounts: a renewal has no instalment 1 and its one charge is the renewal amount', () => {
        const p = previewPhaseAmounts({ application: renewal });
        expect(p.isRenewal).toBe(true);
        expect(p.phase1).toBeNull();
        expect(p.phase2.phaseTotal).toBe(2 * RENEWAL_PER_SCOPE_TOTAL);
        expect(p.totals.grandTotal).toBe(2 * RENEWAL_PER_SCOPE_TOTAL);
    });

    test('preview amounts for a new filing are unchanged (both instalments from the engine)', () => {
        const p = previewPhaseAmounts({ application: fresh });
        expect(p.isRenewal).toBe(false);
        expect(p.phase1.phaseTotal).toBe(FEES.PHASE1_PER_SCOPE + Math.round(FEES.PHASE1_PER_SCOPE * FEES.VAT_RATE));
        expect(p.phase2.phaseTotal).toBe(FEES.PHASE2_PER_SCOPE + Math.round(FEES.PHASE2_PER_SCOPE * FEES.VAT_RATE));
    });
});
