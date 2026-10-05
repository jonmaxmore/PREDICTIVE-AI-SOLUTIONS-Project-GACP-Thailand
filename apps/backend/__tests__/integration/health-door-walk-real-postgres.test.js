'use strict';

/**
 * The §3.1 door walk (spec 2026-09-30-remove-workspace-mode §3.1 guard part 2,
 * Task 6), on a REAL Postgres through the REAL server app: the real
 * authenticateHealth / authenticateAny middlewares verify real access tokens and
 * bind the tenant context, and the real prisma-database client
 * carries the read witness. Nothing in the request path is mocked except the
 * headless-browser PDF renderer and the job queues (their bytes and jobs are not
 * the subject; the reads in front of them are).
 *
 * The walk enumerates EVERY GET route of `app._router.stack` (recursing into
 * routers) that a health token can reach: a handle named authenticateHealth or
 * authenticateAny on the route, or in front of it in any enclosing router. Each
 * path parameter is filled from PARAMS; a route whose parameter the map does
 * not know FAILS the walk, so a new health GET door cannot arrive unwalked.
 *
 * Actors (fixture: __tests__/integration/fixtures/holder-scope-fixture.js):
 *   A  OWNER of company C, filer of everything
 *   B  MANAGER of C, a co-member
 *   V  VIEWER of C
 *   S  stranger, OWNER of personal PS
 *   (no actor sends a workspace header since R2 Task 12)
 *
 * Assertions:
 *   1. the witness (THROW mode, the NODE_ENV=test default) refuses no read on
 *      any walked door (no HEALTH_READ_UNSCOPED line);
 *   2. S never receives an id of C's or A's rows in any body (an id S itself
 *      put in the URL is not a disclosure and is ignored for that request);
 *   3. S is refused with 404 (never 2xx, never a 403 that confirms the row)
 *      on every by-id door keyed on C's or A's rows (R2 Task 12);
 *   4. counts equal list lengths for B (plan Review Focus 4);
 *   5. every actor × door answers the recorded status and set of fixture rows
 *      (R2 answers since Task 12; in R1 this pinned main 9616ccdf). Re-record
 *      with HEALTH_DOOR_WALK_RECORD=<path>.
 */

process.env.PAYMENT_ADAPTER = process.env.PAYMENT_ADAPTER || 'mock';
// The walk sends a few hundred requests from one IP; the global limiter is not the subject.
process.env.RATE_LIMIT_MAX = '1000000';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');
const { seedHolderScopeFixture, cleanupHolderScopeFixture } = require('./fixtures/holder-scope-fixture');

jest.mock('../../services/pdf/pdf-generator.service', () => ({
    initialize: async () => {},
    warmUp: async () => {},
    close: async () => {},
    generatePDF: async () => Buffer.from('%PDF-1.4 walk'),
    generateFromTemplate: async () => Buffer.from('%PDF-1.4 walk'),
    replaceTemplateVariables: (t) => t,
    readTemplateCached: (templatePath) => require('fs').readFileSync(templatePath, 'utf8'),
}));
jest.mock('../../services/queue-service', () => ({
    ...jest.requireActual('../../services/queue-service'),
    getPrecheckQueue: () => ({ add: async () => ({ id: 'job-walk' }) }),
    getPdfQueue: () => null,
}));

// The expected file holds the R2 answers (re-recorded in Task 12, 2026-10-03): no
// workspace header, no filer pin. Co-members B and V read C's rows like the filer A,
// A also reads its personal Y, and the stranger S gets 404 wherever it got 403 in R1.
// Each moved row is listed with its reason in evidence/remove-workspace-mode/task-12/green.txt.
const EXPECTED_FILE = path.join(__dirname, '..', 'fixtures', 'health-door-walk.expected.json');
const AUTH_NAMES = new Set(['authenticateHealth', 'authenticateAny']);

// ── route enumeration ───────────────────────────────────────────────────────

