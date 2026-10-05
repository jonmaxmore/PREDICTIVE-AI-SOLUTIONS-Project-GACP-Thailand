/**
 * The public scan carries the lab report now — operator ruling 2026-09-05.
 *
 * R9 (spec 2026-08-20) said the public surface states ONLY that a test exists:
 * "ไม่มีไฟล์ ไม่มีค่า ไม่มีสรุปผ่าน/ไม่ผ่าน". That was the right call under the
 * privacy position in force at the time — a real COA carries the farmer's name and
 * address printed inside it.
 *
 * The operator retired that position on 2026-09-05: "ยังไม่ต้องสนใจกฎหมาย PDPA ให้
 * อัปโหลด COA และพวกชื่อฟาร์ม และที่อยู่ติดต่อได้ เมื่อสแกนต้องเห็นทั้งหมด", and then
 * asked for the report specifically: "ต้องแนบเอกสารนี้ลงไปด้วย ให้เห็นว่าฟาร์มนี้มีผลตรวจ".
 * Recorded as a demo-phase relaxation with a return date in tnt-data-scope.md §7.
 *
 * The trap this file exists to hold shut: the lot claim and the farm claim must
 * stay separate on the wire. A single "this farm has lab results" line read by
 * someone holding an untested bag says their bag was tested.
 */
'use strict';

jest.mock('../../server', () => ({ prisma: {} }));
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

jest.mock('../../services/trace-service/common', () => ({
    prisma: {
        plantingCycle: { findFirst: jest.fn() },
        harvestBatch: { findFirst: jest.fn() },
        lot: { findFirst: jest.fn() },
        batchLabResult: { findMany: jest.fn() },
    },
    logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
    qrcodeService: { verifyTraceIntegrity: jest.fn() },
    formatCultivationType: (x) => x,
    formatThaiDate: (x) => (x ? String(x) : null),
    SAFETY_DISCLAIMER: 'disclaimer',
    FDA_REFERRAL: 'fda',
    TRACE_NOT_FOUND_MESSAGE: 'not found',
    evaluateCertGate: jest.requireActual('../../services/trace-service/common').evaluateCertGate,
}));

const common = require('../../services/trace-service/common');
const { resolveTraceByGenericQr } = require('../../services/trace-service/resolve-generic');

const ctx = { requestIp: '127.0.0.1', userAgent: 'jest' };

const COA = {
    id: 'lab-1', harvestBatchId: 'hb-1', organizationId: 'org-1', uploadedBy: 'user-1',
    fileUrl: '/uploads/lab-results/a.pdf', fileName: 'coa.pdf',
    labName: 'ห้องปฏิบัติการกลาง', reportNumber: 'TR-2569-001',
    reportedAt: new Date('2026-09-15T00:00:00Z'), verificationCode: 'ABCD-1234',
    verificationStatus: 'FARMER_UPLOADED', uploadedAt: new Date('2026-09-16T00:00:00Z'),
    isDeleted: false,
};

const FARM = { id: 'farm-1', farmName: 'สวนสมุนไพรลุงมี', farmType: 'OUTDOOR', district: 'เมือง', province: 'เชียงใหม่', status: 'ACTIVE' };

function lotRow(labResults) {
    return {
        id: 'lot-1', lotNumber: 'LOT-1', qrCode: 'lot-qr', status: 'PACKED',
        packagedAt: null, expiryDate: null, testStatus: null,
        batch: {
            batchNumber: 'B-1', harvestDate: null, plantingDate: null,
            farm: { ...FARM }, plant: null, cycle: null,
            labResults,
        },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    common.prisma.plantingCycle.findFirst.mockResolvedValue(null);
    common.prisma.harvestBatch.findFirst.mockResolvedValue(null);
    common.prisma.batchLabResult.findMany.mockResolvedValue([]);
    common.qrcodeService.verifyTraceIntegrity.mockResolvedValue({ available: false, valid: null });
});

describe('a scanned lot shows the report of the batch it came from', () => {
    test('the file, the lab and the report number reach the scanner', async () => {
        common.prisma.lot.findFirst.mockResolvedValue(lotRow([COA]));
        const out = await resolveTraceByGenericQr('lot-qr', ctx);

        expect(out.status).toBe(200);
        expect(out.body.data.lot.labTest.lot).toMatchObject({
            tested: true,
            latest: expect.objectContaining({
                fileUrl: '/uploads/lab-results/a.pdf',
                labName: 'ห้องปฏิบัติการกลาง',
                reportNumber: 'TR-2569-001',
                verificationCode: 'ABCD-1234',
                verificationStatus: 'FARMER_UPLOADED',
            }),
        });
    });

    test('a lot whose batch has no report says NOT TESTED', async () => {
        common.prisma.lot.findFirst.mockResolvedValue(lotRow([]));
        const out = await resolveTraceByGenericQr('lot-qr', ctx);
        expect(out.body.data.lot.labTest.lot).toMatchObject({ tested: false, latest: null });
    });

    test('the farm line is separate, and an untested lot stays untested beside it', async () => {
        // The trap: the farm holds two reports, this bag has none.
        common.prisma.lot.findFirst.mockResolvedValue(lotRow([]));
        common.prisma.batchLabResult.findMany.mockResolvedValue([COA, { ...COA, id: 'lab-2' }]);

        const out = await resolveTraceByGenericQr('lot-qr', ctx);
        expect(out.body.data.lot.labTest.lot.tested).toBe(false);
        expect(out.body.data.lot.labTest.farm).toMatchObject({ subject: 'FARM', reportCount: 2 });
    });

    test('no flattened boolean a template could print as "has lab results"', async () => {
        common.prisma.lot.findFirst.mockResolvedValue(lotRow([COA]));
        const out = await resolveTraceByGenericQr('lot-qr', ctx);
        const labTest = out.body.data.lot.labTest;
        expect(Object.prototype.hasOwnProperty.call(labTest, 'tested')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(labTest, 'hasLabResults')).toBe(false);
    });

    test('internal ids still never reach the public body', async () => {
        common.prisma.lot.findFirst.mockResolvedValue(lotRow([COA]));
        common.prisma.batchLabResult.findMany.mockResolvedValue([COA]);
        const out = await resolveTraceByGenericQr('lot-qr', ctx);
        const serialized = JSON.stringify(out.body);
        expect(serialized).not.toContain('harvestBatchId');
        expect(serialized).not.toContain('organizationId');
        expect(serialized).not.toContain('uploadedBy');
        expect(serialized).not.toContain('lab-1');
    });

    test('if this branch ever caches, the cached copy cannot be a different shape', async () => {
        // The LOT branch returns no `cacheResponse` today — only the cycle and
        // batch branches do — so there is currently no second copy to drift. This
        // pins the invariant rather than the absence: the day someone adds caching
        // here, handing back a differently-built body (one that skipped a
        // redaction, say) goes red instead of shipping.
        common.prisma.lot.findFirst.mockResolvedValue(lotRow([COA]));
        const out = await resolveTraceByGenericQr('lot-qr', ctx);
        if (out.cacheResponse !== undefined) {
            expect(out.cacheResponse).toEqual(out.body);
        }
        // And the response itself does carry the report, cache or no cache.
        expect(JSON.stringify(out.body)).toContain('/uploads/lab-results/a.pdf');
    });
});
