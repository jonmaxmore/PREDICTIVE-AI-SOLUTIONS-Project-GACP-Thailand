/**
 * RLS Phase 0 (shadow / measure-first) — Task 3 integration: GUC reaches
 * the connection, on a REAL Postgres.
 *
 * Task 3 wires findUnique/update/delete/upsert to (when RLS_SHADOW_GUC=
 * true) wrap their bound query in a batch $transaction that pins
 * app.tenant_id (or app.rls_bypass) via set_config(..., true) first. The
 * unit suite (__tests__/unit/rls-shadow-guc.test.js) proves the WIRING
 * against mocked clients; THIS file proves the MECHANISM against a real
 * connection: the GUC set by element 1 of the batch is actually visible to
 * element 2 (same pinned connection, same transaction — set_config's
 * `is_local=true` means it also dies at COMMIT, so it can't leak into the
 * next op on a pooled connection), and that a real row lookup through the
 * wired findUnique hook is UNCHANGED with the flag on (RLS policy is still
 * `SELECT TRUE`, permissive — Phase 0 enforces nothing).
 *
 * IMPORTANT — how the GUC-visibility probe works: `withTenantGuc` batches
 * `[client.$executeRawUnsafe(SET_CONFIG), query(args)]` into ONE
 * `client.$transaction([...])` call. For that batching to actually pin both
 * statements to the same connection/transaction, EVERY element of the array
 * must be a Prisma "lazy" promise — i.e. the raw, un-awaited return value of
 * calling a Prisma client method — handed to `$transaction` without ever
 * being awaited first. In real production `query` is Prisma's own "next in
 * the extension chain" callback, always lazy. Below, the tests that want to
 * observe `current_setting(...)` pass a substitute `query` of the shape
 * `() => scopedPrisma.$queryRawUnsafe(sql)` — a PLAIN function returning the
 * lazy promise directly. An `async () => { return await ...; }` wrapper
 * would NOT work here: awaiting inside the wrapper dispatches
 * $queryRawUnsafe as its own standalone operation before it can ever reach
 * the batch array, decoupling it from the SET_CONFIG statement and making
 * the probe pass or fail for the wrong reason. This is a deliberately
 * hand-written substitute query for observability only — production call
 * sites never do this; they pass Prisma's own bound `query`.
 *
 * Gated the same way as the repo's other real-Postgres integration tests —
 * copied verbatim from __tests__/integration/tenant-isolation-cross-org-be.test.js
 * (DATABASE_URL presence only; no separate REQUIRE_DB env var exists
 * anywhere in this repo — grepped clean, see task-3-report.md). Skips
 * cleanly without a DB. RLS_SHADOW_GUC is set/restored INSIDE this suite, so
 * `DATABASE_URL=... npx jest rls-shadow-guc.int -i` is enough to run it for
 * real — see task-3-report.md for the exact operator command.
 */

'use strict';

const { PrismaClient } = require('@prisma/client');
const { prisma: scopedPrisma } = require('../../services/prisma-database');
const { runWithTenantContext, withoutTenantScope } = require('../../services/tenant-context');
const { tenantInjectExtension } = require('../../services/tenant-prisma-extension');

// Not `Boolean(process.env.DATABASE_URL)`: jest.setup.js:104 pins that variable on every
// run, so the old HAS_DB was always true — this suite never skipped and died on connection
// refused. Ask the run-level guard what it actually probed; it names the reason in the title.
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

const findUniqueHook = tenantInjectExtension.query.$allModels.findUnique;

