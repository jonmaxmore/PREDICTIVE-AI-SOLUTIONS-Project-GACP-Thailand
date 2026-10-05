/**
 * WF-F7 integration — optimistic concurrency on Application.version, verified
 * against a REAL Postgres (not a mock). Proves the lost-update / double-advance
 * race the audit flagged is actually closed:
 *
 *   - two writers both read version N
 *   - the first commits (row → version N+1)
 *   - the second, still scoped to version N, matches 0 rows and is rejected
 *     with CONCURRENCY_CONFLICT instead of silently clobbering the first
 *
 * Requires DATABASE_URL pointing at a migrated Postgres. Skips itself cleanly
 * when no database is reachable so the unit-only CI lane stays green.
 */

const { PrismaClient } = require('@prisma/client');
const { writeApplicationStatus } = require('../../services/application-status-writer');

// Not `Boolean(process.env.DATABASE_URL)`: jest.setup.js:104 pins that variable on every
// run, so the old HAS_DB was always true — this suite never skipped and died on connection
// refused. Ask the run-level guard what it actually probed; it names the reason in the title.
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

d('WF-F7 — optimistic lock against real Postgres', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let prisma;
    let appId;
    let orgId;
    let healthId;

    beforeAll(async () => {
        prisma = new PrismaClient();
        await prisma.$connect();
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        // Application.organizationId → Organization FK; Application.healthId →
        // User.canonicalId FK. Seed both throwaway parents.
        const org = await prisma.organization.create({
            data: {
                name: 'WF-F7 Test Org',
                slug: `wf-f7-${suffix}`,
                code: `WFF7_${suffix}`.toUpperCase().slice(0, 24),
            },
        });
        orgId = org.id;
        healthId = `wf-f7-canon-${suffix}`;
        await prisma.user.create({
            data: {
                canonicalId: healthId,
                password: 'x', // unused — never authenticated in this test
                organizationId: orgId,
                // users_auth_type_identity_ck requires HEALTH_ID rows to carry a
                // healthId; EMAIL_LEGACY has no identity-field requirement, which
                // is all we need for a throwaway FK parent.
                authType: 'EMAIL_LEGACY',
            },
        });
    });

    afterAll(async () => {
        if (appId) {
            await prisma.application.deleteMany({ where: { id: appId } }).catch(() => {});
        }
        if (healthId) {
            await prisma.user.deleteMany({ where: { canonicalId: healthId } }).catch(() => {});
        }
        if (orgId) {
            await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
        }
        await prisma.$disconnect();
    });

    beforeEach(async () => {
        const created = await prisma.application.create({
            data: {
                applicationNumber: `WF-F7-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                healthId,
                areaType: 'OUTDOOR',
                organizationId: orgId,
                status: 'AUDIT_CONFIRMED',
            },
        });
        appId = created.id;
        // Sanity: a freshly created row starts at version 1 (schema @default(1)).
        expect(created.version).toBe(1);
    });

    afterEach(async () => {
        if (appId) {
            await prisma.application.deleteMany({ where: { id: appId } }).catch(() => {});
            appId = null;
        }
    });

    test('a single versioned write advances version 1 → 2', async () => {
        await writeApplicationStatus({
            prisma,
            applicationId: appId,
            fromStatus: 'AUDIT_CONFIRMED',
            toStatus: 'AUDIT_PASSED',
            actorId: 'auditor-1',
            actorRole: 'AUDITOR',
            expectedVersion: 1,
            autoIssueCertificate: false, // isolate the lock behaviour from cert issuance
        });
        const row = await prisma.application.findUnique({ where: { id: appId } });
        expect(row.version).toBe(2);
        expect(row.status).toBe('AUDIT_PASSED');
    });

    test('two writers reading the same version: first wins, second hits CONCURRENCY_CONFLICT', async () => {
        // Both read version 1.
        const writerA = writeApplicationStatus({
            prisma,
            applicationId: appId,
            fromStatus: 'AUDIT_CONFIRMED',
            toStatus: 'AUDIT_PASSED',
            actorId: 'auditor-A',
            actorRole: 'AUDITOR',
            expectedVersion: 1,
            autoIssueCertificate: false,
        });
        // Run A to completion first to make the ordering deterministic, THEN
        // fire B which still believes the row is at version 1.
        await writerA;

        await expect(
            writeApplicationStatus({
                prisma,
                applicationId: appId,
                fromStatus: 'AUDIT_CONFIRMED',
                toStatus: 'REJECTED',
                actorId: 'auditor-B',
                actorRole: 'AUDITOR',
                expectedVersion: 1, // stale — A already bumped it to 2
                autoIssueCertificate: false,
            }),
        ).rejects.toMatchObject({ code: 'CONCURRENCY_CONFLICT' });

        // The losing write must NOT have taken effect.
        const row = await prisma.application.findUnique({ where: { id: appId } });
        expect(row.status).toBe('AUDIT_PASSED'); // A's value, not B's REJECTED
        expect(row.version).toBe(2); // advanced exactly once
    });

    test('without expectedVersion, the write still advances version (last-write-wins)', async () => {
        await writeApplicationStatus({
            prisma,
            applicationId: appId,
            fromStatus: 'AUDIT_CONFIRMED',
            toStatus: 'AUDIT_PASSED',
            actorId: 'auditor-1',
            actorRole: 'AUDITOR',
            autoIssueCertificate: false,
        });
        const row = await prisma.application.findUnique({ where: { id: appId } });
        expect(row.version).toBe(2);
    });
});
