/**
 * BE-T1 integration — the AUDIT_PASSED status flip and certificate issuance must
 * commit (or roll back) as ONE unit. This asserts the underlying guarantee the
 * fix depends on, against a REAL Postgres: a writeApplicationStatus performed
 * inside prisma.$transaction is durably reverted if that transaction later
 * throws — so a cert-generation failure can never leave a row stranded in
 * AUDIT_PASSED with no certificate.
 *
 * Requires DATABASE_URL → a migrated Postgres; skips cleanly otherwise.
 */

const { PrismaClient } = require('@prisma/client');
const { writeApplicationStatus } = require('../../services/application-status-writer');

// Not `Boolean(process.env.DATABASE_URL)`: jest.setup.js:104 pins that variable on every
// run, so the old HAS_DB was always true — this suite never skipped and died on connection
// refused. Ask the run-level guard what it actually probed; it names the reason in the title.
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

d('BE-T1 — status flip is atomic with the surrounding transaction', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let prisma;
    let appId;
    let orgId;
    let healthId;

    beforeAll(async () => {
        prisma = new PrismaClient();
        await prisma.$connect();
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const org = await prisma.organization.create({
            data: {
                name: 'BE-T1 Test Org',
                slug: `be-t1-${suffix}`,
                code: `BET1_${suffix}`.toUpperCase().slice(0, 24),
            },
        });
        orgId = org.id;
        healthId = `be-t1-canon-${suffix}`;
        await prisma.user.create({
            data: {
                canonicalId: healthId,
                password: 'x',
                organizationId: orgId,
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
                applicationNumber: `BE-T1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                healthId,
                areaType: 'OUTDOOR',
                organizationId: orgId,
                status: 'AUDIT_CONFIRMED',
            },
        });
        appId = created.id;
    });

    afterEach(async () => {
        if (appId) {
            await prisma.application.deleteMany({ where: { id: appId } }).catch(() => {});
            appId = null;
        }
    });

    test('a status write inside a transaction that later throws is rolled back (no orphan AUDIT_PASSED)', async () => {
        const boom = new Error('cert generation blew up after the status flip');

        await expect(
            prisma.$transaction(async (tx) => {
                await writeApplicationStatus({
                    prisma: tx,
                    applicationId: appId,
                    fromStatus: 'AUDIT_CONFIRMED',
                    toStatus: 'AUDIT_PASSED',
                    actorId: 'auditor-1',
                    actorRole: 'AUDITOR',
                    autoIssueCertificate: false, // we simulate the failure ourselves, below
                });
                // Simulate generateCertificate throwing *after* the status flip —
                // exactly the partial-failure window BE-T1 closes.
                throw boom;
            }),
        ).rejects.toBe(boom);

        // The status flip must have been undone by the transaction rollback.
        const row = await prisma.application.findUnique({ where: { id: appId } });
        expect(row.status).toBe('AUDIT_CONFIRMED'); // NOT AUDIT_PASSED
        expect(row.version).toBe(1); // increment rolled back too
    });

    test('a status write inside a transaction that commits is durable', async () => {
        await prisma.$transaction(async (tx) => {
            await writeApplicationStatus({
                prisma: tx,
                applicationId: appId,
                fromStatus: 'AUDIT_CONFIRMED',
                toStatus: 'AUDIT_PASSED',
                actorId: 'auditor-1',
                actorRole: 'AUDITOR',
                autoIssueCertificate: false,
            });
        });
        const row = await prisma.application.findUnique({ where: { id: appId } });
        expect(row.status).toBe('AUDIT_PASSED');
        expect(row.version).toBe(2);
    });
});
