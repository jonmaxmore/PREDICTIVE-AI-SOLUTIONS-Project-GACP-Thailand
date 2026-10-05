'use strict';

/**
 * Application health reads go through holderReadWhere (spec 2026-09-30 §3.1,
 * Task 3), on a REAL Postgres through the REAL prisma-database client and the
 * real tenant-context middleware. Only authentication is attached by hand.
 *
 * Fixture: company C (JURISTIC). A is its OWNER and filed appC; B is a MANAGER
 * of C who filed nothing; S is a stranger with only a personal entity. A also
 * owns a personal entity P with appP.
 *
 * R2 Task 12: the holder fragment alone decides (no filer pin, no workspace
 * header): a co-member reads the holder's filings like the filer does.
 *
 * What only a real run shows: the read witness (HOLDER_READ_WITNESS) sees
 * Prisma's clone of the args, so "the where carries the fragment" is proved
 * only when the witness is silent for model Application on a live request.
 *
 * Doors whose only watched reads are Application reads run with the witness in
 * THROW mode: an unscoped Application read would 500 the door. Doors that also
 * read ApplicationDocument / Invoice / Certificate / Farm (converted in Task 4)
 * run in shadow mode, and the assertion is that no Application read is logged.
 */

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

const mockActor = { current: null };
jest.mock('../../middleware/auth-middleware', () => {
    const actual = jest.requireActual('../../middleware/auth-middleware');
    const { tenantContextMiddleware } = jest.requireActual('../../middleware/tenant-context-middleware');
    const bindTenant = tenantContextMiddleware();
    const attach = (req, res, next) => {
        req.user = { ...mockActor.current };
        return bindTenant(req, res, next);
    };
    return {
        ...actual,
        authenticateAny: attach,
        authenticateHealth: attach,
        authenticateProvider: attach,
        authenticateToken: attach,
    };
});

const sharedLogger = require('../../shared/logger');
const witnessConfig = require('../../config/holder-read-witness');

function setMode(mode) {
    if (mode === undefined) { delete process.env.HOLDER_READ_WITNESS; }
    else { process.env.HOLDER_READ_WITNESS = mode; }
    witnessConfig.resetHolderReadWitnessModeCache();
}

