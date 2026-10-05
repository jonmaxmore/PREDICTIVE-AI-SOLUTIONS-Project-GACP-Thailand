/**
 * A0-AUDIT-EMISSION / PR-A0-2 — INVARIANT A0 per hop, against a REAL Postgres,
 * driving the REAL HTTP handlers.
 *
 * INVARIANT A0 (design-decision.md §4), as checked per hop H below:
 *   (1) commit(H) ⇒ ΔAuditLog(category=APPLICATION,
 *       action=APPLICATION_STATUS_TRANSITION, resourceId=applicationId) = +1 per
 *       status edge H walks, with metadata.fromStatus/toStatus matching.
 *   (2) a failure injected AFTER the status write and BEFORE the route's COMMIT
 *       ⇒ the status is unchanged AND Δ = 0.
 *   (3) firing the hop a second time, once its own guard rejects it, adds nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REWRITTEN for PR-A0-2 audit round 1, finding F2 (HIGH).
 *
 * The first version of this file could not have gone red on the pre-PR-A0-2
 * code and was therefore not evidence of anything: it opened its own
 * transactions, called `writeApplicationStatus` directly, and re-implemented the
 * route bodies inline — so it asserted that the transaction shape the TEST wrote
 * is atomic, which is trivially true and says nothing about the routes. The real
 * handler was never invoked, so reverting the wrapper in `applications.js` /
 * `application-bundles.js` would not have moved a single assertion.
 *
 * What changed:
 *   • every hop is fired through its REAL express router over supertest, with
 *     only auth/consent/multer stubbed (they are not the subject and cannot be
 *     satisfied from a fixture);
 *   • the table is data-driven, one row per hop, so a hop is added by adding a
 *     row rather than by copying a describe block;
 *   • clause (2) is injected UNIFORMLY: `writeApplicationStatus` is a
 *     pass-through to the real implementation that can be ARMED to delegate and
 *     then throw on its Nth call. The throw therefore happens inside whatever
 *     transaction the ROUTE opened — which is exactly the thing under test. On a
 *     route with no wrapper (the pre-PR-A0-2 code) the earlier hop is already
 *     committed and clause (2) fails, which is the RED this file owes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HONEST SCOPE — read before trusting anything here (Law 3.8; the F-A lesson).
 *
 * THIS FILE HAS STILL NEVER EXECUTED. It self-skips without `DATABASE_URL`, and
 * in the PR-A0-2 sandbox `@prisma/client` has no generated client at all
 * (gacp-debug SKILL.md:21), so it cannot even load there. Neither red nor green
 * is claimed for any case below, on any environment. The structural defect F2
 * named is fixed — the cases now target the real routes and CAN go red when the
 * wrapper is reverted — but "can" is a reading of the code, not a result.
 *
 * The FIXTURES are the least verified part: seed shapes (formData keys, deadline
 * fields, consent) were derived by reading each route, never by running them.
 * Expect the first Postgres run to need fixture repair, and do not read a
 * fixture failure as a product failure.
 *
 * DESCOPED (design-decision.md §3, amended by PR-A0-2 after this audit round):
 * hops #18, #19, #20, #21, #22 and #24 are NOT in the table. Each sits behind a
 * canonical-permission middleware stack or needs companion rows (WorkActivity +
 * StageActivityConfig + group membership for #22; an ACTIVE auditor on a working
 * day for #24) that cannot be seeded honestly without running them once. They
 * are recorded as descoped with reasons rather than shipped as unverified rows.
 */

'use strict';

const express = require('express');
const request = require('supertest');

// Not `Boolean(process.env.DATABASE_URL)`: jest.setup.js:104 pins that variable on every
// run, so the old HAS_DB was always true — this suite never skipped and died on connection
// refused. Ask the run-level guard what it actually probed; it names the reason in the title.
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

const TRANSITION_ACTION = 'APPLICATION_STATUS_TRANSITION';
const OVERRIDE_ACTION = 'APPLICATION_STATUS_OVERRIDE';

