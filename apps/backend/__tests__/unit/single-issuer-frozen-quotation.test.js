'use strict';

/**
 * W14 — a quotation issued under the OLD formula still reprices to what it said.
 *
 * THE QUESTION
 * The platform has live quotations that were issued while VAT was charged on
 * the platform portion only. Those documents are already in farmers' hands and
 * say 33,210 for one scope. What should the platform bill when one of them is
 * accepted and paid, now that the formula says 35,310?
 *
 * THE CONSERVATIVE ANSWER, and the one implemented: a quotation is a PRICE OF
 * RECORD. It keeps its frozen numbers. Only quotations issued after this change
 * use the new formula. Re-pricing an outstanding quotation upward would bill a
 * farmer more than the document they were given — for a document they may have
 * already accepted — which is not a rounding detail, it is a broken quote.
 *
 * HOW IT IS GUARANTEED
 * Not by a version flag, but by the fact that the frozen reader never
 * recomputes. `_reconstructFrozenFromInstallments` reads stateAmount,
 * platformAmount and vatAmount out of the STORED installments and adds them up.
 * It has no access to the rates and does not call the fee service, so a formula
 * change physically cannot reach a row that was already written. This suite
 * pins that property against a snapshot in the genuine old shape, because the
 * obvious "improvement" — recomputing VAT from the stored platform amount to
 * "fix up" legacy rows — would silently reprice every outstanding quotation.
 *
 * The snapshot below is the real pre-W14 installment shape: vatAmount is 7% of
 * the PLATFORM amount (500 → 35), not of the service fee (5,500 → 385).
 */

const quotationService = require('../../services/quotation-service');
const feeService = require('../../services/fee-service');

const { reconstructFrozenFromInstallments } = quotationService._internals;

/** Installments exactly as the OLD formula wrote them, 1 cultivation scope. */
const OLD_FORMULA_INSTALLMENTS = Object.freeze([
    Object.freeze({
        phase: 'PHASE_1',
        amount: 5000,
        serviceFeeAmount: 5500,
        vatAmount: 35, // 7% of 500 — the retired formula
        scopeCount: 1,
    }),
    Object.freeze({
        phase: 'PHASE_2',
        amount: 25000,
        serviceFeeAmount: 27500,
        vatAmount: 175, // 7% of 2,500 — the retired formula
        scopeCount: 1,
    }),
]);

/** The same, for a renewal quotation frozen under the old formula (single charge). */
const OLD_FORMULA_RENEWAL_INSTALLMENTS = Object.freeze([
    Object.freeze({
        phase: 'PHASE_2',
        amount: 30000,
        serviceFeeAmount: 33000,
        vatAmount: 210, // 7% of 3,000 — the retired formula
        scopeCount: 1,
    }),
]);

describe('W14 — quotations frozen under the old formula keep their numbers', () => {
    test('a two-phase quotation still reprices to 33,210 — its own total, not 35,310', () => {
        const frozen = reconstructFrozenFromInstallments(OLD_FORMULA_INSTALLMENTS);

        expect(frozen.phase1.vatAmount).toBe(35);
        expect(frozen.phase1.phaseTotal).toBe(5535);
        expect(frozen.phase2.vatAmount).toBe(175);
        expect(frozen.phase2.phaseTotal).toBe(27675);

        const frozenGrandTotal = frozen.phase1.phaseTotal + frozen.phase2.phaseTotal;
        expect(frozenGrandTotal).toBe(33210);

        // The new formula would say 35,310 for the same farm. The frozen
        // quotation must NOT move to it.
        const today = feeService.calculateApplicationFees({}, { scopeCount: 1 });
        expect(today.total).toBe(35310);
        expect(frozenGrandTotal).not.toBe(today.total);
    });

    test('a renewal quotation frozen under the old formula still reprices to 33,210', () => {
        const frozen = reconstructFrozenFromInstallments(OLD_FORMULA_RENEWAL_INSTALLMENTS);
        expect(frozen.singleCharge).toBe(true);
        expect(frozen.phase1.phaseTotal).toBe(0);
        expect(frozen.phase2.vatAmount).toBe(210);
        expect(frozen.phase2.phaseTotal).toBe(33210);
    });

    test('the frozen reader never consults the fee service — the mechanism, not a coincidence', () => {
        // If the reader recomputed anything from the rates, changing them would
        // move a frozen row. Prove it cannot: feed installments whose amounts
        // match NO formula the platform has ever had, and they still come back
        // exactly as stored.
        const invented = [{
            phase: 'PHASE_2',
            amount: 12345,
            serviceFeeAmount: 12444,
            vatAmount: 7,
            scopeCount: 1,
        }];
        const frozen = reconstructFrozenFromInstallments(invented);
        // The reader copies the row's own ค่าบริการ and VAT and adds them. It
        // used to also hand back stateAmount / platformAmount, split out of the
        // stored figures — a decomposition the row never carried and the system
        // can no longer produce (operator 2026-09-11). Reconstructing a split
        // for a frozen document is the one thing a frozen reader must not do.
        expect(frozen.phase2.serviceFeeAmount).toBe(12444);
        expect(frozen.phase2.vatAmount).toBe(7);
        expect(frozen.phase2.phaseTotal).toBe(12444 + 7);
        expect(frozen.phase2).not.toHaveProperty('stateAmount');
        expect(frozen.phase2).not.toHaveProperty('platformAmount');
    });

    test('a NEW quotation issued today uses the new formula', () => {
        // The other half of the contract: freezing old rows must not freeze the
        // platform. A quotation built now carries the new VAT base.
        const fees = quotationService._internals.resolveBillableFees({
            id: 'app-new', totalAreaTypes: 1, formData: {},
        });
        const installments = quotationService._internals.buildInstallments(fees);
        const frozen = reconstructFrozenFromInstallments(installments.platform);

        expect(frozen.phase1.vatAmount).toBe(385);
        expect(frozen.phase2.vatAmount).toBe(1925);
        expect(frozen.phase1.phaseTotal + frozen.phase2.phaseTotal).toBe(35310);
    });

    test('a legacy un-enriched installment still falls back rather than inventing a price', () => {
        // Pre-GAP-5 rows carry only { phase, amount }. The reader returns null
        // so the caller recomputes — unchanged by W14, and asserted here so the
        // fallback is not mistaken for a frozen price.
        expect(reconstructFrozenFromInstallments([{ phase: 'PHASE_2', amount: 25000 }])).toBeNull();
        expect(reconstructFrozenFromInstallments([])).toBeNull();
        expect(reconstructFrozenFromInstallments(null)).toBeNull();
    });
});
