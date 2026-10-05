/**
 * B-PLANTING item 4 (backlog #84 / B3): the PUBLIC trace search page
 * (apps/web-app/src/app/trace/client-view.tsx) pushes whatever code the
 * visitor types to `/trace/<code>`, which fetches `GET /api/trace/:qrCode`
 * — resolveTraceByGenericQr(). That cascade only ever tried PlantingCycle
 * -> HarvestBatch -> Lot -> 404 (services/trace-service/resolve-generic.js);
 * a plot-cycle code (entityType PLANTING_CYCLE_PLOT, resolved by the
 * SEPARATE resolveTraceByPlotCycleQr() behind the dedicated
 * `/api/trace/plot-cycle/:qrCode` route that a real QR SCAN opens via
 * /trace/plot-cycle/[qr-code]) never matched any of those three, so typing
 * or navigating to a perfectly valid plot-cycle code through the generic
 * path always 404'd — "ไม่พบข้อมูลผลิตภัณฑ์" for a real product.
 *
 * Fix: resolveTraceByGenericQr now falls back to resolveTraceByPlotCycleQr
 * (the SAME resolver a QR scan uses) after Lot also misses, before
 * returning 404 — so manual entry resolves to the IDENTICAL projection
 * (`type: 'PLOT_CYCLE'`, same shape) instead of a false 404. R9 exposure
 * limits (existence + lab name only) are untouched — this only adds a
 * lookup path, not new fields.
 */
'use strict';

jest.mock('../../server', () => ({ prisma: {} }));
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue(undefined) },
    AuditCategory: { SYSTEM: 'SYSTEM' },
    AuditSeverity: { INFO: 'INFO' },
    ResourceType: { SYSTEM: 'SYSTEM' },
}));

// evaluateCertGate below is pulled out of the REAL common.js via jest.requireActual —
// it's the one piece of that module this test wants unmocked. But requireActual loads
// common.js's own top-level `require('../qrcode/qrcode-service')` for real too, and that
// constructs the real SignatureService singleton, whose constructor fires an unawaited
// background `initialize()` (real RSA key I/O). This test's two assertions finish and
// tear down long before that promise settles, so it later tries to `require()` through
// this file's already-torn-down module registry — "You are trying to `import` a file
// after the Jest environment has been torn down", from THIS file (measured 2026-09-26,
// fix round 1: reproducible under Node 24, timing-masked under Node 20 — same defect
// either way per services/crypto/signature-service.js's own doc comment: "a test that
// only needs issuance to get past signing mocks the service"). This test never signs
// anything, so stub the singleton out from under the real common.js before requireActual
// ever runs.
jest.mock('../../services/crypto/signature-service', () => ({
    getSignatureService: () => ({ ensureInitialized: jest.fn().mockResolvedValue(undefined) }),
    initializeSignatureService: jest.fn().mockResolvedValue({}),
    SignatureService: jest.fn(),
    fingerprintPublicKey: jest.fn(),
    DEFAULT_KEY_DIR: '/tmp',
}));

const mockPlantingCycleFindFirst = jest.fn();
const mockHarvestBatchFindFirst = jest.fn();
const mockLotFindFirst = jest.fn();
const mockTraceQrSecurityFindFirst = jest.fn();
const mockPlantingCyclePlotFindUnique = jest.fn();
const mockPlantUnitGroupBy = jest.fn();
const mockHarvestBatchFindMany = jest.fn();

jest.mock('../../services/trace-service/common', () => ({
    prisma: {
        plantingCycle: { findFirst: (...args) => mockPlantingCycleFindFirst(...args) },
        harvestBatch: {
            findFirst: (...args) => mockHarvestBatchFindFirst(...args),
            findMany: (...args) => mockHarvestBatchFindMany(...args),
        },
        lot: { findFirst: (...args) => mockLotFindFirst(...args) },
        traceQrSecurity: { findFirst: (...args) => mockTraceQrSecurityFindFirst(...args) },
        plantingCyclePlot: { findUnique: (...args) => mockPlantingCyclePlotFindUnique(...args) },
        plantUnit: { groupBy: (...args) => mockPlantUnitGroupBy(...args) },
    },
    qrcodeService: {
        verifyTraceIntegrity: jest.fn().mockResolvedValue(null),
        recordTraceScan: jest.fn().mockResolvedValue({ available: false, valid: null }),
        generatePublicTraceUrl: jest.fn((p) => `https://trace.test/${p}`),
    },
    logger: { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() },
    formatCultivationType: (x) => x || '',
    formatThaiDate: (d) => (d ? String(d) : null),
    parseJsonMetaFromNotes: jest.fn(() => null),
    normalizeSourceFromPayload: jest.fn(() => ({})),
    buildIntegrityPayload: jest.fn((integrity) => ({ available: Boolean(integrity?.available) })),
    SAFETY_DISCLAIMER: 'disclaimer',
    FDA_REFERRAL: 'fda',
    PLOT_HARVEST_META_PREFIX: 'PLOT_HARVEST_META:',
    TRACE_NOT_FOUND_MESSAGE: 'ไม่พบข้อมูล',
    evaluateCertGate: jest.requireActual('../../services/trace-service/common').evaluateCertGate,
}));