// ── the only stubs: identity, consent, upload ────────────────────────────────
// None of them is under test and none can be satisfied from a fixture.

const CURRENT_USER = {};

jest.mock('../../middleware/auth-middleware', () => {
    const inject = (req, _res, next) => { req.user = { ...global.__A0_PR2_USER__ }; next(); };
    return {
        authenticateHealth: inject,
        authenticateAny: inject,
        authenticateProvider: inject,
    };
});

jest.mock('../../middleware/consent-manager', () => ({
    requireConsent: (_req, _res, next) => next(),
}));

jest.mock('multer', () => {
    const multer = () => ({
        array: () => (req, _res, next) => {
            req.files = [{ filename: 'car-evidence.pdf', originalname: 'car.pdf', size: 2048 }];
            next();
        },
        single: () => (_req, _res, next) => next(),
    });
    multer.diskStorage = () => ({});
    return multer;
});

/**
 * Clause-(2) injection point. The REAL writer runs; the proxy only decides
 * whether to throw AFTER it returns, on a chosen call index, so the failure
 * lands inside the transaction the ROUTE opened, after a real status UPDATE and
 * a real audit INSERT.
 */
const injection = { throwOnCall: null, calls: 0 };
jest.mock('../../services/application-status-writer', () => {
    const actual = jest.requireActual('../../services/application-status-writer');
    return {
        ...actual,
        writeApplicationStatus: async (args) => {
            const out = await actual.writeApplicationStatus(args);
            injection.calls += 1;
            if (injection.throwOnCall === injection.calls) {
                throw new Error('A0-PR2 injected failure after the status write, before COMMIT');
            }
            return out;
        },
    };
});

const { PrismaClient } = require('@prisma/client');

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
 * The per-edge assertion below used to run `toMatchObject` straight at
 * `rows[i].metadata`. That form only ever passed against mocks that echo the
 * input object back; on the first run against a real Postgres it errored with
 * "received value must be a non-null object / Received has type: string". It was
 * pinning a shape that has never existed in the database.
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

