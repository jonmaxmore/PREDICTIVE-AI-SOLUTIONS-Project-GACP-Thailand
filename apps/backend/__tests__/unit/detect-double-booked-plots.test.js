/**
 * The R15 detector must find a double-booked plot through EITHER binding.
 *
 * Enforcement of "one plot, one open cycle" lives in planting-service, and the operator
 * declined the database constraint that was proposed to back it up: a plot binds to a cycle
 * two ways — the legacy scalar `PlantingCycle.plotId` and the join table `PlantingCyclePlot`
 * that the wizard actually writes — so a partial unique index on plantingCycle(plotId) would
 * have covered the legacy half only while looking like a guarantee. The detector replaces it,
 * which means the detector inherits the same trap: a version that read one binding would
 * report clean over a real violation and be worse than nothing.
 *
 * So the cases below are not symmetric decoration. "Join table only" and "legacy scalar only"
 * are the two halves that must BOTH be seen, and HARVESTED / soft-deleted are the two ways a
 * cycle stops occupying the ground (R15: drying the previous round runs in parallel, the
 * goods have left the land).
 *
 * WHAT IS SIMULATED: `makeFakePrisma()` understands only the two `where`/`select` shapes the
 * detector actually sends and THROWS on anything else, so a query the fake does not model can
 * never pass silently. The filters are applied for real, so a detector that dropped
 * `isDeleted:false` or the status filter fails here rather than going quietly green.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const detector = require('../../scripts/detect-double-booked-plots');

const OPEN = detector.readOpenCycleStatuses();

const PLOT_A = { id: 'plot-a', name: 'แปลง A', plotCode: 'PLOT-BEJAD-M4SR7', farmId: 'farm-1' };
const PLOT_B = { id: 'plot-b', name: 'แปลง B', plotCode: 'PLOT-BEJAD-9QK2T', farmId: 'farm-1' };
const PLOTS = [PLOT_A, PLOT_B];

function matchWhere(row, where) {
    return Object.entries(where).every(([key, cond]) => {
        if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
            if ('in' in cond) { return cond.in.includes(row[key]); }
            throw new Error(`fake prisma: unmodelled condition on ${key}: ${JSON.stringify(cond)}`);
        }
        return row[key] === cond;
    });
}

function project(row, select) {
    if (!select) { throw new Error('fake prisma: the detector must always select explicitly'); }
    const out = {};
    for (const [key, value] of Object.entries(select)) {
        if (value === true) { out[key] = row[key]; continue; }
        if (key === 'cyclePlots') {
            out[key] = (row.cyclePlots || []).map((cp) => project(cp, value.select));
            continue;
        }
        throw new Error(`fake prisma: unmodelled select ${key}`);
    }
    return out;
}

/**
 * @param {Array} cycles rows in planting_cycles: `{ id, cycleName, status, startDate,
 *   plotId?, isDeleted?, cyclePlots?: [{ plotId }] }`
 */
function makeFakePrisma(cycles) {
    const rows = cycles.map((c) => ({
        isDeleted: false,
        plotId: null,
        cyclePlots: [],
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        ...c,
    }));
    const models = {
        plantingCycle: {
            findMany: async ({ where, select }) => rows.filter((r) => matchWhere(r, where)).map((r) => project(r, select)),
        },
        plot: {
            findMany: async ({ where, select }) => PLOTS.filter((p) => matchWhere(p, where)).map((p) => project(p, select)),
        },
    };
    return new Proxy({}, {
        get: (_t, model) => {
            if (typeof model !== 'string') { return undefined; }
            if (!models[model]) { throw new Error(`fake prisma: unmodelled model prisma.${model}`); }
            return new Proxy({}, {
                get: (_m, action) => {
                    if (typeof models[model][action] !== 'function') {
                        throw new Error(`fake prisma: unmodelled call prisma.${model}.${String(action)}()`);
                    }
                    return models[model][action];
                },
            });
        },
    });
}

const run = (cycles) => detector.findDoubleBookedPlots(makeFakePrisma(cycles), OPEN);

