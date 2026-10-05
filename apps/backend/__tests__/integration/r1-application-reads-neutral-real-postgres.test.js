'use strict';

/**
 * R1 is behaviour-neutral for the Application health doors (operator ruling C1,
 * controller ruling on Task 3 fix round 1): for every actor, workspace header
 * and door below, the R1 code answers with exactly the status and row set the
 * pre-R1 code (e46ceba0) answered with. The widening to "co-members read the
 * company's filings" happens in R2 (Tasks 8, 9, 12), never in R1.
 *
 * EXPECTED was captured by running this same file against e46ceba0's
 * implementation files (the Task 3 fix-round RED/record run, see
 * evidence/remove-workspace-mode/task-3/fix1-*.txt); row ids are mapped to
 * fixture labels so the table is stable across runs.
 *
 * Real Postgres, the real prisma-database client, the real tenant-context and
 * active-entity middlewares; only authentication is attached by hand, and
 * multer is stubbed so the CAR door needs no file on disk.
 *
 * Doors: GET /my, /my/statuses, / (lists), GET /draft, GET /dashboard/stats (count),
 * and per filing GET /:id, /status, /statement, /history, /activities, /katorlor1,
 * /requirements, /audit-notes, /quotations and the preview; writes: POST
 * /:id/revision-resubmit, POST /:id/car and POST /draft with an explicit id.
 *
 * Fixture (one organisation):
 *   A — OWNER of personal P and of company C.       filings aC, aP, aRev (C), aCar (C)
 *   W — OWNER of personal PW, MANAGER invited to P.  filing  wP (on A's P)
 *   V — OWNER of personal PV, VIEWER of C.
 *   M — OWNER of personal PM, MANAGER of C.          filing  mC (on C)
 *   S — OWNER of personal PS only (a stranger).
 *   N — no entity and no membership at all.           filings nN, nD (entityId null)
 *   A also filed aN with entityId null (a filing outside every membership).
 *
 * No entity context (final review C1, 2026-10-03): N gets no context because
 * the active-entity middleware finds no personal entity; any user gets none
 * when that middleware's resolution throws (its catch falls through). Without
 * a context nothing overwrites a top-level entityId, so a door that ANDs the
 * holder fragment with its pin narrows. The `transient` rows drive that catch
 * for real (the first read of the workspace header throws).
 */

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

const mockActor = { current: null, transient: false };
jest.mock('../../middleware/auth-middleware', () => {
    const actual = jest.requireActual('../../middleware/auth-middleware');
    const { tenantContextMiddleware } = jest.requireActual('../../middleware/tenant-context-middleware');
    const { activeEntityMiddleware } = jest.requireActual('../../middleware/active-entity-middleware');
    const bindTenant = tenantContextMiddleware();
    const bindEntity = activeEntityMiddleware();
    // `transient`: the first read of the workspace header throws, so the
    // active-entity middleware takes its catch path and binds no context.
    const failOnce = (headers) => {
        let thrown = false;
        return new Proxy(headers, {
            get(target, key, receiver) {
                if (key === 'x-active-entity-id' && !thrown) {
                    thrown = true;
                    throw new Error('simulated transient membership lookup failure');
                }
                return Reflect.get(target, key, receiver);
            },
        });
    };
    const attach = (req, res, next) => {
        req.user = { ...mockActor.current };
        if (mockActor.transient) { req.headers = failOnce(req.headers); }
        return bindTenant(req, res, () => bindEntity(req, res, next));
    };
    return { ...actual, authenticateAny: attach, authenticateHealth: attach, authenticateProvider: attach, authenticateToken: attach };
});

// The CAR door takes multipart evidence; the file itself is not under test.
jest.mock('multer', () => {
    const pass = () => (_req, _res, next) => next();
    const multer = () => ({
        array: () => (req, _res, next) => {
            req.files = [{ filename: 'car-evidence.pdf', originalname: 'car.pdf', size: 2048 }];
            next();
        },
        single: pass,
        fields: pass,
        any: pass,
        none: pass,
    });
    multer.diskStorage = () => ({});
    multer.memoryStorage = () => ({});
    return multer;
});