d('RLS Phase 0 Task 3 — GUC reaches the connection (real Postgres)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw; // un-extended client: seeds/cleans without tenant scoping
    let orgAId;
    let userAId;
    let canonA;
    const ORIGINAL_FLAG = process.env.RLS_SHADOW_GUC;

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const orgA = await raw.organization.create({
            data: { name: 'RLS-T3 Tenant A', slug: `rls-t3-a-${suffix}`, code: `RLST3A_${suffix}`.toUpperCase().slice(0, 24) },
        });
        orgAId = orgA.id;
        canonA = `rls-t3-a-user-${suffix}`;
        const userA = await raw.user.create({
            data: { canonicalId: canonA, password: 'x', authType: 'EMAIL_LEGACY', organizationId: orgAId },
        });
        userAId = userA.id;
        process.env.RLS_SHADOW_GUC = 'true';
    });

    afterAll(async () => {
        await raw.user.deleteMany({ where: { canonicalId: canonA } }).catch(() => {});
        await raw.organization.deleteMany({ where: { id: orgAId } }).catch(() => {});
        await raw.$disconnect();
        if (ORIGINAL_FLAG === undefined) { delete process.env.RLS_SHADOW_GUC; }
        else { process.env.RLS_SHADOW_GUC = ORIGINAL_FLAG; }
    });

    test('tenant context bound: set_config(app.tenant_id, orgId) is visible to the SECOND statement in the same batch transaction', async () => {
        const rows = await runWithTenantContext({ organizationId: orgAId }, () =>
            findUniqueHook({
                model: 'User', // any TENANT_SCOPED_MODELS entry — only gates isTenantScoped()
                args: {},
                query: () => scopedPrisma.$queryRawUnsafe(`SELECT current_setting('app.tenant_id', true) AS tid`),
                // no `client` passed -> falls back to getClosureExtendedClient(),
                // which resolves the real fully-extended `prisma` singleton --
                // this also exercises the closure-capture fallback path for
                // real, since real Prisma never puts `client` on hook args.
            }),
        );
        expect(rows[0].tid).toBe(orgAId); // the GUC set in element 0 reached element 1's connection
    });

    test('withoutTenantScope: set_config(app.rls_bypass, on) is visible to the SECOND statement in the same batch transaction', async () => {
        const rows = await withoutTenantScope(() =>
            findUniqueHook({
                model: 'User',
                args: {},
                query: () => scopedPrisma.$queryRawUnsafe(`SELECT current_setting('app.rls_bypass', true) AS bypass`),
            }),
        );
        expect(rows[0].bypass).toBe('on');
    });

    test('a real findUnique through the actual model still returns the row — policy is permissive (SELECT TRUE), zero result change', async () => {
        const row = await runWithTenantContext({ organizationId: orgAId }, () =>
            scopedPrisma.user.findUnique({ where: { id: userAId } }),
        );
        expect(row).not.toBeNull();
        expect(row.id).toBe(userAId);
        expect(row.organizationId).toBe(orgAId);
    });

    test('SET LOCAL does not leak: a later standalone query on the pool sees no residual app.tenant_id', async () => {
        // set_config(..., true) = SET LOCAL, transaction-scoped; it must die at
        // COMMIT so a pooled connection never carries org A's id into the next,
        // unrelated op (this is what prototype-probe.js case C already proved
        // for the raw mechanism — this asserts the SAME property end-to-end
        // through the wired hook used above).
        const rows = await scopedPrisma.$queryRawUnsafe(`SELECT current_setting('app.tenant_id', true) AS tid`);
        expect(rows[0].tid).toBeFalsy();
    });

    test('BENCHMARK — latency delta of the 2-statement GUC form vs a bare query, over a findUnique loop (recorded in task-3-report.md)', async () => {
        const ITER = 50;

        process.env.RLS_SHADOW_GUC = 'false';
        const t0 = process.hrtime.bigint();
        for (let i = 0; i < ITER; i++) {
            await runWithTenantContext({ organizationId: orgAId }, () =>
                scopedPrisma.user.findUnique({ where: { id: userAId } }),
            );
        }
        const t1 = process.hrtime.bigint();
        const bareMs = Number(t1 - t0) / 1e6;

        process.env.RLS_SHADOW_GUC = 'true';
        const t2 = process.hrtime.bigint();
        for (let i = 0; i < ITER; i++) {
            await runWithTenantContext({ organizationId: orgAId }, () =>
                scopedPrisma.user.findUnique({ where: { id: userAId } }),
            );
        }
        const t3 = process.hrtime.bigint();
        const gucMs = Number(t3 - t2) / 1e6;

        const deltaMs = gucMs - bareMs;
        console.log(
            `[RLS-T3 BENCHMARK] ${ITER} findUnique ops — bare: ${bareMs.toFixed(2)}ms total ` +
            `(${(bareMs / ITER).toFixed(3)}ms/op), GUC-wrapped: ${gucMs.toFixed(2)}ms total ` +
            `(${(gucMs / ITER).toFixed(3)}ms/op), delta: ${deltaMs.toFixed(2)}ms total ` +
            `(${(deltaMs / ITER).toFixed(3)}ms/op extra per op).`,
        );
        // Measurement only — no pass/fail threshold (staging hardware/network
        // varies; a fixed ms budget here would just be a flaky assertion).
        // The number to act on is the console.log line above.
        expect(Number.isFinite(deltaMs)).toBe(true);
    });
});
