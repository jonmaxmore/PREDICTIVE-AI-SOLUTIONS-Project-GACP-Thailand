/**
 * T11 + T13 — what a scan may say about lab evidence.
 *
 * The operator asked for two things in one sentence: "ต้องแนบเอกสารนี้ลงไปด้วย ให้เห็นว่า
 * ฟาร์มนี้มีผลตรวจ". They are two different claims and the whole point of this module
 * is that they must never be collapsed into one:
 *
 *   THIS LOT     tested / not yet tested, and the file if there is one
 *   THIS FARM    how many reports the farm holds
 *
 * Written as one line — "ฟาร์มนี้มีผลตรวจ" — someone holding an UNTESTED bag reads
 * that their bag was tested. Every sentence would be individually true and the
 * reader would still be misled, which is worse than saying nothing.
 *
 * T11: a lot never carries its own COA. The laboratory tested the BATCH, and one
 * batch yields many lots, so the lot inherits. Attaching per-lot would mean the
 * same file uploaded N times until the day two of them differ.
 */
'use strict';

const {
    lotLabEvidence, farmLabEvidence, publicLabProjection,
} = require('../../services/lab-evidence-service');

const coa = (over = {}) => ({
    id: 'lab-1', fileUrl: '/uploads/lab-results/a.pdf', fileName: 'coa.pdf',
    labName: 'ห้องปฏิบัติการกลาง', reportNumber: 'TR-2569-001',
    reportedAt: new Date('2026-09-15T00:00:00Z'), verificationCode: 'ABCD-1234',
    verificationStatus: 'FARMER_UPLOADED', uploadedAt: new Date('2026-09-16T00:00:00Z'),
    isDeleted: false, ...over,
});

describe('T11 — a lot inherits from the batch that was tested', () => {
    test('the lot reports the batch\'s newest report', () => {
        const lot = { batch: { labResults: [coa({ id: 'old', uploadedAt: new Date('2026-09-01') }), coa({ id: 'new', uploadedAt: new Date('2026-09-16') })] } };
        expect(lotLabEvidence(lot).tested).toBe(true);
        expect(lotLabEvidence(lot).latest.id).toBe('new');
    });

    test('every report of the batch is listed, newest first — a corrected COA sits beside its predecessor', () => {
        const lot = { batch: { labResults: [coa({ id: 'a', uploadedAt: new Date('2026-09-01') }), coa({ id: 'b', uploadedAt: new Date('2026-09-16') })] } };
        expect(lotLabEvidence(lot).reports.map((r) => r.id)).toEqual(['b', 'a']);
    });

    test('a batch with no report means NOT TESTED, not "unknown"', () => {
        expect(lotLabEvidence({ batch: { labResults: [] } })).toMatchObject({ tested: false, latest: null });
        expect(lotLabEvidence({ batch: {} })).toMatchObject({ tested: false });
        expect(lotLabEvidence({})).toMatchObject({ tested: false });
        expect(lotLabEvidence(null)).toMatchObject({ tested: false });
    });

    test('a withdrawn report does not count as evidence', () => {
        const lot = { batch: { labResults: [coa({ isDeleted: true })] } };
        expect(lotLabEvidence(lot).tested).toBe(false);
    });
});

describe('T13 — the farm line is about the FARM, and says so', () => {
    test('it counts the farm\'s reports', () => {
        expect(farmLabEvidence([coa(), coa({ id: 'l2' })])).toMatchObject({ reportCount: 2 });
    });

    test('withdrawn reports are not counted', () => {
        expect(farmLabEvidence([coa(), coa({ id: 'l2', isDeleted: true })])).toMatchObject({ reportCount: 1 });
    });

    test('a farm with none says zero rather than going silent', () => {
        expect(farmLabEvidence([])).toMatchObject({ reportCount: 0 });
        expect(farmLabEvidence(null)).toMatchObject({ reportCount: 0 });
    });
});

describe('the public projection keeps the two claims apart', () => {
    const tested = { batch: { labResults: [coa()] } };
    const untested = { batch: { labResults: [] } };

    test('an untested lot on a farm WITH reports still says the lot is untested', () => {
        // The trap, stated as a test: the farm has evidence, this bag does not.
        const out = publicLabProjection({ lot: untested, farmLabResults: [coa(), coa({ id: 'l2' })] });
        expect(out.lot.tested).toBe(false);
        expect(out.farm.reportCount).toBe(2);
    });

    test('the lot claim is a separate object from the farm claim — they cannot be read as one', () => {
        const out = publicLabProjection({ lot: tested, farmLabResults: [coa()] });
        expect(out).toHaveProperty('lot');
        expect(out).toHaveProperty('farm');
        // No flattened boolean that a template could render as "has lab results".
        expect(Object.prototype.hasOwnProperty.call(out, 'tested')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(out, 'hasLabResults')).toBe(false);
    });

    test('the farm claim carries its own subject word, so it cannot be printed bare', () => {
        const out = publicLabProjection({ lot: untested, farmLabResults: [coa()] });
        expect(out.farm.subject).toBe('FARM');
        expect(out.lot.subject).toBe('LOT');
    });

    test('the file and the lab name are published — mติ 2026-09-05 opened them', () => {
        const out = publicLabProjection({ lot: tested, farmLabResults: [] });
        expect(out.lot.latest).toMatchObject({
            fileUrl: '/uploads/lab-results/a.pdf', labName: 'ห้องปฏิบัติการกลาง',
            reportNumber: 'TR-2569-001', verificationCode: 'ABCD-1234',
        });
    });

    test('who uploaded it travels with it — a scanner should not have to guess', () => {
        const out = publicLabProjection({ lot: tested, farmLabResults: [] });
        expect(out.lot.latest.verificationStatus).toBe('FARMER_UPLOADED');
    });

    test('internal ids never reach the public body', () => {
        const out = publicLabProjection({ lot: tested, farmLabResults: [coa()] });
        const serialized = JSON.stringify(out);
        expect(serialized).not.toContain('"id"');
        expect(serialized).not.toContain('harvestBatchId');
        expect(serialized).not.toContain('organizationId');
        expect(serialized).not.toContain('uploadedBy');
    });
});
