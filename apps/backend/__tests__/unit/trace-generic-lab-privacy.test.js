/**
 * SEC-TRACE-PII-002 — the PUBLIC generic trace resolver (unauthenticated
 * `GET /api/trace/:qrCode`, no auth middleware anywhere on its route chain —
 * see routes/api/index.js:315 `router.use('/trace', traceRouter)` and
 * routes/api/trace/trace.js:88 `router.get('/:qrCode', ...)`) exposed raw lab
 * measured values (`lab_analysis.results`, `lab_analysis.status`) plus, on the
 * LOT branch, potency values and a live document link
 * (`labTest.thcContent/cbdContent/moistureContent/labTestReportUrl`) to any
 * anonymous scanner.
 *
 * Ruling R9 (design note 2026-08-20-planting-tnt-design:24,62,77)
 * is the authority on what the public page may say about a lab test:
 *   "หน้า public แจ้งแค่ว่า 'มี/ไม่มี' ผลตรวจ ... ไม่มีไฟล์ ไม่มีค่า
 *    ไม่มีสรุปผ่าน/ไม่ผ่าน" — existence only. NOT EVEN a pass/fail verdict,
 * and never the file or the measured values. `labName` is explicitly
 * permitted ("โดย <ชื่อ Lab>").
 *
 * ── R9 RETIRED 2026-09-05, and this file inverted rather than deleted ──────
 *
 * operator: "ยังไม่ต้องสนใจกฎหมาย PDPA ให้อัปโหลด COA และพวกชื่อฟาร์ม และที่อยู่ติดต่อได้
 * เมื่อสแกนต้องเห็นทั้งหมด" and then, specifically: "ต้องแนบเอกสารนี้ลงไปด้วย ให้เห็นว่า
 * ฟาร์มนี้มีผลตรวจ". The COA file, the laboratory's name, its report number and its
 * verification code are published now. Logged as a demo-phase relaxation with a
 * return date in tnt-data-scope.md §7.
 *
 * WHAT DID NOT CHANGE, and is why the leak assertions below stay:
 * the MEASURED VALUES on the Lot row — thcContent, cbdContent, moistureContent —
 * and the legacy per-lot `labTestReportUrl` are still absent from the public body.
 * The operator's other instruction settles that: "เราจะไม่ได้พิมพ์บอกค่าเท่าไหร่
 * เราจะอัพโหลดผลแลป" — those typed columns are not a source of truth any more, the
 * uploaded COA is, and publishing numbers nobody vouched for beside a document that
 * contradicts them is worse than publishing neither.
 *
 * So `expectNoLabLeak` is unchanged and still runs. Only the shape and the SOURCE
 * of `labTest` moved: it now reports the batch's uploaded reports (T11/T13) rather
 * than a boolean derived from `lot.testStatus`.
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

// Distinctive markers so a substring leak anywhere in the serialized body is
// unambiguous (a real measured value / a real farmer-identifying report URL).
const SECRET_RESULTS = [{ testName: 'THC', value: 0.29, unit: '%', status: 'PASS' }];
const SECRET_REPORT_URL = 'https://lab.example/reports/SECRET-FARMER-COA-9f31.pdf';

const FARM = {
    farmName: 'สวนสมุนไพรลุงมี', farmType: 'OUTDOOR',
    district: 'เมือง', province: 'เชียงใหม่', status: 'ACTIVE',
};

function expectNoLabLeak(body) {
    const serialized = JSON.stringify(body);
    // Forbidden keys must not appear at all (absence, not null).
    expect(serialized).not.toContain('"results"');
    expect(serialized).not.toContain('"thcContent"');
    expect(serialized).not.toContain('"cbdContent"');
    expect(serialized).not.toContain('"moistureContent"');
    expect(serialized).not.toContain('"labTestReportUrl"');
    expect(serialized).not.toContain('"passed"');
    // Forbidden VALUES must not appear anywhere in the payload.
    expect(serialized).not.toContain('SECRET-FARMER-COA');
    expect(serialized).not.toContain('0.29');
    expect(serialized).not.toContain('THC');
}

beforeEach(() => {
    jest.clearAllMocks();
    common.prisma.plantingCycle.findFirst.mockResolvedValue(null);
    common.prisma.harvestBatch.findFirst.mockResolvedValue(null);
    common.prisma.lot.findFirst.mockResolvedValue(null);
    common.qrcodeService.verifyTraceIntegrity.mockResolvedValue({ available: false, valid: null });
});

describe('resolveTraceByGenericQr — public lab-result redaction (SEC-TRACE-PII-002 / R9)', () => {
    test('PLANTING_CYCLE branch: lab_analysis carries existence + labName only', async () => {
        common.prisma.plantingCycle.findFirst.mockResolvedValue({
            id: 'cycle-1', uuid: 'cycle-1',
            farm: { ...FARM },
            plantSpecies: { code: 'CANNABIS', nameTH: 'กัญชา', nameEN: 'Cannabis', scientificName: 'Cannabis sativa' },
            certificate: {
                id: 'cert-1', certificateNumber: 'GACP-1', expiryDate: null, issuedDate: null,
                status: 'active', standardName: 'GACP',
                application: { labResults: SECRET_RESULTS, labResultStatus: 'PASSED', labName: 'ห้องแล็บกลาง' },
            },
            batches: [],
            plotName: 'A1', plotArea: 1, areaUnit: 'rai',
            cultivationType: 'OUTDOOR', seedSource: null, soilType: null, irrigationType: null,
            cycleName: 'C1', cycleNumber: 1,
            startDate: null, expectedHarvestDate: null, actualHarvestDate: null,
            estimatedYield: null, actualYield: null, status: 'ACTIVE', varietyName: null,
        });

        const out = await resolveTraceByGenericQr('cycle-1', ctx);

        expect(out.status).toBe(200);
        expectNoLabLeak(out.body);
        expect(out.body.data.lab_analysis).toEqual({ tested: true, labName: 'ห้องแล็บกลาง' });
    });

    test('HARVEST_BATCH branch: lab_analysis carries existence + labName only', async () => {
        common.prisma.harvestBatch.findFirst.mockResolvedValue({
            id: 'batch-1',
            farm: { ...FARM },
            species: { code: 'C', nameTH: 'ก', nameEN: 'C', scientificName: 'Cs' },
            plant: { code: 'C', nameTH: 'ก', nameEN: 'C', scientificName: 'Cs' },
            cycle: {
                farmId: 'farm-1',
                certificate: {
                    id: 'cert-1', certificateNumber: 'GACP-1', expiryDate: null, issuedDate: null,
                    status: 'active', standardName: 'GACP',
                    application: { labResults: SECRET_RESULTS, labResultStatus: 'FAILED', labName: 'ห้องแล็บกลาง' },
                },
            },
            farmId: 'farm-1',
            lots: [],
            plotName: null, plotArea: null, areaUnit: 'rai',
            cultivationType: 'OUTDOOR', seedSource: null,
            batchNumber: 'B1', plantingDate: null, harvestDate: null,
            actualYield: null, estimatedYield: null, yieldUnit: 'kg', qualityGrade: 'A', status: 'OK',
        });

        const out = await resolveTraceByGenericQr('B1', ctx);

        expect(out.status).toBe(200);
        expectNoLabLeak(out.body);
        // The permitted assurance signal survives regardless of the underlying
        // PASSED/FAILED value — R9 forbids surfacing which one.
        expect(out.body.data.lab_analysis).toEqual({ tested: true, labName: 'ห้องแล็บกลาง' });
    });

    test('HARVEST_BATCH branch: no cert → lab_analysis is null (existing gate unchanged)', async () => {
        common.prisma.harvestBatch.findFirst.mockResolvedValue({
            id: 'batch-1',
            farm: { ...FARM },
            plant: { code: 'C', nameTH: 'ก', nameEN: 'C', scientificName: 'Cs' },
            cycle: { certificate: null },
            lots: [],
            plotName: null, plotArea: null, areaUnit: 'rai',
            cultivationType: 'OUTDOOR', seedSource: null,
            batchNumber: 'B1', plantingDate: null, harvestDate: null,
            actualYield: null, estimatedYield: null, yieldUnit: 'kg', qualityGrade: 'A', status: 'OK',
        });

        const out = await resolveTraceByGenericQr('B1', ctx);
        expect(out.body.data.lab_analysis).toBeNull();
    });

    test('LOT branch: the measured values and the legacy report URL still never leak', async () => {
        common.prisma.lot.findFirst.mockResolvedValue({
            lotNumber: 'L1', packageType: 'BOX', quantity: 1, unitWeight: 1,
            status: 'OK', packagedAt: null, expiryDate: null,
            testStatus: 'PASSED',
            thcContent: 0.29, cbdContent: 1.1, moistureContent: 8.5,
            labTestReportUrl: SECRET_REPORT_URL,
            batch: {
                batchNumber: 'B1', harvestDate: null, plantingDate: null,
                farm: { ...FARM },
                plant: { code: 'C' },
                cycle: { certificate: null },
            },
        });

        const out = await resolveTraceByGenericQr('L1', ctx);

        expect(out.status).toBe(200);
        // The typed columns stay unpublished — that part of R9 survives the ruling.
        expectNoLabLeak(out.body);
        // And `tested` no longer comes from lot.testStatus at all: with no uploaded
        // COA on the batch, a lot whose legacy column says PASSED reads NOT TESTED.
        expect(out.body.data.lot.labTest.lot).toMatchObject({ tested: false });
        expect(out.body.data.lot.labTest.farm).toMatchObject({ subject: 'FARM' });
    });

    test('LOT branch: a legacy PENDING column cannot make a lot look tested either', async () => {
        common.prisma.lot.findFirst.mockResolvedValue({
            lotNumber: 'L1', packageType: 'BOX', quantity: 1, unitWeight: 1,
            status: 'OK', packagedAt: null, expiryDate: null,
            testStatus: 'PENDING',
            thcContent: null, cbdContent: null, moistureContent: null,
            labTestReportUrl: SECRET_REPORT_URL, // Bug 6.3 invariant: a report URL alone must never flip this true.
            batch: {
                batchNumber: 'B1', harvestDate: null, plantingDate: null,
                farm: { ...FARM },
                plant: { code: 'C' },
                cycle: { certificate: null },
            },
        });

        const out = await resolveTraceByGenericQr('L1', ctx);
        expect(out.body.data.lot.labTest.lot).toMatchObject({ tested: false, latest: null });
    });

    test('LOT branch: a legacy FAILED column leaks neither the verdict nor the values', async () => {
        common.prisma.lot.findFirst.mockResolvedValue({
            lotNumber: 'L1', packageType: 'BOX', quantity: 1, unitWeight: 1,
            status: 'OK', packagedAt: null, expiryDate: null,
            testStatus: 'FAILED',
            thcContent: 0.29, cbdContent: null, moistureContent: null,
            labTestReportUrl: SECRET_REPORT_URL,
            batch: {
                batchNumber: 'B1', harvestDate: null, plantingDate: null,
                farm: { ...FARM },
                plant: { code: 'C' },
                cycle: { certificate: null },
            },
        });

        const out = await resolveTraceByGenericQr('L1', ctx);
        expectNoLabLeak(out.body);
        // FAILED is a verdict; the platform does not publish verdicts it did not
        // reach. Without an uploaded COA there is nothing to show either way.
        expect(out.body.data.lot.labTest.lot).toMatchObject({ tested: false });
    });
});
