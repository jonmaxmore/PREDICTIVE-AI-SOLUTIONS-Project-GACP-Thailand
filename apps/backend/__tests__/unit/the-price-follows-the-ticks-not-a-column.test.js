/**
 * The quotation must be priced for what the applicant ticked.
 *
 * Found by walking the real doors on a real database, 2026-09-06, which is the only way it
 * could have been found: a filing declaring THREE ลักษณะพื้นที่ (OUTDOOR + GREENHOUSE +
 * INDOOR, stored and readable in `formData.farmData.areaTypes`) was issued a quotation for
 * ONE — `scopeCount: 1`, one anonymous `SCOPE_1` line, 35,310 THB where the operator's
 * ruling makes it 105,930.
 *
 * The cause is the same disagreement this branch already fixed once at the submit gate.
 * `_resolveBillableFees` did not read the filing's declaration at all: it read
 * `storedCultivationScopeCount`, which looks at the `cultivationScopeCount` /
 * `totalAreaTypes` COLUMNS on the application row — columns the six-step wizard never
 * writes — and fell back to `?? 1`.
 *
 * So the unit tests passed (they call the fee engine directly with formData) and the
 * product billed one scope. Only pressing the door showed it.
 *
 * The rule these tests pin: the DECLARATION wins. The stored column is a fallback for a
 * filing that declares nothing, never an override of one that does — it cannot be, or the
 * price and the paperwork describe different applications.
 */
'use strict';

const quotationService = require('../../services/quotation-service');

const { resolveBillableFees } = quotationService._internals;

/** A filing that ticked three ลักษณะพื้นที่, as the wizard stores them. */
function threeTickedFiling(extra = {}) {
    return {
        id: 'app-1',
        formData: { farmData: { areaTypes: ['OUTDOOR', 'GREENHOUSE', 'INDOOR'] } },
        ...extra,
    };
}

describe('the price follows the ticks', () => {
    test('three ticked types are billed as three, with no stored column at all', () => {
        const fees = resolveBillableFees(threeTickedFiling());
        expect(fees.scopeCount).toBe(3);
        expect(fees.grandTotal).toBe(105930);
    });

    test('the three lines carry the types the applicant chose, not SCOPE_n', () => {
        const fees = resolveBillableFees(threeTickedFiling());
        expect(fees.phase1.scopeBreakdown.map((l) => l.method))
            .toEqual(['OUTDOOR', 'GREENHOUSE', 'INDOOR']);
    });

    test('a stale column does NOT overrule what the filing declares', () => {
        // The walked application: three ticks, and a column that says nothing useful.
        // Reading the column first is what billed one scope.
        const fees = resolveBillableFees(threeTickedFiling({ totalAreaTypes: 1 }));
        expect(fees.scopeCount).toBe(3);
        expect(fees.grandTotal).toBe(105930);
    });

    test('a filing that declares NOTHING still honours the stored column', () => {
        // Older rows priced before the wizard wrote ลักษณะพื้นที่ keep their price: the
        // column is the only thing left that knows what they were quoted for.
        const fees = resolveBillableFees({ id: 'legacy', formData: {}, totalAreaTypes: 3 });
        expect(fees.scopeCount).toBe(3);
        expect(fees.grandTotal).toBe(105930);
    });

    test('a filing with neither is one scope, never zero', () => {
        const fees = resolveBillableFees({ id: 'bare', formData: {} });
        expect(fees.scopeCount).toBe(1);
        expect(fees.grandTotal).toBe(35310);
    });

    test('a renewal is priced by the same declaration, not by a different rung', () => {
        const fees = resolveBillableFees({
            id: 'renewal-1',
            formData: { renewalOf: 'cert-1', farmData: { areaTypes: ['OUTDOOR', 'INDOOR'] } },
        });
        expect(fees.isRenewal).toBe(true);
        expect(fees.scopeCount).toBe(2);
        // Two types, one charge: 35,310 × 2.
        expect(fees.grandTotal).toBe(70620);
    });
});
