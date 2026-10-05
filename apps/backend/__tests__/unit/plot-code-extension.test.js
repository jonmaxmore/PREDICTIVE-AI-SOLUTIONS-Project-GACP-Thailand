/**
 * Every plot that comes into existence carries a permanent code.
 *
 * มกษ. 3502-2561 ข้อ 8(1) requires "รหัสแปลงปลูกและข้อมูลประจำแปลงปลูก" — a plot code and
 * per-plot data (docs/standards/tas-3502-2561-records-and-traceability.md). Layer 1 added the
 * column, the generator (shared/plot-code.js) and a partial unique index. A column nobody
 * fills is still a plot that can never carry a sign, so this file pins the minting.
 *
 * WHY AN EXTENSION AND NOT CALL-SITE PATCHES: the runtime paths that insert a Plot row —
 *   services/planting-service.js        (POST /farms/:farmId/plots)
 *   services/certificate-service.js     (ensurePlotsForFarm at issuance)
 * (the wizard-submission path went with the /api/wizard door, R2 Task 10) — and a per-site fix
 * is one forgotten route away from being useless. The tests below drive both through their
 * real service functions, with only Prisma's dispatcher and the database faked; createMany is
 * pinned on its own below.
 *
 * WHAT IS SIMULATED: `fakePlotModel()` reproduces what Prisma's $allModels query extension
 * does — call the hook for an action with `{ model, args, query }`. It is not Prisma. The last
 * test checks the real client in services/prisma-database.js applies this extension, so the
 * two halves meet.
 */

'use strict';

// planting-service captures `prisma` at require time, so the mock hands it a live reference
// to whatever fake the current test installed.
let mockCurrentPlotModel = null;
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        plot: new Proxy({}, {
            get: (_t, key) => (...args) => mockCurrentPlotModel[key](...args),
        }),
    },
}));

const fs = require('fs');
const path = require('path');

const { isValidPlotCode } = require('../../shared/plot-code');
const { plotCodeExtension } = require('../../services/plot-code-extension');

const hooks = plotCodeExtension.query.$allModels;

/**
 * Stand in for Prisma's dispatcher: route an action on a model through the extension hook,
 * ending at `sink` (which plays the database). Records what the database was asked to write.
 */
function fakePlotModel(sink, model = 'Plot') {
    const writes = [];
    const dispatch = (action) => async (args) => {
        const run = (a) => {
            writes.push(JSON.parse(JSON.stringify(a)));
            return sink(a);
        };
        if (!hooks[action]) { return run(args); }
        return hooks[action]({ model, args, query: run });
    };
    return {
        writes,
        create: dispatch('create'),
        createMany: dispatch('createMany'),
        upsert: dispatch('upsert'),
        count: async () => 0,
    };
}

const echo = (args) => Promise.resolve({ id: 'plot-1', ...(args.data || args.create || {}) });

function p2002(target) {
    return Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target },
    });
}

afterEach(() => { mockCurrentPlotModel = null; });

describe('plot code is minted on every path that creates a Plot', () => {
    test('route path — planting-service.createPlotForFarm returns a plot with a valid code', async () => {
        const plot = fakePlotModel(echo);
        mockCurrentPlotModel = plot;
        const plantingService = require('../../services/planting-service');

        const created = await plantingService.createPlotForFarm({
            farmId: 'farm-1', name: 'แปลงเหนือ', area: 1600, areaUnit: 'sqm', solarSystem: 'OUTDOOR',
        });

        expect(isValidPlotCode(created.plotCode)).toBe(true);
        expect(plot.writes[0].data.plotCode).toBe(created.plotCode);
    });

    test('issuance path — certificate-service.ensurePlotsForFarm mints a code for the fallback plot', async () => {
        const plot = fakePlotModel(echo);
        const certificateService = require('../../services/certificate-service');

        await certificateService.ensurePlotsForFarm(
            { id: 'farm-1', organizationId: 'org-1', cultivationArea: 1600, areaUnit: 'sqm' },
            { areaType: 'outdoor', formData: {} },
            { plot },
        );

        expect(plot.writes).toHaveLength(1);
        expect(isValidPlotCode(plot.writes[0].data.plotCode)).toBe(true);
    });

    // Moved from the deleted "wizard path" case (R2 Task 10): that door was the one
    // live createMany caller. The extension still hooks createMany, so its happy path
    // is pinned on the hook itself: every row gets its own valid code.
    test('createMany gives every row in the batch its own valid code', async () => {
        const plot = fakePlotModel(echo);
        await plot.createMany({
            data: [
                { farmId: 'farm-1', name: 'แปลง 1', area: 1600 },
                { farmId: 'farm-1', name: 'แปลง 2', area: 1600 },
            ],
        });
        const rows = plot.writes[0].data;
        expect(rows).toHaveLength(2);
        rows.forEach((row) => expect(isValidPlotCode(row.plotCode)).toBe(true));
        expect(rows[0].plotCode).not.toBe(rows[1].plotCode);
    });
});

