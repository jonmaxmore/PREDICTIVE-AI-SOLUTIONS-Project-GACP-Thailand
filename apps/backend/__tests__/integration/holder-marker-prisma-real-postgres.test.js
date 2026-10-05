'use strict';

/**
 * The HOLDER_SCOPED marker is a symbol key on a Prisma `where` object
 * (spec 2026-09-30 §3.1). This suite pins, on a real Postgres and on the
 * Prisma this repo runs (5.22.0, plan conflict C2), that:
 *   - Prisma ignores the symbol key: a marked where returns the seeded row and
 *     does not throw, at the top level and inside a relation filter;
 *   - the same holds through the tenantInjectExtension client, with a tenant and
 *     an entity context bound so the extension actually rewrites `where`;
 *   - R(user) computed against the real schema drops a PENDING membership and a
 *     membership on a soft-deleted entity (the `entity: { isDeleted: false }`
 *     relation filter runs in SQL, not in a mock);
 *   - (Task 2) Prisma accepts the deep-frozen fragments as args, top level,
 *     relation and Farm OR shapes, unspread;
 *   - (Task 2) a query-extension hook does NOT see the symbol: Prisma 5.22
 *     deep-clones args for every hook (runtime `_a(t.args)`), so the read
 *     witness checks by value instead: holderReadWhere/farmAccessWhere register
 *     each fragment's canonical form in the request's tenant context, and the
 *     witness logs model, op, route and principal
 *     (holder-read-witness-real-postgres.test.js). The spec's WeakSet fallback
 *     is replaced by that value registration: a WeakSet on the `in` arrays fails
 *     for the same reason (the hook gets new arrays).
 * The symbol marker still guards in-process code and unit callers. Skips cleanly
 * without a migrated test database.
 */

const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');
const { tenantInjectExtension } = require('../../services/tenant-prisma-extension');
const { runWithTenantContext } = require('../../services/tenant-context');
const { runWithEntityContext } = require('../../services/entity-context');
const {
    HOLDER_SCOPED,
    holderScopeForUser,
    holderReadWhere,
    hasHolderMarker,
    markHolderScoped,
} = require('../../services/holder-access');

