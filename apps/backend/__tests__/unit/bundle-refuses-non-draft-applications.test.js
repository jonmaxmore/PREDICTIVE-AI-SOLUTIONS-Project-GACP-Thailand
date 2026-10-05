'use strict';

/**
 * ARCH-01 (audit 2026-09-17) — the bundle doors must refuse every linked case
 * that is no longer DRAFT.
 *
 * The hole: the only status gate on application-bundles.js was the terminal
 * set (R1a). A case that is still alive but already past DRAFT — paying its
 * fee, under document review, inside a revision/CAR window, APPROVED with a
 * certificate minted — could be linked into a bundle by its own applicant and
 * the bundle submit loop then wrote SUBMITTED onto it through the canonical
 * writer in its permissive default mode. Two API calls reset a live case to
 * the intake queue and out of its deadline.
 *
 * How this suite measures it: the REAL router, driven with `router.handle()`
 * (no listening socket), and the REAL status writer and state machine. Prisma
 * is an in-memory store that honours `where`, `select`/`include` projection,
 * `version` scoping and transaction rollback, so "the status is unchanged" is
 * read back from the row itself rather than inferred from a mock call. Only
 * the collaborators that are not under test (entity permission engine,
 * document law, audit sink) are stubbed.
 *
 * State names come from the SSOT (workflow-transition-service WORKFLOW_STATES
 * and the writer's TERMINAL_STATUSES); the named states in the first test are
 * the ones the audit proof exploited, pinned so the derived list cannot go
 * silently empty.
 */

// ── in-memory store (names start with `mock` so jest.mock factories may use them)
const mockStore = { applications: new Map(), bundles: new Map(), nextBundle: 1 };
const mockTransitionRows = [];

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => {
        req.user = {
            id: 'user-1',
            healthId: 'health-1',
            canonicalId: 'health-1',
            canonicalRole: 'health',
            organizationId: 'org-1',
        };
        next();
    },
}));

jest.mock('../../services/entity-effective-permissions-service', () => ({
    assertEntityActionPermission: jest.fn(async () => ({ allowed: true, via: 'ENTITY_PERMISSION' })),
}));

// The writer's default emission goes through statusTransitionAuditHook; record
// what it would have written so "no transition row" is observable.
jest.mock('../../middleware/audit-logger', () => {
    const actual = jest.requireActual('../../middleware/audit-logger');
    return {
        ...actual,
        auditLogger: {
            log: jest.fn(async () => ({ id: 'audit-1' })),
            logWithin: jest.fn(async () => ({ id: 'audit-1' })),
        },
        statusTransitionAuditHook: () => async (entry) => { mockTransitionRows.push(entry); },
    };
});

// Document law is proven in m2a-doc-requirements{,-doors}.test.js; here every
// case has its papers.
jest.mock('../../services/application-document-requirements', () => {
    const actual = jest.requireActual('../../services/application-document-requirements');
    return {
        ...actual,
        assertRequiredDocumentsPresent: jest.fn(async () => ({ appliedRules: [] })),
    };
});

jest.mock('../../services/application-service', () => ({
    findPersonalEntityForHealthIdentity: jest.fn(async () => null),
    healDraftEntityColumns: jest.fn(),
}));

// The real writer, wrapped only so the exact arguments the door hands it can
// be replayed below.
jest.mock('../../services/application-status-writer', () => {
    const actual = jest.requireActual('../../services/application-status-writer');
    return {
        ...actual,
        writeApplicationStatus: jest.fn((args) => actual.writeApplicationStatus(args)),
    };
});

