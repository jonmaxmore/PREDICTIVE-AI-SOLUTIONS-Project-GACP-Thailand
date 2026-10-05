'use strict';
/**
 * autosave-lost-reply (staging walk 2026-10-02): the web autosave now RETRIES a draft save
 * whose reply was lost (a 2xx whose body never arrived, a timeout, a dropped connection,
 * 502/503/504). In every one of those cases the server may already have written the save.
 * This pins, on a real Postgres, that sending the same POST /api/applications/draft again
 * is harmless: one application, identical data, and nothing minted or duplicated.
 *
 * What a repeat DOES write, by design (listed so nobody mistakes it for a duplicate):
 *   - application.updatedAt and formData.lastDraftSavedAt move forward;
 *   - application.workflowHistory gains one APPLICATION_DRAFT_SAVED event per save
 *     (the save trail, inside the same row).
 * Nothing else: no new application row, no audit_logs row, no notification.
 *
 * Run: DATABASE_URL=<local migrated postgres> TEST_DATABASE_URL=<same> npx jest --config jest.config.cjs \
 *        __tests__/integration/draft-save-repeat-is-harmless-real-postgres.test.js -i
 */

const express = require('express');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

const mockHealthIdentity = { current: null };
jest.mock('../../middleware/auth-middleware', () => {
    const asHealthUser = (req, _res, next) => {
        req.user = { ...mockHealthIdentity.current.reqUser };
        return next();
    };
    return { authenticateHealth: asHealthUser, authenticateAny: asHealthUser, authenticateProvider: asHealthUser };
});
jest.mock('../../middleware/consent-manager', () => ({
    ...jest.requireActual('../../middleware/consent-manager'),
    // Consent is not what these tests are about; the submit door's clock check runs after it.
    requireConsent: (_req, _res, next) => next(),
}));
jest.mock('../../services/application-service', () => {
    const actual = jest.requireActual('../../services/application-service');
    actual.resolveHealthIdentity = async () => mockHealthIdentity.current.identity;
    return actual;
});

/** What buildDraftPayload (web use-auto-save.ts) sends for a step-1/step-4 wizard. */
function wizardPayload(applicationId, holderId) {
    return {
        // R2 Task 8: a first save (no id yet) names the holder the applicant chose at step 1.
        ...(applicationId ? { applicationId } : { entityId: holderId }),
        plantId: 'cannabis',
        serviceType: null,
        areaType: 'OUTDOOR',
        purpose: 'EXPORT',
        cultivationMethods: [],
        step: 2,
        currentStep: 1,
        formData: {
            requestType: 'NEW',
            certScope: 'PLANTING',
            applicantType: 'INDIVIDUAL',
            plantId: 'cannabis',
            certificationPurposes: ['EXPORT'],
            siteTypes: ['OUTDOOR'],
            applicantData: { firstName: 'ส่งซ้ำ', lastName: 'ทดสอบ', phone: '0812345678' },
            locationType: 'OUTDOOR',
        },
    };
}

/** formData minus the one timestamp a save is supposed to move. */
function stableFormData(formData) {
    const { lastDraftSavedAt: _moved, ...rest } = formData || {};
    return rest;
}