const ACTORS = ['A', 'W', 'V', 'M', 'S', 'N'];
const HEADERS = ['none', 'P', 'C'];
const BY_ID_TARGETS = ['aC', 'aP', 'wP', 'mC', 'aN', 'nN'];
const BY_ID_DOORS = [
    ['GET /:id', (id) => `/api/applications/${id}`],
    ['GET /:id/status', (id) => `/api/applications/${id}/status`],
    ['GET /:id/statement', (id) => `/api/applications/${id}/statement`],
    ['GET /:id/history', (id) => `/api/applications/${id}/history`],
    ['GET /:id/activities', (id) => `/api/applications/${id}/activities`],
    ['GET /:id/katorlor1', (id) => `/api/applications/${id}/katorlor1`],
    ['GET /:id/requirements', (id) => `/api/applications/${id}/requirements`],
    ['GET /:id/audit-notes', (id) => `/api/applications/${id}/audit-notes`],
    ['GET /:id/quotations', (id) => `/api/applications/${id}/quotations`],
    ['GET /preview/:id', (id) => `/api/preview/applications/${id}/preview`],
];
const LIST_DOORS = ['/api/applications/my', '/api/applications/my/statuses', '/api/applications/'];

// Captured from e46ceba0 (pre-R1) — see the header. `<status> <sorted labels>` for
// lists, `<status>` for by-id doors, `<status> <label>` for POST /draft.
const EXPECTED = require('../fixtures/r1-application-reads-neutral.expected.json');

