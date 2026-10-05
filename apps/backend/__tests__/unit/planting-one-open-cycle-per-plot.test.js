/**
 * R15 — one plot holds at most ONE open planting cycle at a time.
 *
 * Spec: design note 2026-08-20-planting-tnt-design:152
 *   "หนึ่งพื้นที่ปลูก มีรอบที่เปิดอยู่ได้ครั้งละหนึ่งรอบเท่านั้น ... ปิดรอบเดิม (ตัด) ก่อนจึงเริ่มรอบใหม่ได้ ...
 *    ทำให้คำว่า 'รอบปัจจุบัน' มีคำตอบเดียวเสมอ ... การตากของรอบก่อนหน้าเดินคู่ขนานได้ เพราะของออกจากที่ดินไปแล้ว
 *    ไม่นับเป็นรอบที่เปิดอยู่"
 *
 * WHY THIS IS NOT A TIDINESS RULE: two live "current" cycles on the same ground is the
 * shape of produce laundering — a second open cycle on a certified plot gives untracked
 * material a certified origin to be recorded against. Ledger F-G4-21 found it happening
 * for real: cycles f5a675aa... and b727d0f2... were both PLANTED on plot PLOT-BEJAD-M4SR7.
 *
 * The check lives in the SERVICE (planting-service), not in a route handler, so every door
 * that opens a cycle through the service inherits it — the audit-evidence chain taught this
 * repo that a rule enforced at one door is not enforced.
 *
 * WHAT IS SIMULATED: `makeDb()` is a hand-rolled stand-in for Prisma that understands only
 * the `where`/`select` shapes this service actually sends, and THROWS on anything else, so a
 * query shape the fake does not model can never pass silently. It is not Prisma; the real
 * client is exercised by the integration suites.
 */

'use strict';

let mockDb = null;

// planting-service captures `prisma` at require time; the proxy hands it whichever fake the
// running test installed. `$`-prefixed keys ($transaction) are client-level functions, not models.
jest.mock('../../services/prisma-database', () => ({
    prisma: new Proxy({}, {
        get: (_t, key) => {
            if (typeof key !== 'string') { return undefined; }
            if (key.startsWith('$')) { return (...args) => mockDb[key](...args); }
            return new Proxy({}, {
                get: (_m, action) => (...args) => {
                    if (!mockDb[key] || typeof mockDb[key][action] !== 'function') {
                        throw new Error(`fake prisma: unmodelled call prisma.${key}.${String(action)}()`);
                    }
                    return mockDb[key][action](...args);
                },
            });
        },
    }),
}));

const plantingService = require('../../services/planting-service');

const FARM_ID = 'farm-1';
const CERT_ID = 'cert-1';
const PLOT = { id: 'plot-bejad', name: 'PLOT-BEJAD-M4SR7', area: 1000, areaUnit: 'sqm', solarSystem: 'OUTDOOR' };
const OTHER_PLOT = { id: 'plot-other', name: 'แปลง B', area: 1000, areaUnit: 'sqm', solarSystem: 'OUTDOOR' };
const PLOTS = [PLOT, OTHER_PLOT];

function matchValue(value, cond) {
    if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
        if ('in' in cond) { return cond.in.includes(value); }
        if ('not' in cond) { return value !== cond.not; }
        throw new Error(`fake prisma: unmodelled condition ${JSON.stringify(cond)}`);
    }
    return value === cond;
}

function matchWhere(row, where = {}) {
    return Object.entries(where).every(([key, cond]) => {
        if (key === 'OR') { return cond.some((branch) => matchWhere(row, branch)); }
        if (key === 'cyclePlots') {
            if (!cond.some) { throw new Error('fake prisma: unmodelled cyclePlots filter'); }
            return (row.cyclePlots || []).some((cp) => matchWhere(cp, cond.some));
        }
        return matchValue(row[key], cond);
    });
}

function project(row, select) {
    if (!select) { return row; }
    const out = {};
    for (const [key, value] of Object.entries(select)) {
        if (value === true) { out[key] = row[key]; continue; }
        if (key === 'cyclePlots') { out[key] = (row.cyclePlots || []).map((cp) => project(cp, value.select)); continue; }
        throw new Error(`fake prisma: unmodelled select ${key}`);
    }
    return out;
}

