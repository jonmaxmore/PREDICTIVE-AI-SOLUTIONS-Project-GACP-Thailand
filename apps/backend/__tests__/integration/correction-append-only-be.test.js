/**
 * R2 M7 integration (RED-first) — correction submissions are append-only (D-6).
 * Asserted against a REAL Postgres.
 *
 * Before M7 a farmer's resubmit OVERWROTE Application.formData each round,
 * destroying the previously-submitted version. M7 preserves every round's
 * submitted formData as an immutable CorrectionSubmissionVersion row, keyed by
 * (applicationId, stage, roundNo) off the M3 CorrectionRound ledger.
 *
 * This exercises the SAME atomic pattern production uses (the resubmit paths in
 * routes/api/applications/applications.js POST /submit and
 * services/application-service/application-review-revision-methods.js
 * submitRevision): inside ONE transaction, overwrite Application.formData AND
 * append the snapshot via services/correction-submission-version-service.js.
 *
 * Written BEFORE the table/service/wiring exist → RED until M7 lands. Four
 * operator-confirmed cases:
 *   1. round-1 submit → EXACTLY one version row carrying round 1's formData.
 *   2. round-2 submit → a SECOND row (round 2); round-1's row is UNCHANGED
 *      (history preserved — the earlier submission is not destroyed).
 *   3. append-only at the DB level: a second row for the SAME
 *      (applicationId, stage, roundNo) throws a unique-constraint error (P2002).
 *   4. EXPAND: Application.formData still reflects the LATEST submission.
 *
 * Requires DATABASE_URL → a migrated Postgres; skips cleanly otherwise.
 */

const { PrismaClient } = require('@prisma/client');
const { snapshotCorrectionSubmission } = require('../../services/correction-submission-version-service');
const { CORRECTION_ROUND_STAGE } = require('../../shared/correction-round-stage');

// Not `Boolean(process.env.DATABASE_URL)`: jest.setup.js:104 pins that variable on every
// run, so the old HAS_DB was always true — this suite never skipped and died on connection
// refused. Ask the run-level guard what it actually probed; it names the reason in the title.
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

// The resubmit-from status for a doc-review correction (→ DOC_REVIEW round).
const REVISION_REQUESTED = 'REVISION_REQUESTED';

