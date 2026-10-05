/**
 * SEC-CULT-001 — INVERTED 2026-09-05, not deleted.
 *
 * This file used to assert the opposite: that the public trace strips the farm's
 * street address and sub-district from every branch, leaving only a coarse
 * "district, province". That was the correct reading of the privacy position in
 * force, and the assertions are kept in the git history rather than pretended away.
 *
 * The operator replaced that position: "ยังไม่ต้องสนใจกฎหมาย PDPA ให้อัปโหลด COA และ
 * พวกชื่อฟาร์ม และที่อยู่ติดต่อได้ เมื่อสแกนต้องเห็นทั้งหมด" — a DEMO-PHASE relaxation
 * with a return date before ministry production, listed in tnt-data-scope.md §7 in
 * the same shape as the residency rule.
 *
 * So the file keeps doing its job — guarding what the public projection may carry —
 * but now guards the CORRECT line. And the line moved by exactly one step, which is
 * why these three assertions matter more than the ones they replace:
 *
 *   the ADDRESS is published        the operator opened it
 *   the COORDINATES are not         a separate question, asked and answered "ไม่เปิด"
 *   the internal id is not          never part of the ruling at all
 *
 * Coordinates are the one that would be easy to let slide in with the rest. Sub-
 * district tells a buyer where produce comes from; latitude and longitude walk a
 * stranger to the plot, and cannabis plots are theft targets. Opening the address
 * does not carry that along, and this file fails if it ever does.
 */
'use strict';

// common.js imports ../../server + ../prisma-database (both process.exit(1)
// without DATABASE_URL) — mock them so requireActual('common') for the real
// evaluateCertGate loads cleanly (the project rules DB-import gotcha).
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
    // resolve-generic now depends on the shared cert gate (H3). Use the REAL one.
    evaluateCertGate: jest.requireActual('../../services/trace-service/common').evaluateCertGate,
}));

const common = require('../../services/trace-service/common');
const { resolveTraceByGenericQr } = require('../../services/trace-service/resolve-generic');

// A farm row that DOES carry PII — the resolver must not leak it publicly.
const PII_FARM = {
    farmName: 'สวนสมุนไพรลุงมี',
    farmType: 'OUTDOOR',
    district: 'เมือง',
    province: 'เชียงใหม่',
    subDistrict: 'สุเทพ',
    address: '99/1 ซอยลับ หมู่ 4 ถนนนิมมานเหมินทร์',
    status: 'ACTIVE',
};

const ctx = { requestIp: '127.0.0.1', userAgent: 'jest' };

const expectPublicFarmShape = (body) => {
    const farm = body.data.farm;
    // Opened by the 2026-09-05 ruling.
    expect(farm.address).toBe('99/1 ซอยลับ หมู่ 4 ถนนนิมมานเหมินทร์');
    expect(farm.subDistrict).toBe('สุเทพ');
    // Unchanged: the coarse line stays, because it is what most readers use and it
    // still reads correctly for a farm with no street address recorded.
    expect(farm.location).toBe('เมือง, เชียงใหม่');
    expect(farm.name).toBe('สวนสมุนไพรลุงมี');

    // NOT opened, and asked about separately: coordinates walk a stranger to the
    // plot. Absent rather than null — a null advertises that the platform holds the
    // number and invites the next change to fill it in.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('latitude');
    expect(serialized).not.toContain('longitude');
    // Never part of the ruling: an id is a handle for enumerating other records.
    expect(farm.id).toBeUndefined();
};

beforeEach(() => {
    jest.clearAllMocks();
    common.prisma.plantingCycle.findFirst.mockResolvedValue(null);
    common.prisma.harvestBatch.findFirst.mockResolvedValue(null);
    common.prisma.lot.findFirst.mockResolvedValue(null);
    // Default: entity is NOT cryptographically sealed (no TraceQrSecurity row).
    common.qrcodeService.verifyTraceIntegrity.mockResolvedValue({ available: false, valid: null });
});

