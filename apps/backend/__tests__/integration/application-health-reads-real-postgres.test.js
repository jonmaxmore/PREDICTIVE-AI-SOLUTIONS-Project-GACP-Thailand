'use strict';

/**
 * Application health reads go through holderReadWhere (spec 2026-09-30 §3.1,
 * Task 3), on a REAL Postgres through the REAL prisma-database client and the
 * real tenant-context + active-entity middlewares. Only authentication is
 * attached by hand.
 *
 * Fixture: company C (JURISTIC). A is its OWNER and filed appC; B is a MANAGER
 * of C who filed nothing; S is a stranger with only a personal entity. A also
 * owns a personal entity P with appP.
 *
 * R1 (operator ruling C1, Task 3 fix round 1): every door also keeps its pre-R1
 * filer pin (r1LegacyApplicantPin), so a co-member is NOT given the filer's rows
 * in R1 — B in workspace C gets what the pre-R1 code gave B. The exact pre-R1
 * equality over actors × workspaces × doors is r1-application-reads-neutral-real-postgres.test.js.
 *
 * What only a real run shows:
 *   - the read witness (HOLDER_READ_WITNESS) sees Prisma's clone of the args, so
 *     "the where carries the fragment" is proved only when the witness is
 *     silent for model Application on a live request;
 *   - the R1 intersection (holderScope ∩ req.activeEntity, ruling C1) and the
 *     entity ALS rewrite really combine to the rows the doors return.
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
    const { activeEntityMiddleware } = jest.requireActual('../../middleware/active-entity-middleware');
    const bindTenant = tenantContextMiddleware();
    const bindEntity = activeEntityMiddleware();
    const attach = (req, res, next) => {
        req.user = { ...mockActor.current };
        return bindTenant(req, res, () => bindEntity(req, res, next));
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

    const get = (path, entityId) => request(app).get(path).set({ 'x-active-entity-id': entityId });

    // ── by-id doors: A and co-member B (workspace C) read appC; S gets 404 ─────
    const byIdDoors = [
        ['GET /applications/:id', (id) => `/api/applications/${id}`],
        ['GET /applications/:id/status', (id) => `/api/applications/${id}/status`],
        ['GET /applications/:id/history', (id) => `/api/applications/${id}/history`],
        ['GET /applications/:id/activities', (id) => `/api/applications/${id}/activities`],
        ['GET /applications/:id/audit-notes', (id) => `/api/applications/${id}/audit-notes`],
    ];

    describe.each(byIdDoors)('%s (witness throw)', (_name, path) => {
        test('filer A in workspace C → 200; co-member B in workspace C → 404 (R1 keeps the filer pin); stranger S → 404; no unscoped Application read', async () => {
            setMode('throw');
            as(fx.A);
            expect((await get(path(fx.appC), fx.C)).status).toBe(200);
            as(fx.B);
            expect((await get(path(fx.appC), fx.C)).status).toBe(404);
            as(fx.S);
            expect((await get(path(fx.appC), fx.PS)).status).toBe(404);
            expect(applicationWitnessLogs()).toEqual([]);
        });

        test('R1 intersection: A in the personal workspace does not reach the company filing (404), and does reach appP', async () => {
            setMode('throw');
            as(fx.A);
            expect((await get(path(fx.appC), fx.P)).status).toBe(404);
            expect((await get(path(fx.appP), fx.P)).status).toBe(200);
            expect(applicationWitnessLogs()).toEqual([]);
        });
    });

    // ── list doors ─────────────────────────────────────────────────────────────
    // /my/statuses rows name the filing `applicationId`; the other lists name it `id`.
    const ids = (res) => (Array.isArray(res.body?.data) ? res.body.data.map((r) => r.id || r.applicationId).sort() : res.body);

    test('GET /applications/my, /, /my/statuses (witness throw): A lists per workspace; B sees C\'s filings only where pre-R1 relaxed; S nothing', async () => {
        setMode('throw');
        for (const path of ['/api/applications/my', '/api/applications/my/statuses', '/api/applications/']) {
            as(fx.A);
            expect(ids(await get(path, fx.C))).toEqual([fx.appC]);
            expect(ids(await get(path, fx.P))).toEqual([fx.appP]);
            as(fx.S);
            expect(ids(await get(path, fx.PS))).toEqual([]);
        }
        as(fx.B);
        // /my and / relaxed to the workspace pre-R1 (buildHealthWhereClause personal:false); /my/statuses pinned the filer.
        expect(ids(await get('/api/applications/my', fx.C))).toEqual([fx.appC]);
        expect(ids(await get('/api/applications/', fx.C))).toEqual([fx.appC]);
        expect(ids(await get('/api/applications/my/statuses', fx.C))).toEqual([]);
        expect(applicationWitnessLogs()).toEqual([]);
    });

    test('GET /applications/draft (witness throw): the caller\'s own open draft within the workspace; B filed none', async () => {
        setMode('throw');
        as(fx.A);
        expect((await get('/api/applications/draft', fx.C)).body.data?.id).toBe(fx.appC);
        as(fx.B);
        expect((await get('/api/applications/draft', fx.C)).body.data).toBeNull();
        as(fx.S);
        expect((await get('/api/applications/draft', fx.PS)).body.data).toBeNull();
        expect(applicationWitnessLogs()).toEqual([]);
    });

    test('GET /applications/bundles/my and /:id (witness throw): the filer\'s bundle, its filings listed as pre-R1 (no nested narrowing in R1)', async () => {
        setMode('throw');
        as(fx.A);
        const mine = await get('/api/applications/bundles/my', fx.C);
        expect(mine.status).toBe(200);
        expect(mine.body.data.map((b) => b.id)).toEqual([fx.bundle]);
        expect(mine.body.data[0].applications.map((a) => a.id)).toEqual([fx.appC]);
        const one = await get(`/api/applications/bundles/${fx.bundle}`, fx.C);
        expect(one.status).toBe(200);
        expect(one.body.data.applications.map((a) => a.id)).toEqual([fx.appC]);
        // R1: the included filings are not narrowed — pre-R1 never scoped the
        // include, so the company filing still lists in the personal workspace (Task 9).
        const personal = await get(`/api/applications/bundles/${fx.bundle}`, fx.P);
        expect(personal.status).toBe(200);
        expect(personal.body.data.applications.map((a) => a.id)).toEqual([fx.appC]);
        // B does not own the bundle (C8: bundles stay with their filer).
        as(fx.B);
        expect((await get(`/api/applications/bundles/${fx.bundle}`, fx.C)).status).toBe(404);
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
        test('A in workspace C is not refused; B (R1 filer pin) and S get 404; no unscoped Application read', async () => {
            as(fx.A);
            expect((await get(path(fx.appC), fx.C)).status).not.toBe(404);
            as(fx.B);
            expect((await get(path(fx.appC), fx.C)).status).toBe(404);
            as(fx.S);
            expect((await get(path(fx.appC), fx.PS)).status).toBe(404);
            expect(applicationWitnessLogs()).toEqual([]);
        });
    });

    test('GET /dashboard/stats (witness shadow): the application count follows the holder scope, no unscoped Application read', async () => {
        as(fx.A);
        const res = await get('/api/dashboard/stats', fx.C);
        expect(res.status).toBe(200);
        expect(res.body.data.totalApplications).toBe(1);
        as(fx.S);
        expect((await get('/api/dashboard/stats', fx.PS)).body.data.totalApplications).toBe(0);
        expect(applicationWitnessLogs()).toEqual([]);
    });

    // ── service methods behind the write doors (payments, draft/prepare, revision,
    //    CAR, quotation accept, draft delete), called as the doors call them: inside
    //    the request's contexts, after the middlewares, every query awaited there.
    describe('service methods behind the write doors (witness throw, real client)', () => {
        const applicationService = require('../../services/application-service');
        const { holderScope } = require('../../services/holder-access');

        /** Run `fn(scope, req)` inside one request through the real middlewares. */
        async function inRequest(user, entityId, fn) {
            const probe = express();
            let out;
            let failure = null;
            probe.get('/probe', require('../../middleware/auth-middleware').authenticateHealth, async (req, res) => {
                try { out = await fn(await holderScope(req), req); } catch (error) { failure = error; }
                res.json({ ok: true });
            });
            as(user);
            await request(probe).get('/probe').set({ 'x-active-entity-id': entityId });
            if (failure) { throw failure; }
            return out;
        }

        // Each caller passes its own filer identity for the R1 pin, as the doors do.
        const byIdCalls = (user) => (scope) => Promise.all([
            applicationService.findForPaymentOwnership(fx.appC, { holderScope: scope, filerHealthId: user.canonicalId }),
            applicationService.findOwnedApplicationForApplicant(fx.appC, { holderScope: scope, filerUserId: user.id }),
            applicationService.findApplicationByIdForHealth(fx.appC, { holderScope: scope, filerHealthId: user.canonicalId }),
        ]);

        test('the filer A reads appC through each by-id method; co-member B and stranger S read none (R1 filer pin); no unscoped Application read', async () => {
            setMode('throw');
            const asA = await inRequest(fx.A, fx.C, byIdCalls(fx.A));
            expect(asA.map((row) => row && row.id)).toEqual([fx.appC, fx.appC, fx.appC]);
            expect(await inRequest(fx.B, fx.C, byIdCalls(fx.B))).toEqual([null, null, null]);
            expect(await inRequest(fx.S, fx.PS, byIdCalls(fx.S))).toEqual([null, null, null]);
            expect(applicationWitnessLogs()).toEqual([]);
        });

        test('latest open draft is the filer\'s (pre-R1 healthId pin): A → appC in C, B → null', async () => {
            setMode('throw');
            const latest = (user) => (scope) => applicationService.findLatestOpenDraftForHealth({ holderScope: scope, filerHealthId: user.canonicalId });
            expect((await inRequest(fx.A, fx.C, latest(fx.A)))?.id).toBe(fx.appC);
            expect(await inRequest(fx.B, fx.C, latest(fx.B))).toBeNull();
            expect(applicationWitnessLogs()).toEqual([]);
        });

        test('deleteDraft keeps the strict filer pin AND the fragment: B cannot delete appC; nothing is deleted', async () => {
            setMode('throw');
            const del = (user) => (scope) => applicationService.deleteDraft(user.id, fx.appC, { holderScope: scope });
            expect(await inRequest(fx.B, fx.C, del(fx.B))).toBeNull();
            expect(await inRequest(fx.S, fx.PS, del(fx.S))).toBeNull();
            // A in the personal workspace: the filer pin matches, the fragment does not.
            expect(await inRequest(fx.A, fx.P, del(fx.A))).toBeNull();
            const row = await raw.application.findUnique({ where: { id: fx.appC }, select: { isDeleted: true } });
            expect(row.isDeleted).toBe(false);
            // The filer in the holder's workspace still deletes their own draft.
            const appD = await makeApplication('D', fx.A, fx.C);
            const deleted = await inRequest(fx.A, fx.C, (scope) => applicationService.deleteDraft(fx.A.id, appD, { holderScope: scope }));
            expect(deleted).toEqual({ id: appD });
            expect(applicationWitnessLogs()).toEqual([]);
        });
    });
});