jest.mock('../../services/prisma-database', () => {
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const project = (row, select) => {
        if (!select) { return clone(row); }
        const out = {};
        Object.keys(select).forEach((key) => { if (select[key]) { out[key] = clone(row[key] ?? null); } });
        return out;
    };
    const notFound = () => Object.assign(new Error('Record to update not found.'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2025',
    });
    const matches = (row, where = {}) => Object.entries(where).every(([key, want]) => {
        if (key === 'AND') { return (Array.isArray(want) ? want : [want]).every((member) => matches(row, member)); }
        if (key === 'OR') { return (Array.isArray(want) ? want : [want]).some((member) => matches(row, member)); }
        if (want && typeof want === 'object' && Array.isArray(want.in)) { return want.in.includes(row[key]); }
        return row[key] === want;
    });
    const applyData = (row, data) => {
        Object.entries(data).forEach(([key, value]) => {
            if (value && typeof value === 'object' && !Array.isArray(value) && 'increment' in value) {
                row[key] = (row[key] || 0) + value.increment;
            } else {
                row[key] = value instanceof Date ? value.toISOString() : value;
            }
        });
    };
    const withApplications = (bundle, include) => {
        const out = clone(bundle);
        if (include && include.applications) {
            out.applications = [...mockStore.applications.values()]
                .filter((app) => app.bundleId === bundle.id)
                .map((app) => project(app, include.applications.select));
        }
        return out;
    };

    const application = {
        findUnique: jest.fn(async ({ where, select }) => {
            const row = mockStore.applications.get(where.id);
            return row ? project(row, select) : null;
        }),
        findFirst: jest.fn(async ({ where, select }) => {
            const row = [...mockStore.applications.values()].find((r) => matches(r, where));
            return row ? project(row, select) : null;
        }),
        findMany: jest.fn(async ({ where, select }) => [...mockStore.applications.values()]
            .filter((r) => matches(r, where))
            .map((r) => project(r, select))),
        update: jest.fn(async ({ where, data }) => {
            const row = [...mockStore.applications.values()].find((r) => matches(r, where));
            if (!row) { throw notFound(); }
            applyData(row, data);
            return clone(row);
        }),
        updateMany: jest.fn(async ({ where, data }) => {
            const rows = [...mockStore.applications.values()].filter((r) => matches(r, where));
            rows.forEach((row) => applyData(row, data));
            return { count: rows.length };
        }),
    };
    const applicationBundle = {
        findFirst: jest.fn(async ({ where, include }) => {
            const row = [...mockStore.bundles.values()].find((b) => matches(b, where));
            return row ? withApplications(row, include) : null;
        }),
        findMany: jest.fn(async () => []),
        create: jest.fn(async ({ data }) => {
            const row = { id: `bundle-new-${mockStore.nextBundle++}`, ...data };
            mockStore.bundles.set(row.id, row);
            return clone(row);
        }),
        update: jest.fn(async ({ where, data, include }) => {
            const row = mockStore.bundles.get(where.id);
            if (!row) { throw notFound(); }
            applyData(row, data);
            return withApplications(row, include);
        }),
        delete: jest.fn(),
    };
    // A Prisma interactive-tx handle has the model namespaces but no
    // $transaction — the writer keys its behaviour on exactly that shape.
    const tx = { application, applicationBundle };
    const prisma = {
        application,
        applicationBundle,
        // holder-access (spec 2026-09-30 §3.1): the caller is an ACTIVE OWNER of
        // the entity every seeded case is filed under.
        entityMembership: { findMany: jest.fn(async () => [{ entityId: 'ent-1', role: 'OWNER' }]) },
        $transaction: jest.fn(async (fn) => {
            const snapshot = {
                applications: clone([...mockStore.applications.entries()]),
                bundles: clone([...mockStore.bundles.entries()]),
                rows: mockTransitionRows.length,
            };
            try {
                return await fn(tx);
            } catch (err) {
                mockStore.applications = new Map(snapshot.applications);
                mockStore.bundles = new Map(snapshot.bundles);
                mockTransitionRows.length = snapshot.rows;
                throw err;
            }
        }),
    };
    return { prisma };
});

const { prisma: prismaMock } = require('../../services/prisma-database');
const { assertRequiredDocumentsPresent } = require('../../services/application-document-requirements');
const { writeApplicationStatus } = require('../../services/application-status-writer');
const actualWriter = jest.requireActual('../../services/application-status-writer');
const { WORKFLOW_STATES } = require('../../services/workflow-transition-service');
const bundlesRouter = require('../../routes/api/applications/application-bundles');

const NOT_DRAFT = 'BUNDLE_APPLICATION_NOT_DRAFT';
const LIVE_NON_DRAFT = WORKFLOW_STATES.filter(
    (state) => state !== 'DRAFT' && !actualWriter.TERMINAL_STATUSES.has(state),
);