describe('the extension only ever mints, never re-issues', () => {
    test('a caller-supplied plotCode is left exactly as it was', async () => {
        const plot = fakePlotModel(echo);
        await plot.create({ data: { farmId: 'f', name: 'n', area: 1, plotCode: 'PLOT-AAAAA-BBBBB' } });
        expect(plot.writes[0].data.plotCode).toBe('PLOT-AAAAA-BBBBB');
    });

    test('update is not hooked at all — a plot that has a code can never have it replaced', () => {
        expect(hooks.update).toBeUndefined();
        expect(hooks.updateMany).toBeUndefined();
    });

    test('upsert mints into the create branch and does not touch the update branch', async () => {
        const plot = fakePlotModel(echo);
        await plot.upsert({
            where: { id: 'plot-1' },
            create: { id: 'plot-1', farmId: 'f', name: 'n', area: 1 },
            update: { name: 'renamed' },
        });
        expect(isValidPlotCode(plot.writes[0].create.plotCode)).toBe(true);
        expect(plot.writes[0].update).toEqual({ name: 'renamed' });
    });

    test('qrIssuedAt and qrRevokedAt stay untouched — a code existing is not a sign existing', async () => {
        const plot = fakePlotModel(echo);
        await plot.create({ data: { farmId: 'f', name: 'n', area: 1 } });
        expect(plot.writes[0].data.qrIssuedAt).toBeUndefined();
        expect(plot.writes[0].data.qrRevokedAt).toBeUndefined();
    });

    test('other models are untouched', async () => {
        const farm = fakePlotModel(echo, 'Farm');
        await farm.create({ data: { farmName: 'f' } });
        expect(farm.writes[0].data.plotCode).toBeUndefined();
    });
});

describe('the unique index is the arbiter — collisions retry with a fresh code', () => {
    test('a P2002 on plotCode is retried with a DIFFERENT code, not pre-checked', async () => {
        const seen = [];
        let calls = 0;
        const plot = fakePlotModel((args) => {
            calls += 1;
            seen.push(args.data.plotCode);
            if (calls === 1) { return Promise.reject(p2002(['plotCode'])); }
            return Promise.resolve({ id: 'plot-1', ...args.data });
        });

        const created = await plot.create({ data: { farmId: 'f', name: 'n', area: 1 } });

        expect(calls).toBe(2);
        expect(seen[0]).not.toBe(seen[1]);
        expect(isValidPlotCode(created.plotCode)).toBe(true);
    });

    test('a P2002 on some OTHER column is rethrown immediately — no pointless retry', async () => {
        let calls = 0;
        const plot = fakePlotModel(() => {
            calls += 1;
            return Promise.reject(p2002(['id']));
        });
        await expect(plot.create({ data: { id: 'dup', farmId: 'f', name: 'n', area: 1 } }))
            .rejects.toMatchObject({ code: 'P2002' });
        expect(calls).toBe(1);
    });

    test('createMany re-mints the batch on collision and gives up rather than looping forever', async () => {
        let calls = 0;
        const plot = fakePlotModel(() => {
            calls += 1;
            return Promise.reject(p2002(['plotCode']));
        });
        await expect(plot.createMany({ data: [{ farmId: 'f', name: 'n', area: 1 }] }))
            .rejects.toMatchObject({ code: 'P2002' });
        expect(calls).toBeGreaterThan(1);
        expect(calls).toBeLessThanOrEqual(6);
    });
});

describe('the extension is actually wired into the shared client', () => {
    // Source-scan, for the reason prisma-tx-defaults.test.js gives: requiring the real module
    // constructs a PrismaClient against DATABASE_URL, which a unit test must not do.
    const SRC = fs.readFileSync(
        path.join(__dirname, '..', '..', 'services', 'prisma-database.js'),
        'utf8',
    );

    test('prisma-database.js applies plotCodeExtension to the client the services use', () => {
        expect(SRC).toContain("require('./plot-code-extension')");
        expect(SRC).toMatch(/\$extends\(plotCodeExtension\)/);
    });
});