const { resolveTraceByGenericQr } = require('../../services/trace-service/resolve-generic');

const ctx = { requestIp: '127.0.0.1', userAgent: 'jest' };
const QR_CODE = 'PLOTQR-TYPED-BY-HAND';

const ASSIGNMENT = {
    id: 'cyclePlot-1',
    cycleId: 'cycle-1',
    plotId: 'plot-1',
    allocatedAreaSqm: 800,
    plannedPlantCount: 120,
    plot: { id: 'plot-1', name: 'แปลง A', solarSystem: 'OUTDOOR' },
    cycle: {
        id: 'cycle-1', cycleName: 'รอบที่ 1/2569', status: 'GROWING',
        startDate: new Date('2026-01-01'), expectedHarvestDate: new Date('2026-06-01'),
        cultivationType: 'SELF_GROWN',
        farm: { id: 'farm-1', farmName: 'ฟาร์มทดสอบ', district: 'd', province: 'p' },
        plantSpecies: { code: 'CANNABIS', nameTH: 'กัญชา', nameEN: 'Cannabis' },
    },
};

describe('resolveTraceByGenericQr — falls back to plot-cycle resolution', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // The 3 existing entity lookups all miss — this is what a
        // plot-cycle code hitting the GENERIC path looks like today.
        mockPlantingCycleFindFirst.mockResolvedValue(null);
        mockHarvestBatchFindFirst.mockResolvedValue(null);
        mockLotFindFirst.mockResolvedValue(null);
    });

    it('resolves a plot-cycle code to the SAME PLOT_CYCLE projection a real QR scan gets, instead of 404', async () => {
        mockTraceQrSecurityFindFirst.mockResolvedValueOnce({
            id: 'sec-1', entityId: ASSIGNMENT.id, payload: null,
            publicUrl: `https://trace.test/plot-cycle/${QR_CODE}`, qrCode: QR_CODE,
        });
        mockPlantingCyclePlotFindUnique.mockResolvedValue(ASSIGNMENT);
        mockPlantUnitGroupBy.mockResolvedValue([]);
        mockHarvestBatchFindMany.mockResolvedValue([]);

        const result = await resolveTraceByGenericQr(QR_CODE, ctx);

        expect(result.status).toBe(200);
        expect(result.body.type).toBe('PLOT_CYCLE');
        expect(result.body.data.plot.id).toBe('plot-1');

        // 2026-08-24: the fixture species is CANNABIS, which PlantSpecies.requiresLicense
        // marks as controlled, so the plot projection now withholds the quantity and the
        // farm's identifying details (see redactPublicPlotPayload in resolve-plot-cycle.js).
        //
        // Asserting the redacted shape HERE rather than swapping the fixture for a
        // non-controlled species is deliberate: it makes this test prove two things at
        // once — that the generic fallback reaches the same projection as a direct scan,
        // and that the redaction applies on the fallback route too. A redaction that held
        // on the direct route and leaked through the fallback would be a bypass, and this
        // is the test that would catch it.
        // No per-plant count in the projection (R8, 2026-08-25); the withheld
        // quantity signal for a controlled species is plannedPlantCount.
        expect(result.body.data).not.toHaveProperty('plantUnits');
        expect(result.body.data.plot.plannedPlantCount).toBeNull();
        // Farm identity is OPEN on every public door (operator ruling 2026-09-06,
        // F-WALK-04) — the fallback must carry the same open identity the direct
        // route carries, and the same withheld forecast.
        expect(result.body.data.farm.name).toBe('ฟาร์มทดสอบ');
        expect(result.body.data.cycle.expectedHarvestDate).toBeNull();
    });

    it('still 404s (with the full generic not-found body) when NOTHING matches at all', async () => {
        mockTraceQrSecurityFindFirst.mockResolvedValue(null);
        mockPlantingCyclePlotFindUnique.mockResolvedValue(null);

        const result = await resolveTraceByGenericQr('TOTALLY-UNKNOWN-CODE', ctx);

        expect(result.status).toBe(404);
        expect(result.body.success).toBe(false);
        // Regression guard: the generic 404 shape (disclaimers/referrals),
        // not the bare plot-cycle-resolver 404 shape, must still be used
        // when truly nothing resolves.
        expect(result.body.disclaimers).toBeDefined();
        expect(result.body.referrals).toBeDefined();
    });
});
