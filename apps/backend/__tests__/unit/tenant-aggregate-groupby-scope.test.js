/**
 * R&D tenant-isolation fix — close the aggregate/groupBy bypass.
 *
 * The tenant-prisma-extension hooks findMany/findFirst/count for org-scoping,
 * but `aggregate` and `groupBy` were NOT hooked — so revenue/stat _sum/groupBy
 * leaked cross-org (see invoice-service.js#getSummary hand-patch, the
 * smoking-gun asymmetry where counts were scoped but _sum was not).
 *
 * This suite exercises the REAL extension hooks through the REAL tenant-context
 * AsyncLocalStorage (same approach as entity-prisma-extension.test.js) to pin:
 *   - aggregate/groupBy run within a bound tenant context (flag ON) → organizationId injected
 *   - aggregate/groupBy with NO context → fail-open (no injection), behaviour preserved
 *   - flag OFF (default) → strict no-op, today's behaviour
 *   - withoutTenantScope (platform-admin/cron) → no injection
 *   - non-tenant-scoped models → untouched
 */

'use strict';

const { runWithTenantContext, withoutTenantScope } = require('../../services/tenant-context');
const { tenantInjectExtension } = require('../../services/tenant-prisma-extension');

const aggregateHook = tenantInjectExtension.query.$allModels.aggregate;
const groupByHook = tenantInjectExtension.query.$allModels.groupBy;

function captureCall() {
    const calls = [];
    const fn = (args) => {
        calls.push(args);
        return Promise.resolve('result');
    };
    return { fn, calls };
}

describe('tenant-prisma-extension — aggregate/groupBy org-scope hook', () => {
    const ORIGINAL_FLAG = process.env.TENANT_READ_ORG_SCOPE;
    beforeEach(() => { delete process.env.TENANT_READ_ORG_SCOPE; });
    afterAll(() => {
        if (ORIGINAL_FLAG === undefined) { delete process.env.TENANT_READ_ORG_SCOPE; }
        else { process.env.TENANT_READ_ORG_SCOPE = ORIGINAL_FLAG; }
    });

    it('exposes aggregate + groupBy hooks (parity with findMany/findFirst/count)', () => {
        expect(typeof aggregateHook).toBe('function');
        expect(typeof groupByHook).toBe('function');
    });

    describe('flag ON — org dimension active', () => {
        beforeEach(() => { process.env.TENANT_READ_ORG_SCOPE = 'true'; });

        it('aggregate within tenant ctx → organizationId injected into where', async () => {
            const { fn, calls } = captureCall();
            await runWithTenantContext({ organizationId: 'org-A' }, async () => {
                await aggregateHook({
                    model: 'Invoice',
                    args: { _sum: { totalAmount: true }, where: { status: 'PAID' } },
                    query: fn,
                });
            });
            expect(calls[0].where).toEqual({ status: 'PAID', organizationId: 'org-A' });
            // unrelated args preserved
            expect(calls[0]._sum).toEqual({ totalAmount: true });
        });

        it('groupBy within tenant ctx → organizationId injected into where', async () => {
            const { fn, calls } = captureCall();
            await runWithTenantContext({ organizationId: 'org-A' }, async () => {
                await groupByHook({
                    model: 'Invoice',
                    args: { by: ['status'], _sum: { totalAmount: true }, where: { isDeleted: false } },
                    query: fn,
                });
            });
            expect(calls[0].where).toEqual({ isDeleted: false, organizationId: 'org-A' });
            expect(calls[0].by).toEqual(['status']);
        });

        it('aggregate with NO tenant ctx → fail-open, no injection', async () => {
            const { fn, calls } = captureCall();
            await aggregateHook({
                model: 'Invoice',
                args: { _sum: { totalAmount: true }, where: { status: 'PAID' } },
                query: fn,
            });
            expect(calls[0].where).toEqual({ status: 'PAID' });
        });

        it('groupBy with NO tenant ctx → fail-open, no injection', async () => {
            const { fn, calls } = captureCall();
            await groupByHook({
                model: 'Invoice',
                args: { by: ['status'], where: { isDeleted: false } },
                query: fn,
            });
            expect(calls[0].where).toEqual({ isDeleted: false });
        });

        it('aggregate inside withoutTenantScope (platform-admin/cron) → no injection', async () => {
            const { fn, calls } = captureCall();
            await runWithTenantContext({ organizationId: 'org-A' }, async () => {
                await withoutTenantScope(async () => {
                    await aggregateHook({
                        model: 'Invoice',
                        args: { _sum: { totalAmount: true }, where: { status: 'PAID' } },
                        query: fn,
                    });
                });
            });
            expect(calls[0].where).toEqual({ status: 'PAID' });
        });

        it('groupBy on a NON-tenant-scoped model → untouched even with ctx', async () => {
            const { fn, calls } = captureCall();
            await runWithTenantContext({ organizationId: 'org-A' }, async () => {
                await groupByHook({
                    model: 'SystemConfig',
                    args: { by: ['key'], where: { key: 'x' } },
                    query: fn,
                });
            });
            expect(calls[0].where).toEqual({ key: 'x' });
        });

        it('aggregate with missing where → injects organizationId-only where', async () => {
            const { fn, calls } = captureCall();
            await runWithTenantContext({ organizationId: 'org-A' }, async () => {
                await aggregateHook({ model: 'Invoice', args: { _sum: { totalAmount: true } }, query: fn });
            });
            expect(calls[0].where).toEqual({ organizationId: 'org-A' });
        });
    });

    describe('DEFAULT (flag unset) — org dimension ON (Gap-1 GREEN)', () => {
        it('aggregate within tenant ctx → organizationId injected by default', async () => {
            const { fn, calls } = captureCall();
            await runWithTenantContext({ organizationId: 'org-A' }, async () => {
                await aggregateHook({
                    model: 'Invoice',
                    args: { _sum: { totalAmount: true }, where: { status: 'PAID' } },
                    query: fn,
                });
            });
            expect(calls[0].where).toEqual({ status: 'PAID', organizationId: 'org-A' });
        });

        it('groupBy within tenant ctx → organizationId injected by default', async () => {
            const { fn, calls } = captureCall();
            await runWithTenantContext({ organizationId: 'org-A' }, async () => {
                await groupByHook({
                    model: 'Invoice',
                    args: { by: ['status'], where: { isDeleted: false } },
                    query: fn,
                });
            });
            expect(calls[0].where).toEqual({ isDeleted: false, organizationId: 'org-A' });
        });
    });

    describe('kill-switch (TENANT_READ_ORG_SCOPE=false) — org dimension is a no-op', () => {
        beforeEach(() => { process.env.TENANT_READ_ORG_SCOPE = 'false'; });

        it('aggregate within tenant ctx → NO organizationId injected', async () => {
            const { fn, calls } = captureCall();
            await runWithTenantContext({ organizationId: 'org-A' }, async () => {
                await aggregateHook({
                    model: 'Invoice',
                    args: { _sum: { totalAmount: true }, where: { status: 'PAID' } },
                    query: fn,
                });
            });
            expect(calls[0].where).toEqual({ status: 'PAID' });
        });

        it('groupBy within tenant ctx → NO organizationId injected', async () => {
            const { fn, calls } = captureCall();
            await runWithTenantContext({ organizationId: 'org-A' }, async () => {
                await groupByHook({
                    model: 'Invoice',
                    args: { by: ['status'], where: { isDeleted: false } },
                    query: fn,
                });
            });
            expect(calls[0].where).toEqual({ isDeleted: false });
        });
    });
});
