/**
 * ENT-01 (Gap-1) integration — CROSS-TENANT READ ISOLATION, on a REAL Postgres.
 *
 * The invariant every tenant system must hold: while acting inside org B's
 * request context, a read returns ONLY org B's rows — never org A's. This is
 * asserted against real Postgres because it is a data-layer property, not a
 * route/handler property.
 *
 * WHY THIS IS RED-FIRST (expected to FAIL until the fix lands):
 * Today the org read-scope is gated behind env TENANT_READ_ORG_SCOPE, which is
 * DEFAULT OFF in prod (docker-compose.production.yml `:-false`), and the RLS
 * policy is an inert no-op (migration 20260502060000_rls_quiet_observe_only:
 * `rls_observe_check` = SELECT TRUE; app never sets app.tenant_id). So with no
 * flag set — exactly the prod default — a findMany/count executed inside org B's
 * tenant context returns org A's rows. That is a silent cross-tenant leak. These
 * tests encode the correct end state (isolation) and therefore FAIL now.
 *
 * The GREEN fix makes the org read-scope enforce whenever a tenant context is
 * bound (admin/cron/public paths use withoutTenantScope → no context → unaffected;
 * see tenant-prisma-extension.js "SAFE BY CONSTRUCTION"). findUnique/update/delete
 * by-id are a deeper (RLS/GUC) layer tracked separately — intentionally NOT
 * asserted here so this suite has a clean RED→GREEN via the read-scope fix.
 *
 * Model under test: `User` — tenant-scoped (organizationId) but NOT entity-scoped,
 * so the ONLY dimension that can isolate it is organization. That keeps this a
 * pure org-leak proof, uncontaminated by the always-on entity filter.
 *
 * Requires DATABASE_URL → a migrated Postgres; skips cleanly otherwise.
 */

const { PrismaClient } = require('@prisma/client');
const { prisma: scopedPrisma } = require('../../services/prisma-database');
const { runWithTenantContext } = require('../../services/tenant-context');

// Not `Boolean(process.env.DATABASE_URL)`: jest.setup.js:104 pins that variable on every
// run, so the old HAS_DB was always true — this suite never skipped and died on connection
// refused. Ask the run-level guard what it actually probed; it names the reason in the title.
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

d('ENT-01 — cross-tenant read isolation (organization dimension)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw; // un-extended client: seeds/cleans across tenants without scoping
    let orgAId;
    let orgBId;
    let canonA;
    let canonB;

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const orgA = await raw.organization.create({
            data: { name: 'ENT01 Tenant A', slug: `ent01-a-${suffix}`, code: `ENT01A_${suffix}`.toUpperCase().slice(0, 24) },
        });
        const orgB = await raw.organization.create({
            data: { name: 'ENT01 Tenant B', slug: `ent01-b-${suffix}`, code: `ENT01B_${suffix}`.toUpperCase().slice(0, 24) },
        });
        orgAId = orgA.id;
        orgBId = orgB.id;
        canonA = `ent01-a-user-${suffix}`;
        canonB = `ent01-b-user-${suffix}`;
        await raw.user.create({ data: { canonicalId: canonA, password: 'x', authType: 'EMAIL_LEGACY', organizationId: orgAId } });
        await raw.user.create({ data: { canonicalId: canonB, password: 'x', authType: 'EMAIL_LEGACY', organizationId: orgBId } });
    });

    afterAll(async () => {
        await raw.user.deleteMany({ where: { canonicalId: { in: [canonA, canonB].filter(Boolean) } } }).catch(() => {});
        await raw.organization.deleteMany({ where: { id: { in: [orgAId, orgBId].filter(Boolean) } } }).catch(() => {});
        await raw.$disconnect();
    });

    test('findMany inside org B context returns ONLY org B rows (no org A leak)', async () => {
        // Prisma queries are LAZY: the callback must AWAIT the query so it executes
        // INSIDE the tenant context. storage.run() returns before a returned-but-
        // unawaited promise runs, which would leave getTenantContext() null and skip
        // the org filter entirely — masking whether the fix works. This mirrors how a
        // real request handler awaits its reads within runWithTenantContext.
        const seen = await runWithTenantContext({ organizationId: orgBId }, async () => {
            return await scopedPrisma.user.findMany({ where: { canonicalId: { in: [canonA, canonB] } } });
        });
        const orgs = seen.map((u) => u.organizationId);
        // Isolation invariant — acting as B, org A must be invisible.
        expect(orgs).not.toContain(orgAId);
        expect(seen.some((u) => u.canonicalId === canonA)).toBe(false);
        // ...while B's own row stays visible (the scope narrows, not blanks).
        expect(seen.some((u) => u.canonicalId === canonB)).toBe(true);
    });

    test('count inside org B context does not count org A rows', async () => {
        const n = await runWithTenantContext({ organizationId: orgBId }, async () => {
            return await scopedPrisma.user.count({ where: { canonicalId: { in: [canonA, canonB] } } });
        });
        expect(n).toBe(1); // only B's user, never 2
    });
});