d('R2 M7 — correction submissions are append-only (per-round formData history)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let prisma;
    let orgId;
    let healthId;
    /** @type {string} */
    let appId;

    beforeAll(async () => {
        prisma = new PrismaClient();
        await prisma.$connect();
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const org = await prisma.organization.create({
            data: {
                name: 'M7 Test Org',
                slug: `m7-cao-${suffix}`,
                code: `M7CAO_${suffix}`.toUpperCase().slice(0, 24),
            },
        });
        orgId = org.id;
        healthId = `m7-cao-canon-${suffix}`;
        await prisma.user.create({
            data: {
                canonicalId: healthId,
                password: 'x',
                organizationId: orgId,
                authType: 'EMAIL_LEGACY',
            },
        });
    });

    beforeEach(async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const app = await prisma.application.create({
            data: {
                applicationNumber: `M7-CAO-${suffix}`,
                healthId,
                areaType: 'OUTDOOR',
                organizationId: orgId,
                status: REVISION_REQUESTED,
                formData: { round: 0, note: 'seed' },
            },
        });
        appId = app.id;
        // M3 ledger: doc-review correction round 1 is open (the farmer responds
        // to it in round 1). organizationId mirrors the app's tenant.
        await prisma.correctionRound.create({
            data: {
                applicationId: appId,
                stage: CORRECTION_ROUND_STAGE.DOC_REVIEW,
                roundNo: 1,
                decidedAt: new Date(),
                dueAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
                organizationId: orgId,
            },
        });
    });

    afterEach(async () => {
        if (!appId) { return; }
        await prisma.correctionSubmissionVersion.deleteMany({ where: { applicationId: appId } }).catch(() => {});
        await prisma.correctionRound.deleteMany({ where: { applicationId: appId } }).catch(() => {});
        await prisma.application.deleteMany({ where: { id: appId } }).catch(() => {});
        appId = null;
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
     * Mimic the production resubmit exactly: in ONE transaction, OVERWRITE
     * Application.formData (EXPAND — the column keeps the latest working copy)
     * AND append the immutable per-round snapshot.
     */
    async function submitCorrectionRound(formData) {
        return prisma.$transaction(async (tx) => {
            await tx.application.update({ where: { id: appId }, data: { formData } });
            return snapshotCorrectionSubmission({
                prisma: tx,
                applicationId: appId,
                fromStatus: REVISION_REQUESTED,
                formDataSnapshot: formData,
            });
        });
    }

    const versionsOf = () =>
        prisma.correctionSubmissionVersion.findMany({
            where: { applicationId: appId },
            orderBy: { roundNo: 'asc' },
        });

    test('round-1 submission → exactly one version row carrying round 1 formData', async () => {
        const round1Form = { round: 1, plot: 'A-1', applicant: 'first-pass' };
        const result = await submitCorrectionRound(round1Form);

        expect(result.snapshotted).toBe(true);
        expect(result.stage).toBe(CORRECTION_ROUND_STAGE.DOC_REVIEW);
        expect(result.roundNo).toBe(1);

        const rows = await versionsOf();
        expect(rows).toHaveLength(1);
        expect(rows[0].stage).toBe(CORRECTION_ROUND_STAGE.DOC_REVIEW);
        expect(rows[0].roundNo).toBe(1);
        expect(rows[0].formDataSnapshot).toEqual(round1Form);
    });

    test('round-2 submission → a SECOND row; round-1 row is UNCHANGED (history preserved)', async () => {
        const round1Form = { round: 1, plot: 'A-1', applicant: 'first-pass' };
        const round2Form = { round: 2, plot: 'A-1-fixed', applicant: 'second-pass' };

        await submitCorrectionRound(round1Form);
        const round1RowBefore = (await versionsOf())[0];

        // Reviewer requested another correction → M3 opens round 2 for the stage.
        await prisma.correctionRound.create({
            data: {
                applicationId: appId,
                stage: CORRECTION_ROUND_STAGE.DOC_REVIEW,
                roundNo: 2,
                decidedAt: new Date(),
                dueAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
                organizationId: orgId,
            },
        });

        const result2 = await submitCorrectionRound(round2Form);
        expect(result2.roundNo).toBe(2);

        const rows = await versionsOf();
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.roundNo)).toEqual([1, 2]);
        expect(rows[1].formDataSnapshot).toEqual(round2Form);

        // Round-1's row is immutable — its snapshot still equals what was
        // submitted in round 1, and its id/createdAt did not change.
        const round1RowAfter = rows[0];
        expect(round1RowAfter.formDataSnapshot).toEqual(round1Form);
        expect(round1RowAfter.id).toBe(round1RowBefore.id);
        expect(round1RowAfter.createdAt.getTime()).toBe(round1RowBefore.createdAt.getTime());
    });

    test('append-only: a second row for the SAME (application, stage, round) throws P2002', async () => {
        const round1Form = { round: 1, plot: 'A-1', applicant: 'first-pass' };
        await submitCorrectionRound(round1Form);

        // Attempt to OVERWRITE round 1 by inserting another row for the same key.
        let caught = null;
        try {
            await prisma.correctionSubmissionVersion.create({
                data: {
                    applicationId: appId,
                    stage: CORRECTION_ROUND_STAGE.DOC_REVIEW,
                    roundNo: 1,
                    formDataSnapshot: { round: 1, tampered: true },
                    organizationId: orgId,
                },
            });
        } catch (error) {
            caught = error;
        }

        expect(caught).not.toBeNull();
        expect(caught.code).toBe('P2002');

        // The original round-1 snapshot is untouched — no overwrite happened.
        const rows = await versionsOf();
        expect(rows).toHaveLength(1);
        expect(rows[0].formDataSnapshot).toEqual(round1Form);
    });

    test('EXPAND: Application.formData still reflects the LATEST submission', async () => {
        const round1Form = { round: 1, plot: 'A-1', applicant: 'first-pass' };
        const round2Form = { round: 2, plot: 'A-1-fixed', applicant: 'second-pass' };

        await submitCorrectionRound(round1Form);
        await prisma.correctionRound.create({
            data: {
                applicationId: appId,
                stage: CORRECTION_ROUND_STAGE.DOC_REVIEW,
                roundNo: 2,
                decidedAt: new Date(),
                dueAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
                organizationId: orgId,
            },
        });
        await submitCorrectionRound(round2Form);

        const app = await prisma.application.findUnique({
            where: { id: appId },
            select: { formData: true },
        });
        expect(app.formData).toEqual(round2Form);
    });
});
