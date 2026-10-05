'use strict';

/**
 * The Application health doors, actor × context × door, on a real Postgres.
 * Built in R1 to prove behaviour-neutrality against e46ceba0; since R2 Task 12
 * EXPECTED holds the R2 answers: the workspace header, the active-entity
 * middleware and every filer pin are gone, so every context of an actor answers
 * alike and a door answers by membership of the filing's holder (re-recorded
 * 2026-10-03; every moved row is checked against the R2 rule in
 * evidence/remove-workspace-mode/task-12/green.txt).
 *
 * Real Postgres, the real prisma-database client and the real tenant-context
 * middleware; only authentication is attached by hand, and multer is stubbed so
 * the CAR door needs no file on disk.
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
 * The `transient` rows once drove the active-entity middleware's catch path (R1);
 * with the middleware gone they are ordinary requests and answer like `none`.
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

// `<status> <sorted labels>` for lists, `<status>` for by-id doors, `<status> <label>`
// for POST /draft. R2 answers since Task 12 — see the header.
const EXPECTED = require('../fixtures/r1-application-reads-neutral.expected.json');

d('Application health doors answer by holder membership (R2) (real Postgres)', () => {
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

    // `transient` used to make the active-entity middleware fail once (R1); the
    // middleware is gone (R2 Task 12), so a transient row is an ordinary request.
    const as = (name) => {
        const u = fx.users[name];
        mockActor.current = { id: u.id, canonicalId: u.canonicalId, healthId: u.canonicalId, role: 'health', canonicalRole: 'health', organizationId: fx.org };
    };
    // R2 Task 12: no request sends the workspace header. The context label stays in each
    // row key so the re-recorded table shows that every context now answers alike.
    const headerFor = () => ({});
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

    test('read doors: every actor × context × door gives the R2 status and row set', async () => {
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
        // Former middleware catch path rows (R1); now ordinary requests: A and N.
        for (const actor of ['A', 'N']) {
            as(actor);
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
    }, 120000); // ~1300 requests: 25-30 s alone, past jest's 30 s default under load

    // Review Focus 4 (R2 Task 9 fix round 1): the list and every count or badge of
    // that list read the same rows. For each actor × context the read doors above
    // walked: the ids of GET /my equal the ids of GET /my/statuses and of GET /, and
    // /dashboard/stats counts exactly that many applications.
    test('Review Focus 4: /my, /my/statuses and / list the same ids, and /dashboard/stats counts them, for every actor × context', () => {
        const contexts = [...new Set(Object.keys(actual).filter((k) => k.endsWith('|GET /my'))
            .map((k) => k.slice(0, -'|GET /my'.length)))];
        expect(contexts.length).toBeGreaterThan(0);
        const ids = (value) => {
            const [status, labels = ''] = String(value).split(' ');
            return { status, ids: labels.split(',').filter(Boolean).sort().join(',') };
        };
        const mismatches = [];
        for (const ctx of contexts) {
            const list = ids(actual[`${ctx}|GET /my`]);
            for (const other of ['GET /my/statuses', 'GET /']) {
                const got = ids(actual[`${ctx}|${other}`]);
                if (got.status !== list.status || got.ids !== list.ids) {
                    mismatches.push(`${ctx}: /my ${JSON.stringify(list)} vs ${other} ${JSON.stringify(got)}`);
                }
            }
            const stats = actual[`${ctx}|GET /dashboard/stats`];
            if (stats && list.status === '200' && stats.startsWith('200 ')) {
                const counted = Number(stats.split(' ')[1]);
                const listed = list.ids ? list.ids.split(',').length : 0;
                if (counted !== listed) { mismatches.push(`${ctx}: /my lists ${listed} but /dashboard/stats counts ${counted}`); }
            }
        }
        expect(mismatches).toEqual([]);
    });

    test('write doors: V, W and S never act on A\'s filings, M only edits A\'s draft on C; every answer is the recorded R2 answer', async () => {
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
                if (actor === 'M') { continue; } // M's draft edit runs below, after the snapshot
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

        // R2 Task 9 (spec §3.2 draft edits): M, a MANAGER of C, may fill in a draft
        // held by C whoever filed it; it still cannot submit it (submit guard).
        for (const h of HEADERS) {
            as('M');
            const draft = await request(app).post('/api/applications/draft').set(headerFor(h)).send({ applicationId: fx.apps.aC });
            record(`M|${h}|POST /draft|aC`, `${draft.status} ${draft.body?.data?.id ? labelOf(draft.body.data.id) : '-'}`);
        }

        // The filer still acts on their own filing (last, so it mutates nothing above).
        as('A');
        const own = await request(app).post('/api/applications/draft').set(headerFor('C')).send({ applicationId: fx.apps.aC });
        record('A|C|POST /draft|aC', `${own.status} ${own.body?.data?.id ? labelOf(own.body.data.id) : '-'}`);
        const ownRev = await request(app).post(`/api/applications/${fx.apps.aRev}/revision-resubmit`).set(headerFor('C')).send({});
        record('A|C|POST /:id/revision-resubmit|aRev', `${ownRev.status}`);
        // N (no entity, no membership) tries to save their own null-holder draft by
        // explicit id, twice. R2 Task 8: 404 (a null holder is in no one's editIds; D1
        // heals such rows before deploy).
        as('N');
        const nOwn = await request(app).post('/api/applications/draft').send({ applicationId: fx.apps.nD });
        record('N|none|POST /draft|nD', `${nOwn.status} ${nOwn.body?.data?.id ? labelOf(nOwn.body.data.id) : '-'}`);
        as('N');
        const nTransient = await request(app).post('/api/applications/draft').send({ applicationId: fx.apps.nD });
        record('N|transient|POST /draft|nD', `${nTransient.status} ${nTransient.body?.data?.id ? labelOf(nTransient.body.data.id) : '-'}`);
        as('A');
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
                if (actor !== 'M') { expect(writes[`${actor}|${h}|POST /draft|aC`]).not.toMatch(/ aC$/); }
            }
        }
    });

    afterAll(() => {
        if (process.env.R1_NEUTRAL_RECORD) {
            require('fs').writeFileSync(process.env.R1_NEUTRAL_RECORD, `${JSON.stringify(actual, Object.keys(actual).sort(), 2)}\n`);
        }
    });
});