d('POST /api/applications/draft sent twice (a lost reply, retried) is harmless (real Postgres)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let app;
    const fx = {};
    const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        const org = await raw.organization.create({
            data: { name: 'repeat-save org', slug: `repeat-save-${s}`, code: `RPT_${s}`.toUpperCase().slice(0, 24) },
        });
        const canonicalId = `repeat-save-canon-${s}`;
        const user = await raw.user.create({
            data: { canonicalId, password: 'x', organizationId: org.id, authType: 'EMAIL_LEGACY' },
        });
        const entity = await raw.entity.create({
            data: { type: 'INDIVIDUAL', displayName: 'ทดสอบ ส่งซ้ำ', organizationId: org.id },
        });
        // R2 Task 8 (spec 2026-09-30 §3.2): a draft write needs the caller's ACTIVE,
        // non-VIEWER membership on the draft's holder (holderScope(req).editIds).
        await raw.entityMembership.create({
            data: { userId: user.id, entityId: entity.id, role: 'OWNER', status: 'ACTIVE', organizationId: org.id },
        });
        Object.assign(fx, { orgId: org.id, userId: user.id, canonicalId, entityId: entity.id });
        mockHealthIdentity.current = {
            reqUser: { id: user.id, role: 'health', canonicalRole: 'health' },
            identity: { userId: user.id, healthId: canonicalId },
        };
        const router = require('../../routes/api/applications/applications');
        app = express();
        app.use(express.json());
        // The tenant scope tenant-context-middleware opens on every real request (the
        // Prisma tenant extension stamps organizationId on a create from it).
        const { runWithTenantContext } = require('../../services/tenant-context');
        app.use((req, _res, next) => {
            runWithTenantContext({ organizationId: fx.orgId }, () => next());
        });
        app.use('/api/applications', router);
    });

    afterAll(async () => {
        if (fx.canonicalId) {
            const rows = await raw.application.findMany({ where: { healthId: fx.canonicalId }, select: { id: true } });
            for (const { id } of rows) { await raw.auditLog.deleteMany({ where: { resourceId: id } }).catch(() => {}); }
            await raw.application.deleteMany({ where: { healthId: fx.canonicalId } }).catch(() => {});
        }
        if (fx.entityId) {
            await raw.entityMembership.deleteMany({ where: { entityId: fx.entityId } }).catch(() => {});
            await raw.entity.deleteMany({ where: { id: fx.entityId } }).catch(() => {});
        }
        if (fx.userId) {
            await raw.notification.deleteMany({ where: { userId: fx.userId } }).catch(() => {});
            await raw.user.deleteMany({ where: { id: fx.userId } }).catch(() => {});
        }
        if (fx.orgId) { await raw.organization.deleteMany({ where: { id: fx.orgId } }).catch(() => {}); }
        await raw.$disconnect();
    });

    async function snapshot() {
        const apps = await raw.application.findMany({
            where: { healthId: fx.canonicalId },
            orderBy: { createdAt: 'asc' },
        });
        const ids = apps.map((a) => a.id);
        const audit = await raw.auditLog.count({ where: { resourceId: { in: ids.length ? ids : ['-'] } } });
        const auditByActor = await raw.auditLog.count({ where: { actorId: fx.userId } }).catch(() => null);
        const notifications = await raw.notification.count({ where: { userId: fx.userId } });
        const quotations = await raw.quotation.count({ where: { applicationId: { in: ids.length ? ids : ['-'] } } });
        const documents = await raw.applicationDocument.count({ where: { applicationId: { in: ids.length ? ids : ['-'] } } });
        return { apps, audit, auditByActor, notifications, quotations, documents };
    }

    function comparable(row) {
        return {
            id: row.id,
            applicationNumber: row.applicationNumber,
            status: row.status,
            entityId: row.entityId,
            submitterId: row.submitterId,
            serviceType: row.serviceType,
            areaType: row.areaType,
            certificationPurposes: row.certificationPurposes,
            consentedPDPA: row.consentedPDPA,
            formData: stableFormData(row.formData),
        };
    }

    test('the same payload with the same applicationId twice: one application, identical data, no new rows anywhere', async () => {
        const seeded = await raw.application.create({
            data: {
                applicationNumber: `RPT-X-${s}`,
                healthId: fx.canonicalId,
                entityId: fx.entityId,
                submitterId: fx.userId,
                areaType: 'OUTDOOR',
                organizationId: fx.orgId,
                status: 'DRAFT',
                formData: { steps: {}, applicantData: { firstName: 'เดิม' } },
            },
        });
        const before = await snapshot();

        const first = await request(app).post('/api/applications/draft').send(wizardPayload(seeded.id));
        expect(first.status).toBe(200);
        const afterFirst = await snapshot();

        // The reply above is "lost"; the client sends the same thing again.
        const second = await request(app).post('/api/applications/draft').send(wizardPayload(seeded.id));
        expect(second.status).toBe(200);
        const afterSecond = await snapshot();

        expect(second.body.data.id).toBe(seeded.id);
        expect(first.body.data.id).toBe(seeded.id);
        expect(afterSecond.apps).toHaveLength(1);
        expect(afterSecond.apps[0].formData.applicantData.firstName).toBe('ส่งซ้ำ');
        expect(comparable(afterSecond.apps[0])).toEqual(comparable(afterFirst.apps[0]));
        // The save trail grows by exactly one event per save, inside the same row.
        const trail = (row) => (Array.isArray(row.workflowHistory) ? row.workflowHistory : []);
        expect(trail(afterFirst.apps[0]).length).toBe(trail(before.apps[0]).length + 1);
        expect(trail(afterSecond.apps[0]).length).toBe(trail(afterFirst.apps[0]).length + 1);
        expect(trail(afterSecond.apps[0]).at(-1).action).toBe('APPLICATION_DRAFT_SAVED');
        // No other table moves on a repeat.
        for (const key of ['audit', 'auditByActor', 'notifications', 'quotations', 'documents']) {
            expect({ key, value: afterSecond[key] }).toEqual({ key, value: afterFirst[key] });
            expect({ key, value: afterFirst[key] }).toEqual({ key, value: before[key] });
        }
        fx.lastSnapshot = afterSecond;
    });

    test('a FIRST save (no id yet) whose reply was lost, retried with no id: still one new application, not two', async () => {
        // Clean slate for this user.
        await raw.application.deleteMany({ where: { healthId: fx.canonicalId } });
        const before = await snapshot();
        expect(before.apps).toHaveLength(0);

        const first = await request(app).post('/api/applications/draft').send(wizardPayload(undefined, fx.entityId));
        expect(first.status).toBe(200);
        const afterFirst = await snapshot();
        expect(afterFirst.apps).toHaveLength(1);

        // The client never learned the id, so the retry carries none.
        const second = await request(app).post('/api/applications/draft').send(wizardPayload(undefined, fx.entityId));
        expect(second.status).toBe(200);
        const afterSecond = await snapshot();

        expect(afterSecond.apps).toHaveLength(1);
        expect(second.body.data.id).toBe(first.body.data.id);
        expect(comparable(afterSecond.apps[0])).toEqual(comparable(afterFirst.apps[0]));
        for (const key of ['audit', 'auditByActor', 'notifications', 'quotations', 'documents']) {
            expect({ key, value: afterSecond[key] }).toEqual({ key, value: afterFirst[key] });
        }
        fx.created = { first: before, afterFirst, afterSecond };
    });

    /**
     * Fix round 1 (C1): a slow OLDER save must never land on top of a newer one. The wizard
     * sends `{ saveSession, saveSeq }` beside applicationId; the server keeps the last applied
     * clock in formData.draftSaveClock (no schema change) and refuses an older one.
     */
    async function seedDraft(label) {
        const row = await raw.application.create({
            data: {
                applicationNumber: `RPT-${label}-${s}`,
                healthId: fx.canonicalId,
                entityId: fx.entityId,
                submitterId: fx.userId,
                areaType: 'OUTDOOR',
                organizationId: fx.orgId,
                status: 'DRAFT',
                formData: { steps: {}, applicantData: { firstName: 'เดิม' } },
            },
        });
        return row;
    }
    function clocked(id, firstName, saveSession, saveSeq) {
        const p = wizardPayload(id);
        p.formData = { ...p.formData, applicantData: { ...p.formData.applicantData, firstName } };
        return { ...p, saveSession, saveSeq };
    }
    const readRow = (id) => raw.application.findUnique({ where: { id } });

    test('C1: seq 2 applied, then seq 1 from the same session arrives: 409 DRAFT_OUT_OF_ORDER, nothing written, data stays seq 2', async () => {
        const x = await seedDraft('ORDER');
        const newer = await request(app).post('/api/applications/draft').send(clocked(x.id, 'ใหม่กว่า', 'sess-A', 2));
        expect(newer.status).toBe(200);
        const afterNewer = await readRow(x.id);
        expect(afterNewer.formData.draftSaveClock).toEqual({ session: 'sess-A', seq: 2 });

        const older = await request(app).post('/api/applications/draft').send(clocked(x.id, 'เก่ากว่า', 'sess-A', 1));
        expect(older.status).toBe(409);
        expect(older.body.code).toBe('DRAFT_OUT_OF_ORDER');
        const afterOlder = await readRow(x.id);
        expect(afterOlder.formData.applicantData.firstName).toBe('ใหม่กว่า');
        expect(afterOlder.updatedAt.toISOString()).toBe(afterNewer.updatedAt.toISOString());
        expect(afterOlder.formData).toEqual(afterNewer.formData);
        expect(afterOlder.workflowHistory).toEqual(afterNewer.workflowHistory);

        // The same seq again (a duplicate delivery) is refused too.
        const same = await request(app).post('/api/applications/draft').send(clocked(x.id, 'ซ้ำ', 'sess-A', 2));
        expect(same.status).toBe(409);
        expect((await readRow(x.id)).formData.applicantData.firstName).toBe('ใหม่กว่า');
    });

    test('C1: seq 1 and seq 2 racing for the same row: whatever the arrival order, the stored answers are seq 2', async () => {
        for (let round = 0; round < 5; round += 1) {
            const x = await seedDraft(`RACE${round}`);
            const [a, b] = await Promise.all([
                request(app).post('/api/applications/draft').send(clocked(x.id, 'หนึ่ง', `sess-R${round}`, 1)),
                request(app).post('/api/applications/draft').send(clocked(x.id, 'สอง', `sess-R${round}`, 2)),
            ]);
            expect(b.status).toBe(200);
            // seq 1 either landed first (then seq 2 over it) or arrived second and was refused.
            if (a.status === 409) {
                expect(a.body.code).toBe('DRAFT_OUT_OF_ORDER');
            } else {
                expect(a.status).toBe(200);
            }
            const row = await readRow(x.id);
            expect(row.formData.applicantData.firstName).toBe('สอง');
            expect(row.formData.draftSaveClock).toEqual({ session: `sess-R${round}`, seq: 2 });
        }
    });

    test('C1: another session (another tab, a reload) is not compared, and a save with no clock (an older client) is not checked', async () => {
        const x = await seedDraft('SESS');
        expect((await request(app).post('/api/applications/draft').send(clocked(x.id, 'แท็บแรก', 'sess-T1', 9))).status).toBe(200);
        expect((await request(app).post('/api/applications/draft').send(clocked(x.id, 'แท็บสอง', 'sess-T2', 1))).status).toBe(200);
        expect((await readRow(x.id)).formData.applicantData.firstName).toBe('แท็บสอง');
        const p = wizardPayload(x.id);
        p.formData = { ...p.formData, applicantData: { firstName: 'ไม่มีนาฬิกา' } };
        expect((await request(app).post('/api/applications/draft').send(p)).status).toBe(200);
        const row = await readRow(x.id);
        expect(row.formData.applicantData.firstName).toBe('ไม่มีนาฬิกา');
        expect(row.formData.draftSaveClock).toEqual({ session: 'sess-T2', seq: 1 });
    });

    test('C1: the clock cannot be forged through formData (the allowlist drops it)', async () => {
        const x = await seedDraft('FORGE');
        const p = clocked(x.id, 'ปลอม', 'sess-F', 1);
        p.formData = { ...p.formData, draftSaveClock: { session: 'sess-F', seq: 999 } };
        expect((await request(app).post('/api/applications/draft').send(p)).status).toBe(200);
        expect((await readRow(x.id)).formData.draftSaveClock).toEqual({ session: 'sess-F', seq: 1 });
    });

    /**
     * Fix round 2 (1): under RLS_SHADOW_GUC=true a model write inside the locked transaction
     * ran on another connection and waited for the lock the transaction itself held (P2028,
     * 500). The ordered save must finish, with the flag on.
     */
    test('fix round 2: with RLS_SHADOW_GUC=true an ordered save completes (no self-deadlock)', async () => {
        const before = process.env.RLS_SHADOW_GUC;
        process.env.RLS_SHADOW_GUC = 'true';
        try {
            const x = await seedDraft('GUC');
            const started = Date.now();
            const res = await request(app).post('/api/applications/draft').send(clocked(x.id, 'ธงเปิด', 'sess-G', 1));
            expect(res.status).toBe(200);
            expect(Date.now() - started).toBeLessThan(4000);
            expect((await readRow(x.id)).formData.applicantData.firstName).toBe('ธงเปิด');
            const second = await request(app).post('/api/applications/draft').send(clocked(x.id, 'ธงเปิดสอง', 'sess-G', 2));
            expect(second.status).toBe(200);
        } finally {
            if (before === undefined) { delete process.env.RLS_SHADOW_GUC; } else { process.env.RLS_SHADOW_GUC = before; }
        }
    }, 30000);

    /**
     * Fix round 2 (2): the route reads the row, then writes a merge of it. A document upload
     * that commits in between used to be overwritten (its draftDocuments entry lost). The
     * ordered save now re-reads the row under its lock and merges onto that.
     */
    test('fix round 2: a document upload that commits between the save\'s read and its write is kept', async () => {
        const x = await seedDraft('UPLOAD');
        const svc = require('../../services/application-service');
        const realFind = svc.findApplicationByIdForHealth;
        const spy = jest.spyOn(svc, 'findApplicationByIdForHealth').mockImplementation(async (...args) => {
            const stale = await realFind.apply(svc, args);
            // The upload door (applications.js draft-document upload) commits now.
            const now = await raw.application.findUnique({ where: { id: x.id } });
            await raw.application.update({
                where: { id: x.id },
                data: { formData: { ...now.formData, draftDocuments: [{ documentId: 'doc-1', slotId: 'sop_manual', fileName: 'sop.pdf' }] } },
            });
            return stale;
        });
        try {
            const res = await request(app).post('/api/applications/draft').send(clocked(x.id, 'หลังอัปโหลด', 'sess-U', 1));
            expect(res.status).toBe(200);
        } finally {
            spy.mockRestore();
        }
        const row = await readRow(x.id);
        expect(row.formData.applicantData.firstName).toBe('หลังอัปโหลด');
        expect(row.formData.draftDocuments).toEqual([{ documentId: 'doc-1', slotId: 'sop_manual', fileName: 'sop.pdf' }]);
    });

    /**
     * Fix round 2 (3): tab B saved (seq 1), then tab A saved older answers. B's submit names
     * B's last applied clock; the stored clock is A's, so the submit is refused 409
     * DRAFT_NOT_LATEST and nothing moves.
     */
    test('fix round 2: submit naming a clock that is no longer the stored one is refused 409 DRAFT_NOT_LATEST', async () => {
        const x = await seedDraft('SUBMIT');
        expect((await request(app).post('/api/applications/draft').send(clocked(x.id, 'แท็บ B', 'sess-B', 1))).status).toBe(200);
        expect((await request(app).post('/api/applications/draft').send(clocked(x.id, 'แท็บ A เก่า', 'sess-A', 1))).status).toBe(200);
        const before = await readRow(x.id);

        const res = await request(app).post('/api/applications/submit').send({ applicationId: x.id, saveSession: 'sess-B', lastAppliedSeq: 1 });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('DRAFT_NOT_LATEST');
        const after = await readRow(x.id);
        expect(after.status).toBe('DRAFT');
        expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());

        // B saves its current answers once (seq 2) and names that clock: the clock check passes.
        expect((await request(app).post('/api/applications/draft').send(clocked(x.id, 'แท็บ B', 'sess-B', 2))).status).toBe(200);
        const again = await request(app).post('/api/applications/submit').send({ applicationId: x.id, saveSession: 'sess-B', lastAppliedSeq: 2 });
        expect(again.body.code).not.toBe('DRAFT_NOT_LATEST');
    });
});
