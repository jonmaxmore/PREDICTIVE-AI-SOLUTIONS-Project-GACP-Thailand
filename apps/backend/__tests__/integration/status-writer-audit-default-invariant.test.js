/**
 * A0-AUDIT-EMISSION / PR-A0-1 — INVARIANT A0 at the writer level, against a
 * REAL Postgres (design-decision.md §4: clauses (1)(2)(3) "ต้องเป็น integration
 * บน Postgres จริง"; atomicity is unprovable on a mock by definition).
 *
 * INVARIANT A0 as it applies to `writeApplicationStatus` itself:
 *   (1) a status write with NO `onAudit` supplied ⇒ ΔAuditLog(category=APPLICATION,
 *       action=APPLICATION_STATUS_TRANSITION, resourceId=applicationId) = +1 exactly
 *       (not ≥1), with metadata.fromStatus / metadata.toStatus matching the hop.
 *   (2) same tx: a failure injected AFTER the UPDATE but BEFORE COMMIT ⇒ the
 *       status is unchanged AND Δ = 0 (the audit row dies with the write).
 *   (3) retry: a second attempt that the writer's own guard rejects
 *       (`expectedVersion` optimistic lock — the writer-level equivalent of the
 *       per-hop "already in state" guard, since the writer has no hop guard of
 *       its own) ⇒ Δ on the second round = 0 and the status does not move.
 *   (4) is out of scope here — it is the Tier-C fail-closed clause owned by
 *       PR-A0-3 / PR-A0-4.
 *
 * Follows the M4 reference pattern operator signed off (the change log:125):
 * self-seeded org → user → application, database guard, narrow delta counting.
 *
 * RED-first (Law 3.11): on the pre-PR1 writer clause (1) fails with Δ=0 because
 * audit emission was opt-in. This file self-SKIPS when no test database answered, so the
 * only environment where its RED/GREEN counts is a runner with Postgres
 * (gacp-debug: "skipped = ไม่ผ่าน gate", R-R2-1).
 */

'use strict';

// PR-A0-1b: the ONLY stub in this file is the certificate service — it is the
// trigger for the cert-rollback case below, and a trigger has to be
// controllable. Everything the invariants actually assert (transactions,
// audit rows, status column) runs against the real database.
const mockCertState = {
    findCertificateForApplication: async () => null,
    generateCertificate: async () => ({ id: 'cert-x', certificateNumber: 'GACP-X' }),
};
jest.mock('../../services/certificate-service', () => ({
    findCertificateForApplication: (...a) => mockCertState.findCertificateForApplication(...a),
    generateCertificate: (...a) => mockCertState.generateCertificate(...a),
}));

const { PrismaClient } = require('@prisma/client');
const { writeApplicationStatus } = require('../../services/application-status-writer');

// Not `Boolean(process.env.DATABASE_URL)`: jest.setup.js:104 pins that variable on every
// run, so the old HAS_DB was always true — this suite never skipped and died on connection
// refused. Ask the run-level guard what it actually probed; it names the reason in the title.
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

const TRANSITION_ACTION = 'APPLICATION_STATUS_TRANSITION';

/**
 * PR-A0-1b / F1 — a tx handle whose audit INSERT fails the way a real one does:
 * the failing statement is issued THROUGH the caller's transaction, so Postgres
 * really does mark it ABORTED (25P02) before the writer sees the rejection.
 *
 * Cycle 2 / F-A: this proxy is a PASS-THROUGH. The first version stubbed only
 * `auditLog.create`, but `logWithin` reads the hash-chain tail first
 * (`middleware/audit-logger.js:611` → `getLastHash` → `client.auditLog.findFirst`
 * at :327). With `findFirst` missing, a TypeError was raised BEFORE the poisoning
 * statement ever ran: the transaction was never aborted, and the case could not
 * go red on any writer. Everything therefore delegates to the real tx client, and
 * only `create` is wrapped — it runs a genuinely failing statement in the SAME
 * transaction and then delegates, so what the writer catches is the real 25P02
 * raised by the real INSERT, reached through the real critical path (advisory
 * lock → tail read → insert). There is no shortcut that ends before the poison.
 */