describe('R15 detector — what counts as a violation', () => {
    test('a clean dataset reports zero violations and says so out loud', async () => {
        const result = await run([
            { id: 'cycle-1', cycleName: 'รอบที่ 1/2569', status: 'PLANTED', cyclePlots: [{ plotId: PLOT_A.id }] },
            { id: 'cycle-2', cycleName: 'รอบที่ 1/2569 (B)', status: 'GROWING', cyclePlots: [{ plotId: PLOT_B.id }] },
        ]);

        expect(result.violations).toEqual([]);
        expect(result.cyclesScanned).toBe(2);
        expect(result.plotsBound).toBe(2);
        // Silence from a detector is indistinguishable from a detector that never ran.
        expect(detector.formatReport(result).join('\n')).toContain('CLEAN');
    });

    test('two open cycles bound through the JOIN TABLE are caught', async () => {
        const result = await run([
            { id: 'cycle-1', cycleName: 'รอบที่ 1/2569', status: 'PLANTED', cyclePlots: [{ plotId: PLOT_A.id }] },
            { id: 'cycle-2', cycleName: 'รอบที่ 2/2569', status: 'PLANNING', cyclePlots: [{ plotId: PLOT_A.id }] },
        ]);

        expect(result.violations).toHaveLength(1);
        expect(result.violations[0].plotId).toBe(PLOT_A.id);
        expect(result.violations[0].cycles.map((c) => c.id).sort()).toEqual(['cycle-1', 'cycle-2']);
    });

    test('two open cycles bound through the LEGACY SCALAR only are caught', async () => {
        // The half a partial unique index on plantingCycle(plotId) would have covered — and
        // the half the wizard never writes. Both halves must be read or the detector lies.
        const result = await run([
            { id: 'cycle-legacy-1', cycleName: 'รอบเก่า 1', status: 'READY_HARVEST', plotId: PLOT_A.id },
            { id: 'cycle-legacy-2', cycleName: 'รอบเก่า 2', status: 'PLANTED', plotId: PLOT_A.id },
        ]);

        expect(result.violations).toHaveLength(1);
        expect(result.violations[0].cycles.map((c) => c.boundVia)).toEqual([
            'legacy scalar PlantingCycle.plotId',
            'legacy scalar PlantingCycle.plotId',
        ]);
    });

    test('one legacy-bound cycle and one join-bound cycle on the same plot are caught — the union is the point', async () => {
        const result = await run([
            { id: 'cycle-legacy', cycleName: 'รอบเก่า', status: 'GROWING', plotId: PLOT_A.id },
            { id: 'cycle-wizard', cycleName: 'รอบใหม่', status: 'PLANNING', cyclePlots: [{ plotId: PLOT_A.id }] },
        ]);

        expect(result.violations).toHaveLength(1);
        expect(result.violations[0].cycles.map((c) => c.id).sort()).toEqual(['cycle-legacy', 'cycle-wizard']);
    });

    test('ONE cycle bound to the same plot BOTH ways is one occupant, not a violation', async () => {
        const result = await run([
            { id: 'cycle-1', cycleName: 'รอบที่ 1/2569', status: 'PLANTED', plotId: PLOT_A.id, cyclePlots: [{ plotId: PLOT_A.id }] },
        ]);

        expect(result.violations).toEqual([]);
        expect(result.plotsBound).toBe(1);
    });

    test('a HARVESTED cycle does NOT occupy the plot — drying runs in parallel (R15)', async () => {
        const result = await run([
            { id: 'cycle-harvested', cycleName: 'รอบที่ 1/2569', status: 'HARVESTED', cyclePlots: [{ plotId: PLOT_A.id }] },
            { id: 'cycle-open', cycleName: 'รอบที่ 2/2569', status: 'PLANTED', cyclePlots: [{ plotId: PLOT_A.id }] },
        ]);

        expect(result.violations).toEqual([]);
        expect(result.cyclesScanned).toBe(1);
    });

    test('a soft-deleted open cycle does NOT occupy the plot', async () => {
        const result = await run([
            { id: 'cycle-deleted', cycleName: 'รอบที่ลบแล้ว', status: 'PLANTED', isDeleted: true, cyclePlots: [{ plotId: PLOT_A.id }] },
            { id: 'cycle-open', cycleName: 'รอบที่ 2/2569', status: 'PLANTED', cyclePlots: [{ plotId: PLOT_A.id }] },
        ]);

        expect(result.violations).toEqual([]);
        expect(result.cyclesScanned).toBe(1);
    });

    test('an open cycle bound to no plot at all is ignored rather than crashed on', async () => {
        const result = await run([
            { id: 'cycle-unbound', cycleName: 'ยังไม่เลือกแปลง', status: 'PLANNING' },
        ]);

        expect(result.violations).toEqual([]);
        expect(result.plotsBound).toBe(0);
    });
});

describe('R15 detector — the report tells a human what to do', () => {
    test('it names the plot and every cycle holding it, with id, name, status and start date', async () => {
        const result = await run([
            {
                id: 'cycle-1', cycleName: 'รอบที่ 1/2569', status: 'PLANTED',
                startDate: new Date('2026-01-05T00:00:00.000Z'), cyclePlots: [{ plotId: PLOT_A.id }],
            },
            {
                id: 'cycle-2', cycleName: 'รอบที่ 2/2569', status: 'PLANNING',
                startDate: new Date('2026-03-20T00:00:00.000Z'), plotId: PLOT_A.id,
            },
        ]);
        const report = detector.formatReport(result).join('\n');

        expect(report).toContain('แปลง A');
        expect(report).toContain(PLOT_A.id);
        expect(report).toContain(PLOT_A.plotCode);
        expect(report).toContain('cycle-1');
        expect(report).toContain('cycle-2');
        expect(report).toContain('รอบที่ 2/2569');
        expect(report).toContain('PLANNING');
        expect(report).toContain('2026-01-05');
        expect(report).toContain('2026-03-20');
    });

    test('a plot row that no longer exists is reported, not crashed on', async () => {
        const result = await run([
            { id: 'cycle-1', cycleName: 'รอบ 1', status: 'PLANTED', plotId: 'plot-vanished' },
            { id: 'cycle-2', cycleName: 'รอบ 2', status: 'PLANTED', plotId: 'plot-vanished' },
        ]);

        expect(result.violations[0].plotName).toBe('(plot row not found)');
        expect(detector.formatReport(result).join('\n')).toContain('plot-vanished');
    });
});

