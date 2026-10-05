/**
 * ค่าธรรมเนียมเป็นการ "บวก" ไม่ใช่ "คูณ" — operator ruling 2026-09-06.
 *
 * The question put to the operator was "does the fee MULTIPLY per ลักษณะพื้นที่", and the
 * answer corrected the frame rather than picking a side:
 *
 *   *"จะบอกว่าคูณหรือไม่คูณลำบาก มันเป็นการบวกมากกว่า ถ้าเลือก 3 รูปแบบการปลูก ราคาก็คือ
 *    3 รูปแบบ แต่ในเสนอราคา และใบวางบิลก็ต้องลงรายละเอียดด้วย เช่น 1.ค่าธรรมเนียมขออนุญาต
 *    แบบกลางแจ้ง งวดที่ 1 หากมี 3 รูปแบบในใบเสนอราคาต้องมีบอกเป็น 1 2 3 แล้วราคาก็เอามารวมกัน"*
 *
 * At today's rates `base × 3` and `rate + rate + rate` are the same number, so the ruling
 * looks cosmetic and is not. Two things follow from it that multiplication cannot give:
 *
 *   1. The total is DERIVED FROM the lines. Today the quotation divides a phase total by
 *      the scope count to invent a per-type line, which is the arithmetic running
 *      backwards — the moment one type costs a different amount, every line is wrong and
 *      the total still looks right.
 *   2. Each type is a line the applicant can read, so a document says what it charges for.
 *
 * These tests pin the model, not the arithmetic: they pass a per-type rate that is NOT
 * uniform and require the total to follow the lines.
 */
'use strict';

const {
    calculatePhase1Fee,
    calculatePhase2Fee,
    calculateApplicationFees,
    resolveCultivationScopes,
} = require('../../modules/billing/internal/fee-service');

/** What the six-step wizard actually writes — ลักษณะพื้นที่, nested under farmData. */
function wizardFiling(areaTypes) {
    return { formData: { farmData: { areaTypes } } };
}

describe('which cultivation types a filing declared', () => {
    test('the wizard\'s own ลักษณะพื้นที่ ticks are read', () => {
        expect(resolveCultivationScopes(wizardFiling(['OUTDOOR', 'GREENHOUSE'])))
            .toEqual(['OUTDOOR', 'GREENHOUSE']);
    });

    test('the wizard ticks (areaTypes) win over a STALE cultivationMethods when both are present', () => {
        // Operator ruling 2026-09-06 (superseding the earlier cultivationMethods-wins rule):
        // the price must equal what the farmer selected on step 3, and step 3 writes
        // farmData.areaTypes. A demo filing carried cultivationMethods=[3 methods] (a stale
        // value from an older path) while the farmer had ticked only INDOOR — and was billed
        // for three. areaTypes, when present, is the authoritative declaration.
        const both = { cultivationMethods: ['OUTDOOR', 'GREENHOUSE', 'INDOOR'], formData: { farmData: { areaTypes: ['INDOOR'] } } };
        expect(resolveCultivationScopes(both)).toEqual(['INDOOR']);
    });

    test('the legacy cultivationMethods key is the FALLBACK when no areaTypes were written', () => {
        const legacy = { cultivationMethods: ['INDOOR'] };
        expect(resolveCultivationScopes(legacy)).toEqual(['INDOOR']);
    });

    test('a plot born OUTDOOR is a FALLBACK, never a tick that outranks a declaration', () => {
        // 7ab1ffcb — แปลงที่ 1 is created as OUTDOOR by the form and its control is
        // disabled, so an indoor-only farm carries an OUTDOOR plot nobody chose. Letting
        // it outrank the declaration bills for a method the applicant never selected.
        const filing = { formData: { farmData: { areaTypes: ['INDOOR'] } }, plots: [{ solarSystem: 'OUTDOOR' }] };
        expect(resolveCultivationScopes(filing)).toEqual(['INDOOR']);
    });

    test('a filing that declares nothing is one scope, not zero', () => {
        // Zero would make the fee zero, which is a worse answer than the minimum charge.
        expect(resolveCultivationScopes({}).length).toBe(1);
    });

    test('the same type ticked twice is one type', () => {
        expect(resolveCultivationScopes(wizardFiling(['OUTDOOR', 'outdoor']))).toEqual(['OUTDOOR']);
    });
});

