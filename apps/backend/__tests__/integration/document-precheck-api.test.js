/**
 * Task 7 (document pre-check) — the two sides' doors on a REAL Postgres.
 *
 * The unit suite (__tests__/unit/document-precheck/routes.test.js) pins the
 * role × body matrix over an in-memory database. This file proves what only a
 * real database can:
 *
 *   - TENANT: an officer of org B reads nothing of org A's pre-check. The
 *     request goes through the real tenant-context middleware and the
 *     tenant-extended prisma client — the route adds no organizationId where
 *     clause of its own, so this is the data layer's scope doing the work.
 *   - the applicant's acknowledgement is recorded and the application's status
 *     is exactly what it was before;
 *   - a verdict row really stores the pre-check it was taken over.
 *
 * Only the caller is attached by hand (authentication has its own suites);
 * the tenant middleware that runs after authentication is the real one.
 *
 * Requires a migrated test database (test-support/test-database.js); skips
 * cleanly without one, as the sibling integration suites do.
 */

'use strict';

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

const mockActor = { current: null };
jest.mock('../../middleware/auth-middleware', () => {
    const { tenantContextMiddleware } = jest.requireActual('../../middleware/tenant-context-middleware');
    const bindTenant = tenantContextMiddleware();
    const attach = (req, res, next) => {
        req.user = { ...mockActor.current };
        return bindTenant(req, res, next);
    };
    return {
        authenticateAny: attach,
        authenticateHealth: attach,
        authenticateProvider: attach,
        requireRole: () => (_req, _res, next) => next(),
    };
});

const THIRTEEN_DIGITS = /[0-9๐-๙]{13}/;
const NOT_FOUND_REASON = 'ไม่พบชื่อผู้ยื่นคำขอในเอกสาร ให้เจ้าหน้าที่ตรวจเอง';
const SNIPPET_TEXT = 'โฉนดที่ดิน เลขที่ 12345';
const RAW_ID = '1103700012345';