d('Application health reads carry the holder fragment (real Postgres, real middlewares)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let app;
    const suffix = crypto.randomUUID().slice(0, 8);
    const fx = { apps: [], entities: [], users: [], bundles: [] };
    const ORIGINAL_MODE = process.env.HOLDER_READ_WITNESS;

    async function makeUser(label) {
        const id = crypto.randomUUID();
        const canonicalId = `hr-${label}-${suffix}`;
        await raw.user.create({
            data: {
                id, canonicalId, healthId: canonicalId, password: 'x', role: 'health', authType: 'EMAIL_LEGACY',
                email: `hr-${label}-${suffix}@example.test`, firstName: 'ทดสอบ', lastName: label, organizationId: fx.orgId,
            },
        });
        fx.users.push(id);
        return { id, canonicalId, label };
    }

    async function makeEntity(type, displayName) {
        const row = await raw.entity.create({ data: { type, displayName, organizationId: fx.orgId } });
        fx.entities.push(row.id);
        return row.id;
    }

    const member = (userId, entityId, role) => raw.entityMembership.create({
        data: { userId, entityId, role, status: 'ACTIVE', organizationId: fx.orgId },
    });

    async function makeApplication(label, filer, entityId) {
        const row = await raw.application.create({
            data: {
                applicationNumber: `APP-HR-${label}-${suffix}`, healthId: filer.canonicalId, areaType: 'OUTDOOR',
                organizationId: fx.orgId, entityId, submitterId: filer.id, status: 'DRAFT',
                formData: { steps: {}, workflowState: 'DRAFT' },
            },
        });
        fx.apps.push(row.id);
        return row.id;
    }

    const as = (user) => {
        mockActor.current = {
            id: user.id, canonicalId: user.canonicalId, healthId: user.canonicalId,
            role: 'health', canonicalRole: 'health', organizationId: fx.orgId,
        };
    };

    let warn;
    const applicationWitnessLogs = () => warn.mock.calls
        .map((c) => c[1])
        .filter((m) => m && m.signal === 'HEALTH_READ_UNSCOPED' && m.model === 'Application');

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        const org = await raw.organization.create({
            data: { name: `hr-${suffix}`, slug: `hr-${suffix}`, code: `HR_${suffix}`.toUpperCase() },
        });
        fx.orgId = org.id;
        fx.A = await makeUser('a');
        fx.B = await makeUser('b');
        fx.S = await makeUser('s');
        fx.C = await makeEntity('JURISTIC', 'บริษัท ทดสอบสมาชิก จำกัด');
        fx.P = await makeEntity('INDIVIDUAL', 'ทดสอบ a');
        fx.PS = await makeEntity('INDIVIDUAL', 'ทดสอบ s');
        await member(fx.A.id, fx.C, 'OWNER');
        await member(fx.B.id, fx.C, 'MANAGER');
        await member(fx.A.id, fx.P, 'OWNER');
        await member(fx.S.id, fx.PS, 'OWNER');
        fx.appC = await makeApplication('C', fx.A, fx.C);
        fx.appP = await makeApplication('P', fx.A, fx.P);
        const bundle = await raw.applicationBundle.create({
            data: { bundleNumber: `BND-HR-${suffix}`, healthId: fx.A.canonicalId, status: 'DRAFT', organizationId: fx.orgId },
        });
        fx.bundles.push(bundle.id);
        fx.bundle = bundle.id;
        await raw.application.update({ where: { id: fx.appC }, data: { bundleId: bundle.id } });

        app = express();
        app.use(express.json());
        app.use('/api/applications/bundles', require('../../routes/api/applications/application-bundles'));
        app.use('/api/applications', require('../../routes/api/applications/applications'));
        app.use('/api/applications', require('../../routes/api/applications/audit-notes'));
        app.use('/api/preview', require('../../routes/api/preview/preview'));
        app.use('/api/dashboard', require('../../routes/api/system/dashboard'));
    });

    afterAll(async () => {
        setMode(ORIGINAL_MODE);
        if (!raw) { return; }
        await raw.application.updateMany({ where: { id: { in: fx.apps } }, data: { bundleId: null } }).catch(() => {});
        await raw.applicationBundle.deleteMany({ where: { id: { in: fx.bundles } } }).catch(() => {});
        await raw.application.deleteMany({ where: { id: { in: fx.apps } } }).catch(() => {});
        await raw.entityMembership.deleteMany({ where: { entityId: { in: fx.entities } } }).catch(() => {});
        await raw.entity.deleteMany({ where: { id: { in: fx.entities } } }).catch(() => {});
        await raw.user.deleteMany({ where: { id: { in: fx.users } } }).catch(() => {});
        if (fx.orgId) { await raw.organization.deleteMany({ where: { id: fx.orgId } }).catch(() => {}); }
        await raw.$disconnect();
    });

    beforeEach(() => {
        setMode(undefined);
        warn = jest.spyOn(sharedLogger, 'warn');
    });
    afterEach(() => { warn.mockRestore(); });

    // R2 Task 12: no workspace header; membership alone decides.
    const get = (path) => request(app).get(path);

    // ── by-id doors: A and co-member B (workspace C) read appC; S gets 404 ─────
    const byIdDoors = [
        ['GET /applications/:id', (id) => `/api/applications/${id}`],
        ['GET /applications/:id/status', (id) => `/api/applications/${id}/status`],
        ['GET /applications/:id/history', (id) => `/api/applications/${id}/history`],
        ['GET /applications/:id/activities', (id) => `/api/applications/${id}/activities`],
        ['GET /applications/:id/audit-notes', (id) => `/api/applications/${id}/audit-notes`],
    ];

    describe.each(byIdDoors)('%s (witness throw)', (_name, path) => {
        test('filer A and co-member B (MANAGER of C) → 200 on appC; stranger S → 404; no unscoped Application read', async () => {
            setMode('throw');
            as(fx.A);
            expect((await get(path(fx.appC))).status).toBe(200);
            as(fx.B);
            expect((await get(path(fx.appC))).status).toBe(200);
            as(fx.S);
            expect((await get(path(fx.appC))).status).toBe(404);
            expect(applicationWitnessLogs()).toEqual([]);
        });

        test('A reaches both its holders\' filings (C and P); B, a member of C only, does not reach appP (404)', async () => {
            setMode('throw');
            as(fx.A);
            expect((await get(path(fx.appC))).status).toBe(200);
            expect((await get(path(fx.appP))).status).toBe(200);
            as(fx.B);
            expect((await get(path(fx.appP))).status).toBe(404);
            expect(applicationWitnessLogs()).toEqual([]);
        });
    });

    // ── list doors ─────────────────────────────────────────────────────────────
    // /my/statuses rows name the filing `applicationId`; the other lists name it `id`.
    const ids = (res) => (Array.isArray(res.body?.data) ? res.body.data.map((r) => r.id || r.applicationId).sort() : res.body);

    test('GET /applications/my, /, /my/statuses (witness throw): A lists both holders\' filings; B sees C\'s; S nothing', async () => {
        setMode('throw');
        for (const path of ['/api/applications/my', '/api/applications/my/statuses', '/api/applications/']) {
            as(fx.A);
            expect(ids(await get(path))).toEqual([fx.appC, fx.appP].sort());
            as(fx.B);
            expect(ids(await get(path))).toEqual([fx.appC]);
            as(fx.S);
            expect(ids(await get(path))).toEqual([]);
        }
        expect(applicationWitnessLogs()).toEqual([]);
    });

    test('GET /applications/draft (witness throw): the caller\'s own open draft on a holder it edits; B filed none', async () => {
        setMode('throw');
        as(fx.A);
        expect([fx.appC, fx.appP]).toContain((await get('/api/applications/draft')).body.data?.id);
        as(fx.B);
        expect((await get('/api/applications/draft')).body.data).toBeNull();
        as(fx.S);
        expect((await get('/api/applications/draft')).body.data).toBeNull();
        expect(applicationWitnessLogs()).toEqual([]);
    });

    test('GET /applications/bundles/my and /:id (witness throw): the filer\'s bundle and its filings (C8)', async () => {
        setMode('throw');
        as(fx.A);
        const mine = await get('/api/applications/bundles/my');
        expect(mine.status).toBe(200);
        expect(mine.body.data.map((b) => b.id)).toEqual([fx.bundle]);
        expect(mine.body.data[0].applications.map((a) => a.id)).toEqual([fx.appC]);
        const one = await get(`/api/applications/bundles/${fx.bundle}`);
        expect(one.status).toBe(200);
        expect(one.body.data.applications.map((a) => a.id)).toEqual([fx.appC]);
        // B does not own the bundle (C8: bundles stay with their filer).
        as(fx.B);
        expect((await get(`/api/applications/bundles/${fx.bundle}`)).status).toBe(404);
        expect(applicationWitnessLogs()).toEqual([]);
    });

    // ── doors that also read other watched models (Task 4): shadow, Application silent ──
    const shadowDoors = [
        ['GET /applications/:id/requirements', (id) => `/api/applications/${id}/requirements`],
        ['GET /applications/:id/katorlor1', (id) => `/api/applications/${id}/katorlor1`],
        ['GET /applications/:id/statement', (id) => `/api/applications/${id}/statement`],
        ['GET /preview/applications/:id/preview', (id) => `/api/preview/applications/${id}/preview`],
    ];

    describe.each(shadowDoors)('%s (witness shadow)', (_name, path) => {
        test('A and co-member B are not refused; stranger S gets 404; no unscoped Application read', async () => {
            as(fx.A);
            expect((await get(path(fx.appC))).status).not.toBe(404);
            as(fx.B);
            expect((await get(path(fx.appC))).status).not.toBe(404);
            as(fx.S);
            expect((await get(path(fx.appC))).status).toBe(404);
            expect(applicationWitnessLogs()).toEqual([]);
        });
    });

    test('GET /dashboard/stats (witness shadow): the application count follows the holder scope, no unscoped Application read', async () => {
        as(fx.A);
        const res = await get('/api/dashboard/stats');
        expect(res.status).toBe(200);
        expect(res.body.data.totalApplications).toBe(2);
        as(fx.B);
        expect((await get('/api/dashboard/stats')).body.data.totalApplications).toBe(1);
        as(fx.S);
        expect((await get('/api/dashboard/stats')).body.data.totalApplications).toBe(0);
        expect(applicationWitnessLogs()).toEqual([]);
    });

    // ── service methods behind the write doors (payments, draft/prepare, revision,
    //    CAR, quotation accept, draft delete), called as the doors call them: inside
    //    the request's contexts, after the middlewares, every query awaited there.
    describe('service methods behind the write doors (witness throw, real client)', () => {
        const applicationService = require('../../services/application-service');
        const { holderScope } = require('../../services/holder-access');

        /** Run `fn(scope, req)` inside one request through the real middlewares. */
        async function inRequest(user, fn) {
            const probe = express();
            let out;
            let failure = null;
            probe.get('/probe', require('../../middleware/auth-middleware').authenticateHealth, async (req, res) => {
                try { out = await fn(await holderScope(req), req); } catch (error) { failure = error; }
                res.json({ ok: true });
            });
            as(user);
            await request(probe).get('/probe');
            if (failure) { throw failure; }
            return out;
        }

        // R2 Task 12: every by-id method carries the fragment alone.
        const byIdCalls = () => (scope) => Promise.all([
            applicationService.findForPaymentOwnership(fx.appC, { holderScope: scope }),
            applicationService.findOwnedApplicationForApplicant(fx.appC, { holderScope: scope }),
            applicationService.findApplicationByIdForHealth(fx.appC, { holderScope: scope }),
        ]);

        test('the filer A and the co-member B read appC through each by-id method; stranger S reads none; no unscoped Application read', async () => {
            setMode('throw');
            expect((await inRequest(fx.A, byIdCalls())).map((row) => row && row.id)).toEqual([fx.appC, fx.appC, fx.appC]);
            expect((await inRequest(fx.B, byIdCalls())).map((row) => row && row.id)).toEqual([fx.appC, fx.appC, fx.appC]);
            expect(await inRequest(fx.S, byIdCalls())).toEqual([null, null, null]);
            expect(applicationWitnessLogs()).toEqual([]);
        });

        test('latest open draft is the caller\'s own on a holder it edits: A → one of its drafts, B → null', async () => {
            setMode('throw');
            // R2 Task 8 (spec §3.2 resume): the caller's own draft, on a holder it may edit.
            const latest = (user) => (scope) => applicationService.findLatestOpenDraftForHealth({
                holderScope: scope, submitterId: user.id, editIds: scope.editIds,
            });
            expect([fx.appC, fx.appP]).toContain((await inRequest(fx.A, latest(fx.A)))?.id);
            expect(await inRequest(fx.B, latest(fx.B))).toBeNull();
            expect(applicationWitnessLogs()).toEqual([]);
        });

        test('deleteDraft (R2 Task 9, spec §3.3): B (MANAGER, not creator) is refused 403, S sees nothing; nothing is deleted', async () => {
            setMode('throw');
            const del = (user) => (scope) => applicationService.deleteDraft(user.id, fx.appC, { holderScope: scope });
            await expect(inRequest(fx.B, del(fx.B))).rejects.toMatchObject({ statusCode: 403, code: 'ENTITY_PERMISSION_DENIED' });
            expect(await inRequest(fx.S, del(fx.S))).toBeNull();
            const row = await raw.application.findUnique({ where: { id: fx.appC }, select: { isDeleted: true } });
            expect(row.isDeleted).toBe(false);
            // The creator (OWNER) still deletes their own draft.
            const appD = await makeApplication('D', fx.A, fx.C);
            const deleted = await inRequest(fx.A, (scope) => applicationService.deleteDraft(fx.A.id, appD, { holderScope: scope }));
            expect(deleted).toEqual({ id: appD });
            expect(applicationWitnessLogs()).toEqual([]);
        });
    });
});
