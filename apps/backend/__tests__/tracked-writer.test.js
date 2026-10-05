/**
 * tracked-writer unit tests — Wave A Phase 24/G3 foundation.
 *
 * Verifies the generic writer's contract:
 *  - Required-args validation
 *  - prisma[model].update called with correct shape
 *  - findFirst is called to fetch beforeState when not supplied
 *  - changes array computed correctly (skip equal values)
 *  - onAudit fires only when at least one tracked field changed
 *  - onAudit failure does NOT throw (best-effort)
 *  - includeDeleted-style escape hatches via beforeState bypass
 *  - shallowEqual handles Date / Json / primitives
 */

'use strict';

const path = require('path');

const writerPath = path.resolve(__dirname, '../services/tracked-writer.js');

function loadWriter() {
    jest.resetModules();
    return require(writerPath);
}

function makePrisma() {
    return {
        application: {
            update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
            findFirst: jest.fn(async () => null),
        },
        workActivity: {
            update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
            findFirst: jest.fn(async () => null),
        },
    };
}

describe('tracked-writer required-args validation', () => {
    test('throws when args object is missing', async () => {
        const { trackedUpdate } = loadWriter();
        await expect(trackedUpdate()).rejects.toThrow(/args required/);
    });

    test('throws when prisma is missing', async () => {
        const { trackedUpdate } = loadWriter();
        await expect(
            trackedUpdate({ model: 'application', where: { id: 'x' }, data: {} }),
        ).rejects.toThrow(/prisma required/);
    });

    test('throws when model is missing', async () => {
        const { trackedUpdate } = loadWriter();
        await expect(
            trackedUpdate({ prisma: makePrisma(), where: { id: 'x' }, data: {} }),
        ).rejects.toThrow(/model required/);
    });

    test('throws when where is missing', async () => {
        const { trackedUpdate } = loadWriter();
        await expect(
            trackedUpdate({ prisma: makePrisma(), model: 'application', data: {} }),
        ).rejects.toThrow(/where required/);
    });

    test('throws when data is missing', async () => {
        const { trackedUpdate } = loadWriter();
        await expect(
            trackedUpdate({ prisma: makePrisma(), model: 'application', where: { id: 'x' } }),
        ).rejects.toThrow(/data required/);
    });

    test('throws when prisma[model].update is not a function', async () => {
        const { trackedUpdate } = loadWriter();
        await expect(
            trackedUpdate({
                prisma: { madeUpModel: {} },
                model: 'madeUpModel',
                where: { id: 'x' },
                data: { foo: 1 },
            }),
        ).rejects.toThrow(/is not a function/);
    });
});

