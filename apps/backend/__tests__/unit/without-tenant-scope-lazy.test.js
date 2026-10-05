/**
 * withoutTenantScope must run the WHOLE returned work with no tenant bound —
 * including a lazy thenable (a PrismaPromise) that the callback returns
 * without awaiting.
 *
 * The defect (2026-09-29 Tier C review): `withoutTenantScope(fn)` was
 * `storage.run(null, fn)`. `withoutTenantScope(() => prisma.user.count(...))`
 * returns a PrismaPromise, which does nothing until someone calls `.then` on
 * it. The caller calls `.then` (via `await`) AFTER storage.run has exited, so
 * Prisma ran the extension hooks — and the org read-scope — under the
 * CALLER's tenant, not "no tenant". 44 call sites have that shape; two of
 * them are security guards (S6 last-admin count, S7 REVOKE lookup).
 *
 * The earlier unit suites could not see it: their fake clients use
 * `async` functions, which run eagerly INSIDE the run. So this suite uses
 * (1) a fake that is lazy the same way Prisma is, and (2) a real
 * PrismaClient with a recording query extension — the extension hook never
 * calls `query()`, so no database is needed and the store it observes is
 * exactly what tenant-prisma-extension would read.
 */

'use strict';

const {
    runWithTenantContext,
    withoutTenantScope,
    getTenantContext,
    isWithoutTenantScope,
} = require('../../services/tenant-context');

/** A thenable that does nothing until `.then` — the PrismaPromise shape. */
function lazyThenable(work) {
    let started = null;
    return {
        calls: 0,
        then(onFulfilled, onRejected) {
            this.calls += 1;
            if (!started) {
                started = Promise.resolve().then(work);
            }
            return started.then(onFulfilled, onRejected);
        },
    };
}

describe('withoutTenantScope — lazy thenable returned by the callback', () => {
    test('the lazy work runs with no tenant bound, even when the caller holds org A', async () => {
        let observed;
        const result = await runWithTenantContext({ organizationId: 'org-A' }, async () => {
            const r = await withoutTenantScope(() => lazyThenable(() => {
                observed = { ctx: getTenantContext(), bypass: isWithoutTenantScope() };
                return 7;
            }));
            // the caller's own tenant is untouched afterwards
            expect(getTenantContext()).toEqual({ organizationId: 'org-A' });
            return r;
        });
        expect(result).toBe(7);
        expect(observed).toEqual({ ctx: null, bypass: true });
    });

    test('the lazy work is started exactly once', async () => {
        const t = lazyThenable(() => 1);
        await runWithTenantContext({ organizationId: 'org-A' }, async () => {
            await withoutTenantScope(() => t);
        });
        expect(t.calls).toBe(1);
    });

    test('a rejection from the lazy work reaches the caller unchanged', async () => {
        const boom = new Error('boom');
        await expect(runWithTenantContext({ organizationId: 'org-A' }, async () => (
            withoutTenantScope(() => lazyThenable(() => { throw boom; }))
        ))).rejects.toBe(boom);
    });

    test('a non-thenable return value comes back synchronously and unchanged', () => {
        const obj = { a: 1 };
        runWithTenantContext({ organizationId: 'org-A' }, () => {
            expect(withoutTenantScope(() => obj)).toBe(obj);
            expect(withoutTenantScope(() => 5)).toBe(5);
            expect(withoutTenantScope(() => undefined)).toBeUndefined();
            expect(withoutTenantScope(() => null)).toBeNull();
        });
    });

    test('a synchronous throw still propagates synchronously', () => {
        expect(() => withoutTenantScope(() => { throw new Error('sync'); })).toThrow('sync');
    });

    test('an async callback still runs every await with no tenant bound', async () => {
        const seen = [];
        await runWithTenantContext({ organizationId: 'org-A' }, async () => {
            await withoutTenantScope(async () => {
                seen.push(getTenantContext());
                await new Promise((r) => setImmediate(r));
                seen.push(isWithoutTenantScope());
            });
        });
        expect(seen).toEqual([null, true]);
    });
});

describe('withoutTenantScope — a real PrismaPromise (no database needed)', () => {
    // eslint-disable-next-line global-require
    const { PrismaClient } = require('@prisma/client');
    const hookSaw = [];
    // Unreachable url: the recording hook returns without calling query(),
    // so the engine is never asked to connect.
    const client = new PrismaClient({
        datasources: { db: { url: 'postgresql://unused:unused@127.0.0.1:1/unused' } },
    }).$extends({
        query: {
            $allModels: {
                async count() {
                    hookSaw.push({ ctx: getTenantContext(), bypass: isWithoutTenantScope() });
                    return 42;
                },
            },
        },
    });

    afterAll(async () => { await client.$disconnect().catch(() => {}); });

    test('prisma.user.count returned un-awaited runs its extension hooks with no tenant', async () => {
        hookSaw.length = 0;
        const n = await runWithTenantContext({ organizationId: 'org-A' }, async () => (
            withoutTenantScope(() => client.user.count({ where: {} }))
        ));
        expect(n).toBe(42);
        expect(hookSaw).toEqual([{ ctx: null, bypass: true }]);
    });

    test('control: the same call made directly under org A sees org A', async () => {
        hookSaw.length = 0;
        await runWithTenantContext({ organizationId: 'org-A' }, async () => client.user.count({ where: {} }));
        expect(hookSaw).toEqual([{ ctx: { organizationId: 'org-A' }, bypass: false }]);
    });
});