describe('the phase total is the sum of its per-type lines', () => {
    test('three types produce three lines, and they add up to the state amount', () => {
        const fee = calculatePhase1Fee(wizardFiling(['OUTDOOR', 'GREENHOUSE', 'INDOOR']));

        expect(fee.scopeBreakdown).toHaveLength(3);
        expect(fee.scopeBreakdown.map((line) => line.method))
            .toEqual(['OUTDOOR', 'GREENHOUSE', 'INDOOR']);

        const summed = fee.scopeBreakdown.reduce((total, line) => total + line.serviceFeeAmount, 0);
        expect(summed).toBe(fee.serviceFeeAmount);
    });

    test('a NON-UNIFORM per-type rate proves the total follows the lines', () => {
        // The point of the ruling. With `base × count` this test cannot pass at all.
        const fee = calculatePhase1Fee(wizardFiling(['OUTDOOR', 'INDOOR']), {
            rateForScope: (method) => (method === 'INDOOR' ? 7000 : 5000),
        });

        expect(fee.scopeBreakdown.map((line) => line.serviceFeeAmount)).toEqual([5000, 7000]);
        // …และทุกอย่างข้างล่างคำนวณจากผลบวกนั้น ไม่ใช่จากจำนวนนับ
        expect(fee.serviceFeeAmount).toBe(12000);
        expect(fee.vatAmount).toBe(840);                    // 7% ของค่าบริการ
        expect(fee.phaseTotal).toBe(12840);
    });

    test('each line says which type and which phase it is', () => {
        const p1 = calculatePhase1Fee(wizardFiling(['OUTDOOR']));
        const p2 = calculatePhase2Fee(wizardFiling(['OUTDOOR']));

        expect(p1.scopeBreakdown[0]).toMatchObject({ method: 'OUTDOOR', phase: 'PHASE_1' });
        expect(p2.scopeBreakdown[0]).toMatchObject({ method: 'OUTDOOR', phase: 'PHASE_2' });
    });

    test('the fee engine carries no display text — that belongs to the document', () => {
        // Four Thai vocabularies for ลักษณะพื้นที่ already exist (system/config.js,
        // journey-config-options.js, master-data-constants.js, quotation-line-items.js).
        // A fifth inside the pricing engine would trip the dup-source ratchet AND put
        // wording in the layer least able to change it. The engine says WHICH type and
        // WHICH phase; quotation-line-items.js writes the sentence a farmer reads.
        const line = calculatePhase1Fee(wizardFiling(['OUTDOOR'])).scopeBreakdown[0];
        expect(line.labelTH).toBeUndefined();
        expect(JSON.stringify(line)).not.toMatch(/[ก-๙]/);
    });

    test('one type still costs exactly what it costs today — nothing re-prices', () => {
        const one = calculateApplicationFees(wizardFiling(['OUTDOOR']));
        // ตารางอัตราที่ใช้อยู่จริง (docs/architecture/fee-model-2026-09-05.md): 35,310 per type.
        expect(one.total).toBe(35310);
    });

    test('three types cost three times one type, because the rates are equal today', () => {
        const one = calculateApplicationFees(wizardFiling(['OUTDOOR']));
        const three = calculateApplicationFees(wizardFiling(['OUTDOOR', 'GREENHOUSE', 'INDOOR']));
        expect(three.total).toBe(one.total * 3);
        expect(three.total).toBe(105930);
        expect(three.scopeCount).toBe(3);
    });

    test('the breakdown survives into the combined result, per phase', () => {
        const fees = calculateApplicationFees(wizardFiling(['OUTDOOR', 'INDOOR']));
        expect(fees.phase1.scopeBreakdown).toHaveLength(2);
        expect(fees.phase2.scopeBreakdown).toHaveLength(2);
        const everyLine = [...fees.phase1.scopeBreakdown, ...fees.phase2.scopeBreakdown];
        const summed = everyLine.reduce((total, line) => total + line.phaseTotal, 0);
        expect(summed).toBe(fees.total);
    });
});