describe('tracked-writer update + audit emission', () => {
    test('calls prisma[model].update with the provided where + data', async () => {
        const { trackedUpdate } = loadWriter();
        const prisma = makePrisma();
        const out = await trackedUpdate({
            prisma,
            model: 'application',
            where: { id: 'app-1' },
            data: { phase1Status: 'PAID' },
        });
        expect(prisma.application.update).toHaveBeenCalledWith({
            where: { id: 'app-1' },
            data: { phase1Status: 'PAID' },
        });
        expect(out).toEqual({ id: 'app-1', phase1Status: 'PAID' });
    });

    test('fetches beforeState via findFirst when not supplied', async () => {
        const { trackedUpdate } = loadWriter();
        const prisma = makePrisma();
        prisma.application.findFirst.mockResolvedValue({ phase1Status: 'PENDING' });

        const onAudit = jest.fn();
        await trackedUpdate({
            prisma,
            model: 'application',
            where: { id: 'app-1' },
            data: { phase1Status: 'PAID' },
            trackedFields: ['phase1Status'],
            actorId: 'u-1',
            onAudit,
        });

        expect(prisma.application.findFirst).toHaveBeenCalledWith({
            where: { id: 'app-1' },
            select: { phase1Status: true },
        });
        expect(onAudit).toHaveBeenCalledTimes(1);
        const entry = onAudit.mock.calls[0][0];
        expect(entry.model).toBe('application');
        expect(entry.recordId).toBe('app-1');
        expect(entry.changes).toEqual([
            { field: 'phase1Status', before: 'PENDING', after: 'PAID' },
        ]);
        expect(entry.actorId).toBe('u-1');
    });

    test('honours caller-supplied beforeState (skips findFirst)', async () => {
        const { trackedUpdate } = loadWriter();
        const prisma = makePrisma();
        const onAudit = jest.fn();
        await trackedUpdate({
            prisma,
            model: 'application',
            where: { id: 'app-2' },
            data: { phase2Status: 'PAID' },
            trackedFields: ['phase2Status'],
            beforeState: { phase2Status: 'PENDING' },
            actorId: 'u-2',
            onAudit,
        });
        expect(prisma.application.findFirst).not.toHaveBeenCalled();
        expect(onAudit).toHaveBeenCalledTimes(1);
        expect(onAudit.mock.calls[0][0].changes).toEqual([
            { field: 'phase2Status', before: 'PENDING', after: 'PAID' },
        ]);
    });

    test('does NOT call onAudit when no tracked field actually changed', async () => {
        const { trackedUpdate } = loadWriter();
        const prisma = makePrisma();
        const onAudit = jest.fn();
        await trackedUpdate({
            prisma,
            model: 'application',
            where: { id: 'x' },
            data: { phase1Status: 'PAID' },
            trackedFields: ['phase1Status'],
            beforeState: { phase1Status: 'PAID' }, // identical
            onAudit,
        });
        expect(prisma.application.update).toHaveBeenCalled();
        expect(onAudit).not.toHaveBeenCalled();
    });

    test('emits one audit entry containing all changed fields', async () => {
        const { trackedUpdate } = loadWriter();
        const prisma = makePrisma();
        const onAudit = jest.fn();
        await trackedUpdate({
            prisma,
            model: 'application',
            where: { id: 'x' },
            data: { phase1Status: 'PAID', phase2Status: 'PAID' },
            trackedFields: ['phase1Status', 'phase2Status'],
            beforeState: { phase1Status: 'PENDING', phase2Status: 'PENDING' },
            onAudit,
        });
        expect(onAudit).toHaveBeenCalledTimes(1);
        const { changes } = onAudit.mock.calls[0][0];
        expect(changes).toHaveLength(2);
        expect(changes.map((c) => c.field).sort()).toEqual(['phase1Status', 'phase2Status']);
    });

    test('trackedFields filters down which fields trigger audit', async () => {
        const { trackedUpdate } = loadWriter();
        const prisma = makePrisma();
        const onAudit = jest.fn();
        await trackedUpdate({
            prisma,
            model: 'application',
            where: { id: 'x' },
            data: { phase1Status: 'PAID', formData: { foo: 'bar' } },
            trackedFields: ['phase1Status'], // formData ignored
            beforeState: { phase1Status: 'PENDING' },
            onAudit,
        });
        expect(onAudit).toHaveBeenCalledTimes(1);
        expect(onAudit.mock.calls[0][0].changes).toEqual([
            { field: 'phase1Status', before: 'PENDING', after: 'PAID' },
        ]);
    });

    test('onAudit failure is swallowed (writer does not throw)', async () => {
        const { trackedUpdate } = loadWriter();
        const prisma = makePrisma();
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            await expect(
                trackedUpdate({
                    prisma,
                    model: 'application',
                    where: { id: 'x' },
                    data: { phase1Status: 'PAID' },
                    trackedFields: ['phase1Status'],
                    beforeState: { phase1Status: 'PENDING' },
                    onAudit: () => {
                        throw new Error('audit-log down');
                    },
                }),
            ).resolves.toBeDefined();
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('onAudit callback failed'),
            );
        } finally {
            warnSpy.mockRestore();
        }
    });
});

describe('tracked-writer shallowEqual helper', () => {
    test('primitives', () => {
        const { _shallowEqual: eq } = loadWriter();
        expect(eq('a', 'a')).toBe(true);
        expect(eq(1, 1)).toBe(true);
        expect(eq(true, true)).toBe(true);
        expect(eq(null, null)).toBe(true);
        expect(eq(undefined, undefined)).toBe(true);
        expect(eq('a', 'b')).toBe(false);
        expect(eq(1, 2)).toBe(false);
    });

    test('null vs value asymmetry', () => {
        const { _shallowEqual: eq } = loadWriter();
        expect(eq(null, 'x')).toBe(false);
        expect(eq('x', null)).toBe(false);
        expect(eq(undefined, 'x')).toBe(false);
    });

    test('Date instances compare by getTime', () => {
        const { _shallowEqual: eq } = loadWriter();
        const a = new Date('2026-04-30T12:00:00Z');
        const b = new Date('2026-04-30T12:00:00Z');
        const c = new Date('2026-05-01T12:00:00Z');
        expect(eq(a, b)).toBe(true);
        expect(eq(a, c)).toBe(false);
    });

    test('plain objects compare via JSON.stringify', () => {
        const { _shallowEqual: eq } = loadWriter();
        expect(eq({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
        expect(eq({ a: 1 }, { a: 2 })).toBe(false);
    });
});