d('A0 PR-2 — per-hop invariant, real routes on real Postgres', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let prisma;
    let orgId;
    let healthId;
    let userId;
    let suffix;

    /** Narrow count — resourceId + action + category, never a broad sweep. */
    const transitionRows = (id) => prisma.auditLog.count({
        where: { category: 'APPLICATION', action: TRANSITION_ACTION, resourceId: id },
    });
    const overrideRows = (id) => prisma.auditLog.count({
        where: { category: 'ADMIN', action: OVERRIDE_ACTION, resourceId: id },
    });
    const statusOf = (id) => prisma.application
        .findUnique({ where: { id }, select: { status: true, version: true } });

    async function seedApplication({ status, formData = {}, workflowHistory = [] }) {
        const row = await prisma.application.create({
            data: {
                applicationNumber: `A0-PR2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                healthId,
                areaType: 'OUTDOOR',
                organizationId: orgId,
                status,
                formData,
                workflowHistory,
            },
        });
        return row.id;
    }

    function mount(routerPath, { asAdmin = false } = {}) {
        global.__A0_PR2_USER__ = asAdmin
            ? { id: userId, role: 'admin', canonicalRole: 'admin', organizationId: orgId }
            : { id: userId, canonicalId: healthId, healthId, organizationId: orgId, canonicalRole: 'health', role: 'HEALTH_USER' };
        const app = express();
        app.use(express.json());
        // admin/applications.js has no auth middleware of its own — the mount
        // point supplies req.user, exactly as the real server does.
        app.use((req, _res, next) => { req.user = { ...global.__A0_PR2_USER__ }; next(); });
        app.use('/mnt', require(routerPath));
        return app;
    }

    // ── the past-due timestamps the deadline hops read out of formData ───────
    const PAST = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    /**
     * One row per hop. `fire(app, ctx)` returns the supertest promise; `edges`
     * is the list of status edges the hop is expected to walk, in order.
     */
    const HOPS = [
        {
            id: '#8/#9',
            title: 'POST /submit — initial submit walks DRAFT→SUBMITTED→PENDING_DOC_FEE',
            router: '../../routes/api/applications/applications',
            seed: () => ({
                status: 'DRAFT',
                formData: completeCanonicalFormData(),
            }),
            fire: (app, ctx) => request(app).post('/mnt/submit').send({ applicationId: ctx.appId }),
            okStatus: (s) => s < 400,
            edges: [['DRAFT', 'SUBMITTED'], ['SUBMITTED', 'PENDING_DOC_FEE']],
            // clause (2): let hop 1 commit its UPDATE + row, then blow up hop 2.
            injectOnCall: 2,
            finalStatusAfterFailure: 'DRAFT',
        },
        {
            id: '#12',
            title: 'POST /bundles/:id/submit — every linked case walks DRAFT→SUBMITTED',
            router: '../../routes/api/applications/application-bundles',
            seedExtra: async (ctx) => {
                const second = await seedApplication({ status: 'DRAFT' });
                const bundle = await prisma.applicationBundle.create({
                    data: {
                        bundleNumber: `BND-A0PR2-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        healthId,
                        status: 'DRAFT',
                    },
                });
                await prisma.application.updateMany({
                    where: { id: { in: [ctx.appId, second] } },
                    data: { bundleId: bundle.id },
                });
                ctx.secondAppId = second;
                ctx.bundleId = bundle.id;
            },
            seed: () => ({ status: 'DRAFT' }),
            fire: (app, ctx) => request(app).post(`/mnt/${ctx.bundleId}/submit`).send({}),
            okStatus: (s) => s === 200,
            edges: [['DRAFT', 'SUBMITTED']],
            injectOnCall: 2, // case 1 lands, case 2 blows up
            finalStatusAfterFailure: 'DRAFT',
            extraAssertionsOnSuccess: async (ctx) => {
                const bundle = await prisma.applicationBundle.findUnique({ where: { id: ctx.bundleId } });
                expect(bundle.status).toBe('SUBMITTED');
            },
            extraAssertionsOnFailure: async (ctx) => {
                const bundle = await prisma.applicationBundle.findUnique({ where: { id: ctx.bundleId } });
                expect(bundle.status).toBe('DRAFT');
                expect(await transitionRows(ctx.secondAppId)).toBe(0);
            },
        },
        {
            id: '#7',
            title: 'PATCH /admin/applications/:id/status — admin override',
            router: '../../routes/api/admin/applications',
            mountOpts: { asAdmin: true },
            seed: () => ({ status: 'AUDIT_FEE_PAID' }),
            fire: (app, ctx) => request(app).patch(`/mnt/${ctx.appId}/status`).send({
                status: 'AUDIT_CONFIRMED',
                reasonCode: 'DATA_CORRECTION',
                comment: 'แก้ไขสถานะตามคำสั่งผู้ดูแลระบบ',
            }),
            okStatus: (s) => s === 200,
            edges: [['AUDIT_FEE_PAID', 'AUDIT_CONFIRMED']],
            injectOnCall: 1,
            finalStatusAfterFailure: 'AUDIT_FEE_PAID',
            extraAssertionsOnSuccess: async (ctx) => {
                // the PR-A0-2 double-row ruling, as counts: one of each, never two.
                expect(await overrideRows(ctx.appId)).toBe(1);
            },
            extraAssertionsOnFailure: async (ctx) => {
                expect(await overrideRows(ctx.appId)).toBe(0);
            },
        },
        {
            id: '#13',
            title: 'POST /applications/:id/car — late CAR evidence expires the case',
            router: '../../routes/api/applications/applications-car',
            seed: () => ({
                status: 'CAR_PENDING',
                formData: { workflowState: 'CAR_PENDING', carDueAt: PAST, car_due_at: PAST },
            }),
            seedExtra: async (ctx) => {
                await prisma.revisionDeadline.create({
                    data: { applicationId: ctx.appId, status: 'PENDING', dueAt: new Date(PAST) },
                }).catch(() => {}); // the companion row is asserted, not required to seed
            },
            fire: (app, ctx) => request(app).post(`/mnt/${ctx.appId}/car`).send({ notes: 'ส่งหลักฐาน' }),
            okStatus: (s) => s === 400, // the expiry IS the rejection
            edges: [['CAR_PENDING', 'EXPIRED']],
            injectOnCall: 1,
            finalStatusAfterFailure: 'CAR_PENDING',
        },
        {
            id: '#14',
            title: 'POST /applications/:id/car — in-time CAR evidence advances to CAR_REVIEWING',
            router: '../../routes/api/applications/applications-car',
            seed: () => ({
                status: 'CAR_PENDING',
                formData: { workflowState: 'CAR_PENDING', carDueAt: FUTURE, car_due_at: FUTURE },
            }),
            fire: (app, ctx) => request(app).post(`/mnt/${ctx.appId}/car`).send({ notes: 'ส่งหลักฐาน' }),
            okStatus: (s) => s === 200,
            edges: [['CAR_PENDING', 'CAR_REVIEWING']],
            injectOnCall: 1,
            finalStatusAfterFailure: 'CAR_PENDING',
        },
        {
            id: '#15',
            title: 'GET /system/cron/auto-cancel — the overdue sweep expires the case',
            router: '../../routes/api/system/cron',
            seed: () => ({
                status: 'REVISION_REQUESTED',
                formData: { workflowState: 'REVISION_REQUESTED', revisionDueAt: PAST },
            }),
            fire: (app) => request(app).get('/mnt/auto-cancel').set('x-cron-secret', process.env.CRON_SECRET),
            okStatus: (s) => s === 200,
            edges: [['REVISION_REQUESTED', 'EXPIRED']],
            injectOnCall: 1,
            finalStatusAfterFailure: 'REVISION_REQUESTED',
        },
    ];

    beforeAll(async () => {
        prisma = new PrismaClient();
        await prisma.$connect();
        suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const org = await prisma.organization.create({
            data: {
                name: 'A0 PR2 Test Org',
                slug: `a0-pr2-${suffix}`,
                code: `A0PR2_${suffix}`.toUpperCase().slice(0, 24),
            },
        });
        orgId = org.id;
        healthId = `a0-pr2-canon-${suffix}`;
        const user = await prisma.user.create({
            data: {
                canonicalId: healthId,
                password: 'x', // never authenticated in this test
                organizationId: orgId,
                authType: 'EMAIL_LEGACY',
            },
        });
        userId = user.id;
        process.env.CRON_SECRET = process.env.CRON_SECRET || `a0-pr2-cron-${suffix}`;
    });

    afterAll(async () => {
        if (healthId) {
            await prisma.applicationBundle.deleteMany({ where: { healthId } }).catch(() => {});
            await prisma.application.deleteMany({ where: { healthId } }).catch(() => {});
            await prisma.user.deleteMany({ where: { canonicalId: healthId } }).catch(() => {});
        }
        if (orgId) {
            await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
        }
        await prisma.$disconnect();
    });

    beforeEach(() => {
        injection.throwOnCall = null;
        injection.calls = 0;
        Object.keys(CURRENT_USER).forEach((k) => delete CURRENT_USER[k]);
    });

    describe.each(HOPS.map((h) => [`${h.id} — ${h.title}`, h]))('%s', (_label, hop) => {
        let ctx;

        beforeEach(async () => {
            ctx = { appId: await seedApplication(hop.seed()) };
            if (hop.seedExtra) { await hop.seedExtra(ctx); }
        });

        afterEach(async () => {
            const ids = [ctx.appId, ctx.secondAppId].filter(Boolean);
            await prisma.auditLog.deleteMany({ where: { resourceId: { in: ids } } }).catch(() => {});
            await prisma.revisionDeadline.deleteMany({ where: { applicationId: { in: ids } } }).catch(() => {});
            await prisma.application.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
            if (ctx.bundleId) {
                await prisma.applicationBundle.deleteMany({ where: { id: ctx.bundleId } }).catch(() => {});
            }
        });

        test('(1) the hop commits ⇒ exactly one canonical row per edge it walks', async () => {
            const before = await transitionRows(ctx.appId);

            const res = await hop.fire(mount(hop.router, hop.mountOpts), ctx);
            expect(hop.okStatus(res.status)).toBe(true);

            expect((await transitionRows(ctx.appId)) - before).toBe(hop.edges.length);
            const last = hop.edges[hop.edges.length - 1];
            expect((await statusOf(ctx.appId)).status).toBe(last[1]);

            const rows = await prisma.auditLog.findMany({
                where: { category: 'APPLICATION', action: TRANSITION_ACTION, resourceId: ctx.appId },
                orderBy: { createdAt: 'asc' },
            });
            hop.edges.forEach(([from, to], i) => {
                expect(persistedAuditMetadata(rows[i].metadata)).toMatchObject({ fromStatus: from, toStatus: to });
            });

            if (hop.extraAssertionsOnSuccess) { await hop.extraAssertionsOnSuccess(ctx); }
        });

        test('(2) a failure injected after the status write, before COMMIT ⇒ status unchanged AND Δ = 0', async () => {
            const before = await transitionRows(ctx.appId);
            injection.throwOnCall = hop.injectOnCall;

            const res = await hop.fire(mount(hop.router, hop.mountOpts), ctx);
            expect(res.status).toBeGreaterThanOrEqual(400);

            // THIS is the assertion the wrapper exists for. Revert the
            // `prisma.$transaction` in applications.js / application-bundles.js
            // and the earlier edge is already committed here.
            expect((await statusOf(ctx.appId)).status).toBe(hop.finalStatusAfterFailure);
            expect((await transitionRows(ctx.appId)) - before).toBe(0);

            if (hop.extraAssertionsOnFailure) { await hop.extraAssertionsOnFailure(ctx); }
        });

        test('(3) firing the hop again once its own guard rejects it adds nothing', async () => {
            await hop.fire(mount(hop.router, hop.mountOpts), ctx);
            const afterFirst = await transitionRows(ctx.appId);
            const statusAfterFirst = (await statusOf(ctx.appId)).status;

            await hop.fire(mount(hop.router, hop.mountOpts), ctx);

            expect(await transitionRows(ctx.appId)).toBe(afterFirst);
            expect((await statusOf(ctx.appId)).status).toBe(statusAfterFirst);
        });
    });
});