function withPoisoningAuditInsert(tx) {
    const auditLog = new Proxy(tx.auditLog, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (prop !== 'create') {
                return typeof value === 'function' ? value.bind(target) : value;
            }
            return async (...args) => {
                // Real statement, real abort — 22012 division_by_zero. Runs
                // AFTER the lock and the tail read, i.e. exactly where a failing
                // audit INSERT would land.
                await tx.$queryRawUnsafe('SELECT 1/0').catch(() => {});
                // Delegating now raises the genuine 25P02 from Postgres.
                return target.create(...args);
            };
        },
    });
    return new Proxy(tx, {
        get(target, prop, receiver) {
            if (prop === 'auditLog') { return auditLog; }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

/**
 * The PERSISTED shape of `audit_logs.metadata`, asserted rather than assumed.
 *
 * `middleware/audit-logger.js:394` persists
 * `JSON.stringify(maskMetadataPii(metadata))` — a JSON *string* scalar inside a
 * Prisma `Json?` column — and Prisma reads that column back as the same string
 * (real consumer:
 * `routes/api/provider/handlers/workflow-audit-timelines-handler.js:93`
 * JSON.parses `entry.metadata`). That is deliberate, not a defect: the hash
 * chain must cover the form that is actually STORED (audit-logger.js:380-384),
 * and `_stableMetadataForHash` (:228) re-derives that exact string at verify
 * time — so persisting a JSON object instead would make `verifyChain` mismatch
 * on every row.
 *
 * These assertions used to run `toMatchObject` straight at `row.metadata`. They
 * only ever passed against mocks that echo the input object back; on the first
 * run against a real Postgres they errored with "received value must be a
 * non-null object / Received has type: string". They were pinning a shape that
 * has never existed in the database.
 *
 * This helper is STRICTLY STRONGER than what it replaces, not a relaxation:
 *   (a) it pins the storage contract itself — `typeof === 'string'`. If anyone
 *       switches the writer to persist an object, THIS goes red immediately, at
 *       the audit-emission invariant, instead of the breakage surfacing later as
 *       an unverifiable hash chain;
 *   (b) it pins that the payload is parseable JSON;
 *   (c) the caller still matches every field it matched before, on the decoded
 *       value — no field was dropped.
 */
function persistedAuditMetadata(value) {
    expect(typeof value).toBe('string');
    return JSON.parse(value);
}

d('A0 PR-1 — writer emits the canonical transition row by default, in the same tx', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let prisma;
    let orgId;
    let healthId;
    let appId;

    beforeAll(async () => {
        prisma = new PrismaClient();
        await prisma.$connect();
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const org = await prisma.organization.create({
            data: {
                name: 'A0 PR1 Test Org',
                slug: `a0-pr1-${suffix}`,
                code: `A0PR1_${suffix}`.toUpperCase().slice(0, 24),
            },
        });
        orgId = org.id;
        healthId = `a0-pr1-canon-${suffix}`;
        await prisma.user.create({
            data: {
                canonicalId: healthId,
                password: 'x', // never authenticated in this test
                organizationId: orgId,
                authType: 'EMAIL_LEGACY',
            },
        });
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

    beforeEach(async () => {
        const created = await prisma.application.create({
            data: {
                applicationNumber: `A0-PR1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                healthId,
                areaType: 'OUTDOOR',
                organizationId: orgId,
                status: 'SUBMITTED',
            },
        });
        appId = created.id;
    });

    afterEach(async () => {
        if (appId) {
            await prisma.auditLog.deleteMany({ where: { resourceId: appId } }).catch(() => {});
            await prisma.application.deleteMany({ where: { id: appId } }).catch(() => {});
            appId = null;
        }
    });

    /** Narrow count — resourceId + action + category, never a broad sweep. */
    const transitionRows = (id) => prisma.auditLog.count({
        where: { category: 'APPLICATION', action: TRANSITION_ACTION, resourceId: id },
    });
    const statusOf = (id) => prisma.application
        .findUnique({ where: { id }, select: { status: true, version: true } });

    test('(1) status write with no onAudit ⇒ exactly +1 canonical APPLICATION transition row', async () => {
        const before = await transitionRows(appId);

        await writeApplicationStatus({
            prisma, // bare client — the writer opens its own internal tx
            applicationId: appId,
            fromStatus: 'SUBMITTED',
            toStatus: 'PENDING_DOC_FEE',
            actorId: 'a0-pr1-actor',
            actorRole: 'health',
            reason: 'A0 PR1 invariant (1)',
            autoIssueCertificate: false,
        });

        expect((await transitionRows(appId)) - before).toBe(1);
        expect((await statusOf(appId)).status).toBe('PENDING_DOC_FEE');

        const row = await prisma.auditLog.findFirst({
            where: { category: 'APPLICATION', action: TRANSITION_ACTION, resourceId: appId },
            orderBy: { createdAt: 'desc' },
        });
        expect(row.resourceType).toBe('APPLICATION');
        expect(persistedAuditMetadata(row.metadata)).toMatchObject({
            fromStatus: 'SUBMITTED',
            toStatus: 'PENDING_DOC_FEE',
        });
    });

    test('(2) failure injected after the UPDATE but before COMMIT ⇒ status unchanged AND Δ = 0', async () => {
        const before = await transitionRows(appId);

        await expect(
            prisma.$transaction(async (tx) => {
                await writeApplicationStatus({
                    prisma: tx, // caller tx — the audit row must join THIS tx
                    applicationId: appId,
                    fromStatus: 'SUBMITTED',
                    toStatus: 'PENDING_DOC_FEE',
                    actorId: 'a0-pr1-actor',
                    actorRole: 'health',
                    reason: 'A0 PR1 invariant (2)',
                    autoIssueCertificate: false,
                });
                throw new Error('A0-PR1 injected failure after UPDATE, before COMMIT');
            }),
        ).rejects.toThrow('A0-PR1 injected failure');

        expect((await statusOf(appId)).status).toBe('SUBMITTED');
        expect((await transitionRows(appId)) - before).toBe(0);
    });

    test('(3) retry rejected by the writer guard ⇒ Δ on the second round = 0', async () => {
        const seeded = await statusOf(appId);

        await writeApplicationStatus({
            prisma,
            applicationId: appId,
            fromStatus: 'SUBMITTED',
            toStatus: 'PENDING_DOC_FEE',
            actorId: 'a0-pr1-actor',
            actorRole: 'health',
            reason: 'A0 PR1 invariant (3) first round',
            expectedVersion: seeded.version,
            autoIssueCertificate: false,
        });

        const afterFirst = await transitionRows(appId);
        expect(afterFirst).toBe(1);

        // Second round replays the SAME write (stale version) — the guard must
        // reject it, and a rejected hop must not leave an audit row behind.
        await expect(
            writeApplicationStatus({
                prisma,
                applicationId: appId,
                fromStatus: 'SUBMITTED',
                toStatus: 'PENDING_DOC_FEE',
                actorId: 'a0-pr1-actor',
                actorRole: 'health',
                reason: 'A0 PR1 invariant (3) retry',
                expectedVersion: seeded.version, // stale — round 1 already bumped it
                autoIssueCertificate: false,
            }),
        ).rejects.toMatchObject({ code: 'CONCURRENCY_CONFLICT' });

        expect((await transitionRows(appId)) - afterFirst).toBe(0);
        expect((await statusOf(appId)).status).toBe('PENDING_DOC_FEE');
    });

    test('an explicit onAudit callback still produces exactly one row (no double emission)', async () => {
        const before = await transitionRows(appId);
        const { statusTransitionAuditHook } = require('../../middleware/audit-logger');

        await prisma.$transaction(async (tx) => {
            await writeApplicationStatus({
                prisma: tx,
                applicationId: appId,
                fromStatus: 'SUBMITTED',
                toStatus: 'PENDING_DOC_FEE',
                actorId: 'a0-pr1-actor',
                actorRole: 'health',
                reason: 'A0 PR1 no-double-emission',
                onAudit: statusTransitionAuditHook({ tx }),
                autoIssueCertificate: false,
            });
        });

        expect((await transitionRows(appId)) - before).toBe(1);
    });

    test('(F1) audit INSERT failure inside a CALLER tx ⇒ the status write still COMMITS (Δ = 0)', async () => {
        const before = await transitionRows(appId);

        await prisma.$transaction(async (tx) => {
            await writeApplicationStatus({
                prisma: withPoisoningAuditInsert(tx),
                applicationId: appId,
                fromStatus: 'SUBMITTED',
                toStatus: 'PENDING_DOC_FEE',
                actorId: 'a0-pr1b-actor',
                actorRole: 'health',
                reason: 'A0 PR1b F1 — fail-open must mean the business write commits',
                autoIssueCertificate: false,
            });
            // The caller keeps working after the writer returns — impossible in
            // an aborted transaction, which is precisely the regression.
            await tx.application.update({
                where: { id: appId },
                data: { updatedBy: 'a0-pr1b-after-writer' },
            });
        });

        const row = await prisma.application.findUnique({
            where: { id: appId },
            select: { status: true, updatedBy: true },
        });
        expect(row.status).toBe('PENDING_DOC_FEE');
        expect(row.updatedBy).toBe('a0-pr1b-after-writer');
        expect((await transitionRows(appId)) - before).toBe(0);
    });

    test('(F3) cert-hook failure in DEFAULT mode ⇒ a compensating reversal row exists', async () => {
        const before = await transitionRows(appId);
        mockCertState.findCertificateForApplication = async () => null;
        mockCertState.generateCertificate = async () => { throw new Error('A0-PR1b simulated cert mint failure'); };

        try {
            await expect(
                writeApplicationStatus({
                    prisma,
                    applicationId: appId,
                    fromStatus: 'SUBMITTED',
                    toStatus: 'AUDIT_PASSED',
                    actorId: 'a0-pr1b-actor',
                    actorRole: 'auditor',
                    reason: 'A0 PR1b F3 — reversal must be emitted in default mode',
                }),
            ).rejects.toMatchObject({ code: 'CERT_AUTO_GEN_FAILED' });
        } finally {
            mockCertState.generateCertificate = async () => ({ id: 'cert-x', certificateNumber: 'GACP-X' });
        }

        // status reverted …
        expect((await statusOf(appId)).status).toBe('SUBMITTED');
        // … and the trail shows BOTH the forward hop and its reversal, so no
        // phantom AUDIT_PASSED transition is left standing (Δ = +2, not +1).
        expect((await transitionRows(appId)) - before).toBe(2);
        const rows = await prisma.auditLog.findMany({
            where: { category: 'APPLICATION', action: TRANSITION_ACTION, resourceId: appId },
            orderBy: { createdAt: 'asc' },
        });
        expect(persistedAuditMetadata(rows[rows.length - 1].metadata)).toMatchObject({
            fromStatus: 'AUDIT_PASSED',
            toStatus: 'SUBMITTED',
            reason: 'APPROVED_ROLLBACK_CERT_FAILURE',
        });
    });

    test('onAudit:false is silent by design ⇒ Δ = 0 while the status still moves', async () => {
        const before = await transitionRows(appId);

        await writeApplicationStatus({
            prisma,
            applicationId: appId,
            fromStatus: 'SUBMITTED',
            toStatus: 'PENDING_DOC_FEE',
            actorId: 'a0-pr1-actor',
            actorRole: 'health',
            reason: 'A0 PR1 opt-out',
            onAudit: false,
            autoIssueCertificate: false,
        });

        expect((await transitionRows(appId)) - before).toBe(0);
        expect((await statusOf(appId)).status).toBe('PENDING_DOC_FEE');
    });
});
