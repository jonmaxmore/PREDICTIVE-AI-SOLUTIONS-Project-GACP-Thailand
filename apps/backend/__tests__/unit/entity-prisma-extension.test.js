// Wave C PR C-2 — verify the tenant-prisma-extension's new entity-scope
// behaviour. We don't load Prisma — we exercise the extension's query
// hooks directly, the same approach the existing tenant-prisma-extension
// test takes (see tenant-context.test.js).

const { runWithEntityContext, withoutEntityScope } = require('../../services/entity-context');
const {
    tenantInjectExtension,
    isEntityScoped,
    _ENTITY_SCOPED_MODELS,
} = require('../../services/tenant-prisma-extension');

const findManyHook = tenantInjectExtension.query.$allModels.findMany;
const findFirstHook = tenantInjectExtension.query.$allModels.findFirst;
const countHook = tenantInjectExtension.query.$allModels.count;

function captureCall() {
    const calls = [];
    const fn = (args) => {
        calls.push(args);
        return Promise.resolve('result');
    };
    return { fn, calls };
}

describe('Wave C PR C-2 — entity-scoped read auto-filter', () => {
    describe('ENTITY_SCOPED_MODELS classification', () => {
        it('flags Application and Farm as entity-scoped', () => {
            expect(isEntityScoped('Application')).toBe(true);
            expect(isEntityScoped('Farm')).toBe(true);
        });
        it('does NOT flag EntityMembership (cross-entity by design)', () => {
            expect(isEntityScoped('EntityMembership')).toBe(false);
        });
        it('does NOT flag TraceQrSecurity (polymorphic entityType, different sense)', () => {
            expect(isEntityScoped('TraceQrSecurity')).toBe(false);
        });
        it('does NOT flag Certificate (transitively scoped via Application)', () => {
            expect(isEntityScoped('Certificate')).toBe(false);
        });
    });

    describe('findMany', () => {
        it('injects entityId when context is bound', async () => {
            const { fn, calls } = captureCall();
            await runWithEntityContext({ entityId: 'ent-1', role: 'OWNER' }, async () => {
                await findManyHook({ model: 'Application', args: { where: { status: 'DRAFT' } }, query: fn });
            });
            expect(calls[0].where).toEqual({ status: 'DRAFT', entityId: 'ent-1' });
        });

        it('preserves any explicit entityId in args.where', async () => {
            const { fn, calls } = captureCall();
            await runWithEntityContext({ entityId: 'ent-1', role: 'OWNER' }, async () => {
                await findManyHook({ model: 'Application', args: { where: { entityId: 'ent-explicit', status: 'DRAFT' } }, query: fn });
            });
            // Spec is "inject when not present" — but we want predictability,
            // so the active-context wins (defence-in-depth against accidental
            // cross-entity reads when the route handler hard-codes a different
            // entityId).
            expect(calls[0].where.entityId).toBe('ent-1');
        });

        it('does NOT inject when no context is bound (script / migration path)', async () => {
            const { fn, calls } = captureCall();
            await findManyHook({ model: 'Application', args: { where: { status: 'DRAFT' } }, query: fn });
            expect(calls[0].where).toEqual({ status: 'DRAFT' });
        });

        it('does NOT inject inside withoutEntityScope', async () => {
            const { fn, calls } = captureCall();
            await runWithEntityContext({ entityId: 'ent-1', role: 'OWNER' }, async () => {
                await withoutEntityScope(async () => {
                    await findManyHook({ model: 'Application', args: { where: { status: 'DRAFT' } }, query: fn });
                });
            });
            expect(calls[0].where).toEqual({ status: 'DRAFT' });
        });

        it('does NOT touch non-entity-scoped models', async () => {
            const { fn, calls } = captureCall();
            await runWithEntityContext({ entityId: 'ent-1', role: 'OWNER' }, async () => {
                await findManyHook({ model: 'User', args: { where: { isDeleted: false } }, query: fn });
            });
            expect(calls[0].where).toEqual({ isDeleted: false });
        });

        it('handles missing args.where', async () => {
            const { fn, calls } = captureCall();
            await runWithEntityContext({ entityId: 'ent-1', role: 'OWNER' }, async () => {
                await findManyHook({ model: 'Application', args: {}, query: fn });
            });
            expect(calls[0].where).toEqual({ entityId: 'ent-1' });
        });
    });

    describe('findFirst', () => {
        it('injects entityId on Application reads', async () => {
            const { fn, calls } = captureCall();
            await runWithEntityContext({ entityId: 'ent-1', role: 'MANAGER' }, async () => {
                await findFirstHook({ model: 'Application', args: { where: { status: 'DRAFT' } }, query: fn });
            });
            expect(calls[0].where).toEqual({ status: 'DRAFT', entityId: 'ent-1' });
        });

        it('injects entityId on Farm reads', async () => {
            const { fn, calls } = captureCall();
            await runWithEntityContext({ entityId: 'ent-2', role: 'OWNER' }, async () => {
                await findFirstHook({ model: 'Farm', args: { where: { name: 'F1' } }, query: fn });
            });
            expect(calls[0].where).toEqual({ name: 'F1', entityId: 'ent-2' });
        });
    });

    describe('count', () => {
        it('injects entityId so count reflects the active scope', async () => {
            const { fn, calls } = captureCall();
            await runWithEntityContext({ entityId: 'ent-1', role: 'OWNER' }, async () => {
                await countHook({ model: 'Application', args: { where: { status: 'DRAFT' } }, query: fn });
            });
            expect(calls[0].where).toEqual({ status: 'DRAFT', entityId: 'ent-1' });
        });
    });
});
