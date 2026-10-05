/**
 * T10 — the door a farmer attaches a COA through.
 *
 * The operator's instruction was specific: "ต้องหาทางแนบผลแลปให้ได้ เราจะไม่ได้พิมพ์บอก
 * ค่าเท่าไหร่ เราจะอัพโหลดผลแลป". So this door takes a FILE and the report's header
 * fields, and has no field for THC, CBD or moisture at all. A typed number is one
 * that can be typed wrong, and when it disagrees with the PDF nobody can tell which
 * is true.
 *
 * It attaches to the HARVEST BATCH, because the laboratory tested a batch and one
 * batch yields many lots (design §4.5). And it ADDS a row: a COA is a document that
 * arrives later, not an edit to something already asserted, so it does not collide
 * with the freeze — and the 2026-09-05 ruling forbids amending frozen data, so a
 * corrected report is a second row beside the first, never a replacement.
 *
 * Ownership is checked the way every other batch route checks it —
 * farmService.listAccessibleFarmIds — so a farmer cannot attach a report to
 * somebody else's produce.
 */
'use strict';

const mockBatchFindUnique = jest.fn();
const mockLabCreate = jest.fn(async ({ data }) => ({ id: 'lab-1', ...data }));
const mockListFarmIds = jest.fn(async () => ['farm-1']);
const mockInspect = jest.fn(async () => ({ ok: true }));

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        harvestBatch: { findUnique: (...a) => mockBatchFindUnique(...a) },
        batchLabResult: { create: (...a) => mockLabCreate(...a) },
    },
}));
jest.mock('../../services/farm-service', () => ({ listAccessibleFarmIds: (...a) => mockListFarmIds(...a) }));
jest.mock('../../services/upload-content-guard', () => ({
    inspectStoredUpload: (...a) => mockInspect(...a),
    discardRejectedUpload: jest.fn(async () => {}),
}));
jest.mock('../../shared/logger', () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));

const { buildLabResultRow, assertLabUploadInput } = require('../../services/batch-lab-result-service');

const FILE = { originalname: 'coa.pdf', filename: 'stored.pdf', path: '/tmp/stored.pdf', size: 40960, mimetype: 'application/pdf' };

describe('what the door demands, and what it refuses to know', () => {
    test('a file and a lab name are enough', () => {
        expect(() => assertLabUploadInput({ file: FILE, labName: 'ห้องปฏิบัติการกลาง' })).not.toThrow();
    });

    test('no file is refused', () => {
        expect(() => assertLabUploadInput({ file: null, labName: 'ก' }))
            .toThrow(expect.objectContaining({ code: 'LAB_FILE_REQUIRED' }));
    });

    test('a blank lab name is refused — a report with no issuer proves nothing', () => {
        expect(() => assertLabUploadInput({ file: FILE, labName: '   ' }))
            .toThrow(expect.objectContaining({ code: 'LAB_NAME_REQUIRED' }));
    });

    test('the refusals speak Thai, because a farmer reads them', () => {
        try { assertLabUploadInput({ file: null, labName: 'ก' }); } catch (e) {
            expect(e.messageTh || e.message).toMatch(/[ก-๙]/);
        }
    });
});

describe('the row it builds', () => {
    const base = {
        batch: { id: 'hb-1', farmId: 'farm-1', organizationId: 'org-1' },
        file: FILE, labName: 'ห้องปฏิบัติการกลาง', reportNumber: 'TR-2569-001',
        reportedAt: '2026-09-15', verificationCode: 'ABCD-1234', uploadedBy: 'user-1',
        fileUrl: '/uploads/lab/stored.pdf',
    };

    test('is FARMER_UPLOADED until an officer says otherwise', () => {
        expect(buildLabResultRow(base)).toMatchObject({ verificationStatus: 'FARMER_UPLOADED' });
    });

    test('carries no THC, CBD or moisture — the file is the only source', () => {
        const row = buildLabResultRow(base);
        for (const forbidden of ['thcContent', 'cbdContent', 'moistureContent', 'thc', 'cbd', 'moisture', 'passed', 'result']) {
            expect(Object.prototype.hasOwnProperty.call(row, forbidden)).toBe(false);
        }
    });

    test('takes tenancy from the BATCH, never from the request', () => {
        // A caller-supplied organizationId is a caller-supplied tenant boundary.
        const row = buildLabResultRow({ ...base, organizationId: 'org-someone-else' });
        expect(row.organizationId).toBe('org-1');
        expect(row.harvestBatchId).toBe('hb-1');
    });

    test('keeps the header fields the scan will show', () => {
        expect(buildLabResultRow(base)).toMatchObject({
            labName: 'ห้องปฏิบัติการกลาง', reportNumber: 'TR-2569-001', verificationCode: 'ABCD-1234',
        });
    });

    test('an unusable reportedAt becomes null, never an Invalid Date', () => {
        expect(buildLabResultRow({ ...base, reportedAt: 'ไม่ใช่วันที่' }).reportedAt).toBeNull();
        expect(buildLabResultRow({ ...base, reportedAt: undefined }).reportedAt).toBeNull();
    });

    test('trims the lab name rather than storing the spaces', () => {
        expect(buildLabResultRow({ ...base, labName: '  ห้องแล็บ ก  ' }).labName).toBe('ห้องแล็บ ก');
    });
});
