/**
 * A cycle's status is a CLOSED SET — and that is what holds R15 up.
 *
 * R15 says a plot carries at most one open cycle. The gate implements it by asking whether
 * any cycle on the plot has a status in OPEN_CYCLE_STATUSES. That question only means
 * something if the set of possible statuses is finite and known.
 *
 * It was not. `status` is a plain String column (prisma/schema/cultivation.prisma:53-54) and
 * updateCycle wrote whatever arrived:
 *
 *     updateData.status = String(data.status).toUpperCase();
 *
 * So R15 fell to two ordinary requests, with no special access and nothing that looks like an
 * attack in a log:
 *
 *     PATCH /api/planting-cycles/<id>  { "status": "paused" }   → stored as 'PAUSED'
 *     POST  /api/planting-cycles       { plotAssignments: [same plot] }  → accepted
 *
 * because 'PAUSED' is in no list at all, so the plot reads as free while the crop is still
 * standing on it. The rule meant to stop untracked produce being given a certified origin was
 * gone, and the row left behind looks like ordinary data.
 *
 * Found by an adversarial review that tried it rather than read it (2026-08-26), on the same
 * day R15 enforcement was written. The enforcement was real; the vocabulary underneath it was
 * not.
 *
 * These tests pin the vocabulary. The R15 gate itself is proven in
 * planting-one-open-cycle-per-plot.test.js; this file exists to stop the ground moving
 * underneath it.
 */

'use strict';

let mockDb = null;

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

const fs = require('fs');
const path = require('path');
const plantingService = require('../../services/planting-service');

const FARM_ID = 'farm-1';
const CYCLE_ID = 'cycle-open-1';

function makeDb(cycle = {}) {
    const row = {
        id: CYCLE_ID,
        farmId: FARM_ID,
        cycleName: 'รอบที่ 1/2569',
        status: 'PLANTED',
        isDeleted: false,
        plotId: null,
        cyclePlots: [],
        _count: { batches: 0 },
        ...cycle,
    };
    const store = {
        updated: [],
        plantingCycle: {
            findUnique: async () => row,
            findMany: async () => [],
            update: async ({ where, data }) => { store.updated.push({ id: where.id, data }); return { id: where.id, ...data }; },
        },
        plantingCyclePlot: {
            createMany: async ({ data }) => ({ count: data.length }),
            deleteMany: async () => ({ count: 0 }),
        },
        $transaction: async (fn) => fn(store),
    };
    return store;
}

afterEach(() => { mockDb = null; });

describe('an invented status is refused, so it can never release a plot', () => {
    test.each([
        ['paused', 'the exact value the review used to defeat R15'],
        ['PAUSED', 'uppercase makes no difference — it is the value that is unknown, not the case'],
        ['ON_HOLD', 'plausible-sounding is still not a status this product has'],
        ['', 'empty string'],
        ['DELETED', 'a status that sounds terminal but is not in the lifecycle'],
    ])('PATCH status=%p is rejected (%s)', async (value) => {
        mockDb = makeDb();

        await expect(plantingService.updateCycle(CYCLE_ID, { status: value })).rejects.toMatchObject({
            code: 'INVALID_CYCLE_STATUS',
            statusCode: 400,
        });

        // and nothing reached the database — a rejected status must not land half-written
        expect(mockDb.updated).toHaveLength(0);
    });

    test('the refusal tells the caller what IS allowed, rather than only that they were wrong', async () => {
        mockDb = makeDb();

        const error = await plantingService.updateCycle(CYCLE_ID, { status: 'paused' }).catch((e) => e);

        expect(error.message).toContain('PLANNING');
        expect(error.message).toContain('COMPLETED');
        expect(error.field).toBe('status');
    });
});

describe('the documented lifecycle still works', () => {
    test.each(['PLANNING', 'PLANTED', 'GROWING', 'READY_HARVEST', 'HARVESTED', 'COMPLETED'])(
        'status=%s is accepted and written through',
        async (value) => {
            mockDb = makeDb();

            await plantingService.updateCycle(CYCLE_ID, { status: value });

            expect(mockDb.updated).toHaveLength(1);
            expect(mockDb.updated[0].data.status).toBe(value);
        },
    );

    test('lowercase input is normalised, not rejected — the farmer\'s client may send either', async () => {
        mockDb = makeDb();

        await plantingService.updateCycle(CYCLE_ID, { status: 'growing' });

        expect(mockDb.updated[0].data.status).toBe('GROWING');
    });

    test('COMPLETED is reachable, so a failed crop has a way out and the plot is not locked forever', async () => {
        // R15 locks a plot while a cycle is open. A farmer whose crop dies must still be able to
        // close the round — otherwise enforcing the rule would strand the ground permanently.
        // COMPLETED is outside OPEN_CYCLE_STATUSES, so setting it releases the plot.
        mockDb = makeDb({ status: 'GROWING' });

        await plantingService.updateCycle(CYCLE_ID, { status: 'COMPLETED' });

        expect(mockDb.updated[0].data.status).toBe('COMPLETED');
        const source = fs.readFileSync(path.join(__dirname, '../../services/planting-service.js'), 'utf8');
        const open = source.match(/const OPEN_CYCLE_STATUSES = (\[[^\]]*\])/)[1];
        expect(open).not.toContain('COMPLETED');
    });
});

describe('the two vocabularies cannot drift apart', () => {
    function listFromSource(name) {
        const source = fs.readFileSync(path.join(__dirname, '../../services/planting-service.js'), 'utf8');
        const match = source.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
        if (!match) { throw new Error(`${name} not found in planting-service.js`); }
        return match[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    }

    test('every OPEN status is a real status', () => {
        const all = listFromSource('CYCLE_STATUSES');
        const open = listFromSource('OPEN_CYCLE_STATUSES');

        expect(open.length).toBeGreaterThan(0);
        expect(open.filter((s) => !all.includes(s))).toEqual([]);
    });

    test('the closed set matches the lifecycle documented beside the column', () => {
        // prisma/schema/cultivation.prisma carries the lifecycle as a comment on the column.
        // If someone adds a status there and not here, updateCycle would refuse a status the
        // schema calls legitimate; if they add it here only, R15's open/closed split is decided
        // by a list nobody documented. Both are silent, so pin them to each other.
        const schema = fs.readFileSync(
            path.join(__dirname, '../../prisma/schema/cultivation.prisma'), 'utf8',
        );
        const line = schema.split('\n').find((l) => l.includes('PLANNING →') || l.includes('PLANNING ->'));
        expect(line).toBeDefined();

        const documented = line.replace(/^\s*\/\/\s*/, '').split(/→|->/).map((s) => s.trim()).filter(Boolean);
        expect(listFromSource('CYCLE_STATUSES')).toEqual(documented);
    });
});
