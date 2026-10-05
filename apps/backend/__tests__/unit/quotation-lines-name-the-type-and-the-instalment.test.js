/**
 * What a quotation and a billing note must SAY — operator ruling 2026-09-06.
 *
 *   *"ในเสนอราคา และใบวางบิลก็ต้องลงรายละเอียดด้วย เช่น 1.ค่าธรรมเนียมขออนุญาต แบบกลางแจ้ง
 *    งวดที่ 1 หากมี 3 รูปแบบในใบเสนอราคาต้องมีบอกเป็น 1 2 3 แล้วราคาก็เอามารวมกัน"*
 *
 * Three things follow, and the document did none of them completely:
 *
 *   1. numbered lines — already true
 *   2. each line names the CULTIVATION TYPE in Thai. It said "ระบบ OUTDOOR", which is the
 *      internal enum in Thai clothing; the applicant ticked "กลางแจ้ง".
 *   3. each line names the INSTALMENT. It named the stage ("ตรวจประเมิน"), which is what
 *      the money buys, not which of the two payments this is.
 *
 * And the amounts. Every printed line was a SHARE of the phase total, divided by the scope
 * count — the file said so itself: "the lines are a presentation of it". The ruling
 * reverses that: the lines are the price and the total is their sum. Where the row carries
 * a per-type breakdown, the lines are read from it; the sharing path remains for rows
 * issued before the breakdown existed, because a document already sent to an applicant has
 * to keep rendering exactly as it did (the W14-boundary lesson — a tax document that
 * cannot be reopened is lost evidence, not clean code).
 */
'use strict';

const {
    buildQuotationItemLines,
    buildQuotationComponents,
} = require('../../services/pdf/invoice-template-service');

// fix/fee-line-descriptions (operator 2026-10-03): the instalment is named by the
// catalogue name itself ("งวดที่ 1 ค่าบริการตรวจสอบเอกสาร"), which the real component
// builder hands over as the caption — so these cases build their lines from it.
const realComponents = (phase) => buildQuotationComponents({ phase, wholePhaseLine: null, phaseTotal: 16500 });

const COMPONENTS = [
    { caption: 'ค่าธรรมเนียมกรม (ตรวจประเมิน)', total: 15000 },
    { caption: 'ค่าบริการแพลตฟอร์ม (ตรวจประเมิน)', total: 1500 },
];

const THREE_SCOPES = [
    { method: 'OUTDOOR' },
    { method: 'GREENHOUSE' },
    { method: 'INDOOR' },
];

describe('every line says which type and which instalment', () => {
    const lines = buildQuotationItemLines({
        scopes: THREE_SCOPES,
        components: COMPONENTS,
        phase: 1,
    });

    test('three types × two components are numbered 1..6, with no gaps', () => {
        expect(lines.map((l) => l.no)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    test('the type is named in Thai, not as the internal enum', () => {
        const descriptions = lines.map((l) => l.description).join(' | ');
        expect(descriptions).toContain('กลางแจ้ง');
        expect(descriptions).toContain('โรงเรือน');
        // "ระบบ OUTDOOR" was the old wording — the enum wearing Thai clothes.
        expect(descriptions).not.toMatch(/OUTDOOR|GREENHOUSE|INDOOR/);
    });

    test('the instalment is named, because a stage is not an instalment number', () => {
        const p1 = buildQuotationItemLines({ scopes: THREE_SCOPES, components: realComponents(1), phase: 1 });
        expect(p1.every((l) => l.description.includes('งวดที่ 1'))).toBe(true);
    });

    test('phase 2 says งวดที่ 2', () => {
        const p2 = buildQuotationItemLines({ scopes: [{ method: 'OUTDOOR' }], components: realComponents(2), phase: 2 });
        expect(p2[0].description).toContain('งวดที่ 2');
    });

    test('the anonymous SCOPE_n placeholder never reaches the paper as a type', () => {
        // A filing that declared no ลักษณะพื้นที่ is still priced for one scope, and the
        // pricing calls it SCOPE_1. Through the Thai map that would print "แบบSCOPE_1" —
        // the internal enum on a money document, which is exactly what the ruling removes.
        const lines = buildQuotationItemLines({
            scopes: [{ method: 'SCOPE_1' }],
            components: [{ caption: 'ค่าธรรมเนียมกรม (ตรวจประเมิน)', total: 5000 }],
            phase: 1,
        });
        // The caption names the instalment now; the line no longer appends "งวดที่ N".
        expect(lines[0].description).toBe('ค่าธรรมเนียมกรม (ตรวจประเมิน) สำหรับขออนุญาต รูปแบบการปลูกที่ 1');
        expect(lines[0].description).not.toMatch(/SCOPE/i);
    });

    test('a scope the application can no longer name keeps its neutral label', () => {
        // Ruling 12 (2026-08-28): the row was priced for N types and the application now
        // names a different number, so no line may claim one of them.
        const generic = buildQuotationItemLines({
            scopes: [{ generic: true, label: 'รูปแบบการปลูกที่ 1' }],
            components: COMPONENTS,
            phase: 1,
        });
        expect(generic[0].description).toContain('รูปแบบการปลูกที่ 1');
    });
});

describe('the amounts come FROM the lines when the row knows them', () => {
    test('a per-type breakdown is printed as given, not re-divided', () => {
        const lines = buildQuotationItemLines({
            scopes: [{ method: 'OUTDOOR' }, { method: 'INDOOR' }],
            components: [{ caption: 'ค่าธรรมเนียมกรม (ตรวจประเมิน)', total: 12000, key: 'stateAmount' }],
            phase: 1,
            // Non-uniform on purpose: dividing 12,000 by 2 would print 6,000 twice and
            // still sum to the right total, which is exactly the bug being fixed.
            scopeBreakdown: [
                { method: 'OUTDOOR', stateAmount: 5000 },
                { method: 'INDOOR', stateAmount: 7000 },
            ],
        });
        expect(lines.map((l) => l.amount)).toEqual([5000, 7000]);
        expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(12000);
    });

    test('without a breakdown the old sharing still applies, so old documents reopen unchanged', () => {
        const lines = buildQuotationItemLines({
            scopes: [{ method: 'OUTDOOR' }, { method: 'INDOOR' }],
            components: [{ caption: 'ค่าธรรมเนียมกรม (ตรวจประเมิน)', total: 12000, key: 'stateAmount' }],
            phase: 1,
        });
        expect(lines.map((l) => l.amount)).toEqual([6000, 6000]);
    });

    test('a breakdown that does not cover a scope falls back rather than printing a hole', () => {
        const lines = buildQuotationItemLines({
            scopes: [{ method: 'OUTDOOR' }, { method: 'INDOOR' }],
            components: [{ caption: 'ค่าธรรมเนียมกรม', total: 12000, key: 'stateAmount' }],
            phase: 1,
            scopeBreakdown: [{ method: 'OUTDOOR', stateAmount: 5000 }],
        });
        // A missing type must not print 0 next to a real charge — the shared figure is
        // wrong-but-honest, a zero is a false statement about what is owed.
        expect(lines.map((l) => l.amount)).toEqual([6000, 6000]);
    });

    test('the printed lines still sum to the phase figure in the uniform case', () => {
        const lines = buildQuotationItemLines({
            scopes: THREE_SCOPES,
            components: COMPONENTS,
            phase: 1,
        });
        expect(lines.reduce((sum, l) => sum + l.amount, 0))
            .toBeCloseTo(COMPONENTS.reduce((sum, c) => sum + c.total, 0), 2);
    });
});
