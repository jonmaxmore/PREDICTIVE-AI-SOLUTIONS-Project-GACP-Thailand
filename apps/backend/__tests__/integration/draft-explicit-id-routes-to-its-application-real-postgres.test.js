'use strict';
/**
 * Round 4 I-1 (staging-walk-0930 fixes), on a real Postgres: POST /api/applications/draft
 * with an explicit applicationId writes THAT application, in every applicant-editable
 * status (DRAFT / REVISION_REQUESTED / CAR_PENDING — constants/applicant-editable-statuses.js),
 * and leaves the applicant's other open DRAFT untouched.
 *
 * Why it matters: the web autosave never sent the id, so the server resolved the target
 * with findLatestOpenDraftForHealth (DRAFT only). An edit to a REVISION_REQUESTED
 * application landed on another DRAFT — the "without an id" case below pins that
 * behaviour, which is what the client fix (every save now carries the id) routes around.
 * The Bug 2.3 guard (applications.js findOrCreateApplicationForHealth) is what accepts an
 * explicit id only in an editable status; a non-editable one is pinned as refused too.
 *
 * Run: DATABASE_URL=<local migrated postgres> TEST_DATABASE_URL=<same> npx jest --config jest.config.cjs \
 *        __tests__/integration/draft-explicit-id-routes-to-its-application-real-postgres.test.js -i
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
jest.mock('../../services/application-service', () => {
    const actual = jest.requireActual('../../services/application-service');
    // The identity lookup is the caller's side, not the thing under test.
    actual.resolveHealthIdentity = async () => mockHealthIdentity.current.identity;
    return actual;
});

d('POST /api/applications/draft routes an explicit id to its own application (real Postgres)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let app;
    const fx = { appIds: [] };
    const s = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        const org = await raw.organization.create({
            data: { name: 'draft-id org', slug: `draft-id-${s}`, code: `DRAFTID_${s}`.toUpperCase().slice(0, 24) },
        });
        const canonicalId = `draft-id-canon-${s}`;
        const user = await raw.user.create({
            data: { canonicalId, password: 'x', organizationId: org.id, authType: 'EMAIL_LEGACY' },
        });
        const entity = await raw.entity.create({
            data: { type: 'INDIVIDUAL', displayName: 'ทดสอบ เส้นทางร่าง', organizationId: org.id },
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
        app.use('/api/applications', router);
    });

    afterAll(async () => {
        for (const id of fx.appIds) {
            await raw.auditLog.deleteMany({ where: { resourceId: id } }).catch(() => {});
            await raw.application.deleteMany({ where: { id } }).catch(() => {});
        }
        // A no-id POST may mint a fresh DRAFT; sweep everything this user owns.
        if (fx.canonicalId) { await raw.application.deleteMany({ where: { healthId: fx.canonicalId } }).catch(() => {}); }
        if (fx.entityId) { await raw.entityMembership.deleteMany({ where: { entityId: fx.entityId } }).catch(() => {}); }
        if (fx.entityId) { await raw.entity.deleteMany({ where: { id: fx.entityId } }).catch(() => {}); }
        if (fx.otherCanonicalId) { await raw.application.deleteMany({ where: { healthId: fx.otherCanonicalId } }).catch(() => {}); }
        if (fx.otherEntityId) { await raw.entity.deleteMany({ where: { id: fx.otherEntityId } }).catch(() => {}); }
        if (fx.otherUserId) { await raw.user.deleteMany({ where: { id: fx.otherUserId } }).catch(() => {}); }
        if (fx.userId) { await raw.user.deleteMany({ where: { id: fx.userId } }).catch(() => {}); }
        if (fx.orgId) { await raw.organization.deleteMany({ where: { id: fx.orgId } }).catch(() => {}); }
        await raw.$disconnect();
    });

    async function seed(label, status, firstName) {
        const row = await raw.application.create({
            data: {
                applicationNumber: `DRAFTID-${label}-${s}`,
                healthId: fx.canonicalId,
                entityId: fx.entityId,
                submitterId: fx.userId,
                areaType: 'OUTDOOR',
                organizationId: fx.orgId,
                status,
                formData: { steps: {}, applicantData: { firstName } },
            },
        });
        fx.appIds.push(row.id);
        return row;
    }

    const read = (id) => raw.application.findUnique({ where: { id }, select: { status: true, formData: true, updatedAt: true } });

    test.each(['REVISION_REQUESTED', 'CAR_PENDING'])(
        'an explicit id in %s updates THAT application and leaves the other DRAFT untouched',
        async (status) => {
            const x = await seed(`X-${status}`, status, 'เดิม');
            const y = await seed(`Y-${status}`, 'DRAFT', 'ร่างอีกใบ'); // the latest open DRAFT
            const yBefore = await read(y.id);

            const res = await request(app).post('/api/applications/draft').send({
                applicationId: x.id,
                step: 1,
                formData: { applicantData: { firstName: 'แก้ตามข้อสังเกต' } },
            });

            expect(res.status).toBe(200);
            const xAfter = await read(x.id);
            expect(xAfter.formData.applicantData.firstName).toBe('แก้ตามข้อสังเกต');
            expect(xAfter.status).toBe(status); // the draft door never moves status
            const yAfter = await read(y.id);
            expect(yAfter.updatedAt.toISOString()).toBe(yBefore.updatedAt.toISOString());
            expect(yAfter.formData).toEqual(yBefore.formData);
        },
    );

    test('WITHOUT the id the same edit lands on the latest DRAFT, not on the application being corrected (why the client now sends it)', async () => {
        const x = await seed('X-noid', 'REVISION_REQUESTED', 'เดิม');
        const y = await seed('Y-noid', 'DRAFT', 'ร่างอีกใบ');

        // R2 Task 8: an id-less write names its holder; it resumes the caller's own
        // latest DRAFT on that holder (never the application being corrected).
        const res = await request(app).post('/api/applications/draft').send({
            entityId: fx.entityId,
            step: 1,
            formData: { applicantData: { firstName: 'ไปผิดใบ' } },
        });

        expect(res.status).toBe(200);
        expect((await read(x.id)).formData.applicantData.firstName).toBe('เดิม');
        expect((await read(y.id)).formData.applicantData.firstName).toBe('ไปผิดใบ');
    });

    test('an explicit id in a non-editable status is refused (the Bug 2.3 guard) and nothing is written', async () => {
        const z = await seed('Z-review', 'ASSIGNED_FOR_REVIEW', 'ระหว่างตรวจ');
        const before = await read(z.id);

        const res = await request(app).post('/api/applications/draft').send({
            applicationId: z.id,
            step: 1,
            formData: { applicantData: { firstName: 'ห้ามเขียน' } },
        });

        expect(res.status).toBe(409);
        const after = await read(z.id);
        expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
        expect(after.formData).toEqual(before.formData);
    });

    /**
     * Round 5 minor 1: an explicit id that does not resolve FOR THIS USER (another
     * user's application, a soft-deleted one, or one that never existed) used to fall
     * through to the caller's latest DRAFT (or mint one) and answer 200. The applicant
     * believed they were saving application X; the answers went to another row. Now it
     * is 404 APPLICATION_NOT_FOUND and nothing is written anywhere.
     */
    async function callerRowsSnapshot() {
        const rows = await raw.application.findMany({
            where: { healthId: fx.canonicalId },
            select: { id: true, updatedAt: true, formData: true },
            orderBy: { id: 'asc' },
        });
        return rows.map((r) => ({ id: r.id, updatedAt: r.updatedAt.toISOString(), formData: r.formData }));
    }

    test('round 5: an explicit id belonging to ANOTHER user is 404 and neither user\'s rows change', async () => {
        const otherCanon = `draft-id-other-${s}`;
        const other = await raw.user.create({
            data: { canonicalId: otherCanon, password: 'x', organizationId: fx.orgId, authType: 'EMAIL_LEGACY' },
        });
        fx.otherUserId = other.id;
        fx.otherCanonicalId = otherCanon;
        // R2 Task 9 (spec §3.2): a co-member who may edit the holder edits its drafts
        // whoever filed them, so "another user's" row here sits on a holder the caller
        // is not a member of (the other user's own entity).
        const theirHolder = await raw.entity.create({
            data: { type: 'INDIVIDUAL', displayName: 'ทดสอบ ผู้ถืออื่น', organizationId: fx.orgId },
        });
        fx.otherEntityId = theirHolder.id;
        const theirs = await raw.application.create({
            data: {
                applicationNumber: `DRAFTID-THEIRS-${s}`,
                healthId: otherCanon,
                entityId: theirHolder.id,
                submitterId: other.id,
                areaType: 'OUTDOOR',
                organizationId: fx.orgId,
                status: 'DRAFT',
                formData: { steps: {}, applicantData: { firstName: 'ของคนอื่น' } },
            },
        });
        fx.appIds.push(theirs.id);
        await seed('MINE-open', 'DRAFT', 'ร่างของฉัน'); // the caller's latest DRAFT: the old fall-through target
        const theirsBefore = await read(theirs.id);
        const mineBefore = await callerRowsSnapshot();

        const res = await request(app).post('/api/applications/draft').send({
            applicationId: theirs.id,
            step: 1,
            formData: { applicantData: { firstName: 'ห้ามเขียน' } },
        });

        expect(res.status).toBe(404);
        expect(res.body.code).toBe('APPLICATION_NOT_FOUND');
        const theirsAfter = await read(theirs.id);
        expect(theirsAfter.updatedAt.toISOString()).toBe(theirsBefore.updatedAt.toISOString());
        expect(theirsAfter.formData).toEqual(theirsBefore.formData);
        expect(await callerRowsSnapshot()).toEqual(mineBefore); // nothing updated, nothing minted
    });

    test('round 5: a soft-deleted id is 404 and nothing is written', async () => {
        const gone = await seed('GONE', 'DRAFT', 'ลบแล้ว');
        await raw.application.update({ where: { id: gone.id }, data: { isDeleted: true } });
        const before = await callerRowsSnapshot();

        const res = await request(app).post('/api/applications/draft').send({
            applicationId: gone.id,
            step: 1,
            formData: { applicantData: { firstName: 'ห้ามเขียน' } },
        });

        expect(res.status).toBe(404);
        expect(res.body.code).toBe('APPLICATION_NOT_FOUND');
        expect(await callerRowsSnapshot()).toEqual(before);
    });

    test('round 5: an id that never existed is 404 and nothing is minted', async () => {
        const before = await callerRowsSnapshot();
        const res = await request(app).post('/api/applications/draft').send({
            applicationId: '00000000-0000-4000-8000-000000000000',
            step: 1,
            formData: { applicantData: { firstName: 'ห้ามเขียน' } },
        });
        expect(res.status).toBe(404);
        expect(await callerRowsSnapshot()).toEqual(before);
    });
});
