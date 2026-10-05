/**
 * A3 (HIGH) — layer 2 defensive read: even if a cross-farm batch already exists
 * (created before the layer-1 create block), the public trace must NOT surface a
 * certificate whose cycle belongs to a DIFFERENT farm than the batch. Otherwise
 * a consumer scanning the QR sees a genuine in-date GACP cert vouching for
 * uncertified produce.
 *
 * Covers the generic resolver (resolve-generic.js) HARVEST_BATCH + LOT branches.
 * Uses the REAL evaluateCertGate (via requireActual) over a mocked common.
 */
'use strict';

jest.mock('../../server', () => ({ prisma: {} }));
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

jest.mock('../../services/trace-service/common', () => ({
    prisma: {
        plantingCycle: { findFirst: jest.fn() },
        harvestBatch: { findFirst: jest.fn() },
        lot: { findFirst: jest.fn() },
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
const FARM = { farmName: 'Farm', farmType: 'OUTDOOR', district: 'D', province: 'P', status: 'ACTIVE' };
const PLANT = { code: 'C', nameTH: 'ก', nameEN: 'C', scientificName: 'Cannabis' };
const future = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const VALID_CERT = { certificateNumber: 'CERT-X', status: 'active', expiryDate: future, issuedDate: past, standardName: 'GACP' };

function batchRow(batchFarmId, cycleFarmId, cert) {
    return {
        id: 'batch-1', qrCode: 'B1', batchNumber: 'B1', farmId: batchFarmId,
        farm: { ...FARM }, plant: { ...PLANT },
        cycle: { id: 'cycle-1', farmId: cycleFarmId, cycleName: 'C1', certificate: cert },
        lots: [], plotName: 'A1', plotArea: 1, areaUnit: 'rai', cultivationType: 'OUTDOOR', seedSource: null,
        plantingDate: null, harvestDate: null, freshWeight: 1, qualityGrade: 'A', status: 'OK',
    };
}
function lotRow(batchFarmId, cycleFarmId, cert) {
    return {
        id: 'lot-1', qrCode: 'L1', lotNumber: 'L1', packageType: 'BAG', quantity: 1, unitWeight: 1,
        status: 'OK', packagedAt: null, expiryDate: null, testStatus: 'PASSED',
        batch: {
            batchNumber: 'B1', harvestDate: null, plantingDate: null, farmId: batchFarmId,
            farm: { ...FARM }, plant: { ...PLANT },
            cycle: { id: 'cycle-1', farmId: cycleFarmId, certificate: cert },
        },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    common.prisma.plantingCycle.findFirst.mockResolvedValue(null);
    common.prisma.harvestBatch.findFirst.mockResolvedValue(null);
    common.prisma.lot.findFirst.mockResolvedValue(null);
    common.qrcodeService.verifyTraceIntegrity.mockResolvedValue({ available: false, valid: null });
});

describe('A3 — cross-farm cert is dropped on the public trace read', () => {
    test('HARVEST_BATCH: batch.farmId !== cycle.farmId → certificate dropped (null), still 200', async () => {
        common.prisma.harvestBatch.findFirst.mockResolvedValue(batchRow('farm-A', 'farm-B', { ...VALID_CERT }));
        const out = await resolveTraceByGenericQr('B1', ctx);
        expect(out.status).toBe(200);
        expect(out.body.data.certificate).toBeNull();
    });

    test('HARVEST_BATCH: matching farms → certificate surfaced as valid', async () => {
        common.prisma.harvestBatch.findFirst.mockResolvedValue(batchRow('farm-A', 'farm-A', { ...VALID_CERT }));
        const out = await resolveTraceByGenericQr('B1', ctx);
        expect(out.status).toBe(200);
        expect(out.body.data.certificate).not.toBeNull();
        expect(out.body.data.certificate.isValid).toBe(true);
    });

    test('LOT: batch.farmId !== cycle.farmId → certificate dropped (null), still 200', async () => {
        common.prisma.lot.findFirst.mockResolvedValue(lotRow('farm-A', 'farm-B', { ...VALID_CERT }));
        const out = await resolveTraceByGenericQr('L1', ctx);
        expect(out.status).toBe(200);
        expect(out.body.data.certificate).toBeNull();
    });

    test('LOT: matching farms → certificate surfaced as valid', async () => {
        common.prisma.lot.findFirst.mockResolvedValue(lotRow('farm-A', 'farm-A', { ...VALID_CERT }));
        const out = await resolveTraceByGenericQr('L1', ctx);
        expect(out.status).toBe(200);
        expect(out.body.data.certificate).not.toBeNull();
    });
});
