/**
 * Guard: the public plot-cycle trace never touches the per-plant table.
 *
 * R8 (design note 2026-08-20-planting-tnt-design line 95:
 * "จำนวนต้น เป็นแค่ตัวเลขในข้อมูลรอบปลูก ไม่ใช่การติดตามรายหน่วย") retires per-plant
 * tracking. Resolution stops at planting cycle / plot and at Lot.
 *
 * This file used to assert a middle position that no longer exists: that
 * `data.plantUnits.total` be populated from the plot's declared
 * plannedPlantCount rather than from a live PlantUnit row count. On
 * 2026-08-25 the field itself was removed from the public body — a key named
 * after per-plant tracking, carrying a number that meant something else, is
 * the defect, not the fix.
 *
 * So the assertions here are now about ABSENCE, in two directions, because
 * either one alone can be re-added by accident:
 *   1. no `plantUnits` key in the response body, and
 *   2. no query against prisma.plantUnit — the mocks below stay wired up
 *      precisely so a re-added groupBy/count is caught rather than silently
 *      satisfied.
 * The declared plant count a scanner can read is `plot.plannedPlantCount`.
 *
 * Mocking pattern matches trace-resolve-legacy-batch-number-format.test.js:
 * mock services/trace-service/common (shared prisma/logger/qrcodeService) and
 * call the resolver function directly.
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

const mockTraceQrSecurityFindFirst = jest.fn();
const mockPlantingCyclePlotFindUnique = jest.fn();
const mockPlantUnitGroupBy = jest.fn();
const mockPlantUnitCount = jest.fn();
const mockHarvestBatchFindMany = jest.fn();

jest.mock('../../services/trace-service/common', () => ({
    prisma: {
        traceQrSecurity: { findFirst: (...args) => mockTraceQrSecurityFindFirst(...args) },
        plantingCyclePlot: { findUnique: (...args) => mockPlantingCyclePlotFindUnique(...args) },
        plantUnit: {
            groupBy: (...args) => mockPlantUnitGroupBy(...args),
            count: (...args) => mockPlantUnitCount(...args),
        },
        harvestBatch: { findMany: (...args) => mockHarvestBatchFindMany(...args) },
    },
    qrcodeService: {
        recordTraceScan: jest.fn().mockResolvedValue({ available: false, valid: null }),
        generatePublicTraceUrl: jest.fn((p) => `https://trace.test/${p}`),
    },
    logger: { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() },
    formatThaiDate: (d) => (d ? String(d) : null),
    parseJsonMetaFromNotes: jest.fn(() => null),
    normalizeSourceFromPayload: jest.fn(() => ({})),
    buildIntegrityPayload: jest.fn((integrity) => ({ available: Boolean(integrity?.available) })),
    SAFETY_DISCLAIMER: 'disclaimer',
    FDA_REFERRAL: 'fda',
    PLOT_HARVEST_META_PREFIX: 'PLOT_HARVEST_META:',
    TRACE_NOT_FOUND_MESSAGE: 'ไม่พบข้อมูล',
}));

const { resolveTraceByPlotCycleQr } = require('../../services/trace-service/resolve-plot-cycle');

const ctx = { requestIp: '127.0.0.1', userAgent: 'jest' };
const QR_CODE = 'PLOTQR-TEST-1';

const ASSIGNMENT = {
    id: 'cyclePlot-1',
    cycleId: 'cycle-1',
    plotId: 'plot-1',
    allocatedAreaSqm: 800,
    plannedPlantCount: 120, // <- the declared/planned count for this plot
    plot: { id: 'plot-1', name: 'แปลง A', solarSystem: 'OUTDOOR' },
    cycle: {
        id: 'cycle-1', cycleName: 'รอบที่ 1/2569', status: 'GROWING',
        startDate: new Date('2026-01-01'), expectedHarvestDate: new Date('2026-06-01'),
        cultivationType: 'SELF_GROWN',
        farm: { id: 'farm-1', farmName: 'ฟาร์มทดสอบ', district: 'd', province: 'p' },
        plantSpecies: { code: 'CANNABIS', nameTH: 'กัญชา', nameEN: 'Cannabis' },
    },
};

describe('resolveTraceByPlotCycleQr — the public plot page has no per-plant count', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockTraceQrSecurityFindFirst.mockResolvedValueOnce({
            id: 'sec-1', entityId: ASSIGNMENT.id, payload: null,
            publicUrl: `https://trace.test/plot-cycle/${QR_CODE}`, qrCode: QR_CODE,
        });
        mockPlantingCyclePlotFindUnique.mockResolvedValue(ASSIGNMENT);
        mockHarvestBatchFindMany.mockResolvedValue([]);
        // Deliberately generous: if the resolver ever asks the per-plant table
        // again it gets a plausible answer, so the failure below is the missing
        // assertion about the call, not an undefined-mock crash.
        mockPlantUnitGroupBy.mockResolvedValue([{ status: 'PLANTED', _count: { _all: 40 } }]);
        mockPlantUnitCount.mockResolvedValue(40);
    });

    it('publishes no plantUnits field — the plant count on the page is the declared plannedPlantCount', async () => {
        const result = await resolveTraceByPlotCycleQr(QR_CODE, ctx);

        expect(result.status).toBe(200);
        expect(result.body.data).not.toHaveProperty('plantUnits');
        // The one plant number a scanner can read is plot.plannedPlantCount. It
        // is present but withheld here because this fixture's species is cannabis:
        // the controlled-species redaction nulls the quantity signal. That the KEY
        // survives while plantUnits does not is the whole point — one field, on the
        // plot, meaning the declared plan.
        expect(result.body.data.plot).toHaveProperty('plannedPlantCount');
        expect(result.body.data.plot.plannedPlantCount).toBeNull();
    });

    it('never queries the per-plant table, even though rows would be returned if it did', async () => {
        await resolveTraceByPlotCycleQr(QR_CODE, ctx);

        expect(mockPlantUnitGroupBy).not.toHaveBeenCalled();
        expect(mockPlantUnitCount).not.toHaveBeenCalled();
    });

    it('does not link into the retired per-plant units tab', async () => {
        const result = await resolveTraceByPlotCycleQr(QR_CODE, ctx);

        expect(result.body.data.links).not.toHaveProperty('healthPlantingUnitsUrl');
    });
});