/** Walk one request through the real router; resolves with the response. */
function callRouter(method, url, body = {}) {
    return new Promise((resolve, reject) => {
        const req = {
            method,
            url,
            originalUrl: url,
            baseUrl: '',
            body,
            headers: {},
            params: {},
            query: {},
            ip: '127.0.0.1',
            get: () => undefined,
            header: () => undefined,
        };
        const res = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            set() { return this; },
            setHeader() { return this; },
            getHeader() { return undefined; },
            json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
            send(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
            end() { resolve({ status: this.statusCode, body: undefined }); return this; },
        };
        bundlesRouter.handle(req, res, (err) => {
            if (err) { reject(err); return; }
            reject(new Error(`no route matched ${method} ${url}`));
        });
    });
}

function seedApplication({ id, status, version = 1, bundleId = null }) {
    mockStore.applications.set(id, {
        id,
        applicationNumber: `GACP-${id}`,
        healthId: 'health-1',
        isDeleted: false,
        status,
        version,
        entityId: 'ent-1',
        serviceType: 'new_application',
        areaType: 'OUTDOOR',
        bundleId,
        formData: { workflowState: status, farmData: { name: 'applicant answers' } },
    });
}

function seedBundle(id, status = 'DRAFT') {
    mockStore.bundles.set(id, { id, bundleNumber: `BND-${id}`, healthId: 'health-1', status });
}

const appRow = (id) => mockStore.applications.get(id);
const bundleRow = (id) => mockStore.bundles.get(id);

beforeEach(() => {
    jest.clearAllMocks();
    mockStore.applications = new Map();
    mockStore.bundles = new Map();
    mockTransitionRows.length = 0;
});

test('the derived state list covers the states the audit proof exploited', () => {
    expect(LIVE_NON_DRAFT).toEqual(expect.arrayContaining([
        'SUBMITTED', 'PENDING_DOC_FEE', 'ASSIGNED_FOR_REVIEW', 'REVISION_REQUESTED',
        'PENDING_AUDIT_FEE', 'CAR_PENDING', 'CAR_REVIEWING', 'APPROVED',
    ]));
    expect(LIVE_NON_DRAFT).not.toContain('DRAFT');
});

describe('POST /:id/submit — a linked case that has left DRAFT is refused, not reset', () => {
    test.each(LIVE_NON_DRAFT)('%s: 409, the case keeps its status and version, nothing is written', async (state) => {
        seedBundle('bundle-1');
        seedApplication({ id: 'app-live', status: state, version: 7, bundleId: 'bundle-1' });

        const res = await callRouter('POST', '/bundle-1/submit');

        // the row first: what the defect did was rewrite it
        expect(appRow('app-live')).toMatchObject({ status: state, version: 7 });
        expect(appRow('app-live').formData.workflowState).toBe(state);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe(NOT_DRAFT);
        expect(res.body.messageTh).toEqual(expect.any(String));
        expect(bundleRow('bundle-1').status).toBe('DRAFT');
        expect(prismaMock.$transaction).not.toHaveBeenCalled();
        expect(writeApplicationStatus).not.toHaveBeenCalled();
        expect(mockTransitionRows).toHaveLength(0);
    });

    test('one live case refuses the whole bundle — its DRAFT sibling is not submitted either', async () => {
        seedBundle('bundle-1');
        seedApplication({ id: 'app-draft', status: 'DRAFT', bundleId: 'bundle-1' });
        seedApplication({ id: 'app-approved', status: 'APPROVED', version: 9, bundleId: 'bundle-1' });

        const res = await callRouter('POST', '/bundle-1/submit');

        expect(appRow('app-approved')).toMatchObject({ status: 'APPROVED', version: 9 });
        expect(appRow('app-draft').status).toBe('DRAFT');
        expect(res.status).toBe(409);
        expect(res.body.code).toBe(NOT_DRAFT);
        expect(bundleRow('bundle-1').status).toBe('DRAFT');
        expect(mockTransitionRows).toHaveLength(0);
    });

    test('a terminal case still gets its own, more specific refusal (R1a pin)', async () => {
        seedBundle('bundle-1');
        seedApplication({ id: 'app-cert', status: 'CERTIFIED', bundleId: 'bundle-1' });

        const res = await callRouter('POST', '/bundle-1/submit');

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('BUNDLE_TERMINAL_APPLICATION');
        expect(appRow('app-cert').status).toBe('CERTIFIED');
    });
});

