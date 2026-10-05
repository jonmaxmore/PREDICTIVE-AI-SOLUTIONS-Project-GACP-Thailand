'use strict';

/**
 * Final review I1 (2026-10-03): findApplicationByIdForHealth and
 * findLatestOpenDraftForHealth take an options object
 * ({ holderScope, filerHealthId }) since R1. Before R1 they took the filer's
 * healthId positionally: findApplicationByIdForHealth(id, healthId) and
 * findLatestOpenDraftForHealth(healthId). A branch written against the old
 * shape (fix/autosave-lost-reply, 813cf29a, saveApplicantDraftInOrder) merged
 * after R1 would pass a string where the options belong, and the lookup would
 * quietly answer null: the draft door would then refuse (404) or create a new
 * draft instead of saving. These lookups now throw a TypeError on any options
 * argument that is not a plain object, so such a merge fails loudly in its tests.
 */

jest.mock('../../services/prisma-database', () => ({
    prisma: { entityMembership: { findMany: jest.fn(), findFirst: jest.fn() } },
}));

const { createApplicationApplicantQueryMethods } = require('../../services/application-service/application-applicant-query-methods');

const SCOPE = Object.freeze({ userId: 'u-1', readIds: ['ent-1'], editIds: ['ent-1'] });

function makeService() {
    const prisma = { application: { findFirst: jest.fn().mockResolvedValue({ id: 'app-1' }) } };
    return { prisma, service: createApplicationApplicantQueryMethods({ prisma }) };
}

describe('the R1 options-object lookups refuse the pre-R1 positional call', () => {
    test.each([
        ['a healthId string', 'health-1'],
        ['undefined', undefined],
        ['null', null],
        ['an array', ['health-1']],
        ['a number', 42],
    ])('findApplicationByIdForHealth(id, %s) throws a TypeError and reads nothing', async (_label, arg) => {
        const { prisma, service } = makeService();
        await expect(service.findApplicationByIdForHealth('app-1', arg)).rejects.toThrow(TypeError);
        await expect(service.findApplicationByIdForHealth('app-1', arg)).rejects.toThrow(/options object/);
        expect(prisma.application.findFirst).not.toHaveBeenCalled();
    });

    test.each([
        ['a healthId string', 'health-1'],
        ['undefined', undefined],
        ['null', null],
    ])('findLatestOpenDraftForHealth(%s) throws a TypeError and reads nothing', async (_label, arg) => {
        const { prisma, service } = makeService();
        await expect(service.findLatestOpenDraftForHealth(arg)).rejects.toThrow(TypeError);
        expect(prisma.application.findFirst).not.toHaveBeenCalled();
    });

    test('getLatestOpenDraftForApplicant (the alias) refuses the same way', async () => {
        const { service } = makeService();
        await expect(service.getLatestOpenDraftForApplicant('health-1')).rejects.toThrow(TypeError);
    });

    test('the options-object call still reads', async () => {
        const { prisma, service } = makeService();
        await expect(service.findApplicationByIdForHealth('app-1', { holderScope: SCOPE, filerHealthId: 'health-1' }))
            .resolves.toEqual({ id: 'app-1' });
        await expect(service.findLatestOpenDraftForHealth({ holderScope: SCOPE, filerHealthId: 'health-1' }))
            .resolves.toEqual({ id: 'app-1' });
        expect(prisma.application.findFirst).toHaveBeenCalledTimes(2);
    });

    test('an options object without a scope or a filer still fails closed (null, no query)', async () => {
        const { prisma, service } = makeService();
        await expect(service.findApplicationByIdForHealth('app-1', {})).resolves.toBeNull();
        await expect(service.findLatestOpenDraftForHealth({})).resolves.toBeNull();
        expect(prisma.application.findFirst).not.toHaveBeenCalled();
    });
});