describe('resolveTraceByGenericQr — public PII redaction (SEC-CULT-001)', () => {
    test('PLANTING_CYCLE branch publishes the address, and still withholds the coordinates', async () => {
        common.prisma.plantingCycle.findFirst.mockResolvedValue({
            id: 'cycle-1', uuid: 'cycle-1',
            farm: { ...PII_FARM },
            plantSpecies: { code: 'CANNABIS', nameTH: 'กัญชา', nameEN: 'Cannabis', scientificName: 'Cannabis sativa' },
            certificate: null,
            batches: [],
            plotName: 'A1', plotArea: 1, areaUnit: 'rai',
            cultivationType: 'OUTDOOR', seedSource: null, soilType: null, irrigationType: null,
            cycleName: 'C1', cycleNumber: 1,
            startDate: null, expectedHarvestDate: null, actualHarvestDate: null,
            estimatedYield: null, actualYield: null, status: 'ACTIVE', varietyName: null,
        });

        const out = await resolveTraceByGenericQr('cycle-1', ctx);

        expect(out.status).toBe(200);
        expect(out.body.type).toBe('PLANTING_CYCLE');
        expectPublicFarmShape(out.body);
    });

    test('HARVEST_BATCH branch does the same', async () => {
        common.prisma.harvestBatch.findFirst.mockResolvedValue({
            id: 'batch-1',
            farm: { ...PII_FARM },
            species: { code: 'C', nameTH: 'ก', nameEN: 'C', scientificName: 'Cs' },
            cycle: { certificate: null },
            lots: [],
            plotName: null, plotArea: null, areaUnit: 'rai',
            cultivationType: 'OUTDOOR', seedSource: null,
            batchNumber: 'B1', plantingDate: null, harvestDate: null,
            actualYield: null, estimatedYield: null, yieldUnit: 'kg', qualityGrade: 'A', status: 'OK',
        });

        const out = await resolveTraceByGenericQr('B1', ctx);

        expect(out.status).toBe(200);
        expect(out.body.type).toBe('HARVEST_BATCH');
        expectPublicFarmShape(out.body);
    });

    test('LOT branch does the same', async () => {
        common.prisma.lot.findFirst.mockResolvedValue({
            lotNumber: 'L1', packageType: 'BOX', quantity: 1, unitWeight: 1,
            status: 'OK', packagedAt: null, expiryDate: null,
            testStatus: null, thcContent: null, cbdContent: null, moistureContent: null,
            batch: {
                batchNumber: 'B1', harvestDate: null, plantingDate: null,
                farm: { ...PII_FARM },
                plant: { code: 'C' },
                cycle: { certificate: null },
            },
        });

        const out = await resolveTraceByGenericQr('L1', ctx);

        expect(out.status).toBe(200);
        expect(out.body.type).toBe('LOT');
        expectPublicFarmShape(out.body);
    });
});

describe('resolveTraceByGenericQr — verification reflects real RSA integrity (SEC-CULT-002)', () => {
    const batchRow = {
        id: 'batch-1',
        farm: { ...PII_FARM },
        species: { code: 'C', nameTH: 'ก', nameEN: 'C', scientificName: 'Cs' },
        cycle: { certificate: null },
        lots: [],
        plotName: null, plotArea: null, areaUnit: 'rai',
        cultivationType: 'OUTDOOR', seedSource: null,
        batchNumber: 'B1', plantingDate: null, harvestDate: null,
        actualYield: null, estimatedYield: null, yieldUnit: 'kg', qualityGrade: 'A', status: 'OK',
    };

    test('a sealed + valid batch reports verification.valid=true (signature actually checked)', async () => {
        common.prisma.harvestBatch.findFirst.mockResolvedValue(batchRow);
        common.qrcodeService.verifyTraceIntegrity.mockResolvedValue({
            available: true, valid: true, signatureValid: true, hashValid: true, chainValid: true,
        });

        const out = await resolveTraceByGenericQr('B1', ctx);
        const v = out.body.data.verification;
        expect(v.sealed).toBe(true);
        expect(v.signatureValid).toBe(true);
        expect(v.valid).toBe(true);
        // Looked up by the SAME (entityType, id) the QR-security row was created with.
        expect(common.qrcodeService.verifyTraceIntegrity).toHaveBeenCalledWith('HARVEST_BATCH', 'batch-1');
    });

    test('a tampered batch (bad signature) reports verification.valid=false', async () => {
        common.prisma.harvestBatch.findFirst.mockResolvedValue(batchRow);
        common.qrcodeService.verifyTraceIntegrity.mockResolvedValue({
            available: true, valid: false, signatureValid: false, hashValid: true, chainValid: false,
        });

        const out = await resolveTraceByGenericQr('B1', ctx);
        const v = out.body.data.verification;
        expect(v.sealed).toBe(true);
        expect(v.signatureValid).toBe(false);
        expect(v.valid).toBe(false);
    });

    test('an unsealed cycle no longer claims valid:true (was hardcoded)', async () => {
        common.prisma.plantingCycle.findFirst.mockResolvedValue({
            id: 'cycle-1', uuid: 'cycle-1', farm: { ...PII_FARM },
            plantSpecies: { code: 'CANNABIS', nameTH: 'กัญชา', nameEN: 'Cannabis', scientificName: 'Cannabis sativa' },
            certificate: null, batches: [],
            plotName: 'A1', plotArea: 1, areaUnit: 'rai',
            cultivationType: 'OUTDOOR', seedSource: null, soilType: null, irrigationType: null,
            cycleName: 'C1', cycleNumber: 1,
            startDate: null, expectedHarvestDate: null, actualHarvestDate: null,
            estimatedYield: null, actualYield: null, status: 'ACTIVE', varietyName: null,
        });
        // default verifyTraceIntegrity → { available: false } (no cycle-level seal)

        const out = await resolveTraceByGenericQr('cycle-1', ctx);
        const v = out.body.data.verification;
        expect(v.sealed).toBe(false);
        // Security invariant (unchanged): an unsealed cycle must NEVER claim
        // valid:true. M3 made the cycle verdict precisely NOT-APPLICABLE
        // (valid:null, applicable:false) instead of the prior valid:false —
        // a cycle has no seal at its own granularity (it lives at plot/batch/lot),
        // so "not applicable" is the honest verdict and the FE shows the cert
        // STATUS without a false seal-FAILED alarm. Either way it is never true.
        expect(v.valid).not.toBe(true);
        expect(v.valid).toBeNull();
        expect(v.applicable).toBe(false);
        expect(v.signatureValid).toBeNull();
    });
});