/**
 * The canonical formData shape the live wizard posts, as
 * `__tests__/unit/applications-submit-canonical-validation.test.js` builds it —
 * the submit route runs REAL Zod validation, so an incomplete fixture 422s
 * before any hop is walked.
 */
function completeCanonicalFormData() {
    return {
        plantId: 'cannabis',
        serviceType: 'NEW',
        certificationPurposes: ['EXPORT'],
        locationType: 'OUTDOOR',
        cultivationMethods: ['outdoor'],
        consentedPDPA: true,
        acknowledgedStandards: true,
        applicantData: {
            applicantType: 'INDIVIDUAL',
            firstName: 'สมชาย',
            lastName: 'ใจดี',
            idCard: '1100000000008',
            phone: '0812345678',
            email: 'somchai@example.com',
            address: '123 หมู่ 4',
        },
        farmData: {
            farmName: 'ฟาร์มสมชาย',
            address: '123 หมู่ 4',
            province: 'สมุทรปราการ',
            district: 'บางพลี',
            subdistrict: 'บางพลีใหญ่',
            postalCode: '10540',
            totalAreaSize: '5',
            totalAreaUnit: 'Rai',
            landOwnership: 'OWN',
            gpsLat: '13.12',
            gpsLng: '100.65',
        },
        plots: [{ id: 'p1', name: 'แปลงที่ 1', areaSize: '2', areaUnit: 'Rai', solarSystem: 'OUTDOOR' }],
        productionData: { propagationType: ['SEED'], plantParts: ['FLOWER'] },
        documents: [{ name: 'doc.pdf', url: '/uploads/doc.pdf', type: 'LAND_RIGHT' }],
    };
}