d('document-precheck APIs (real Postgres, real tenant scope)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let app;
    let service;
    let runWithTenantContext;
    const uid = () => crypto.randomUUID();
    const digits13 = (s) => s.replace(/\D/g, '').padEnd(13, '7').slice(0, 13);
    const fx = {};

    async function makeOrg() {
        const id = uid();
        await raw.organization.create({
            data: { id, name: `pc7-${id.slice(0, 8)}`, slug: `pc7-${id.slice(0, 8)}`, code: `PC7_${id.slice(0, 8).toUpperCase()}` },
        });
        return id;
    }

    async function makeUser({ orgId, role, provider }) {
        const { resolveCanonicalIdForWrite } = require('../../shared/fk-token');
        const id = uid();
        const nationalId = digits13(id);
        const canonicalId = provider
            ? resolveCanonicalIdForWrite({ actualIdentifier: nationalId, isProvider: true, userId: id })
            : resolveCanonicalIdForWrite({ actualIdentifier: nationalId, userId: id });
        await raw.user.create({
            data: {
                id,
                canonicalId,
                email: `pc7-${id.slice(0, 8)}@example.test`,
                password: 'x',
                firstName: 'ทดสอบ',
                lastName: 'ตรวจล่วงหน้า',
                role,
                organizationId: orgId,
                ...(provider
                    ? { authType: 'PROVIDER_ID', providerId: nationalId }
                    : { authType: 'HEALTH_ID', healthId: nationalId }),
            },
        });
        return { id, canonicalId, orgId, role };
    }

    const as = (user) => {
        mockActor.current = { id: user.id, role: user.role, canonicalRole: user.role, organizationId: user.orgId };
    };

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        service = require('../../services/document-precheck/service');
        ({ runWithTenantContext } = require('../../services/tenant-context'));
        const { deriveDimensions } = require('../../services/application-requirements-service');

        fx.orgA = await makeOrg();
        fx.orgB = await makeOrg();
        fx.officerA = await makeUser({ orgId: fx.orgA, role: 'document_reviewer', provider: true });
        fx.officerB = await makeUser({ orgId: fx.orgB, role: 'document_reviewer', provider: true });
        fx.farmerA = await makeUser({ orgId: fx.orgA, role: 'health' });
        fx.farmerB = await makeUser({ orgId: fx.orgA, role: 'health' });

        // The filing's holder, of which farmer A is the ACTIVE owner: applicant
        // reads follow holder membership (spec 2026-09-30 §3.1), and a filing
        // with no holder is readable by no one on the health side.
        const holder = await raw.entity.create({
            data: { type: 'INDIVIDUAL', displayName: 'ทดสอบ ตรวจล่วงหน้า', organizationId: fx.orgA },
        });
        fx.entityId = holder.id;
        await raw.entityMembership.create({
            data: { userId: fx.farmerA.id, entityId: fx.entityId, role: 'OWNER', status: 'ACTIVE', organizationId: fx.orgA },
        });

        fx.appId = uid();
        await raw.application.create({
            data: {
                id: fx.appId,
                applicationNumber: `APP-PC7-${fx.appId.slice(0, 8)}`,
                healthId: fx.farmerA.canonicalId,
                entityId: fx.entityId,
                status: 'ASSIGNED_FOR_REVIEW',
                serviceType: 'CERTIFICATION',
                areaType: 'OUTDOOR',
                organizationId: fx.orgA,
                // Unassigned on purpose: the assigned-reviewer check cannot be
                // what keeps org B out — only the tenant scope can.
                reviewerId: null,
                formData: { plantId: 'cannabis' },
            },
        });

        fx.ruleId = uid();
        await raw.requirementRule.create({
            data: {
                id: fx.ruleId,
                plantCode: deriveDimensions({ id: 'probe', areaType: 'OUTDOOR', formData: { plantId: 'cannabis' } }).plantCode,
                slotId: 'land_rights',
                isRequired: true,
                effectiveFrom: new Date('2020-01-01'),
                createdBy: fx.officerA.id,
                reason: 'fixture: land_rights is required so the slot is on the filing',
            },
        });

        fx.documentId = uid();
        fx.docRowId = uid();
        await raw.applicationDocument.create({
            data: {
                id: fx.docRowId,
                applicationId: fx.appId,
                documentId: fx.documentId,
                documentType: 'LAND_RIGHTS',
                slotId: 'land_rights',
                fileName: 'deed.pdf',
                fileUrl: '/uploads/deed.pdf',
                currentForSlot: 'land_rights',
            },
        });

        fx.precheckId = uid();
        await raw.documentPrecheck.create({
            data: {
                id: fx.precheckId,
                applicationId: fx.appId,
                documentId: fx.documentId,
                slotId: 'land_rights',
                status: 'DONE',
                rulesVersion: 1,
                extractMethod: 'TEXT_LAYER',
                ocrConfidence: 100,
                pageCount: 1,
                extractedText: `${SNIPPET_TEXT} ${RAW_ID}`,
                completedAt: new Date(),
                organizationId: fx.orgA,
            },
        });
        await raw.documentPrecheckFlag.createMany({
            data: [
                { check: 'READABILITY', result: 'OK', reasonTH: 'อ่านได้', confidence: 1, evidenceSnippet: null },
                { check: 'DOC_TYPE', result: 'MATCH', reasonTH: 'ตรงกับชนิดเอกสาร', confidence: 0.9, evidenceSnippet: `${SNIPPET_TEXT} ${RAW_ID}` },
                { check: 'CROSS_MATCH', result: 'NOT_FOUND', reasonTH: NOT_FOUND_REASON, confidence: 0.4, evidenceSnippet: null },
            ].map((f) => ({ ...f, precheckId: fx.precheckId, organizationId: fx.orgA })),
        });

        app = express();
        app.use(express.json());
        app.use('/api/applications', require('../../routes/api/applications/requirements'));
        app.use('/api/provider/applications', require('../../routes/api/provider/document-reviews'));
    });

    afterAll(async () => {
        if (!raw) {
            return;
        }
        await raw.applicationDocumentReview.deleteMany({ where: { applicationId: fx.appId } }).catch(() => {});
        await raw.documentPrecheckFlag.deleteMany({ where: { precheckId: fx.precheckId } }).catch(() => {});
        await raw.documentPrecheck.deleteMany({ where: { applicationId: fx.appId } }).catch(() => {});
        await raw.applicationDocument.deleteMany({ where: { id: fx.docRowId } }).catch(() => {});
        await raw.application.deleteMany({ where: { id: fx.appId } }).catch(() => {});
        if (fx.entityId) {
            await raw.entityMembership.deleteMany({ where: { entityId: fx.entityId } }).catch(() => {});
            await raw.entity.deleteMany({ where: { id: fx.entityId } }).catch(() => {});
        }
        await raw.requirementRule.deleteMany({ where: { id: fx.ruleId } }).catch(() => {});
        const users = [fx.officerA, fx.officerB, fx.farmerA, fx.farmerB].filter(Boolean).map((u) => u.id);
        await raw.user.deleteMany({ where: { id: { in: users } } }).catch(() => {});
        await raw.organization.deleteMany({ where: { id: { in: [fx.orgA, fx.orgB].filter(Boolean) } } }).catch(() => {});
        await raw.$disconnect();
    });

    test('an officer of org B gets 404 on org A\'s application and none of its observations', async () => {
        as(fx.officerB);
        const res = await request(app).get(`/api/provider/applications/${fx.appId}/document-check`);

        expect(res.status).toBe(404);
        const body = JSON.stringify(res.body);
        expect(body).not.toContain(SNIPPET_TEXT);
        expect(body).not.toContain(NOT_FOUND_REASON);
        expect(body).not.toContain(fx.precheckId);
    });

    test('the tenant-bound read itself: org A\'s pre-check is invisible inside org B and visible inside org A', async () => {
        const inB = await runWithTenantContext({ organizationId: fx.orgB }, async () => service.currentForSlots(fx.appId));
        const inA = await runWithTenantContext({ organizationId: fx.orgA }, async () => service.currentForSlots(fx.appId));

        expect(inB.size).toBe(0);
        expect(inA.size).toBe(1);
        expect(inA.get('land_rights')).toMatchObject({ id: fx.precheckId, status: 'DONE' });
    });

    test('the officer of org A sees the observations with confidence and the snippet, masked, NOT_FOUND included', async () => {
        as(fx.officerA);
        const res = await request(app).get(`/api/provider/applications/${fx.appId}/document-check`);

        expect(res.status).toBe(200);
        const land = res.body.data.slots.find((s) => s.slotId === 'land_rights');
        expect(land.precheck).toMatchObject({ id: fx.precheckId, status: 'DONE', acknowledgedAt: null });
        expect(land.precheck.flags).toHaveLength(3);
        const docType = land.precheck.flags.find((f) => f.check === 'DOC_TYPE');
        expect(docType.confidence).toBeCloseTo(0.9);
        expect(docType.evidenceSnippet).toContain(SNIPPET_TEXT);
        expect(land.precheck.flags.find((f) => f.check === 'CROSS_MATCH')).toMatchObject({ result: 'NOT_FOUND', reasonTH: NOT_FOUND_REASON });
        const body = JSON.stringify(res.body);
        expect(body).not.toMatch(THIRTEEN_DIGITS);
        expect(body).not.toContain('extractedText');
    });

    test('the applicant sees check, result and reason only', async () => {
        as(fx.farmerA);
        const res = await request(app).get(`/api/applications/${fx.appId}/requirements`);

        expect(res.status).toBe(200);
        const land = res.body.data.slots.find((s) => s.slotId === 'land_rights');
        expect(Object.keys(land.precheck).sort()).toEqual(['acknowledgedAt', 'flags', 'id', 'status']);
        for (const f of land.precheck.flags) {
            expect(Object.keys(f).sort()).toEqual(['check', 'reasonTH', 'result']);
        }
        expect(land.precheck.flags.map((f) => f.result)).toContain('NOT_FOUND');
        const body = JSON.stringify(res.body);
        expect(body).not.toContain('confidence');
        expect(body).not.toContain('evidenceSnippet');
        expect(body).not.toContain(SNIPPET_TEXT);
        expect(body).not.toMatch(THIRTEEN_DIGITS);
    });

    test('another health user cannot acknowledge (404, nothing written)', async () => {
        as(fx.farmerB);
        const res = await request(app).post(`/api/applications/${fx.appId}/prechecks/${fx.precheckId}/acknowledge`);

        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ success: false });
        const row = await raw.documentPrecheck.findUnique({ where: { id: fx.precheckId }, select: { applicantAcknowledgedAt: true } });
        expect(row.applicantAcknowledgedAt).toBeNull();
    });

    test('the owner acknowledges: the time is stored and the application status is the same before and after', async () => {
        const before = await raw.application.findUnique({ where: { id: fx.appId }, select: { status: true } });

        as(fx.farmerA);
        const res = await request(app).post(`/api/applications/${fx.appId}/prechecks/${fx.precheckId}/acknowledge`);

        expect(res.status).toBe(200);
        const after = await raw.application.findUnique({ where: { id: fx.appId }, select: { status: true } });
        expect(after.status).toBe(before.status);
        const row = await raw.documentPrecheck.findUnique({ where: { id: fx.precheckId }, select: { applicantAcknowledgedAt: true } });
        expect(row.applicantAcknowledgedAt).toBeInstanceOf(Date);
    });

    test('a verdict row stores the slot\'s current DONE pre-check id', async () => {
        as(fx.officerA);
        const res = await request(app)
            .post(`/api/provider/applications/${fx.appId}/document-reviews`)
            .send({ slotId: 'land_rights', verdict: 'ACCEPTED' });

        expect(res.status).toBe(200);
        const review = await raw.applicationDocumentReview.findFirst({
            where: { applicationId: fx.appId, slotId: 'land_rights' },
            select: { verdict: true, precheckId: true },
        });
        expect(review).toEqual({ verdict: 'ACCEPTED', precheckId: fx.precheckId });
    });
});
