/**
 * The PUBLIC trace surface may not publish a farm's PROJECTED yield.
 *
 * `GET /api/trace/:qrCode` has no auth middleware anywhere on its route chain
 * (routes/api/index.js `router.use('/trace', traceRouter)` → trace.js `router.get('/:qrCode')`),
 * so whatever it returns is readable by anyone holding a QR code — a buyer, a competitor,
 * a passer-by.
 *
 * The approved design says twice that a projection is not theirs to see:
 *
 *   §4.4 "ปริมาณ | เฉพาะที่เก็บเกี่ยวแล้วจริง (จาก HarvestBatch) — ไม่มีตัวเลขคาดการณ์"
 *   §5   lists "ตัวเลขคาดการณ์ผลผลิต" among the things deliberately NOT done this phase
 *        (design note 2026-08-20-planting-tnt-design:80,93)
 *
 * The reason is commercial, and it is the farmer's: `estimatedYield` is what this farm
 * expects to produce this season. Published beside the farm's name, its district and its
 * planting dates, it tells a buyer what to expect and a competitor what is coming — a
 * negotiating position handed to the other side of the table by the certification system
 * the farmer is obliged to use. An ACTUAL harvest weight is a different thing: it is a
 * fact about produce that already exists and is what the scan is for.
 *
 * These tests assert the projection is ABSENT from the public body — not null, absent —
 * on every branch that carries a yield.
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

/** Distinctive so a substring leak anywhere in the serialized body is unambiguous. */
const PROJECTED_YIELD = 987654;
const REAL_HARVEST_WEIGHT = 12345;

const FARM = {
    farmName: 'สวนสมุนไพรลุงมี', farmType: 'OUTDOOR',
    district: 'เมือง', province: 'เชียงใหม่', status: 'ACTIVE',
};

const PLANT = {
    code: 'CANNABIS', nameTH: 'กัญชา', nameEN: 'Cannabis', scientificName: 'Cannabis sativa',
};

function expectNoProjection(body) {
    const serialized = JSON.stringify(body);
    // The key must not appear at all — a null `estimated` still tells a reader the
    // platform holds that number and invites the next change to fill it in.
    expect(serialized).not.toContain('"estimated"');
    expect(serialized).not.toContain('"estimatedYield"');
    // …and the value must not appear under any other name.
    expect(serialized).not.toContain(String(PROJECTED_YIELD));
}

beforeEach(() => {
    jest.clearAllMocks();
    common.prisma.plantingCycle.findFirst.mockResolvedValue(null);
    common.prisma.harvestBatch.findFirst.mockResolvedValue(null);
    common.prisma.lot.findFirst.mockResolvedValue(null);
    common.qrcodeService.verifyTraceIntegrity.mockResolvedValue({ available: false, valid: null });
});

describe('resolveTraceByGenericQr — a projection is not public (spec §4.4, §5)', () => {
    test('PLANTING_CYCLE: the projected yield never reaches an anonymous scanner', async () => {
        common.prisma.plantingCycle.findFirst.mockResolvedValue({
            id: 'cycle-1', uuid: 'cycle-1',
            farm: { ...FARM },
            plantSpecies: { ...PLANT },
            certificate: null,
            batches: [],
            plotName: 'A1', plotArea: 1, areaUnit: 'rai',
            cultivationType: 'OUTDOOR', seedSource: null, soilType: null, irrigationType: null,
            cycleName: 'C1', cycleNumber: 1,
            startDate: null, expectedHarvestDate: null, actualHarvestDate: null,
            estimatedYield: PROJECTED_YIELD, actualYield: null,
            status: 'ACTIVE', varietyName: null,
        });

        const out = await resolveTraceByGenericQr('cycle-1', ctx);

        expect(out.status).toBe(200);
        expectNoProjection(out.body);
    });

    test('an ACTUAL harvest weight is still published — that is what the scan is for', async () => {
        common.prisma.plantingCycle.findFirst.mockResolvedValue({
            id: 'cycle-2', uuid: 'cycle-2',
            farm: { ...FARM },
            plantSpecies: { ...PLANT },
            certificate: null,
            batches: [{
                batchNumber: 'B-1', harvestDate: null,
                freshWeight: REAL_HARVEST_WEIGHT, qualityGrade: 'A', status: 'HARVESTED',
            }],
            plotName: 'A1', plotArea: 1, areaUnit: 'rai',
            cultivationType: 'OUTDOOR', seedSource: null, soilType: null, irrigationType: null,
            cycleName: 'C1', cycleNumber: 1,
            startDate: null, expectedHarvestDate: null, actualHarvestDate: null,
            estimatedYield: PROJECTED_YIELD, actualYield: REAL_HARVEST_WEIGHT,
            status: 'HARVESTED', varietyName: null,
        });

        const out = await resolveTraceByGenericQr('cycle-2', ctx);

        expect(out.status).toBe(200);
        expectNoProjection(out.body);
        // The redaction must not have taken the real number with it.
        expect(JSON.stringify(out.body)).toContain(String(REAL_HARVEST_WEIGHT));
        expect(out.body.data.harvests[0].yield).toBe(REAL_HARVEST_WEIGHT);
    });

    test('the cached copy is redacted too — the cache is what most scans read', async () => {
        common.prisma.plantingCycle.findFirst.mockResolvedValue({
            id: 'cycle-3', uuid: 'cycle-3',
            farm: { ...FARM },
            plantSpecies: { ...PLANT },
            certificate: null,
            batches: [],
            plotName: 'A1', plotArea: 1, areaUnit: 'rai',
            cultivationType: 'OUTDOOR', seedSource: null, soilType: null, irrigationType: null,
            cycleName: 'C1', cycleNumber: 1,
            startDate: null, expectedHarvestDate: null, actualHarvestDate: null,
            estimatedYield: PROJECTED_YIELD, actualYield: null,
            status: 'ACTIVE', varietyName: null,
        });

        const out = await resolveTraceByGenericQr('cycle-3', ctx);

        // trace.js stores `cacheResponse` under the QR key for 300 s and serves it to
        // every later scanner without re-reading the database. A redaction applied to
        // the response but not to the cached copy protects only the first visitor.
        expect(out.cacheResponse).toBeDefined();
        expectNoProjection(out.cacheResponse);
    });
});
