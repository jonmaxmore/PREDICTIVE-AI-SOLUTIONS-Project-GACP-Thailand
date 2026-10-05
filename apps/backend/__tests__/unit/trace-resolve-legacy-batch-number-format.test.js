/**
 * W1-3 (batch/lot identifier SSOT) — HISTORY IS UNTOUCHABLE.
 *
 * A HarvestBatch row whose batchNumber was minted by the OLD (now-fixed) buggy
 * generator in certificate-service.js — `LOT-${year}-${farm.id.slice(0,4)}-001`
 * — must keep resolving through the PUBLIC generic trace resolver
 * (services/trace-service/resolve-generic.js) by an EXACT string match on the
 * stored batchNumber column. The resolver never parses/validates the code's
 * prefix or format (see the `{ batchNumber: qrCode }` OR-clause around line
 * 200), so consolidating batch-number generation onto the new BATCH- prefixed
 * SSOT does not affect resolution of codes minted before the fix — already
 * printed on stickers, embedded in signed QR payloads, and referenced by the
 * DTAM interoperability contract.
 *
 * This is a characterization test: it is expected to pass unchanged both
 * before and after the W1-3 fix, because resolve-generic.js is not touched by
 * this work item — it only reads whatever string is actually stored.
 */
'use strict';

jest.mock('../../server', () => ({ prisma: {} }));
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

const mockBatchFindFirst = jest.fn();

jest.mock('../../services/trace-service/common', () => ({
    prisma: {
        plantingCycle: { findFirst: jest.fn() },
        harvestBatch: { findFirst: (...args) => mockBatchFindFirst(...args) },
        lot: { findFirst: jest.fn() },
    },
    logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
    qrcodeService: { verifyTraceIntegrity: jest.fn(async () => null) },
    formatCultivationType: (x) => x,
    formatThaiDate: (x) => (x ? String(x) : null),
    SAFETY_DISCLAIMER: 'disclaimer',
    FDA_REFERRAL: 'fda',
    TRACE_NOT_FOUND_MESSAGE: 'not found',
    evaluateCertGate: jest.requireActual('../../services/trace-service/common').evaluateCertGate,
}));

const { resolveTraceByGenericQr } = require('../../services/trace-service/resolve-generic');

const ctx = { requestIp: '127.0.0.1', userAgent: 'jest' };
const OLD_FORMAT_CODE = 'LOT-2569-A1B2-001'; // pre-W1-3 certificate-service.js shape

describe('trace resolver — pre-W1-3 old-format batch numbers still resolve', () => {
    afterEach(() => jest.clearAllMocks());

    it('resolves a HarvestBatch stored with the OLD LOT-prefixed batchNumber, unchanged', async () => {
        mockBatchFindFirst.mockResolvedValue({
            id: 'batch-legacy', batchNumber: OLD_FORMAT_CODE, isDeleted: false,
            plotName: 'p', areaUnit: 'sqm', cultivationType: 'SELF_GROWN', seedSource: null,
            plantingDate: null, harvestDate: null, freshWeight: 10, qualityGrade: null, status: 'GROWING',
            farm: { id: 'farm-1', farmName: 'Farm', farmType: 'OUTDOOR', province: 'p', district: 'd', status: 'ACTIVE' },
            plant: { code: 'CANNABIS', nameTH: 'n', nameEN: 'n', scientificName: 's' },
            cycle: null,
            lots: [],
        });

        const result = await resolveTraceByGenericQr(OLD_FORMAT_CODE, ctx);

        expect(result.status).toBe(200);
        expect(result.body.type).toBe('HARVEST_BATCH');
        expect(result.body.data.batch.number).toBe(OLD_FORMAT_CODE);
        // Exact-match lookup — resolution never parses/derives from the string.
        const where = mockBatchFindFirst.mock.calls[0][0].where;
        expect(where.OR).toEqual(
            expect.arrayContaining([{ batchNumber: OLD_FORMAT_CODE }]),
        );
    });
});