d('HOLDER_SCOPED marker on Prisma 5.22 (real Postgres)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let extended;
    const suffix = crypto.randomUUID().slice(0, 8);
    const fx = { entities: [], apps: [] };

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        extended = raw.$extends(tenantInjectExtension);

        const org = await raw.organization.create({
            data: { name: `hm-${suffix}`, slug: `hm-${suffix}`, code: `HM_${suffix}`.toUpperCase() },
        });
        fx.orgId = org.id;
        fx.userId = crypto.randomUUID();
        await raw.user.create({
            data: {
                id: fx.userId, canonicalId: `hm-${suffix}`, password: 'x', role: 'health', authType: 'EMAIL_LEGACY',
                email: `hm-${suffix}@example.test`, firstName: 'ทดสอบ', lastName: 'marker', organizationId: fx.orgId,
            },
        });

        const entity = async (label, extra = {}) => {
            const row = await raw.entity.create({
                data: { type: 'JURISTIC', displayName: `บริษัท ${label} จำกัด`, organizationId: fx.orgId, ...extra },
            });
            fx.entities.push(row.id);
            return row.id;
        };
        fx.X = await entity('live');
        fx.Y = await entity('deleted', { isDeleted: true, deletedAt: new Date() });
        fx.Z = await entity('pending');
        fx.W = await entity('revoked');

        const join = (entityId, role, status) => raw.entityMembership.create({
            data: { userId: fx.userId, entityId, role, status, organizationId: fx.orgId },
        });
        await join(fx.X, 'VIEWER', 'ACTIVE');
        await join(fx.Y, 'OWNER', 'ACTIVE');
        await join(fx.Z, 'OWNER', 'PENDING');
        await join(fx.W, 'OWNER', 'REVOKED');

        const application = await raw.application.create({
            data: {
                applicationNumber: `APP-HM-${suffix}`, healthId: `hm-${suffix}`, areaType: 'OUTDOOR',
                organizationId: fx.orgId, entityId: fx.X, status: 'DRAFT',
            },
        });
        fx.apps.push(application.id);
        fx.appId = application.id;
    });

    afterAll(async () => {
        if (!raw) { return; }
        await raw.application.deleteMany({ where: { id: { in: fx.apps } } }).catch(() => {});
        await raw.entityMembership.deleteMany({ where: { entityId: { in: fx.entities } } }).catch(() => {});
        await raw.entity.deleteMany({ where: { id: { in: fx.entities } } }).catch(() => {});
        if (fx.userId) { await raw.user.deleteMany({ where: { id: fx.userId } }).catch(() => {}); }
        if (fx.orgId) { await raw.organization.deleteMany({ where: { id: fx.orgId } }).catch(() => {}); }
        await raw.$disconnect();
    });

    test('R(user) on the real schema: ACTIVE on a live entity only (no PENDING, no REVOKED, no deleted entity)', async () => {
        const scope = await holderScopeForUser(fx.userId);
        expect(scope.readIds).toEqual([fx.X]);
        expect(scope.editIds).toEqual([]);
    });

    test('Prisma 5.22 ignores the symbol key', async () => {
        const scope = await holderScopeForUser(fx.userId);
        const where = { ...holderReadWhere(scope, 'Application'), isDeleted: false };
        expect(hasHolderMarker(where)).toBe(true);
        // The symbol's value is an object (the vouch list), not a flag — Prisma must ignore that too.
        expect(Array.isArray(where[HOLDER_SCOPED])).toBe(true);
        const rows = await raw.application.findMany({ where, select: { id: true } });
        expect(rows.map((r) => r.id)).toEqual([fx.appId]);
    });

    test('the seeded memberships are really there (the R(user) test is not vacuous)', async () => {
        const rows = await raw.entityMembership.findMany({
            where: { userId: fx.userId }, select: { entityId: true, status: true },
        });
        expect(rows).toHaveLength(4);
        expect(rows.find((r) => r.entityId === fx.W).status).toBe('REVOKED');
    });

    test('a spread-then-override where is unscoped by the marker check', async () => {
        const scope = await holderScopeForUser(fx.userId);
        expect(hasHolderMarker({ ...holderReadWhere(scope, 'Application'), entityId: fx.W })).toBe(false);
    });

    test('Prisma 5.22 ignores the symbol key inside a relation filter', async () => {
        const where = { id: fx.appId, entity: markHolderScoped({ isDeleted: false }) };
        const rows = await raw.application.findMany({ where, select: { id: true } });
        expect(rows.map((r) => r.id)).toEqual([fx.appId]);
    });

    test('an empty scope still fails closed on the real database', async () => {
        const where = holderReadWhere({ userId: fx.userId, readIds: [], editIds: [] }, 'Application');
        await expect(raw.application.count({ where })).resolves.toBe(0);
    });

    test('the same holds through the tenantInjectExtension client (tenant + entity context bound)', async () => {
        const scope = await holderScopeForUser(fx.userId);
        const where = { ...holderReadWhere(scope, 'Application'), isDeleted: false };
        // `async () => await` starts the lazy PrismaPromise INSIDE the bound
        // contexts; returning it unawaited would run it after both have exited.
        const rows = await runWithTenantContext({ organizationId: fx.orgId }, () => runWithEntityContext(
            { entityId: fx.X, role: 'VIEWER', personal: false },
            async () => await extended.application.findMany({ where, select: { id: true } }),
        ));
        expect(rows.map((r) => r.id)).toEqual([fx.appId]);
        expect(hasHolderMarker(where)).toBe(true);
        const first = await runWithTenantContext({ organizationId: fx.orgId }, async () => await extended.application.findFirst({
            where: { id: fx.appId, ...holderReadWhere(scope, 'Application') },
            select: { id: true },
        }));
        expect(first).toEqual({ id: fx.appId });
    });
    test('(Task 2) Prisma 5.22 accepts deep-frozen fragments passed unspread', async () => {
        const scope = await holderScopeForUser(fx.userId);
        const app = holderReadWhere(scope, 'Application');
        const invoice = holderReadWhere(scope, 'Invoice');
        const farm = holderReadWhere(scope, 'Farm');
        expect([app, invoice, farm].every(Object.isFrozen)).toBe(true);
        expect(Object.isFrozen(app.entityId.in)).toBe(true);
        const rows = await raw.application.findMany({ where: app, select: { id: true } });
        expect(rows.map((r) => r.id)).toEqual([fx.appId]);
        await expect(raw.invoice.count({ where: invoice })).resolves.toBe(0);
        await expect(raw.farm.count({ where: farm })).resolves.toBe(0);
        await expect(extended.application.count({ where: app })).resolves.toBe(1);
    });

    test('(Task 2) a query hook receives a clone: the symbol marker does not reach it', async () => {
        const seen = [];
        const spy = raw.$extends({
            query: { $allModels: { async findMany({ args, query }) {
                seen.push(Object.getOwnPropertySymbols(args.where || {}).length);
                return query(args);
            } } },
        });
        const scope = await holderScopeForUser(fx.userId);
        const where = holderReadWhere(scope, 'Application');
        expect(hasHolderMarker(where)).toBe(true);
        await spy.application.findMany({ where, select: { id: true } });
        expect(seen).toEqual([0]);
    });
});
