/**
 * H3 — the generic public trace resolver must 410-GATE a trace whose
 * certificate EXISTS but is invalid (revoked / expired / non-active), exactly
 * like the dedicated batch route already does. Today it returns 200 with the
 * full trace payload (farm/plot/lab fields), leaking a revoked cert's trace to
 * public scanners.
 *
 * It must also use a case-INSENSITIVE status compare — certs are stored
 * status:'active' (lowercase), and the strict `=== 'ACTIVE'` check mis-marked
 * EVERY active cert invalid.
 *
 * Un-certified traces (certificate:null) must keep returning 200 (not gated).
 *
 * The DB-import modules (server / prisma-database) call process.exit(1) without
 * DATABASE_URL, so we mock the whole `common` module — but with the REAL
 * evaluateCertGate pulled via requireActual (mocking the DB-imports first so
 * requireActual('common') loads cleanly).
 */
'use strict';

jest.mock('../../server', () => ({ prisma: {} }));
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

const realCommon = jest.requireActual('../../services/trace-service/common');

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
    // REAL gate under test:
    evaluateCertGate: jest.requireActual('../../services/trace-service/common').evaluateCertGate,
}));

const common = require('../../services/trace-service/common');
const { resolveTraceByGenericQr } = require('../../services/trace-service/resolve-generic');

const ctx = { requestIp: '127.0.0.1', userAgent: 'jest' };
const FARM = { farmName: 'Farm', farmType: 'OUTDOOR', district: 'D', province: 'P', status: 'ACTIVE' };
const PLANT = { code: 'C', nameTH: 'ก', nameEN: 'C', scientificName: 'Cannabis' };

const future = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

