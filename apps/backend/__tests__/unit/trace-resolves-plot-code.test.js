/**
 * The sign in the field carries the PLOT code — and scanning it works.
 *
 * มกษ. 3502-2561 ข้อ 8(1) asks for "รหัสแปลงปลูกและข้อมูลประจำแปลงปลูก"
 * (docs/standards/tas-3502-2561-records-and-traceability.md). Layer 1 added the
 * column (Plot.plotCode, prisma/schema/farm.prisma:243) and the generator
 * (shared/plot-code.js). Nothing READ it yet: resolveTraceByPlotCycleQr only knew
 * TraceQrSecurity rows of entityType PLANTING_CYCLE_PLOT, which are unique per
 * (cycle, plot) — so the only scannable identifier died with the season.
 *
 * These tests state what a scan of the permanent sign must do:
 *   - resolve to the SAME projection an old cycle-plot QR resolves to, via the plot's
 *     one open cycle (R15 guarantees at most one, so nobody picks a season);
 *   - survive bad transcription (lowercase, stray spaces) — the sign is the source of
 *     truth and people read it down a phone;
 *   - answer honestly between harvest and the next planting, when the plot has NO open
 *     cycle — a real and frequent state where 404 would be a lie about real land;
 *   - go quiet when the sign has been revoked;
 *   - redact a controlled species here exactly as on every other route;
 *   - leave every existing QR resolving.
 *
 * Mocking pattern follows trace-plot-cycle-plant-count-ssot.test.js: mock
 * services/trace-service/common and call the resolver directly.
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

const mockPlotFindUnique = jest.fn();
const mockCyclePlotFindFirst = jest.fn();
const mockCyclePlotFindUnique = jest.fn();
const mockTraceQrSecurityFindFirst = jest.fn();
const mockTraceQrSecurityFindMany = jest.fn();
const mockPlantUnitGroupBy = jest.fn();
const mockHarvestBatchFindMany = jest.fn();

jest.mock('../../services/trace-service/common', () => ({
    prisma: {
        plot: { findUnique: (...args) => mockPlotFindUnique(...args) },
        plantingCyclePlot: {
            findFirst: (...args) => mockCyclePlotFindFirst(...args),
            findUnique: (...args) => mockCyclePlotFindUnique(...args),
        },
        traceQrSecurity: {
            findFirst: (...args) => mockTraceQrSecurityFindFirst(...args),
            findMany: (...args) => mockTraceQrSecurityFindMany(...args),
        },
        plantUnit: { groupBy: (...args) => mockPlantUnitGroupBy(...args) },
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

// A real-shaped code from the Layer 1 alphabet (shared/plot-code.js).
const PLOT_CODE = 'PLOT-7F2KX-M9QRT';

const PLOT_ROW = {
    id: 'plot-1',
    plotCode: PLOT_CODE,
    name: 'แปลงหลังบ้าน',
    area: 1600,
    areaUnit: 'sqm',
    solarSystem: 'OUTDOOR',
    qrIssuedAt: new Date('2026-08-24'),
    qrRevokedAt: null,
    farm: { id: 'farm-1', farmName: 'ฟาร์มทดสอบ', district: 'เมือง', province: 'เชียงใหม่' },
};

function assignmentWith(species) {
    return {
        id: 'cyclePlot-1',
        cycleId: 'cycle-1',
        plotId: 'plot-1',
        allocatedAreaSqm: 800,
        plannedPlantCount: 120,
        plot: { id: 'plot-1', name: 'แปลงหลังบ้าน', solarSystem: 'OUTDOOR', plotCode: PLOT_CODE },
        cycle: {
            id: 'cycle-1',
            cycleName: 'รอบที่ 1/2569',
            status: 'GROWING',
            startDate: new Date('2026-01-01'),
            expectedHarvestDate: new Date('2026-06-01'),
            cultivationType: 'SELF_GROWN',
            farm: { id: 'farm-1', farmName: 'ฟาร์มทดสอบ', district: 'เมือง', province: 'เชียงใหม่' },
            plantSpecies: species,
        },
    };
}

const TURMERIC = { code: 'TURMERIC', nameTH: 'ขมิ้นชัน', nameEN: 'Turmeric', requiresLicense: false };
const CANNABIS = { code: 'CANNABIS', nameTH: 'กัญชา', nameEN: 'Cannabis', requiresLicense: true };

beforeEach(() => {
    jest.clearAllMocks();
    mockPlotFindUnique.mockResolvedValue(null);
    mockCyclePlotFindFirst.mockResolvedValue(null);
    mockCyclePlotFindUnique.mockResolvedValue(null);
    mockTraceQrSecurityFindFirst.mockResolvedValue(null);
    mockTraceQrSecurityFindMany.mockResolvedValue([]);
    mockPlantUnitGroupBy.mockResolvedValue([]);
    mockHarvestBatchFindMany.mockResolvedValue([]);
});

describe('resolveTraceByPlotCycleQr — the permanent plot code resolves', () => {
    it('resolves a plot code through the plot\'s open cycle to the same PLOT_CYCLE projection', async () => {
        mockPlotFindUnique.mockResolvedValue(PLOT_ROW);
        mockCyclePlotFindFirst.mockResolvedValue(assignmentWith(TURMERIC));

        const result = await resolveTraceByPlotCycleQr(PLOT_CODE, ctx);

        expect(result.status).toBe(200);
        expect(result.body.type).toBe('PLOT_CYCLE');
        expect(result.body.data.plot.id).toBe('plot-1');
        expect(result.body.data.cycle.id).toBe('cycle-1');
        expect(result.body.data.source.plot.cyclePlotId).toBe('cyclePlot-1');
        // The code that was scanned comes back, so a reader can check the page
        // against the sign in front of them.
        expect(result.body.data.plotCode).toBe(PLOT_CODE);
        expect(result.body.data.hasOpenCycle).toBe(true);
        // Not controlled: the real values are published, as on every other route.
        // The plant count a scanner reads is the declared plannedPlantCount on the
        // plot — there is no per-plant count in the body since R8 retired per-plant
        // tracking (2026-08-25).
        expect(result.body.data).not.toHaveProperty('plantUnits');
        expect(result.body.data.plot.plannedPlantCount).toBe(120);
        expect(result.body.data.farm.name).toBe('ฟาร์มทดสอบ');
    });

    it('looks up the plot by the NORMALISED code when it was transcribed badly', async () => {
        mockPlotFindUnique.mockResolvedValue(PLOT_ROW);
        mockCyclePlotFindFirst.mockResolvedValue(assignmentWith(TURMERIC));

        const result = await resolveTraceByPlotCycleQr('  plot-7f2kx-m9qrt ', ctx);

        expect(result.status).toBe(200);
        expect(result.body.type).toBe('PLOT_CYCLE');
        expect(mockPlotFindUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { plotCode: PLOT_CODE } }),
        );
    });

    it('asks only for an OPEN cycle — a harvested season must not answer the sign', async () => {
        mockPlotFindUnique.mockResolvedValue(PLOT_ROW);
        mockCyclePlotFindFirst.mockResolvedValue(assignmentWith(TURMERIC));

        await resolveTraceByPlotCycleQr(PLOT_CODE, ctx);

        const where = mockCyclePlotFindFirst.mock.calls[0][0].where;
        expect(where.plotId).toBe('plot-1');
        const statuses = where.cycle.status.in;
        expect(statuses).toEqual(expect.arrayContaining(['PLANNING', 'PLANTED', 'GROWING', 'READY_HARVEST']));
        expect(statuses).not.toContain('HARVESTED');
        expect(statuses).not.toContain('COMPLETED');
    });

    it('redacts a controlled species on the plot-code path exactly as on the QR path', async () => {
        mockPlotFindUnique.mockResolvedValue(PLOT_ROW);
        mockCyclePlotFindFirst.mockResolvedValue(assignmentWith(CANNABIS));

        const result = await resolveTraceByPlotCycleQr(PLOT_CODE, ctx);

        expect(result.status).toBe(200);
        // No per-plant count to redact any more (R8, 2026-08-25) — the quantity
        // signal that IS withheld for a controlled species is plannedPlantCount.
        expect(result.body.data).not.toHaveProperty('plantUnits');
        // WITHHELD — the readiness forecast, the quantity signals, the plot's handle
        expect(result.body.data.plot.plannedPlantCount).toBeNull();
        expect(result.body.data.plot.allocatedAreaSqm).toBeNull();
        expect(result.body.data.plot.name).toBeNull();
        expect(result.body.data.cycle.expectedHarvestDate).toBeNull();
        expect(result.body.data.cycle.expectedHarvestDateTH).toBeNull();
        expect(result.body.data.source.plot.plotName).toBeNull();
        // OPEN — the farm's identity. Operator ruling 2026-09-06 (F-WALK-04) put it back:
        // the lot and batch doors print this same farm in full, and three public doors
        // disagreeing about one farm was the defect. This suite still asserted the
        // pre-ruling masking and had been failing ever since.
        expect(result.body.data.farm.name).toBe('ฟาร์มทดสอบ');
        expect(result.body.data.farm.district).not.toBeNull();
    });
});

describe('resolveTraceByPlotCycleQr — the plot between two seasons', () => {
    it('answers with the PLOT, not a 404, when there is no open cycle', async () => {
        mockPlotFindUnique.mockResolvedValue(PLOT_ROW);
        mockCyclePlotFindFirst.mockResolvedValue(null);

        const result = await resolveTraceByPlotCycleQr(PLOT_CODE, ctx);

        expect(result.status).toBe(200);
        expect(result.body.success).toBe(true);
        expect(result.body.type).toBe('PLOT');
        expect(result.body.data.plotCode).toBe(PLOT_CODE);
        expect(result.body.data.hasOpenCycle).toBe(false);
        expect(result.body.data.cycle).toBeNull();
        expect(typeof result.body.message).toBe('string');
        // The URL it hands out must be one that actually renders this shape — the
        // plot-cycle page — not the generic /trace/<code> page, which reads fields a plot
        // projection does not have.
        expect(result.body.data.trackingUrl).toBe(`https://trace.test/plot-cycle/${PLOT_CODE}`);
    });

    it('names the farm but not the plot on the dormant page — species unknown means controlled', async () => {
        mockPlotFindUnique.mockResolvedValue(PLOT_ROW);
        mockCyclePlotFindFirst.mockResolvedValue(null);

        const result = await resolveTraceByPlotCycleQr(PLOT_CODE, ctx);

        // Unknown species is still treated as controlled — the redaction runs. What it
        // withholds since F-WALK-04 is the plot handle and the forecasts, not the farm.
        expect(result.body.data.farm.name).toBe('ฟาร์มทดสอบ');
        expect(result.body.data.farm.district).not.toBeNull();
        expect(result.body.data.plot.name).toBeNull();
        // The dormant page carries no per-plant count at all (R8, 2026-08-25);
        // nothing is allocated or planted between cycles either way.
        expect(result.body.data).not.toHaveProperty('plantUnits');
        expect(result.body.data.plot.plannedPlantCount).toBeNull();
        expect(result.body.data.farm.province).toBe('เชียงใหม่');
    });
});

describe('resolveTraceByPlotCycleQr — a revoked sign', () => {
    it('410s and publishes nothing about the land', async () => {
        mockPlotFindUnique.mockResolvedValue({ ...PLOT_ROW, qrRevokedAt: new Date('2026-08-20') });

        const result = await resolveTraceByPlotCycleQr(PLOT_CODE, ctx);

        expect(result.status).toBe(410);
        expect(result.body.success).toBe(false);
        expect(result.body.verification.reason).toBe('plot_sign_revoked');
        expect(result.body.data).toBeUndefined();
        expect(JSON.stringify(result.body)).not.toContain('ฟาร์มทดสอบ');
        expect(JSON.stringify(result.body)).not.toContain('แปลงหลังบ้าน');
        // No cycle lookup at all: a revoked sign stops before it reads the land.
        expect(mockCyclePlotFindFirst).not.toHaveBeenCalled();
    });
});

describe('resolveTraceByPlotCycleQr — nothing existing may break', () => {
    it('still resolves a legacy cycle-plot QR without ever touching the plot-code path', async () => {
        const LEGACY_QR = '6f1a3d0c-9c4e-4a3f-8b21-2b0d5f7e1a44';
        mockTraceQrSecurityFindFirst.mockResolvedValueOnce({
            id: 'sec-1',
            entityId: 'cyclePlot-1',
            payload: null,
            publicUrl: `https://trace.test/plot-cycle/${LEGACY_QR}`,
            qrCode: LEGACY_QR,
        });
        mockCyclePlotFindUnique.mockResolvedValue(assignmentWith(TURMERIC));

        const result = await resolveTraceByPlotCycleQr(LEGACY_QR, ctx);

        expect(result.status).toBe(200);
        expect(result.body.type).toBe('PLOT_CYCLE');
        expect(result.body.data.cycle.id).toBe('cycle-1');
        expect(mockPlotFindUnique).not.toHaveBeenCalled();
    });

    it('falls through to the legacy cascade when a well-formed code matches no plot', async () => {
        mockPlotFindUnique.mockResolvedValue(null);

        const result = await resolveTraceByPlotCycleQr('PLOT-22222-33333', ctx);

        expect(mockPlotFindUnique).toHaveBeenCalled();
        expect(result.status).toBe(404);
        expect(result.body.success).toBe(false);
    });
});
