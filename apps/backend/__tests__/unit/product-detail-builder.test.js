'use strict';

/**
 * product-detail-builder — the "รายละเอียดสินค้า" block for the financial PDFs.
 * Owner request 2026-06-25 (full detail): plant, cultivation systems, scope
 * count, phase, application number, farm/plot on each line item.
 */
const {
    buildProductDetailLines,
    plantLabel,
    cultivationLabels,
} = require('../../services/pdf/product-detail-builder');

const baseApp = (over = {}) => ({
    applicationNumber: 'APP-2569-MPXTH3NE',
    formData: {
        plantId: 'cannabis',
        cultivationMethods: ['INDOOR', 'GREENHOUSE', 'OUTDOOR'],
        farmData: { farmName: 'ฟาร์มสมชาย' },
        plots: [{ name: 'แปลงที่ 1' }],
        ...over,
    },
});

describe('plantLabel', () => {
    it('maps known plant ids to Thai', () => {
        expect(plantLabel('cannabis')).toBe('กัญชา');
        expect(plantLabel('kratom')).toBe('กระท่อม');
    });
    it('strips a -NNN suffix (CANNABIS-001 -> กัญชา)', () => {
        expect(plantLabel('CANNABIS-001')).toBe('กัญชา');
    });
    it('falls back to the raw value when unknown, and "-" when empty', () => {
        expect(plantLabel('dragonfruit')).toBe('dragonfruit');
        expect(plantLabel('')).toBe('-');
        expect(plantLabel(null)).toBe('-');
    });
});

describe('cultivationLabels', () => {
    it('maps + dedups + labels the systems', () => {
        expect(cultivationLabels(['INDOOR', 'indoor', 'OUTDOOR'])).toEqual([
            'อาคารระบบปิด (Indoor)',
            'กลางแจ้ง (Outdoor)',
        ]);
    });
    it('is safe for non-arrays', () => {
        expect(cultivationLabels(undefined)).toEqual([]);
        expect(cultivationLabels(null)).toEqual([]);
    });
});

// fix/fee-line-descriptions (operator 2026-10-03): the block opens with what the
// service covers, from the one catalogue — it used to open with a second phase
// label ("งวดที่ 1 · ค่าตรวจเอกสาร") under a line that already named the charge.
const { SERVICE_CATALOGUE } = require('../../shared/instalment-service-names');
const P1_COVERAGE = SERVICE_CATALOGUE.PHASE_1.coverage;
const P2_COVERAGE = SERVICE_CATALOGUE.PHASE_2.coverage;

describe('buildProductDetailLines', () => {
    it('names the checkout serviceTypes, and a renewal M2 as the renewal service', () => {
        expect(buildProductDetailLines(baseApp(), { phase: 'CERTIFICATION_CHECKOUT_M1' })).toContain(P1_COVERAGE);
        expect(buildProductDetailLines(baseApp(), { phase: 'CERTIFICATION_CHECKOUT_M2' })).toContain(P2_COVERAGE);
        const renewal = { ...baseApp(), formData: { ...baseApp().formData, renewalOf: 'cert-1' } };
        expect(buildProductDetailLines(renewal, { phase: 'CERTIFICATION_CHECKOUT_M2' }))
            .toContain(SERVICE_CATALOGUE.RENEWAL.coverage);
    });

    it('builds the full detail block for a phase-1 invoice with 3 scopes', () => {
        const lines = buildProductDetailLines(baseApp(), {
            phase: 'PHASE_1_STATE_FEE',
            scopeCount: 3,
            perScope: 5000,
        });
        expect(lines).toContain(P1_COVERAGE);
        expect(lines).toContain('พืชที่ขอรับรอง: กัญชา');
        expect(lines).toContain('ระบบปลูก: อาคารระบบปิด (Indoor), โรงเรือน (Greenhouse), กลางแจ้ง (Outdoor) (3 ระบบ)');
        expect(lines).toContain('คำขอเลขที่: APP-2569-MPXTH3NE');
        expect(lines).toContain('ฟาร์ม: ฟาร์มสมชาย · แปลง: แปลงที่ 1');
        expect(lines).toContain('จำนวน 3 ระบบ · ระบบละ 5,000 · รวม 15,000 บาท');
    });

    it('resolves phase 2 from the serviceType', () => {
        const lines = buildProductDetailLines(baseApp(), { phase: 'PHASE_2_PLATFORM_FEE', scopeCount: 3, perScope: 25000 });
        expect(lines).toContain(P2_COVERAGE);
        expect(lines).toContain('จำนวน 3 ระบบ · ระบบละ 25,000 · รวม 75,000 บาท');
    });

    it('falls back scope to the number of systems when scopeCount is absent', () => {
        const lines = buildProductDetailLines(baseApp(), { phase: 'PHASE_1' });
        expect(lines).toContain('จำนวน 3 ระบบปลูก');
    });

    it('degrades gracefully when product data is missing (no crash, fewer lines)', () => {
        const lines = buildProductDetailLines({ applicationNumber: 'APP-X', formData: {} }, { phase: 'PHASE_1' });
        expect(lines).toContain(P1_COVERAGE);
        expect(lines).toContain('คำขอเลขที่: APP-X');
        expect(lines.some((l) => l.startsWith('พืชที่ขอรับรอง'))).toBe(false);
        expect(lines.some((l) => l.startsWith('ระบบปลูก'))).toBe(false);
    });

    it('compact mode omits the systems summary + the per-scope money line (for the quotation)', () => {
        const lines = buildProductDetailLines(baseApp(), {
            phase: 'PHASE_2', scopeCount: 3, perScope: 25000, compact: true,
        });
        expect(lines).toContain(P2_COVERAGE);
        expect(lines).toContain('พืชที่ขอรับรอง: กัญชา');
        expect(lines).toContain('คำขอเลขที่: APP-2569-MPXTH3NE');
        expect(lines.some((l) => l.startsWith('ระบบปลูก'))).toBe(false);
        expect(lines.some((l) => l.startsWith('จำนวน'))).toBe(false);
    });

    it('is null-safe', () => {
        expect(Array.isArray(buildProductDetailLines(null))).toBe(true);
        expect(Array.isArray(buildProductDetailLines(undefined, {}))).toBe(true);
    });
});
