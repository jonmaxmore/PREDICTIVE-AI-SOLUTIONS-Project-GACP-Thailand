/**
 * [R-HOTFIX-PDPA] PDPA retention sweep vs legal hold — verified against a REAL
 * Postgres, not a mock.
 *
 * The unit suite (__tests__/unit/pdpa-retention-job.test.js) pins the sweep's
 * behaviour against a mocked Prisma client: it proves the job ASKS for the right
 * thing. It cannot prove the database AGREES — that `User.legalHold` exists
 * (prisma/schema/auth.prisma:162), that `legalHold: false` is a valid predicate
 * on it, and that a held row therefore survives a real sweep with its identity
 * columns intact.
 *
 * That distinction matters more than usual here: anonymization nulls the identity
 * columns AND their hash columns, so a false negative is unrecoverable and
 * un-correlatable. Every assertion below reads the row back out of Postgres after
 * the real job has run.
 *
 * Seeding and verification deliberately use a RAW PrismaClient rather than the
 * app client from services/prisma-database: the app client carries the tenant-scope
 * and soft-delete extensions, and we want ground truth, not a filtered view. The
 * sweep itself still runs through its own client, exactly as the cron does.
 *
 * Requires DATABASE_URL pointing at a migrated Postgres. Skips itself cleanly
 * when no database is reachable so the unit-only CI lane stays green.
 */

const { PrismaClient } = require('@prisma/client');
const { runPdpaRetentionSweep } = require('../../jobs/pdpa-retention-job');
const { legalHoldExclusion } = require('../../shared/legal-hold-guard');

// Not `Boolean(process.env.DATABASE_URL)`: jest.setup.js:104 pins that variable on every
// run, so the old HAS_DB was always true — this suite never skipped and died on connection
// refused. Ask the run-level guard what it actually probed; it names the reason in the title.
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

// Decades past any plausible retention window. Operator decision 2026-08-03: a
// held row is skipped permanently, so age must make no difference whatsoever.
const LONG_PAST = new Date('1990-01-01T00:00:00.000Z');