/**
 * @param {Array} cycles rows already in the table: `{ id, cycleName, status, plotId?, cyclePlots?: [{plotId}] }`
 */
function makeDb(cycles = []) {
    const rows = cycles.map((c) => ({ isDeleted: false, farmId: FARM_ID, plotId: null, cyclePlots: [], ...c }));
    const store = {
        created: [],
        updated: [],
        cyclePlotWrites: [],
        farm: {
            findFirst: async () => ({ id: FARM_ID, ownerId: 'owner-1' }),
        },
        plot: {
            findMany: async ({ where }) => PLOTS.filter((p) => where.id.in.includes(p.id)),
        },
        certificate: {
            // ด่านขอบเขตอ่านด้วย findMany ตั้งแต่ 2026-09-11 (ใบล่าสุดใบเดียวเคยปิดกั้น
            // ฟาร์มที่ถือสองใบ) · คืนลิสต์ว่างที่นี่ = ฟาร์มยังไม่มีใบที่ "ยังมีผล" ⇒ ด่าน
            // ขอบเขตเงียบ ซึ่งเป็นสิ่งที่เทสชุดนี้ต้องการ: มันตรึงกติกา R15 (หนึ่งแปลง
            // หนึ่งรอบที่เปิดอยู่) ไม่ใช่กติกาขอบเขตของใบรับรอง
            findMany: async () => [],
            findFirst: async () => ({ id: CERT_ID }),
            findUnique: async () => ({ id: CERT_ID, status: 'active', expiryDate: null, farmId: FARM_ID }),
        },
        plantingCycle: {
            findMany: async ({ where, select }) => rows.filter((r) => matchWhere(r, where)).map((r) => project(r, select)),
            findUnique: async ({ where }) => {
                const row = rows.find((r) => r.id === where.id);
                return row ? { _count: { batches: 0 }, ...row } : null;
            },
            create: async ({ data }) => {
                const row = { id: `cycle-created-${store.created.length + 1}`, ...data };
                store.created.push(row);
                return row;
            },
            update: async ({ where, data }) => {
                store.updated.push({ id: where.id, data });
                return { id: where.id, ...data };
            },
        },
        plantingCyclePlot: {
            createMany: async ({ data }) => { store.cyclePlotWrites.push(...data); return { count: data.length }; },
            deleteMany: async () => ({ count: 0 }),
        },
        $transaction: async (fn) => fn(store),
    };
    return store;
}

const CREATE_PAYLOAD = {
    farmId: FARM_ID,
    plantSpeciesId: 'species-1',
    cycleName: 'รอบที่ 2/2569',
    startDate: '2026-08-25',
    plotAssignments: [{ plotId: PLOT.id, allocatedAreaSqm: 500, plannedPlantCount: 100 }],
};

afterEach(() => { mockDb = null; });