describe('POST / — a non-DRAFT case is not folded into a new bundle', () => {
    test.each(LIVE_NON_DRAFT)('%s: 409, no bundle row, the case is not linked', async (state) => {
        seedApplication({ id: 'app-live', status: state });

        const res = await callRouter('POST', '/', { applications: ['app-live'] });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe(NOT_DRAFT);
        expect(mockStore.bundles.size).toBe(0);
        expect(appRow('app-live')).toMatchObject({ status: state, bundleId: null });
    });

    test('DRAFT cases are still linked (regression pin)', async () => {
        seedApplication({ id: 'app-draft', status: 'DRAFT' });

        const res = await callRouter('POST', '/', { applications: ['app-draft'] });

        expect(res.status).toBe(200);
        expect(mockStore.bundles.size).toBe(1);
        expect(appRow('app-draft').bundleId).toBe(res.body.data.id);
    });
});

describe('POST /:id/applications — a non-DRAFT case is not added to a bundle', () => {
    test.each(LIVE_NON_DRAFT)('%s: 409, the case is not linked', async (state) => {
        seedBundle('bundle-1');
        seedApplication({ id: 'app-live', status: state });

        const res = await callRouter('POST', '/bundle-1/applications', { applicationId: 'app-live' });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe(NOT_DRAFT);
        expect(appRow('app-live')).toMatchObject({ status: state, bundleId: null });
    });

    test('a DRAFT case is still added (regression pin)', async () => {
        seedBundle('bundle-1');
        seedApplication({ id: 'app-draft', status: 'DRAFT' });

        const res = await callRouter('POST', '/bundle-1/applications', { applicationId: 'app-draft' });

        expect(res.status).toBe(200);
        expect(appRow('app-draft').bundleId).toBe('bundle-1');
    });
});

describe('the status write itself is strict', () => {
    test('DRAFT still submits: 200, SUBMITTED, version bumped, one transition row', async () => {
        seedBundle('bundle-1');
        seedApplication({ id: 'app-draft', status: 'DRAFT', version: 3, bundleId: 'bundle-1' });

        const res = await callRouter('POST', '/bundle-1/submit');

        expect(res.status).toBe(200);
        expect(appRow('app-draft')).toMatchObject({ status: 'SUBMITTED', version: 4 });
        expect(appRow('app-draft').formData.farmData).toEqual({ name: 'applicant answers' });
        expect(bundleRow('bundle-1').status).toBe('SUBMITTED');
        expect(mockTransitionRows).toEqual([
            expect.objectContaining({ applicationId: 'app-draft', fromStatus: 'DRAFT', toStatus: 'SUBMITTED' }),
        ]);
    });

    test('the writer call the door makes refuses every edge but DRAFT→SUBMITTED', async () => {
        seedBundle('bundle-1');
        seedApplication({ id: 'app-draft', status: 'DRAFT', version: 3, bundleId: 'bundle-1' });
        await callRouter('POST', '/bundle-1/submit');
        expect(writeApplicationStatus).toHaveBeenCalledTimes(1);
        const doorArgs = writeApplicationStatus.mock.calls[0][0];

        // Replay the door's own call against a case in every other live state.
        // Permissive mode would write SUBMITTED onto each of them.
        for (const state of LIVE_NON_DRAFT) {
            const id = `replay-${state}`;
            seedApplication({ id, status: state, version: doorArgs.expectedVersion ?? 1 });

            await expect(actualWriter.writeApplicationStatus({
                ...doorArgs,
                applicationId: id,
                fromStatus: state,
            })).rejects.toThrow(/illegal transition/);

            expect(appRow(id).status).toBe(state);
        }
    });

    test('a case that leaves DRAFT between the gate and the write is not dragged back', async () => {
        seedBundle('bundle-1');
        seedApplication({ id: 'app-race', status: 'DRAFT', version: 3, bundleId: 'bundle-1' });
        // The applicant's front-door submit lands while this request sits
        // between its gates and its transaction (both hops: v3 → v5).
        assertRequiredDocumentsPresent.mockImplementationOnce(async () => {
            Object.assign(appRow('app-race'), { status: 'PENDING_DOC_FEE', version: 5 });
            return { appliedRules: [] };
        });

        const res = await callRouter('POST', '/bundle-1/submit');

        expect(appRow('app-race')).toMatchObject({ status: 'PENDING_DOC_FEE', version: 5 });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('CONCURRENCY_CONFLICT');
        // the bundle flip rolled back with the refused case
        expect(bundleRow('bundle-1').status).toBe('DRAFT');
        expect(mockTransitionRows).toHaveLength(0);
    });
});