d('R1 Application health doors answer exactly as pre-R1 (real Postgres)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let app;
    const sfx = crypto.randomUUID().slice(0, 8);
    const fx = { users: {}, entities: {}, apps: {}, entityIds: [], userIds: [] };
    const label = new Map();

    const mkUser = async (name) => {
        const id = crypto.randomUUID();
        const canonicalId = `r1n-${name.toLowerCase()}-${sfx}`;
        await raw.user.create({
            data: {
                id, canonicalId, healthId: canonicalId, password: 'x', role: 'health', authType: 'EMAIL_LEGACY',
                email: `r1n-${name.toLowerCase()}-${sfx}@example.test`, firstName: 'ทดสอบ', lastName: name, organizationId: fx.org,
            },
        });
        fx.userIds.push(id);
        fx.users[name] = { id, canonicalId };
    };
    const mkEntity = async (name, type) => {
        const row = await raw.entity.create({ data: { type, displayName: `r1n ${name} ${sfx}`, organizationId: fx.org } });
        fx.entityIds.push(row.id);
        fx.entities[name] = row.id;
    };
    const member = (user, entity, role) => raw.entityMembership.create({
        data: { userId: fx.users[user].id, entityId: fx.entities[entity], role, status: 'ACTIVE', organizationId: fx.org },
    });
    const mkApp = async (name, filer, entity, status) => {
        const row = await raw.application.create({
            data: {
                applicationNumber: `APP-R1N-${name}-${sfx}`, healthId: fx.users[filer].canonicalId, areaType: 'OUTDOOR',
                organizationId: fx.org, entityId: entity ? fx.entities[entity] : null, submitterId: fx.users[filer].id, status,
                formData: { steps: {}, workflowState: status },
            },
        });
        fx.apps[name] = row.id;
        label.set(row.id, name);
    };

    const as = (name, { transient = false } = {}) => {
        mockActor.transient = transient;
        const u = fx.users[name];
        mockActor.current = { id: u.id, canonicalId: u.canonicalId, healthId: u.canonicalId, role: 'health', canonicalRole: 'health', organizationId: fx.org };
    };
    const headerFor = (h) => (h === 'none' ? {} : { 'x-active-entity-id': fx.entities[h] });
    const labelOf = (id) => label.get(id) || 'NEW';
    const listLabels = (res) => (Array.isArray(res.body?.data)
        ? res.body.data.map((r) => labelOf(r.id || r.applicationId)).sort().join(',')
        : '-');

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        fx.org = (await raw.organization.create({ data: { name: `r1n-${sfx}`, slug: `r1n-${sfx}`, code: `R1N_${sfx}`.toUpperCase() } })).id;
        for (const name of ACTORS) { await mkUser(name); }
        await mkEntity('P', 'INDIVIDUAL');
        await mkEntity('C', 'JURISTIC');
        for (const name of ['PW', 'PV', 'PM', 'PS']) { await mkEntity(name, 'INDIVIDUAL'); }
        await member('A', 'P', 'OWNER');
        await member('A', 'C', 'OWNER');
        await member('W', 'PW', 'OWNER');
        await member('W', 'P', 'MANAGER');
        await member('V', 'PV', 'OWNER');
        await member('V', 'C', 'VIEWER');
        await member('M', 'PM', 'OWNER');
        await member('M', 'C', 'MANAGER');
        await member('S', 'PS', 'OWNER');
        await mkApp('aC', 'A', 'C', 'DRAFT');
        await mkApp('aP', 'A', 'P', 'DRAFT');
        await mkApp('wP', 'W', 'P', 'DRAFT');
        await mkApp('mC', 'M', 'C', 'SUBMITTED');
        await mkApp('aRev', 'A', 'C', 'REVISION_REQUESTED');
        await mkApp('aCar', 'A', 'C', 'CAR_PENDING');
        await mkApp('aN', 'A', null, 'SUBMITTED');
        await mkApp('nN', 'N', null, 'SUBMITTED');
        await mkApp('nD', 'N', null, 'DRAFT');
        await raw.applicationDocumentReview.create({
            data: {
                applicationId: fx.apps.aRev, slotId: 'land_rights', verdict: 'MORE_REQUESTED', reviewerId: fx.users.A.id,
                round: 1, organizationId: fx.org, createdAt: new Date(Date.now() - 3600e3), reason: 'อ่านไม่ออก',
                dueDate: new Date(Date.now() + 5 * 86400e3),
            },
        });
        await raw.applicationDocument.create({
            data: {
                applicationId: fx.apps.aRev, documentType: 'LAND_RIGHTS', slotId: 'land_rights', fileName: 'f.pdf',
                fileUrl: '/uploads/f.pdf', currentForSlot: 'land_rights',
            },
        });

        app = express();
        app.use(express.json());
        app.use('/api/applications/:applicationId/quotations', require('../../routes/api/applications/quotations'));
        app.use('/api/applications', require('../../routes/api/applications/revision-resubmit'));
        app.use('/api/applications', require('../../routes/api/applications/audit-notes'));
        app.use('/api/preview', require('../../routes/api/preview/preview'));
        app.use('/api/dashboard', require('../../routes/api/system/dashboard'));
        app.use('/api/applications', require('../../routes/api/applications/applications-car'));
        app.use('/api/applications', require('../../routes/api/applications/applications'));
    });

    afterAll(async () => {
        if (!raw) { return; }
        const appIds = (await raw.application.findMany({ where: { organizationId: fx.org }, select: { id: true } })).map((r) => r.id);
        const wipe = async (model, where) => { if (raw[model]) { await raw[model].deleteMany({ where }).catch(() => {}); } };
        for (const model of ['applicationDocumentReview', 'applicationDocument', 'revisionDeadline', 'workActivity',
            'correctionSubmissionVersion', 'correctionRound', 'applicationComment']) {
            await wipe(model, { applicationId: { in: appIds } });
        }
        await wipe('application', { id: { in: appIds } });
        await raw.entityMembership.deleteMany({ where: { entityId: { in: fx.entityIds } } }).catch(() => {});
        await raw.entity.deleteMany({ where: { id: { in: fx.entityIds } } }).catch(() => {});
        await raw.user.deleteMany({ where: { id: { in: fx.userIds } } }).catch(() => {});
        await raw.organization.deleteMany({ where: { id: fx.org } }).catch(() => {});
        await raw.$disconnect();
    });

    const actual = {};
    const record = (key, value) => { actual[key] = value; };

    test('read doors: every actor × header × door gives the pre-R1 status and row set', async () => {
        for (const actor of ACTORS) {
            for (const h of HEADERS) {
                as(actor);
                const hdr = headerFor(h);
                for (const path of LIST_DOORS) {
                    const res = await request(app).get(path).set(hdr);
                    record(`${actor}|${h}|GET ${path.replace('/api/applications', '')}`, `${res.status} ${listLabels(res)}`);
                }
                const draft = await request(app).get('/api/applications/draft').set(hdr);
                record(`${actor}|${h}|GET /draft`, `${draft.status} ${draft.body?.data?.id ? labelOf(draft.body.data.id) : '-'}`);
                const stats = await request(app).get('/api/dashboard/stats').set(hdr);
                record(`${actor}|${h}|GET /dashboard/stats`, `${stats.status} ${stats.body?.data?.totalApplications ?? '-'}`);
                for (const target of BY_ID_TARGETS) {
                    for (const [door, url] of BY_ID_DOORS) {
                        const res = await request(app).get(url(fx.apps[target])).set(hdr);
                        record(`${actor}|${h}|${door}|${target}`, `${res.status}`);
                    }
                }
            }
        }
        // The middleware's catch path (no context for anyone): A and N, no header.
        for (const actor of ['A', 'N']) {
            as(actor, { transient: true });
            for (const path of LIST_DOORS) {
                const res = await request(app).get(path);
                record(`${actor}|transient|GET ${path.replace('/api/applications', '')}`, `${res.status} ${listLabels(res)}`);
            }
            const draft = await request(app).get('/api/applications/draft');
            record(`${actor}|transient|GET /draft`, `${draft.status} ${draft.body?.data?.id ? labelOf(draft.body.data.id) : '-'}`);
            for (const target of BY_ID_TARGETS) {
                for (const [door, url] of BY_ID_DOORS) {
                    const res = await request(app).get(url(fx.apps[target]));
                    record(`${actor}|transient|${door}|${target}`, `${res.status}`);
                }
            }
        }
        as('A');
        const reads = Object.fromEntries(Object.entries(actual).filter(([k]) => k.includes('|GET ')));
        const expectedReads = Object.fromEntries(Object.entries(EXPECTED).filter(([k]) => k.includes('|GET ')));
        expect(reads).toEqual(expectedReads);
    });

    test('write doors: V, M, W and S never act on A\'s filings; every answer equals pre-R1', async () => {
        const before = await raw.application.findMany({
            where: { id: { in: [fx.apps.aC, fx.apps.aRev, fx.apps.aCar] } },
            select: { id: true, status: true, formData: true, updatedAt: true },
        });
        for (const actor of ['V', 'M', 'W', 'S']) {
            for (const h of HEADERS) {
                as(actor);
                const hdr = headerFor(h);
                const rev = await request(app).post(`/api/applications/${fx.apps.aRev}/revision-resubmit`).set(hdr).send({});
                record(`${actor}|${h}|POST /:id/revision-resubmit|aRev`, `${rev.status}`);
                const car = await request(app).post(`/api/applications/${fx.apps.aCar}/car`).set(hdr).send({ notes: 'หลักฐาน' });
                record(`${actor}|${h}|POST /:id/car|aCar`, `${car.status}`);
                const draft = await request(app).post('/api/applications/draft').set(hdr).send({ applicationId: fx.apps.aC });
                record(`${actor}|${h}|POST /draft|aC`, `${draft.status} ${draft.body?.data?.id ? labelOf(draft.body.data.id) : '-'}`);
            }
        }
        const after = await raw.application.findMany({
            where: { id: { in: [fx.apps.aC, fx.apps.aRev, fx.apps.aCar] } },
            select: { id: true, status: true, formData: true, updatedAt: true },
        });
        // Nothing of A's moved: no status write, no form write, no touch.
        expect(after.sort((x, y) => x.id.localeCompare(y.id))).toEqual(before.sort((x, y) => x.id.localeCompare(y.id)));

        // The filer still acts on their own filing (last, so it mutates nothing above).
        as('A');
        const own = await request(app).post('/api/applications/draft').set(headerFor('C')).send({ applicationId: fx.apps.aC });
        record('A|C|POST /draft|aC', `${own.status} ${own.body?.data?.id ? labelOf(own.body.data.id) : '-'}`);
        const ownRev = await request(app).post(`/api/applications/${fx.apps.aRev}/revision-resubmit`).set(headerFor('C')).send({});
        record('A|C|POST /:id/revision-resubmit|aRev', `${ownRev.status}`);
        // N (no entity, no context) saves their own null-holder draft by explicit id,
        // and again with the middleware's catch path taken.
        as('N');
        const nOwn = await request(app).post('/api/applications/draft').send({ applicationId: fx.apps.nD });
        record('N|none|POST /draft|nD', `${nOwn.status} ${nOwn.body?.data?.id ? labelOf(nOwn.body.data.id) : '-'}`);
        as('N', { transient: true });
        const nTransient = await request(app).post('/api/applications/draft').send({ applicationId: fx.apps.nD });
        record('N|transient|POST /draft|nD', `${nTransient.status} ${nTransient.body?.data?.id ? labelOf(nTransient.body.data.id) : '-'}`);
        as('A', { transient: true });
        const aTransient = await request(app).post('/api/applications/draft').send({ applicationId: fx.apps.aC });
        record('A|transient|POST /draft|aC', `${aTransient.status} ${aTransient.body?.data?.id ? labelOf(aTransient.body.data.id) : '-'}`);
        as('A');

        const writes = Object.fromEntries(Object.entries(actual).filter(([k]) => k.includes('|POST ')));
        const expectedWrites = Object.fromEntries(Object.entries(EXPECTED).filter(([k]) => k.includes('|POST ')));
        expect(writes).toEqual(expectedWrites);
        for (const actor of ['V', 'M', 'W', 'S']) {
            for (const h of HEADERS) {
                expect(writes[`${actor}|${h}|POST /:id/revision-resubmit|aRev`]).not.toMatch(/^2/);
                expect(writes[`${actor}|${h}|POST /:id/car|aCar`]).not.toMatch(/^2/);
                expect(writes[`${actor}|${h}|POST /draft|aC`]).not.toMatch(/ aC$/);
            }
        }
    });

    afterAll(() => {
        if (process.env.R1_NEUTRAL_RECORD) {
            require('fs').writeFileSync(process.env.R1_NEUTRAL_RECORD, `${JSON.stringify(actual, Object.keys(actual).sort(), 2)}\n`);
        }
    });
});
