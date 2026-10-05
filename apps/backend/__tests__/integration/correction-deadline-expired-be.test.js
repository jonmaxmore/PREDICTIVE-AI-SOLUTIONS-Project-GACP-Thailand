/**
 * R2 M4 integration (RED-first) — the revision-deadline cron, when it closes an
 * application whose correction deadline has passed, must stamp the canonical
 * terminal marker `closedReason = 'CORRECTION_DEADLINE_EXPIRED'` AND write one
 * canonical audit row for that closure. Asserted against a REAL Postgres.
 *
 * This is written BEFORE the GREEN implementation (jobs/revision-deadline-checker.js
 * does not yet set closedReason and passes no onAudit). It is EXPECTED to fail on
 * the marker + audit assertions until M4 lands. The four operator-confirmed cases:
 *   1. marker specificity — the expired row gets EXACTLY that value; a sibling
 *      not-yet-overdue row in the same run stays NULL (marker lands on the right row).
 *   2. over-close guard — a not-overdue deadline is never closed and never marked.
 *   3. audit presence — a real close writes +1 canonical audit row; a run that
 *      closes nothing writes +0.
 *   4. idempotency — running the cron TWICE over one expired case leaves round-2
 *      deltas at zero (status, marker, and audit all unchanged).
 *
 * Requires DATABASE_URL → a migrated Postgres; skips cleanly otherwise.
 */

const { PrismaClient } = require('@prisma/client');
const { checkExpiredDeadlines } = require('../../jobs/revision-deadline-checker');

// Not `Boolean(process.env.DATABASE_URL)`: jest.setup.js:104 pins that variable on every
// run, so the old HAS_DB was always true — this suite never skipped and died on connection
// refused. Ask the run-level guard what it actually probed; it names the reason in the title.
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

const CLOSED_REASON = 'CORRECTION_DEADLINE_EXPIRED';
// The other frozen vocab values M4 must NOT write (reserved for backlog writers).
const RESERVED_OTHERS = [
    'REJECTED_DOC_REVIEW',
    'REJECTED_AUDIT',
    'CANCELLED_BY_APPLICANT',
    'CANCELLED_BY_ADMIN',
    'PAYMENT_ABANDONED',
    'LEGACY_AUTO_CANCEL',
];

const DAY_MS = 24 * 60 * 60 * 1000;

d('R2 M4 — correction-deadline-expired close stamps marker + audit', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let prisma;
    let orgId;
    let healthId;
    /** @type {string[]} */
    let createdAppIds;

    beforeAll(async () => {
        prisma = new PrismaClient();
        await prisma.$connect();
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const org = await prisma.organization.create({
            data: {
                name: 'M4 Test Org',
                slug: `m4-cde-${suffix}`,
                code: `M4CDE_${suffix}`.toUpperCase().slice(0, 24),
            },
        });
        orgId = org.id;
        healthId = `m4-cde-canon-${suffix}`;
        await prisma.user.create({
            data: {
                canonicalId: healthId,
                password: 'x',
                organizationId: orgId,
                authType: 'EMAIL_LEGACY',
            },
        });
    });

    beforeEach(() => {
        createdAppIds = [];
    });

    afterEach(async () => {
        // Best-effort child-first cleanup (fresh DB per CI run, so leftovers are
        // harmless; this keeps re-runs on a shared local DB clean).
        for (const id of createdAppIds) {
            await prisma.revisionDeadline.deleteMany({ where: { applicationId: id } }).catch(() => {});
            await prisma.auditLog.deleteMany({ where: { resourceId: id } }).catch(() => {});
            await prisma.application.deleteMany({ where: { id } }).catch(() => {});
        }
        createdAppIds = [];
    });

    afterAll(async () => {
        if (healthId) {
            await prisma.user.deleteMany({ where: { canonicalId: healthId } }).catch(() => {});
        }
        if (orgId) {
            await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
        }
        await prisma.$disconnect();
    });

    /**
     * Seed one application in REVISION_REQUESTED with a single RevisionDeadline.
     * `overdue: true` → due 30 days ago (unambiguously past, regardless of the
     * working-days calc); `overdue: false` → due 30 days out.
     */
    async function seedCase({ overdue }) {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const app = await prisma.application.create({
            data: {
                applicationNumber: `M4-CDE-${suffix}`,
                healthId,
                areaType: 'OUTDOOR',
                organizationId: orgId,
                status: 'REVISION_REQUESTED',
                formData: { plot: 'keep-me', applicant: 'preserve' },
            },
        });
        createdAppIds.push(app.id);
        await prisma.revisionDeadline.create({
            data: {
                applicationId: app.id,
                organizationId: orgId,
                revisionDue: new Date(Date.now() + (overdue ? -30 : 30) * DAY_MS),
                status: 'PENDING',
                createdBy: 'system',
                updatedBy: 'system',
            },
        });
        return app.id;
    }

    const auditCount = (appId) =>
        prisma.auditLog.count({ where: { resourceType: 'APPLICATION', resourceId: appId } });
    const getApp = (appId) =>
        prisma.application.findUnique({ where: { id: appId }, select: { status: true, closedReason: true } });

    test('marker specificity: expired row → EXACTLY CORRECTION_DEADLINE_EXPIRED; not-overdue sibling stays NULL', async () => {
        const expiredId = await seedCase({ overdue: true });
        const freshId = await seedCase({ overdue: false });

        await checkExpiredDeadlines();

        const expired = await getApp(expiredId);
        const fresh = await getApp(freshId);

        // The expired row is closed and carries EXACTLY the M4 marker — not NULL,
        // and not any other reserved vocab value.
        expect(expired.status).toBe('EXPIRED');
        expect(expired.closedReason).toBe(CLOSED_REASON);
        expect(RESERVED_OTHERS).not.toContain(expired.closedReason);

        // The marker landed on the right row only — the sibling is untouched.
        expect(fresh.status).toBe('REVISION_REQUESTED');
        expect(fresh.closedReason).toBeNull();
    });

    test('over-close guard: a not-overdue deadline is never closed and never marked', async () => {
        const freshId = await seedCase({ overdue: false });
        const before = await auditCount(freshId);

        await checkExpiredDeadlines();

        const fresh = await getApp(freshId);
        expect(fresh.status).toBe('REVISION_REQUESTED');
        expect(fresh.closedReason).toBeNull();
        // audit presence (0-close side): nothing closed → no audit row for it.
        expect(await auditCount(freshId)).toBe(before);
    });

    test('audit presence: a real close writes exactly one canonical audit row', async () => {
        const expiredId = await seedCase({ overdue: true });
        const before = await auditCount(expiredId);

        await checkExpiredDeadlines();

        const after = await auditCount(expiredId);
        expect(after - before).toBe(1);
    });

    test('idempotency: running the cron twice leaves round-2 deltas at zero', async () => {
        const expiredId = await seedCase({ overdue: true });

        await checkExpiredDeadlines(); // round 1 — closes it
        const afterOne = await getApp(expiredId);
        const auditAfterOne = await auditCount(expiredId);
        expect(afterOne.status).toBe('EXPIRED');
        expect(afterOne.closedReason).toBe(CLOSED_REASON);

        await checkExpiredDeadlines(); // round 2 — must be a no-op for this row
        const afterTwo = await getApp(expiredId);
        const auditAfterTwo = await auditCount(expiredId);

        expect(afterTwo.status).toBe(afterOne.status);
        expect(afterTwo.closedReason).toBe(afterOne.closedReason);
        expect(auditAfterTwo - auditAfterOne).toBe(0);
    });
});