d('[R-HOTFIX-PDPA] retention sweep leaves legal-hold rows intact (real Postgres)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let prisma;
    let orgId;
    /** @type {string[]} */
    let seededUserIds = [];

    beforeAll(async () => {
        prisma = new PrismaClient();
        await prisma.$connect();
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const org = await prisma.organization.create({
            data: {
                name: 'PDPA Legal Hold Test Org',
                slug: `pdpa-hold-${suffix}`,
                code: `PDPAHOLD_${suffix}`.toUpperCase().slice(0, 24),
            },
        });
        orgId = org.id;
    });

    afterEach(async () => {
        if (seededUserIds.length) {
            await prisma.user.deleteMany({ where: { id: { in: seededUserIds } } }).catch(() => {});
            seededUserIds = [];
        }
    });

    afterAll(async () => {
        if (orgId) {
            await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
        }
        await prisma.$disconnect();
    });

    /**
     * Seed one already-expired user. `legalHold` decides whether the sweep may
     * touch it.
     *
     * `identity` picks WHICH identity column the row carries, and it may only
     * ever be one: the database enforces
     *   CHECK (NOT ("healthId" IS NOT NULL AND "providerId" IS NOT NULL))
     * as `users_single_identity_ck` (migration 20260207120000_identity_guardrails).
     * An earlier revision of this fixture set healthId AND providerId on the same
     * row; the mock-based unit tests accepted it because a mock has no constraints,
     * and it only surfaced once this suite actually reached Postgres. Keep them
     * separate — a caller that wants both covered seeds two users.
     *
     * The health variant also carries healthIdHash: hash-only correlation is the
     * last thread back to the data subject, so proving the HASH survives a sweep
     * matters as much as the plaintext.
     */
    async function seedExpiredUser({ legalHold, identity = 'health' }) {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const identityColumns = identity === 'provider'
            ? { providerId: `PID-${suffix}` }
            : { healthId: `HID-${suffix}`, healthIdHash: `HASH-${suffix}` };
        const created = await prisma.user.create({
            data: {
                canonicalId: `pdpa-hold-canon-${suffix}`,
                password: 'x', // unused — never authenticated in this test
                organizationId: orgId,
                // users_auth_type_identity_ck ties HEALTH_ID rows to a healthId;
                // EMAIL_LEGACY imposes no identity-field requirement, which lets us
                // set the identity columns purely as anonymization canaries.
                authType: 'EMAIL_LEGACY',
                ...identityColumns,
                firstName: 'Hold',
                lastName: 'Canary',
                retainUntil: LONG_PAST,
                legalHold,
            },
        });
        seededUserIds.push(created.id);
        return created;
    }

    test('a user under legal hold keeps healthId, providerId and healthIdHash after a real sweep', async () => {
        // Two rows, because users_single_identity_ck forbids one row from holding
        // both identities — together they cover every column the sweep nulls.
        const held = await seedExpiredUser({ legalHold: true, identity: 'health' });
        const heldProvider = await seedExpiredUser({ legalHold: true, identity: 'provider' });

        await runPdpaRetentionSweep();

        const row = await prisma.user.findUnique({ where: { id: held.id } });
        const providerRow = await prisma.user.findUnique({ where: { id: heldProvider.id } });
        // The whole point: identity columns AND the hash are still there.
        expect(row.healthId).toBe(held.healthId);
        expect(row.healthIdHash).toBe(held.healthIdHash);
        expect(providerRow.providerId).toBe(heldProvider.providerId);
        expect(row.firstName).toBe('Hold');
        expect(row.password).not.toBe('PDPA_ANONYMIZED');
        expect(row.isAnonymized).not.toBe(true);
        // The hold is permanent, so the sweep must also leave the two columns that
        // govern eligibility exactly as it found them — no deferral, no release.
        expect(row.legalHold).toBe(true);
        expect(row.retainUntil).toEqual(LONG_PAST);
    });

    test('an expired user with no hold IS anonymized by the same sweep', async () => {
        // Control: proves the test above passes because of the hold, not because
        // the sweep silently did nothing against this database.
        const sweepable = await seedExpiredUser({ legalHold: false, identity: 'health' });
        const sweepableProvider = await seedExpiredUser({ legalHold: false, identity: 'provider' });

        await runPdpaRetentionSweep();

        const row = await prisma.user.findUnique({ where: { id: sweepable.id } });
        const providerRow = await prisma.user.findUnique({ where: { id: sweepableProvider.id } });
        expect(row.healthId).toBeNull();
        expect(row.healthIdHash).toBeNull();
        expect(providerRow.providerId).toBeNull();
        expect(row.firstName).toBeNull();
        expect(row.password).toBe('PDPA_ANONYMIZED');
    });

    test('anonymizedAt is written to Postgres during the sweep and reads back as a real timestamp', async () => {
        // The marker columns were referenced by the job long before they existed in
        // any schema file or migration (R-HOTFIX-PDPA step 2). Asserting that the
        // job SENT them proves nothing — the mocked client in the unit suite accepts
        // any field name. Only a read-back from Postgres proves the write landed.
        const target = await seedExpiredUser({ legalHold: false, identity: 'health' });

        const before = new Date();
        await runPdpaRetentionSweep();
        const after = new Date();

        const row = await prisma.user.findUnique({ where: { id: target.id } });
        expect(row.isAnonymized).toBe(true);
        expect(row.anonymizedAt).not.toBeNull();
        expect(row.anonymizedAt).toBeInstanceOf(Date);
        // Stamped by THIS run — not a column default, not a value left over from an
        // earlier fixture. The job stamps `new Date()` from the same process clock
        // these bounds are read from, and the column keeps millisecond precision.
        expect(row.anonymizedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(row.anonymizedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    test('a row already anonymized is not swept a second time — the marker, not luck, excludes it', async () => {
        const target = await seedExpiredUser({ legalHold: false, identity: 'health' });

        await runPdpaRetentionSweep();

        const afterFirst = await prisma.user.findUnique({ where: { id: target.id } });
        expect(afterFirst.isAnonymized).toBe(true);
        expect(afterFirst.anonymizedAt).toBeInstanceOf(Date);

        // Re-plant an identity canary on the anonymized row. `retainUntil` is still
        // LONG_PAST and `legalHold` is still false, so `isAnonymized` is now the ONLY
        // predicate standing between this row and the next sweep. If the marker had
        // not persisted, the second run would null this value straight back out —
        // and, because the sweep also nulls the hash columns, would keep doing so to
        // every already-anonymized row in the table every single night.
        const replanted = await prisma.user.update({
            where: { id: target.id },
            data: { firstName: 'Second Pass Canary' },
        });

        await runPdpaRetentionSweep();

        const afterSecond = await prisma.user.findUnique({ where: { id: target.id } });
        expect(afterSecond.firstName).toBe('Second Pass Canary');
        // The audit trail is not rewritten either: the row records when it was
        // anonymized, once. `updatedAt` (@updatedAt, millisecond precision, bumped by
        // the re-plant above) is the discriminator — an untouched row still carries
        // the timestamp of the re-plant. `sessionsRevokedAt` is deliberately NOT used
        // here: utils/session-epoch.js rounds it up to the next whole second, so two
        // sweeps inside the same second would produce an identical stamp and prove
        // nothing.
        expect(afterSecond.anonymizedAt.getTime()).toBe(afterFirst.anonymizedAt.getTime());
        expect(afterSecond.updatedAt.getTime()).toBe(replanted.updatedAt.getTime());
    });

    test('Postgres accepts the guard predicate and excludes the held row from the candidate set', async () => {
        // Schema-agreement check: if `legalHold` were missing or mistyped, this
        // query would throw rather than quietly returning everything — which is
        // exactly the fail-closed behaviour the job depends on.
        const held = await seedExpiredUser({ legalHold: true });
        const sweepable = await seedExpiredUser({ legalHold: false });

        const candidates = await prisma.user.findMany({
            where: {
                id: { in: [held.id, sweepable.id] },
                retainUntil: { lte: new Date() },
                ...legalHoldExclusion(),
            },
            select: { id: true },
        });

        expect(candidates.map((row) => row.id)).toEqual([sweepable.id]);
    });
});