/** The literal mount path of a router layer (`app.use('/x/:id', router)`). */
function mountPath(layer) {
    if (layer.regexp && layer.regexp.fast_slash) { return ''; }
    let i = 0;
    const name = () => `:${layer.keys[i++].name}`;
    // Express 4.22 (path-to-regexp 0.1.x) writes a param segment as
    // `(?:\/([^/]+?))`; older releases escaped the class as `[^\/]`. Normalise the
    // slashes first, then recover each param in order from layer.keys.
    return layer.regexp.source
        .replace(/^\^/, '')
        .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
        .replace(/\\\//g, '/')
        .replace(/\(\?:\/\(\[\^\/\]\+\?\)\)/g, () => `/${name()}`)
        .replace(/\(\?:\(\[\^\/\]\+\?\)\)/g, name);
}

/**
 * Every GET route a health token can reach, as { path, handles }.
 * Auth is "in front" when a route's own stack holds an auth handle, or an
 * earlier middleware layer of an enclosing router does (order matters: a
 * router.use(auth) guards only the layers after it).
 */
function collectHealthGetRoutes(app) {
    const out = [];
    const walk = (stack, prefix, guarded) => {
        let inFront = guarded;
        for (const layer of stack) {
            if (layer.route) {
                const handles = layer.route.stack.map((s) => s.handle && s.handle.name);
                if (layer.route.methods.get && (inFront || handles.some((n) => AUTH_NAMES.has(n)))) {
                    const routePaths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
                    for (const p of routePaths) { out.push({ path: `${prefix}${p === '/' ? '' : p}` || '/', handles }); }
                }
            } else if (layer.handle && Array.isArray(layer.handle.stack)) {
                walk(layer.handle.stack, `${prefix}${mountPath(layer)}`, inFront);
            } else if (layer.handle && AUTH_NAMES.has(layer.handle.name)) {
                if (layer.regexp.fast_slash) { inFront = true; }
                else { throw new Error(`path-scoped auth middleware at ${prefix}${mountPath(layer)}: teach the walk`); }
            }
        }
    };
    walk(app._router.stack, '', false);
    return out;
}

// ── the parameter map ───────────────────────────────────────────────────────

// `:id` means a different row per resource: the longest matching prefix decides.
// Every label names a row the fixture seeds (fixtures/holder-scope-fixture.js), so
// the owner reaches each door's reads (Task 6 fix round 1, I2).
const ID_BY_PREFIX = [
    ['/api/applications/bundles/', 'bundle'],
    ['/api/application-bundles/', 'bundle'],
    ['/api/applications/', 'X'],
    ['/api/preview/applications/', 'D'],
    ['/api/certificates/', 'certX'],
    ['/api/entities/', 'C'],
    ['/api/farms/', 'farm'],
    ['/api/harvest-batches/', 'batch'],
    ['/api/lots/', 'lot'],
    ['/api/planting-cycles/', 'cycle'],
    ['/api/documents/', 'draftDoc'],
    ['/api/report-submissions/', 'report'],
    ['/api/sop-documents/', 'sop'],
    ['/api/tickets/', 'ticket'],
    ['/api/training-records/', 'training'],
    ['/api/site-analyses/', 'siteAnalysis'],
    ['/api/audits/site-analysis/', 'siteAnalysis'],
    ['/api/cultivation-logs/', 'cultivationLog'],
];

const PARAMS = {
    id: (routePath) => {
        const hit = ID_BY_PREFIX.filter(([p]) => routePath.startsWith(p)).sort((a, b) => b[0].length - a[0].length)[0];
        return hit ? hit[1] : null;
    },
    applicationId: () => 'X',
    invoiceId: () => 'invoiceX',
    issuerType: () => 'literal:PLATFORM',
    farmId: () => 'farm',
    plotId: () => 'plot',
    cycleId: () => 'cycle',
    batchId: () => 'batch',
    memberUserId: () => 'userA',
    serviceType: () => 'literal:PHASE_2_PLATFORM_FEE',
    code: (routePath) => (routePath.startsWith('/api/standards/') ? 'standardCode' : 'templateCode'),
};

// Doors that answer only with a query parameter: the same rows, as labels.
const QUERY = {
    '/api/planting-cycles': { farmId: 'farm' },
    // The applicant refund-visibility read (credit notes of one of my invoices).
    '/api/finance/credit-notes': { originalInvoiceId: 'invoiceX' },
    // R2 Task 8 (spec 2026-09-30 §3.2): reads never create, so the draft-document
    // list names its draft (no id → 400 for everyone, which would walk nothing).
    '/api/applications/draft-documents': { applicationId: 'D' },
};

/** Fill a route path; returns { url, labels } or { missing } naming the unknown parameter. */
function fillPath(routePath, ids) {
    const labels = [];
    let missing = null;
    const fill = (label, name) => {
        if (!label) { missing = missing || `:${name}`; return `:${name}`; }
        if (label.startsWith('literal:')) { return label.slice('literal:'.length); }
        labels.push(label);
        return ids[label];
    };
    let url = routePath.replace(/:(\w+)/g, (_m, name) => fill(PARAMS[name] ? PARAMS[name](routePath) : null, name));
    const query = QUERY[routePath];
    if (query) {
        url += `?${Object.entries(query).map(([key, label]) => `${key}=${encodeURIComponent(fill(label, key))}`).join('&')}`;
    }
    return missing ? { missing } : { url, labels };
}

/** Which fixture rows a response names, as sorted labels. */
function labelsIn(res, ids) {
    let text;
    if (Buffer.isBuffer(res.body)) { text = res.body.toString('latin1'); }
    else if (res.body && typeof res.body === 'object' && Object.keys(res.body).length > 0) { text = JSON.stringify(res.body); }
    else { text = String(res.text || ''); }
    return Object.entries(ids).filter(([, id]) => id && text.includes(id)).map(([label]) => label).sort();
}

d('health door walk: every GET a health token can reach, witness in throw mode (real Postgres, real server)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let app;
    let fx;
    let ids;
    let routes;
    let warn;
    const results = {}; // `${actor} ${routePath}` → { url, status, labels, witness: [] }
    const missingParams = [];

    // Present only from Task 6 on: the base commit (9616ccdf) has no witness.
    let witnessConfig = null;
    try { witnessConfig = require('../../config/holder-read-witness'); } catch (_) { witnessConfig = null; }
    const ORIGINAL_MODE = process.env.HOLDER_READ_WITNESS;

    const ACTORS = {
        // R2 Task 12: no actor sends a workspace header; membership alone decides.
        A: () => ({ token: fx.tokens.A, headers: {} }),
        B: () => ({ token: fx.tokens.B, headers: {} }),
        V: () => ({ token: fx.tokens.V, headers: {} }),
        S: () => ({ token: fx.tokens.S, headers: {} }),
    };

    const countsAndLists = async (actor) => {
        const as = { Authorization: `Bearer ${fx.tokens[actor]}` };
        const [list, statuses, stats, certs, farms] = await Promise.all([
            request(app).get('/api/applications/my').set(as),
            request(app).get('/api/applications/my/statuses').set(as),
            request(app).get('/api/dashboard/stats').set(as),
            request(app).get('/api/certificates/my').set(as),
            request(app).get('/api/farms/my').set(as),
        ]);
        // No expect here: this runs in beforeAll, and a throw there would hide the
        // whole walk. The tests below assert the statuses.
        const statusesOk = [list, statuses, stats, certs, farms].map((r) => r.status);
        if (statusesOk.some((code) => code !== 200)) { return { statuses: null, httpStatuses: statusesOk }; }
        return {
            httpStatuses: statusesOk,
            list: list.body.data.map((a) => a.id).sort(),
            statuses: statuses.body.data.map((a) => a.id || a.applicationId).sort(),
            stats: stats.body.data,
            activeCerts: (certs.body.data || []).filter((c) => ['active', 'ACTIVE'].includes(c.status)).length,
            farms: (farms.body.data || []).length,
        };
    };

    const counts = {};

    beforeAll(async () => {
        // The witness default under NODE_ENV=test is THROW (Task 6); never inherit an override.
        delete process.env.HOLDER_READ_WITNESS;
        if (witnessConfig) { witnessConfig.resetHolderReadWitnessModeCache(); }
        raw = new PrismaClient();
        await raw.$connect();
        fx = await seedHolderScopeFixture(raw);
        ids = {
            X: fx.apps.X, D: fx.apps.D, D2: fx.apps.D2, Y: fx.apps.Y, invoiceX: fx.invoiceX, certX: fx.certX,
            C: fx.entities.C, PA: fx.entities.PA, PS: fx.entities.PS,
            farm: fx.more.farm, plot: fx.more.plot, cycle: fx.more.cycle, batch: fx.more.batch, lot: fx.more.lot,
            quotation: fx.more.quotation, quote: fx.more.quote, order: fx.more.order, document: fx.more.document,
            precheck: fx.more.precheck, userA: fx.users.A.id, draftDoc: fx.more.draftDoc, bundle: fx.more.bundle,
            ticket: fx.more.ticket, siteAnalysis: fx.more.siteAnalysis, training: fx.more.training, sop: fx.more.sop,
            report: fx.more.report, cultivationLog: fx.more.cultivationLog, revisionDeadline: fx.more.revisionDeadline,
            templateCode: fx.more.templateCode, standardCode: fx.more.standardCode,
        };
        app = require('../../server');
        // What the server's own boot does after listen(): mark the client connected, or
        // service-availability answers 503 on every door.
        await require('../../services/prisma-database').connect();
        routes = collectHealthGetRoutes(app);

        // Counts and lists are read BEFORE the walk: some GET doors write (GET
        // /applications/draft finds or creates the caller's draft), so after the walk
        // the co-members' drafts sit in C too.
        counts.B = await countsAndLists('B');
        counts.A = await countsAndLists('A');

        const sharedLogger = require('../../shared/logger');
        warn = jest.spyOn(sharedLogger, 'warn');
        for (const [actor, make] of Object.entries(ACTORS)) {
            const { token, headers } = make();
            for (const route of routes) {
                if (!route.path.startsWith('/api/') || route.path.startsWith('/api/v1/')) { continue; }
                const filled = fillPath(route.path, ids);
                if (filled.missing) { missingParams.push(`${route.path} ${filled.missing}`); continue; }
                const before = warn.mock.calls.length;
                const res = await request(app).get(filled.url).set({ Authorization: `Bearer ${token}`, ...headers });
                const witness = warn.mock.calls.slice(before).map((c) => c[1])
                    .filter((m) => m && m.signal === 'HEALTH_READ_UNSCOPED').map((m) => `${m.model}.${m.op}`);
                results[`${actor} ${route.path}`] = {
                    url: filled.url, urlLabels: filled.labels, status: res.status, labels: labelsIn(res, ids), witness,
                };
            }
        }
        warn.mockRestore();

        if (process.env.HEALTH_DOOR_WALK_RECORD) {
            const record = Object.fromEntries(Object.entries(results).sort(([a], [b]) => a.localeCompare(b))
                .map(([k, v]) => [k, { status: v.status, labels: v.labels }]));
            fs.writeFileSync(process.env.HEALTH_DOOR_WALK_RECORD, `${JSON.stringify(record, null, 1)}\n`);
        }
    }, 600000);

    afterAll(async () => {
        if (ORIGINAL_MODE === undefined) { delete process.env.HOLDER_READ_WITNESS; } else { process.env.HOLDER_READ_WITNESS = ORIGINAL_MODE; }
        if (witnessConfig) { witnessConfig.resetHolderReadWitnessModeCache(); }
        if (raw) {
            await cleanupHolderScopeFixture(raw, fx);
            await raw.$disconnect();
        }
    });

    test('the walk found the health GET doors, and every path parameter is in the map', () => {
        expect(missingParams).toEqual([]);
        const walked = new Set(Object.keys(results).map((k) => k.split(' ')[1]));
        // The canonical doors the spec names must be among them.
        for (const door of ['/api/applications/my', '/api/applications/my/statuses', '/api/applications/:id',
            '/api/invoices/my', '/api/invoices/my/:invoiceId/receipt/pdf', '/api/certificates/:id',
            '/api/certificates/my', '/api/quotes/my', '/api/entities/mine', '/api/dashboard/stats',
            '/api/preview/applications/:id/preview', '/api/farms/my']) {
            expect(walked).toContain(door);
        }
        expect(walked.size).toBeGreaterThan(100);
        // The /api/v1 alias mounts the same routers: the walk would see the same set.
        const v1 = new Set(routes.filter((r) => r.path.startsWith('/api/v1/')).map((r) => r.path.replace('/api/v1/', '/api/')));
        const api = new Set(routes.filter((r) => r.path.startsWith('/api/') && !r.path.startsWith('/api/v1/')).map((r) => r.path));
        expect([...v1].filter((p) => !api.has(p))).toEqual([]);
    });

    test('every walked path is a real path, fully filled (no regex left from a param mount)', () => {
        const regexLeft = routes.map((r) => r.path).filter((p) => /\(\?:|\[\^|\\/.test(p));
        expect(regexLeft).toEqual([]);
        const unfilled = Object.entries(results).filter(([, r]) => /:[A-Za-z]/.test(r.url)).map(([k, r]) => `${k} → ${r.url}`);
        expect(unfilled).toEqual([]);
    });

    test('the param-mounted routers are walked for real: the filer A gets 2xx on X\'s quotations and C\'s member permissions', () => {
        const status = (door) => results[`A ${door}`]?.status;
        expect({
            quotations: status('/api/applications/:applicationId/quotations'),
            quotationPdf: status('/api/applications/:applicationId/quotations/:issuerType/pdf'),
            memberPermissions: status('/api/entities/:id/members/:memberUserId/permissions'),
        }).toEqual({ quotations: 200, quotationPdf: 200, memberPermissions: 200 });
        expect(results['A /api/applications/:applicationId/quotations'].labels).toContain('quotation');
    });

    // A door that answers no legitimate actor proves nothing about the stranger: it
    // never reached the read the walk is there to watch. Each door must give 2xx to
    // at least one of A, B, V, or be named here with the reason it cannot.
    const STAFF_ONLY = 'staff-only: requireRole(FULL_STAFF)/providerOnly refuses every health token with 403';
    const NO_2XX_ALLOWED = {
        // authenticateAny lets a health token in, then a role gate refuses it (403):
        // staff-only views. The walk still witnesses everything before the gate.
        '/api/analytics': STAFF_ONLY,
        '/api/analytics/dashboard': STAFF_ONLY,
        '/api/analytics/geography/farms': STAFF_ONLY,
        '/api/analytics/geography/certification-rate': STAFF_ONLY,
        '/api/analytics/trends/applications': STAFF_ONLY,
        '/api/analytics/trends/plant-types': STAFF_ONLY,
        '/api/analytics/predictions/certification-expiry': STAFF_ONLY,
        '/api/analytics/predictions/harvest-forecast': STAFF_ONLY,
        '/api/analytics/performance/overview': STAFF_ONLY,
        // providerOnly list of every recent analysis (routes/api/audit/site-analyses.js:25).
        '/api/site-analyses': STAFF_ONLY,
        '/api/audits/site-analysis': STAFF_ONLY,
    };

    test('every walked door answers 2xx to at least one legitimate actor (A, B or V), or is allowlisted', () => {
        const doors = [...new Set(Object.keys(results).map((k) => k.slice(2)))];
        const dead = doors.filter((door) => !['A', 'B', 'V'].some((a) => {
            const r = results[`${a} ${door}`];
            return r && r.status >= 200 && r.status < 300;
        })).filter((door) => !NO_2XX_ALLOWED[door])
            .map((door) => `${door} → ${['A', 'B', 'V'].map((a) => results[`${a} ${door}`]?.status).join('/')}`);
        expect(dead).toEqual([]);
        // An allowlisted door that starts answering must leave the list.
        const healed = Object.keys(NO_2XX_ALLOWED).filter((door) => ['A', 'B', 'V']
            .some((a) => results[`${a} ${door}`] && results[`${a} ${door}`].status < 300));
        expect(healed).toEqual([]);
    });

    test('no walked door reads a holder-bearing model unscoped (witness THROW, NODE_ENV=test default)', () => {
        const unscoped = Object.entries(results).filter(([, r]) => r.witness.length > 0)
            .map(([k, r]) => `${k} → ${r.status} ${[...new Set(r.witness)].join(',')}`);
        expect({ mode: witnessConfig.holderReadWitnessMode(), unscoped }).toEqual({ mode: 'throw', unscoped: [] });
    });

    test('the stranger S never receives an id of C\'s or A\'s rows', () => {
        const forbidden = ['X', 'D', 'D2', 'Y', 'invoiceX', 'certX', 'C', 'PA', 'farm', 'plot', 'cycle', 'batch', 'lot',
            'quotation', 'quote', 'order', 'document', 'precheck', 'draftDoc', 'bundle', 'ticket', 'siteAnalysis', 'training',
            'sop', 'report', 'cultivationLog', 'revisionDeadline'];
        const leaks = Object.entries(results).filter(([k]) => k.startsWith('S '))
            .map(([k, r]) => [k, r.labels.filter((l) => forbidden.includes(l) && !r.urlLabels.includes(l))])
            .filter(([, l]) => l.length > 0)
            .map(([k, l]) => `${k} → ${l.join(',')}`);
        expect(leaks).toEqual([]);
    });

    test('the stranger S is refused on every by-id door keyed on C\'s or A\'s rows', () => {
        const theirs = new Set(['X', 'D', 'invoiceX', 'certX', 'C', 'farm', 'plot', 'cycle', 'batch', 'lot', 'userA', 'draftDoc',
            'bundle', 'ticket', 'siteAnalysis', 'training', 'sop', 'report', 'cultivationLog']);
        // A door that lists the caller's OWN rows filtered by an id (not a by-id
        // read of that row) answers an empty list, which discloses nothing. Each one
        // is named here with its reason; the walk still checks it leaks no id.
        const OWN_ROWS_FILTERED_BY_ID = {
            // Ticket is not holder-bearing: the caller's own tickets about that
            // application id, so a stranger gets [].
            '/api/tickets/application/:applicationId': (r) => r.labels.length === 0,
        };
        const served = Object.entries(results)
            .filter(([k, r]) => k.startsWith('S ') && r.urlLabels.some((l) => theirs.has(l)) && r.status >= 200 && r.status < 300)
            .filter(([k, r]) => !(OWN_ROWS_FILTERED_BY_ID[k.slice(2)] && OWN_ROWS_FILTERED_BY_ID[k.slice(2)](r)))
            .map(([k, r]) => `${k} → ${r.status} ${r.labels.join(',')}`);
        expect(served).toEqual([]);
        // R2 Task 12: every refusal of the stranger on C's or A's rows is 404 (R1 kept
        // the pre-R1 403s; they are gone with the filer pins and the header).
        const refusals = Object.entries(results)
            .filter(([k, r]) => k.startsWith('S ') && r.urlLabels.some((l) => theirs.has(l)) && r.status >= 400 && r.status < 500)
            .map(([k, r]) => `${k} → ${r.status}`);
        expect(refusals.length).toBeGreaterThan(0);
        // Doors whose refusal is decided after the read, unchanged since R1 (not a
        // holder-read refusal): credit notes answer FORBIDDEN_ROLE for an invoice the
        // caller cannot read; harvest batches sit behind the farm permission gate (T&T
        // freeze, not touched by R2).
        const AFTER_READ_403 = new Set(['/api/finance/credit-notes', '/api/harvest-batches/:id',
            '/api/harvest-batches/:id/lab-results', '/api/harvest-batches/stats/:farmId']);
        expect(refusals.filter((line) => !line.endsWith('→ 404') && !AFTER_READ_403.has(line.slice(2, line.indexOf(' →')))))
            .toEqual([]);
    });

    // Review Focus 4. Every counter equals its list for the co-member: /my/statuses
    // reads /my's where (R2 Task 9 fix round 1), and the dashboard farm counter
    // counts the same membership-based farms as /farms/my (R2 Task 12).
    test('counts equal list lengths for B (Review Focus 4)', () => {
        const b = counts.B;
        expect(b.httpStatuses).toEqual([200, 200, 200, 200, 200]);
        expect(b.list).toEqual([fx.apps.D, fx.apps.D2, fx.apps.X].sort());
        expect(b.stats.applications).toBe(b.list.length);
        expect(b.stats.totalApplications).toBe(b.list.length);
        expect(b.stats.certificates).toBe(b.activeCerts);
        // R2 Task 9 fix round 1: /my/statuses reads exactly /my's where, so it equals the list.
        expect(b.statuses).toEqual(b.list);
        // R2 Task 12: the farm counter counts /farms/my's rows (it pinned Farm.ownerId before).
        expect({ counter: b.stats.farms, list: b.farms }).toEqual({ counter: 1, list: 1 });
    });

    test('counts equal list lengths for the filer A, statuses included', () => {
        const a = counts.A;
        expect(a.httpStatuses).toEqual([200, 200, 200, 200, 200]);
        expect(a.statuses).toEqual(a.list);
        expect(a.stats.applications).toBe(a.list.length);
        expect(a.stats.certificates).toBe(a.activeCerts);
        expect(a.stats.farms).toBe(a.farms);
    });

    test('every actor × door answers as recorded for R2 (Task 12 re-record; was main 9616ccdf in R1)', () => {
        if (process.env.HEALTH_DOOR_WALK_RECORD) { return; }
        const expected = JSON.parse(fs.readFileSync(EXPECTED_FILE, 'utf8'));
        const actual = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { status: v.status, labels: v.labels }]));
        const diffs = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()
            .filter((k) => JSON.stringify(expected[k]) !== JSON.stringify(actual[k]))
            .map((k) => `${k}: expected ${JSON.stringify(expected[k])} got ${JSON.stringify(actual[k])}`);
        expect(diffs).toEqual([]);
    });
});