describe('R15 detector — the guards abort instead of guessing', () => {
    test('a row whose status escaped the filter aborts the run', async () => {
        // If the where clause is not being applied, closed cycles arrive too and the
        // detector would invent violations. Better to fail loudly than to report fiction.
        const liar = {
            plantingCycle: { findMany: async () => [{ id: 'x', status: 'COMPLETED', cyclePlots: [] }] },
        };

        await expect(detector.findDoubleBookedPlots(liar, OPEN)).rejects.toThrow(/outside the requested filter/);
    });

    test('a row without a cyclePlots array aborts rather than reading one binding', async () => {
        const half = {
            plantingCycle: { findMany: async () => [{ id: 'x', status: 'PLANTED' }] },
        };

        await expect(detector.findDoubleBookedPlots(half, OPEN)).rejects.toThrow(/cyclePlots/);
    });

    test('an empty status list is refused — it would report every plot clean', async () => {
        await expect(detector.findDoubleBookedPlots(makeFakePrisma([]), [])).rejects.toThrow(/non-empty/);
    });
});

describe('R15 detector — it borrows the service\'s definition of "open"', () => {
    const SERVICE = path.join(__dirname, '../../services/planting-service.js');

    test('the parsed list is exactly planting-service\'s OPEN_CYCLE_STATUSES', () => {
        const source = fs.readFileSync(SERVICE, 'utf8');
        const declared = source.match(/const OPEN_CYCLE_STATUSES = \[([^\]]*)\]/)[1]
            .split(',').map((t) => t.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);

        expect(OPEN).toEqual(declared);
    });

    test('and it is the R15 list: everything before harvest, nothing after', () => {
        expect(OPEN).toEqual(['PLANNING', 'PLANTED', 'GROWING', 'READY_HARVEST']);
        expect(OPEN).not.toContain('HARVESTED');
        expect(OPEN).not.toContain('COMPLETED');
    });

    test('a service file without the declaration aborts instead of falling back to a copy', () => {
        const decoy = path.join(__dirname, '../../scripts/detect-double-booked-plots.js');

        // Any file that does not declare the list — reading a stale copy would let the
        // detector and the gate disagree about which plots are free.
        expect(() => detector.readOpenCycleStatuses(decoy)).toThrow(/not found/);
    });
});

describe('R15 detector — read-only and secret-free', () => {
    const SOURCE = fs.readFileSync(path.join(__dirname, '../../scripts/detect-double-booked-plots.js'), 'utf8');

    test('no write path exists in the file at all', () => {
        // The operator declined a constraint on the grounds that a half-measure buys false
        // confidence; a "detector" that can write is the same category of surprise.
        for (const write of ['.create(', '.createMany(', '.update(', '.updateMany(', '.upsert(',
            '.delete(', '.deleteMany(', '$executeRaw', '$queryRaw', '$transaction']) {
            expect(SOURCE).not.toContain(write);
        }
    });

    test('the connection string never reaches a printed line', () => {
        const previous = process.env.DATABASE_URL;
        process.env.DATABASE_URL = 'postgresql://gacp_app:s3cr3t-not-real@db.example.supabase.co:5432/postgres';
        try {
            const line = detector.redact(
                `FATAL: can't reach database server at ${process.env.DATABASE_URL} (password s3cr3t-not-real)`,
            );

            expect(line).not.toContain('s3cr3t-not-real');
            expect(line).not.toContain('db.example.supabase.co');
            expect(line).toContain('FATAL');
        } finally {
            if (previous === undefined) { delete process.env.DATABASE_URL; } else { process.env.DATABASE_URL = previous; }
        }
    });

    test('a bare connection URL from any source is redacted even without DATABASE_URL set', () => {
        const previous = process.env.DATABASE_URL;
        delete process.env.DATABASE_URL;
        try {
            expect(detector.redact('P1001: postgres://u:p@host:5432/db is unreachable'))
                .not.toContain('host:5432');
        } finally {
            if (previous !== undefined) { process.env.DATABASE_URL = previous; }
        }
    });

    test('violations exit non-zero, so a scheduled check cannot ignore them', () => {
        expect(detector.EXIT_CLEAN).toBe(0);
        expect(detector.EXIT_VIOLATIONS).not.toBe(0);
        // A failed run must be distinguishable from a real finding.
        expect(detector.EXIT_ERROR).not.toBe(detector.EXIT_VIOLATIONS);
    });
});