function cycleRow(cert) {
    return {
        id: 'cycle-1', uuid: 'cycle-1', farm: { ...FARM },
        plantSpecies: { ...PLANT }, certificate: cert, batches: [],
        plotName: 'A1', plotArea: 1, areaUnit: 'rai',
        cultivationType: 'OUTDOOR', seedSource: null, soilType: null, irrigationType: null,
        cycleName: 'C1', cycleNumber: 1,
        startDate: null, expectedHarvestDate: null, actualHarvestDate: null,
        estimatedYield: null, actualYield: null, status: 'ACTIVE', varietyName: null,
    };
}
function batchRow(cert) {
    return {
        id: 'batch-1', qrCode: 'B1', batchNumber: 'B1', farm: { ...FARM }, plant: { ...PLANT },
        cycle: { id: 'cycle-1', cycleName: 'C1', certificate: cert }, lots: [],
        plotName: 'A1', plotArea: 1, areaUnit: 'rai', cultivationType: 'OUTDOOR', seedSource: null,
        plantingDate: null, harvestDate: null, freshWeight: 1, qualityGrade: 'A', status: 'OK',
    };
}
function lotRow(cert) {
    return {
        id: 'lot-1', qrCode: 'L1', lotNumber: 'L1', packageType: 'BAG', quantity: 1, unitWeight: 1,
        status: 'OK', packagedAt: null, expiryDate: null,
        batch: {
            batchNumber: 'B1', harvestDate: null, plantingDate: null,
            farm: { ...FARM }, plant: { ...PLANT },
            cycle: { id: 'cycle-1', certificate: cert },
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

describe('generic trace resolver — certificate 410-gate (H3)', () => {
    test('1) cycle with revoked cert (future expiry) → 410, no full trace fields', async () => {
        common.prisma.plantingCycle.findFirst.mockResolvedValue(
            cycleRow({ certificateNumber: 'CERT-1', status: 'revoked', expiryDate: future, issuedDate: past }),
        );
        const out = await resolveTraceByGenericQr('cycle-1', ctx);
        expect(out.status).toBe(410);
        expect(out.body.data).toBeUndefined();
        expect(out.body.farm).toBeUndefined();
        expect(out.body.plot).toBeUndefined();
        expect(out.body.lab_analysis).toBeUndefined();
        expect(out.body.type).toBe('PLANTING_CYCLE');
    });

    test('2) batch with revoked cert → 410', async () => {
        common.prisma.harvestBatch.findFirst.mockResolvedValue(
            batchRow({ certificateNumber: 'CERT-2', status: 'revoked', expiryDate: future, issuedDate: past }),
        );
        const out = await resolveTraceByGenericQr('B1', ctx);
        expect(out.status).toBe(410);
        expect(out.body.type).toBe('HARVEST_BATCH');
        expect(out.body.data).toBeUndefined();
    });

    test('3) lot with active-but-EXPIRED cert → 410', async () => {
        common.prisma.lot.findFirst.mockResolvedValue(
            lotRow({ certificateNumber: 'CERT-3', status: 'active', expiryDate: past, issuedDate: past }),
        );
        const out = await resolveTraceByGenericQr('L1', ctx);
        expect(out.status).toBe(410);
        expect(out.body.type).toBe('LOT');
        expect(out.body.data).toBeUndefined();
        expect(out.body.verification.reason).toBe('certificate_expired');
    });

    test('4) cycle with LOWERCASE active cert + future expiry → 200 AND certificate.isValid===true (casing fix)', async () => {
        common.prisma.plantingCycle.findFirst.mockResolvedValue(
            cycleRow({ certificateNumber: 'CERT-4', status: 'active', expiryDate: future, issuedDate: past }),
        );
        const out = await resolveTraceByGenericQr('cycle-1', ctx);
        expect(out.status).toBe(200);
        expect(out.body.data.certificate.isValid).toBe(true);
    });

    // M3: a legit active certified cycle must NOT be reported as a FAILED seal
    // (the seal lives at plot/batch/lot granularity, not cycle.id). The verdict
    // is NOT-APPLICABLE — valid:null + applicable:false — never valid:false.
    test('4b) active certified cycle → seal verdict NOT-APPLICABLE (valid:null, applicable:false), NOT a seal failure', async () => {
        common.prisma.plantingCycle.findFirst.mockResolvedValue(
            cycleRow({ certificateNumber: 'CERT-4B', status: 'active', expiryDate: future, issuedDate: past }),
        );
        const out = await resolveTraceByGenericQr('cycle-1', ctx);
        expect(out.status).toBe(200);
        expect(out.body.data.verification.valid).toBeNull();
        expect(out.body.data.verification.valid).not.toBe(false);
        expect(out.body.data.verification.applicable).toBe(false);
        // the cycle branch must NOT attempt a (always-missing) cycle.id seal lookup
        expect(common.qrcodeService.verifyTraceIntegrity).not.toHaveBeenCalled();
    });

    test('5) certificate:null (un-certified) → still 200, not gated', async () => {
        common.prisma.plantingCycle.findFirst.mockResolvedValue(cycleRow(null));
        const out = await resolveTraceByGenericQr('cycle-1', ctx);
        expect(out.status).toBe(200);
        expect(out.body.data.certificate).toBeNull();
    });

    test('6) 410 body keys deep-equal the dedicated batch route 410 body keys', async () => {
        const cert = { certificateNumber: 'CERT-6', status: 'revoked', expiryDate: future, issuedDate: past };
        const gate = realCommon.evaluateCertGate(cert);
        const genericBody = gate.minimalBody('HARVEST_BATCH');
        // The exact shape the dedicated batch route returns at 410:
        const routeBodyKeys = ['success', 'type', 'verification', 'certificate', 'message'].sort();
        expect(Object.keys(genericBody).sort()).toEqual(routeBodyKeys);
        expect(Object.keys(genericBody.verification).sort()).toEqual(['reason', 'scannedAt', 'valid'].sort());
        expect(Object.keys(genericBody.certificate).sort())
            .toEqual(['expiryDate', 'issuedDate', 'reference', 'status'].sort());
    });
});
