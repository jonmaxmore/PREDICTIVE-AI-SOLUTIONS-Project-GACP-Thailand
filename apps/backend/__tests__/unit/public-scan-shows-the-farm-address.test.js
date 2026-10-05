/**
 * T12 — the public scan carries the farm's address now.
 *
 * SEC-CULT-001 held that an unauthenticated scanner may see only district and
 * province, never the street address or sub-district, because a QR code is
 * guessable and the address is the grower's home. That was the correct reading of
 * the privacy position then in force.
 *
 * The operator replaced that position on 2026-09-05: "ยังไม่ต้องสนใจกฎหมาย PDPA ให้
 * อัปโหลด COA และพวกชื่อฟาร์ม และที่อยู่ติดต่อได้ เมื่อสแกนต้องเห็นทั้งหมด". Recorded as a
 * demo-phase relaxation with a return date before ministry production —
 * tnt-data-scope.md §7 — in the same shape as the residency rule.
 *
 * ONE THING DID NOT MOVE, and it is asserted here rather than left implied. The
 * operator was asked directly about GPS coordinates and answered "ไม่เปิด". That is
 * a different question from privacy: sub-district tells a buyer where produce comes
 * from, coordinates walk a stranger to the plot, and cannabis plots are theft
 * targets. So `latitude` and `longitude` stay absent, and this file fails if they
 * ever appear.
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

const SECRET_COORD_LAT = 18.7654321;
const SECRET_COORD_LNG = 98.1234567;

const FARM = {
    id: 'farm-1', farmName: 'สวนสมุนไพรลุงมี', farmType: 'OUTDOOR',
    address: '99/1 หมู่ 4 ซอยลับ', subDistrict: 'สุเทพ',
    district: 'เมือง', province: 'เชียงใหม่', postalCode: '50200',
    latitude: SECRET_COORD_LAT, longitude: SECRET_COORD_LNG,
    status: 'ACTIVE',
};

function cycleRow() {
    return {
        id: 'cycle-1', uuid: 'cycle-1', farm: { ...FARM },
        plantSpecies: { code: 'CANNABIS', nameTH: 'กัญชา', nameEN: 'Cannabis', scientificName: 'Cannabis sativa' },
        certificate: null, batches: [],
        plotName: 'A1', plotArea: 1, areaUnit: 'rai', cultivationType: 'OUTDOOR',
        seedSource: null, soilType: null, irrigationType: null,
        cycleName: 'C1', cycleNumber: 1,
        startDate: null, expectedHarvestDate: null, actualHarvestDate: null,
        estimatedYield: null, actualYield: null, status: 'ACTIVE', varietyName: null,
    };
}

function batchRow() {
    return {
        id: 'batch-1', batchNumber: 'B1', harvestDate: null, plantingDate: null,
        farm: { ...FARM },
        plant: { code: 'CANNABIS', nameTH: 'กัญชา', nameEN: 'Cannabis', scientificName: 'Cannabis sativa' },
        cycle: { certificate: null },
        labResults: [],
    };
}

function lotRow() {
    return {
        lotNumber: 'L1', packageType: 'BOX', quantity: 1, unitWeight: 1,
        status: 'PACKAGED', packagedAt: null, expiryDate: null,
        batch: {
            batchNumber: 'B1', harvestDate: null, plantingDate: null,
            farm: { ...FARM },
            plant: { code: 'CANNABIS' },
            cycle: { certificate: null },
            labResults: [],
        },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    common.prisma.plantingCycle.findFirst.mockResolvedValue(null);
    common.prisma.harvestBatch.findFirst.mockResolvedValue(null);
    common.prisma.lot.findFirst.mockResolvedValue(null);
    common.prisma.batchLabResult.findMany.mockResolvedValue([]);
    common.qrcodeService.verifyTraceIntegrity.mockResolvedValue({ available: false, valid: null });
});

describe('the scan shows where the produce actually comes from', () => {
    test('the street address and sub-district reach an anonymous scanner', async () => {
        common.prisma.plantingCycle.findFirst.mockResolvedValue(cycleRow());
        const out = await resolveTraceByGenericQr('cycle-1', ctx);

        expect(out.status).toBe(200);
        expect(out.body.data.farm).toMatchObject({
            name: 'สวนสมุนไพรลุงมี',
            address: '99/1 หมู่ 4 ซอยลับ',
            subDistrict: 'สุเทพ',
            district: 'เมือง',
            province: 'เชียงใหม่',
        });
    });

    test('the coarse location line survives — it is what most readers actually use', async () => {
        common.prisma.plantingCycle.findFirst.mockResolvedValue(cycleRow());
        const out = await resolveTraceByGenericQr('cycle-1', ctx);
        expect(out.body.data.farm.location).toBe('เมือง, เชียงใหม่');
    });
});

describe('GPS coordinates stay closed — operator confirmed 2026-09-05', () => {
    test('latitude and longitude are ABSENT, not null', async () => {
        // Absent rather than null: a null tells the next reader the platform holds
        // the number and invites the change that fills it in.
        common.prisma.plantingCycle.findFirst.mockResolvedValue(cycleRow());
        const out = await resolveTraceByGenericQr('cycle-1', ctx);

        const serialized = JSON.stringify(out.body);
        expect(serialized).not.toContain('latitude');
        expect(serialized).not.toContain('longitude');
        expect(serialized).not.toContain(String(SECRET_COORD_LAT));
        expect(serialized).not.toContain(String(SECRET_COORD_LNG));
    });

    test('and not under another name either', async () => {
        common.prisma.plantingCycle.findFirst.mockResolvedValue(cycleRow());
        const out = await resolveTraceByGenericQr('cycle-1', ctx);
        const serialized = JSON.stringify(out.body);
        for (const spelling of ['"lat"', '"lng"', '"lon"', 'coordinates', 'geo']) {
            expect(serialized).not.toContain(spelling);
        }
    });

    test('the farm\'s internal id still never leaves', async () => {
        // Unrelated to the ruling and unchanged by it: an id is a handle for
        // enumeration, not information a scanner needs.
        common.prisma.plantingCycle.findFirst.mockResolvedValue(cycleRow());
        const out = await resolveTraceByGenericQr('cycle-1', ctx);
        expect(out.body.data.farm.id).toBeUndefined();
        expect(JSON.stringify(out.body)).not.toContain('farm-1');
    });

    // ── the gap this file had, found by pressing the button (2026-09-05) ──
    //
    // Every test above hands the resolver a farm object that already carries an
    // address, so they prove the PROJECTION publishes it and nothing more. On the
    // real database the address came back null, because none of the three queries
    // asked for the column — a Prisma `select` that omits a field returns undefined,
    // not an error, so the projection published `undefined ?? null` and the page
    // read as a farm that never recorded an address at all.
    //
    // Same class as the T8 select gap in the same batch. These tests read the
    // ARGUMENTS the resolver hands Prisma, per branch, so a future select cannot
    // quietly drop a column the ruling opened.
    describe.each([
        ['PLANTING_CYCLE', 'plantingCycle', () => cycleRow()],
        ['HARVEST_BATCH', 'harvestBatch', () => batchRow()],
        ['LOT', 'lot', () => lotRow()],
    ])('%s branch', (_label, model, row) => {
        test('asks the database for the columns the ruling opened', async () => {
            for (const m of ['plantingCycle', 'harvestBatch', 'lot']) {
                common.prisma[m].findFirst.mockResolvedValue(null);
            }
            common.prisma[model].findFirst.mockResolvedValue(row());
            await resolveTraceByGenericQr('x-1', ctx);

            const args = common.prisma[model].findFirst.mock.calls.at(-1)[0];
            const select = JSON.stringify(args);
            for (const column of ['address', 'subDistrict', 'postalCode']) {
                expect(select).toContain(`"${column}":true`);
            }
            // and still does NOT fetch the coordinates: not filtered afterwards,
            // never read out of the table in the first place.
            expect(select).not.toContain('"latitude":true');
            expect(select).not.toContain('"longitude":true');
        });
    });
});