describe('R15 — createCycle refuses a plot that already carries an open cycle', () => {
    test('a PLANTED cycle on the plot blocks the new one, and nothing is written', async () => {
        mockDb = makeDb([
            { id: 'cycle-open-1', cycleName: 'รอบที่ 1/2569', status: 'PLANTED', cyclePlots: [{ plotId: PLOT.id }] },
        ]);

        await expect(plantingService.createCycle(CREATE_PAYLOAD)).rejects.toMatchObject({
            code: 'PLOT_ALREADY_HAS_OPEN_CYCLE',
            statusCode: 409,
            plotId: PLOT.id,
            conflictingCycleId: 'cycle-open-1',
        });

        expect(mockDb.created).toHaveLength(0);
        expect(mockDb.cyclePlotWrites).toHaveLength(0);
    });

    test('the message names the plot and the cycle holding it, so the farmer knows what to close', async () => {
        mockDb = makeDb([
            { id: 'cycle-open-1', cycleName: 'รอบที่ 1/2569', status: 'GROWING', cyclePlots: [{ plotId: PLOT.id }] },
        ]);

        const error = await plantingService.createCycle(CREATE_PAYLOAD).catch((e) => e);

        expect(error.message).toContain(PLOT.name);
        expect(error.message).toContain('รอบที่ 1/2569');
    });

    test('a legacy cycle bound only through PlantingCycle.plotId blocks it too', async () => {
        // Rows written before PlantingCyclePlot existed (and the auto-trace / e2e paths) carry the
        // plot on the deprecated scalar only. Reading just the join table would leave the oldest
        // rows in the dataset double-bookable.
        mockDb = makeDb([
            { id: 'cycle-legacy', cycleName: 'รอบเก่า', status: 'READY_HARVEST', plotId: PLOT.id, cyclePlots: [] },
        ]);

        await expect(plantingService.createCycle(CREATE_PAYLOAD)).rejects.toMatchObject({
            code: 'PLOT_ALREADY_HAS_OPEN_CYCLE',
            conflictingCycleId: 'cycle-legacy',
        });
    });

    test('a HARVESTED cycle does NOT occupy the plot, drying runs in parallel (R15)', async () => {
        mockDb = makeDb([
            { id: 'cycle-harvested', cycleName: 'รอบที่ 1/2569', status: 'HARVESTED', cyclePlots: [{ plotId: PLOT.id }] },
        ]);

        const created = await plantingService.createCycle(CREATE_PAYLOAD);

        expect(created.id).toBe('cycle-created-1');
        expect(mockDb.created).toHaveLength(1);
    });

    test('a COMPLETED cycle and a soft-deleted open cycle do not occupy the plot either', async () => {
        mockDb = makeDb([
            { id: 'cycle-completed', cycleName: 'รอบที่ 1/2569', status: 'COMPLETED', cyclePlots: [{ plotId: PLOT.id }] },
            { id: 'cycle-deleted', cycleName: 'รอบที่ 2/2569', status: 'PLANTED', isDeleted: true, cyclePlots: [{ plotId: PLOT.id }] },
        ]);

        await expect(plantingService.createCycle(CREATE_PAYLOAD)).resolves.toMatchObject({ id: 'cycle-created-1' });
    });

    test('an open cycle on a DIFFERENT plot does not block this plot', async () => {
        mockDb = makeDb([
            { id: 'cycle-elsewhere', cycleName: 'รอบที่ 1/2569', status: 'PLANTED', cyclePlots: [{ plotId: OTHER_PLOT.id }] },
        ]);

        await expect(plantingService.createCycle(CREATE_PAYLOAD)).resolves.toMatchObject({ id: 'cycle-created-1' });
    });

    test('a free plot still creates normally', async () => {
        mockDb = makeDb([]);

        await expect(plantingService.createCycle(CREATE_PAYLOAD)).resolves.toMatchObject({
            id: 'cycle-created-1',
            plotCount: 1,
        });
    });
});

describe('R15 — updateCycle cannot move a cycle onto an occupied plot', () => {
    test('re-assigning onto a plot held by another open cycle is refused', async () => {
        mockDb = makeDb([
            { id: 'cycle-mine', cycleName: 'รอบของฉัน', status: 'PLANTED', cyclePlots: [{ plotId: OTHER_PLOT.id }] },
            { id: 'cycle-open-1', cycleName: 'รอบที่ 1/2569', status: 'PLANTED', cyclePlots: [{ plotId: PLOT.id }] },
        ]);

        await expect(plantingService.updateCycle('cycle-mine', {
            plotAssignments: [{ plotId: PLOT.id, allocatedAreaSqm: 500, plannedPlantCount: 100 }],
        })).rejects.toMatchObject({
            code: 'PLOT_ALREADY_HAS_OPEN_CYCLE',
            conflictingCycleId: 'cycle-open-1',
        });

        expect(mockDb.updated).toHaveLength(0);
    });

    test('a cycle keeping its own plot is not blocked by itself', async () => {
        mockDb = makeDb([
            { id: 'cycle-mine', cycleName: 'รอบของฉัน', status: 'PLANTED', cyclePlots: [{ plotId: PLOT.id }] },
        ]);

        await expect(plantingService.updateCycle('cycle-mine', {
            plotAssignments: [{ plotId: PLOT.id, allocatedAreaSqm: 600, plannedPlantCount: 120 }],
        })).resolves.toBeDefined();

        expect(mockDb.updated).toHaveLength(1);
    });
});
