/**
 * Task 7 (document pre-check): what each side is shown, through the REAL routers.
 *
 *   GET  /api/applications/:id/requirements                      — the applicant
 *   POST /api/applications/:id/prechecks/:precheckId/acknowledge — the applicant (owner only)
 *   GET  /api/provider/applications/:id/document-check           — the officer
 *   POST /api/provider/applications/:id/document-reviews         — the officer's verdict
 *
 * The applicant sees each observation's check/result/reasonTH and nothing
 * else — never the confidence, never the snippet quoted off the page, never
 * the extracted text. The officer sees the same plus confidence and the
 * snippet. NOT_FOUND is an observation and is shown as one.
 *
 * The routers and the provider permission guard
 * (routes/api/provider/handlers/shared.js requireCanonicalPermission over the
 * real canonical-rbac table) are real; authentication only attaches the
 * caller, as the sibling route suites do. The database is an in-memory
 * stand-in (unit layer). Tenant isolation is proved on a real Postgres in
 * __tests__/integration/document-precheck-api.test.js.
 *
 * Every role is asserted by the BODY it gets back, not only the status: a
 * guard that runs is not proof of what the route returns.
 */

'use strict';

const express = require('express');
const request = require('supertest');

// A 13-digit run of Arabic or Thai digits — a full national/juristic id.
const THIRTEEN_DIGITS = /[0-9๐-๙]{13}/;

// ── the caller ────────────────────────────────────────────────────────────────

jest.mock('../../../middleware/auth-middleware', () => {
    const attach = (req, res, next) => {
        const role = req.headers['x-test-role'];
        if (!role) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        req.user = {
            id: req.headers['x-test-user'],
            role,
            canonicalRole: role,
            organizationId: 'org-A',
        };
        return next();
    };
    return {
        authenticateAny: attach,
        authenticateHealth: attach,
        authenticateProvider: attach,
        requireRole: () => (_req, _res, next) => next(),
    };
});

// user id → the healthId Application.healthId holds for them.
const mockHealthIdByUser = { 'user-A': 'health-A', 'user-B': 'health-B' };
jest.mock('../../../services/application-service', () => ({
    resolveHealthIdentity: jest.fn(async (userId) => {
        const healthId = mockHealthIdByUser[userId];
        if (!healthId) {
            throw Object.assign(new Error('Health account must have healthId'), { statusCode: 401 });
        }
        return { userId, healthId };
    }),
}));

// ── the in-memory database ────────────────────────────────────────────────────

const mockDb = { applications: [], prechecks: [], flags: [], reviews: [] };

function mockMatches(row, where) {
    return Object.entries(where || {}).every(([key, cond]) => {
        if (key === 'AND') {
            return (Array.isArray(cond) ? cond : [cond]).every((member) => mockMatches(row, member));
        }
        if (key === 'OR') {
            return (Array.isArray(cond) ? cond : [cond]).some((member) => mockMatches(row, member));
        }
        // The holder fragment on a child row (spec 2026-09-30 §3.1, Task 4):
        // { application: { entityId: { in } } } is evaluated on the row's application.
        if (key === 'application' && cond && typeof cond === 'object' && 'applicationId' in row) {
            const parent = mockDb.applications.find((a) => a.id === row.applicationId);
            return Boolean(parent) && mockMatches(parent, cond);
        }
        if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
            if ('not' in cond) {
                return row[key] !== cond.not;
            }
            if ('in' in cond) {
                return cond.in.includes(row[key]);
            }
        }
        return row[key] === cond;
    });
}

function mockPrecheckRelations(row) {
    return {
        ...row,
        flags: mockDb.flags.filter((f) => f.precheckId === row.id),
        application: mockDb.applications.find((a) => a.id === row.applicationId) || null,
    };
}

function mockProject(row, select) {
    if (row === null || row === undefined) {
        return null;
    }
    if (Array.isArray(row)) {
        return row.map((r) => mockProject(r, select));
    }
    const out = {};
    for (const [key, spec] of Object.entries(select)) {
        if (spec === true) {
            out[key] = row[key];
        } else if (spec && typeof spec === 'object' && spec.select) {
            out[key] = mockProject(row[key], spec.select);
        }
    }
    return out;
}

function mockPrecheckRead(args) {
    if (!args || args.include || !args.select) {
        throw new Error('document_prechecks must be read with an explicit select, never include');
    }
    let rows = mockDb.prechecks.filter((r) => mockMatches(r, args.where));
    if (args.orderBy && args.orderBy.createdAt) {
        const dir = args.orderBy.createdAt === 'desc' ? -1 : 1;
        rows = [...rows].sort((a, b) => dir * (a.createdAt - b.createdAt));
    }
    return rows.map((r) => mockProject(mockPrecheckRelations(r), args.select));
}

// holder-access (spec 2026-09-30 §3.1): each applicant is the ACTIVE OWNER of
// the entity that holds their own filing, and of nothing else.
const mockEntityByUser = { 'user-A': 'ent-A', 'user-B': 'ent-B' };

const mockPrisma = {
    entityMembership: {
        findMany: jest.fn(async ({ where }) => (
            mockEntityByUser[where.userId] ? [{ entityId: mockEntityByUser[where.userId], role: 'OWNER' }] : []
        )),
    },
    application: {
        findFirst: jest.fn(async ({ where }) => {
            const row = mockDb.applications.find((a) => mockMatches(a, where));
            return row ? { ...row, entity: null } : null;
        }),
        update: jest.fn(async () => {
            throw new Error('the pre-check doors never write an application');
        }),
        updateMany: jest.fn(async () => {
            throw new Error('the pre-check doors never write an application');
        }),
    },
    applicationDocument: { findMany: jest.fn(async () => []) },
    applicationDocumentReview: {
        findMany: jest.fn(async ({ where }) => mockDb.reviews.filter((r) => mockMatches(r, where))),
        upsert: jest.fn(async ({ create }) => ({ id: 'rev-1', ...create })),
    },
    documentPrecheck: {
        findMany: jest.fn(async (args) => mockPrecheckRead(args)),
        findFirst: jest.fn(async (args) => mockPrecheckRead(args)[0] || null),
        findUnique: jest.fn(async (args) => mockPrecheckRead(args)[0] || null),
        updateMany: jest.fn(async ({ where, data }) => {
            const rows = mockDb.prechecks.filter((r) => mockMatches(r, where));
            rows.forEach((r) => Object.assign(r, data));
            return { count: rows.length };
        }),
    },
};
jest.mock('../../../services/prisma-database', () => ({ prisma: mockPrisma }));

// The requirement engine's answer for app-A (it has its own suites).
const mockResolve = jest.fn();
jest.mock('../../../services/application-requirements-service', () => ({
    resolveApplicationRequirements: (...a) => mockResolve(...a),
}));

jest.mock('../../../services/application-status-writer', () => ({ writeApplicationStatus: jest.fn() }));
jest.mock('../../../services/notification/domain-helpers', () => ({
    notifyRevisionRequired: jest.fn(),
    notifyDocumentApproved: jest.fn(),
}));

jest.mock('../../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/applications', require('../../../routes/api/applications/requirements'));
    app.use('/api/provider/applications', require('../../../routes/api/provider/document-reviews'));
    return app;
}

// ── fixtures ──────────────────────────────────────────────────────────────────

const RAW_ID_ARABIC = '1103700012345';
const RAW_ID_THAI = '๑๑๐๓๗๐๐๐๑๒๓๔๕';
const NOT_FOUND_REASON = 'ไม่พบชื่อผู้ยื่นคำขอในเอกสาร ให้เจ้าหน้าที่ตรวจเอง';
const SNIPPET_TEXT = 'หนังสือรับรองกรรมสิทธิ์';
const SUPERSEDED_REASON = 'ข้อสังเกตของไฟล์ที่ถูกแทนแล้ว';

const SLOTS = [
    { slotId: 'land_rights', labelTH: 'เอกสารสิทธิ์ที่ดิน', required: true, satisfied: true },
    { slotId: 'id_house_reg', labelTH: 'บัตรประชาชน', required: true, satisfied: true },
    { slotId: 'juristic_reg_6m', labelTH: 'หนังสือรับรองนิติบุคคล', required: false, satisfied: false },
    { slotId: 'sop_manual', labelTH: 'คู่มือ SOP', required: true, satisfied: true },
];

function at(minutes) {
    return new Date(Date.UTC(2026, 8, 27, 3, minutes));
}

function seed() {
    mockDb.applications = [
        { id: 'app-A', healthId: 'health-A', entityId: 'ent-A', organizationId: 'org-A', isDeleted: false, status: 'SUBMITTED', reviewerId: null },
        { id: 'app-B', healthId: 'health-B', entityId: 'ent-B', organizationId: 'org-A', isDeleted: false, status: 'SUBMITTED', reviewerId: null },
    ];
    const precheck = (id, applicationId, slotId, status, minutes, extra = {}) => ({
        id,
        applicationId,
        slotId,
        status,
        organizationId: 'org-A',
        documentId: `doc-${id}`,
        rulesVersion: 1,
        extractedText: `ข้อความทั้งฉบับ ${RAW_ID_ARABIC}`,
        applicantAcknowledgedAt: null,
        createdAt: at(minutes),
        completedAt: status === 'PENDING' ? null : at(minutes + 1),
        ...extra,
    });
    mockDb.prechecks = [
        precheck('pc-old', 'app-A', 'land_rights', 'SUPERSEDED', 1),
        precheck('pc-1', 'app-A', 'land_rights', 'DONE', 5),
        precheck('pc-2', 'app-A', 'id_house_reg', 'PENDING', 6),
        // Outside the 7 catalog slots: never shown, whatever the table holds.
        precheck('pc-sop', 'app-A', 'sop_manual', 'DONE', 7),
        precheck('pc-B', 'app-B', 'land_rights', 'DONE', 8),
    ];
    const flag = (precheckId, check, result, reasonTH, confidence, evidenceSnippet) => ({
        id: `${precheckId}-${check}`,
        precheckId,
        organizationId: 'org-A',
        check,
        result,
        reasonTH,
        confidence,
        evidenceSnippet,
    });
    mockDb.flags = [
        flag('pc-old', 'READABILITY', 'UNREADABLE', SUPERSEDED_REASON, 0, null),
        flag('pc-1', 'READABILITY', 'OK', 'อ่านได้', 0.97, null),
        flag('pc-1', 'DOC_TYPE', 'MATCH', 'ตรงกับชนิดเอกสาร', 0.91, `${SNIPPET_TEXT} เลขที่ ${RAW_ID_ARABIC}`),
        // A stored reason carrying a Thai-digit id: the doors mask it on the way out.
        flag('pc-1', 'CROSS_MATCH', 'NOT_FOUND', `${NOT_FOUND_REASON} (${RAW_ID_THAI})`, 0.4, `ผู้ถือ ${RAW_ID_THAI}`),
        flag('pc-sop', 'READABILITY', 'OK', 'ไม่ควรเห็น', 1, 'ไม่ควรเห็น'),
        flag('pc-B', 'READABILITY', 'OK', 'ของคนอื่น', 1, 'ของคนอื่น'),
    ];
    mockDb.reviews = [];
}

beforeEach(() => {
    jest.clearAllMocks();
    seed();
    mockResolve.mockResolvedValue({
        slots: SLOTS.map((s) => ({ ...s })),
        dims: { certScope: 'PLANTING', holderType: 'INDIVIDUAL', plantCode: 'cannabis' },
        missingRequired: [],
        complete: true,
        blockingIssues: [],
        appliedRules: [],
        requiredSlotIds: [],
    });
});

const asHealth = (req, user) => req.set('x-test-role', 'health').set('x-test-user', user);
const asOfficer = (req, role, user = 'officer-1') => req.set('x-test-role', role).set('x-test-user', user);
const slotOf = (body, slotId) => body.data.slots.find((s) => s.slotId === slotId);

// ── the applicant ─────────────────────────────────────────────────────────────

describe('GET /applications/:id/requirements — the applicant', () => {
    test('the owner sees the observations on their in-scope slots: check, result and reason only', async () => {
        const res = await asHealth(request(buildApp()).get('/api/applications/app-A/requirements'), 'user-A');

        expect(res.status).toBe(200);
        const land = slotOf(res.body, 'land_rights');
        expect(Object.keys(land.precheck).sort()).toEqual(['acknowledgedAt', 'flags', 'id', 'status']);
        expect(land.precheck).toMatchObject({ id: 'pc-1', status: 'DONE', acknowledgedAt: null });
        expect(land.precheck.flags).toHaveLength(3);
        for (const f of land.precheck.flags) {
            expect(Object.keys(f).sort()).toEqual(['check', 'reasonTH', 'result']);
        }
        // NOT_FOUND is an observation — shown, never dropped.
        const notFound = land.precheck.flags.find((f) => f.check === 'CROSS_MATCH');
        expect(notFound.result).toBe('NOT_FOUND');
        expect(notFound.reasonTH).toContain(NOT_FOUND_REASON);
    });

    test('never the confidence, the snippet or the extracted text — anywhere in the body', async () => {
        const res = await asHealth(request(buildApp()).get('/api/applications/app-A/requirements'), 'user-A');

        const body = JSON.stringify(res.body);
        expect(body).not.toContain('confidence');
        expect(body).not.toContain('evidenceSnippet');
        expect(body).not.toContain('extractedText');
        expect(body).not.toContain(SNIPPET_TEXT);
        expect(body).not.toMatch(THIRTEEN_DIGITS);
        // The superseded row is history, not the current observation.
        expect(body).not.toContain(SUPERSEDED_REASON);
        expect(body).not.toContain('pc-old');
    });

    test('a slot being checked shows PENDING with no observations yet; an in-scope slot never checked and an out-of-scope slot are null', async () => {
        const res = await asHealth(request(buildApp()).get('/api/applications/app-A/requirements'), 'user-A');

        expect(slotOf(res.body, 'id_house_reg').precheck).toEqual({ id: 'pc-2', status: 'PENDING', flags: [], acknowledgedAt: null });
        expect(slotOf(res.body, 'juristic_reg_6m').precheck).toBeNull();
        expect(slotOf(res.body, 'sop_manual').precheck).toBeNull();
        expect(JSON.stringify(res.body)).not.toContain('ไม่ควรเห็น');
    });

    test('a different health user gets 404 and none of the observations', async () => {
        const res = await asHealth(request(buildApp()).get('/api/applications/app-A/requirements'), 'user-B');

        expect(res.status).toBe(404);
        const body = JSON.stringify(res.body);
        expect(body).not.toContain('precheck');
        expect(body).not.toContain(NOT_FOUND_REASON);
    });

    test('the pre-check rows are read with explicit selects that never name the extracted text', async () => {
        await asHealth(request(buildApp()).get('/api/applications/app-A/requirements'), 'user-A');

        expect(mockPrisma.documentPrecheck.findMany).toHaveBeenCalled();
        for (const [args] of mockPrisma.documentPrecheck.findMany.mock.calls) {
            expect(args.include).toBeUndefined();
            expect(args.select.extractedText).toBeUndefined();
        }
    });
});

describe('POST /applications/:id/prechecks/:precheckId/acknowledge — the applicant', () => {
    const ack = (appId, precheckId, user) =>
        asHealth(request(buildApp()).post(`/api/applications/${appId}/prechecks/${precheckId}/acknowledge`), user);

    test('the owner acknowledges: the time is recorded and the application status is exactly what it was', async () => {
        const statusBefore = mockDb.applications.find((a) => a.id === 'app-A').status;

        const res = await ack('app-A', 'pc-1', 'user-A');

        expect(res.status).toBe(200);
        expect(res.body.data.precheckId).toBe('pc-1');
        expect(res.body.data.acknowledgedAt).toBeTruthy();
        const row = mockDb.prechecks.find((r) => r.id === 'pc-1');
        expect(row.applicantAcknowledgedAt).toBeInstanceOf(Date);
        expect(mockDb.applications.find((a) => a.id === 'app-A').status).toBe(statusBefore);
        expect(mockPrisma.application.update).not.toHaveBeenCalled();
        expect(mockPrisma.application.updateMany).not.toHaveBeenCalled();

        const after = await asHealth(request(buildApp()).get('/api/applications/app-A/requirements'), 'user-A');
        expect(slotOf(after.body, 'land_rights').precheck.acknowledgedAt).toBeTruthy();
    });

    test('a non-owner is refused with 404 and nothing is written', async () => {
        const res = await ack('app-A', 'pc-1', 'user-B');

        expect(res.status).toBe(404);
        // The door's own answer — not express's "no such route" 404.
        expect(res.body).toMatchObject({ success: false });
        expect(mockDb.prechecks.find((r) => r.id === 'pc-1').applicantAcknowledgedAt).toBeNull();
        expect(mockPrisma.documentPrecheck.updateMany).not.toHaveBeenCalled();
    });

    test('a pre-check of another application, named under your own application, is 404 and untouched', async () => {
        const res = await ack('app-A', 'pc-B', 'user-A');

        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ success: false });
        expect(mockDb.prechecks.find((r) => r.id === 'pc-B').applicantAcknowledgedAt).toBeNull();
        expect(mockPrisma.documentPrecheck.updateMany).not.toHaveBeenCalled();
    });

    test('an unknown pre-check is 404', async () => {
        const res = await ack('app-A', 'pc-nope', 'user-A');
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ success: false });
    });
});

// ── the officer ───────────────────────────────────────────────────────────────

describe('GET /provider/applications/:id/document-check — role × body', () => {
    const check = (role) => asOfficer(request(buildApp()).get('/api/provider/applications/app-A/document-check'), role);

    // The roles the existing guard (APPLICATION_DOC_REVIEW) admits.
    test.each([['document_reviewer'], ['field_inspector'], ['system_admin_dtam'], ['system_admin_platform']])(
        '%s: the same observations plus confidence and the snippet — masked',
        async (role) => {
            const res = await check(role);

            expect(res.status).toBe(200);
            const land = slotOf(res.body, 'land_rights');
            expect(land.precheck).toMatchObject({ id: 'pc-1', status: 'DONE', acknowledgedAt: null });
            expect(land.precheck.flags).toHaveLength(3);
            for (const f of land.precheck.flags) {
                expect(Object.keys(f).sort()).toEqual(['check', 'confidence', 'evidenceSnippet', 'reasonTH', 'result']);
            }
            const docType = land.precheck.flags.find((f) => f.check === 'DOC_TYPE');
            expect(docType.confidence).toBe(0.91);
            expect(docType.evidenceSnippet).toContain(SNIPPET_TEXT);
            expect(docType.evidenceSnippet).toContain('…2345');
            expect(land.precheck.flags.find((f) => f.check === 'CROSS_MATCH').result).toBe('NOT_FOUND');

            const body = JSON.stringify(res.body);
            expect(body).not.toMatch(THIRTEEN_DIGITS);
            expect(body).not.toContain('extractedText');
            expect(body).not.toContain(SUPERSEDED_REASON);
            expect(slotOf(res.body, 'sop_manual').precheck).toBeNull();
            expect(slotOf(res.body, 'juristic_reg_6m').precheck).toBeNull();
            expect(slotOf(res.body, 'id_house_reg').precheck).toMatchObject({ status: 'PENDING', flags: [] });
        },
    );

    test.each([
        ['finance_officer_dtam'], ['finance_officer_platform'], ['dispatcher'], ['certificate_approver'], ['health'],
    ])('%s: 403 and the body carries nothing of the pre-check', async (role) => {
        const res = await check(role);

        expect(res.status).toBe(403);
        const body = JSON.stringify(res.body);
        expect(body).not.toContain('precheck');
        expect(body).not.toContain(SNIPPET_TEXT);
        expect(body).not.toContain(NOT_FOUND_REASON);
        expect(mockPrisma.documentPrecheck.findMany).not.toHaveBeenCalled();
    });

    test('a document reviewer who is not the assigned one: 403 and nothing of the pre-check', async () => {
        mockDb.applications.find((a) => a.id === 'app-A').reviewerId = 'officer-2';

        const res = await check('document_reviewer');

        expect(res.status).toBe(403);
        expect(JSON.stringify(res.body)).not.toContain(SNIPPET_TEXT);
        expect(mockPrisma.documentPrecheck.findMany).not.toHaveBeenCalled();
    });

    test('no caller: 401, nothing read', async () => {
        const res = await request(buildApp()).get('/api/provider/applications/app-A/document-check');
        expect(res.status).toBe(401);
        expect(mockPrisma.documentPrecheck.findMany).not.toHaveBeenCalled();
    });
});

describe('POST /provider/applications/:id/document-reviews — the verdict row stores the pre-check it was taken over', () => {
    const verdict = (slotId) => asOfficer(
        request(buildApp()).post('/api/provider/applications/app-A/document-reviews'),
        'document_reviewer',
    ).send({ slotId, verdict: 'ACCEPTED' });

    test('the slot\'s current DONE pre-check id is written on create and on update', async () => {
        const res = await verdict('land_rights');

        expect(res.status).toBe(200);
        const [{ create, update }] = mockPrisma.applicationDocumentReview.upsert.mock.calls[0];
        expect(create.precheckId).toBe('pc-1');
        expect(update.precheckId).toBe('pc-1');
        // The verdict itself is what it always was.
        expect(create).toMatchObject({ slotId: 'land_rights', verdict: 'ACCEPTED', reason: null, dueDate: null });
    });

    test('a slot whose current pre-check is still PENDING stores null — the superseded DONE is not "current"', async () => {
        mockDb.prechecks.push({
            ...mockDb.prechecks.find((r) => r.id === 'pc-1'),
            id: 'pc-newer',
            documentId: 'doc-newer',
            status: 'PENDING',
            createdAt: at(30),
        });
        mockDb.prechecks.find((r) => r.id === 'pc-1').status = 'SUPERSEDED';

        await verdict('land_rights');

        const [{ create, update }] = mockPrisma.applicationDocumentReview.upsert.mock.calls[0];
        expect(create.precheckId).toBeNull();
        expect(update.precheckId).toBeNull();
    });

    test('a FAILED current pre-check stores null', async () => {
        mockDb.prechecks.find((r) => r.id === 'pc-1').status = 'FAILED';

        await verdict('land_rights');

        expect(mockPrisma.applicationDocumentReview.upsert.mock.calls[0][0].create.precheckId).toBeNull();
    });

    test('a slot outside the catalog stores null even if a row exists for it', async () => {
        await verdict('sop_manual');

        expect(mockPrisma.applicationDocumentReview.upsert.mock.calls[0][0].create.precheckId).toBeNull();
    });
});

describe('warn-only: a pre-check read that fails never fails the door', () => {
    beforeEach(() => {
        mockPrisma.documentPrecheck.findMany.mockRejectedValueOnce(new Error('relation "document_prechecks" does not exist'));
        mockPrisma.documentPrecheck.findFirst.mockRejectedValueOnce(new Error('relation "document_prechecks" does not exist'));
    });

    // Each test consumes only the reads its door makes; a queued rejection it
    // did not consume would otherwise fail the first read of a LATER suite
    // (jest.clearAllMocks keeps the once-queue). Task 10 found this when its
    // own tests below started with a null precheckId.
    afterEach(() => {
        mockPrisma.documentPrecheck.findMany.mockReset();
        mockPrisma.documentPrecheck.findMany.mockImplementation(async (args) => mockPrecheckRead(args));
        mockPrisma.documentPrecheck.findFirst.mockReset();
        mockPrisma.documentPrecheck.findFirst.mockImplementation(async (args) => mockPrecheckRead(args)[0] || null);
    });

    test('the applicant\'s requirements still answer, every slot\'s precheck null', async () => {
        const res = await asHealth(request(buildApp()).get('/api/applications/app-A/requirements'), 'user-A');

        expect(res.status).toBe(200);
        for (const slot of res.body.data.slots) {
            expect(slot).toHaveProperty('precheck', null);
        }
    });

    test('the officer\'s document-check still answers, every slot\'s precheck null', async () => {
        const res = await asOfficer(request(buildApp()).get('/api/provider/applications/app-A/document-check'), 'document_reviewer');

        expect(res.status).toBe(200);
        for (const slot of res.body.data.slots) {
            expect(slot).toHaveProperty('precheck', null);
        }
    });

    test('the verdict is still recorded, with precheckId null', async () => {
        const res = await asOfficer(
            request(buildApp()).post('/api/provider/applications/app-A/document-reviews'),
            'document_reviewer',
        ).send({ slotId: 'land_rights', verdict: 'ACCEPTED' });

        expect(res.status).toBe(200);
        const [{ create, update }] = mockPrisma.applicationDocumentReview.upsert.mock.calls[0];
        expect(create.precheckId).toBeNull();
        expect(update.precheckId).toBeNull();
    });
});

// ── Task 10: deferred minors from the Task 7 review (task-7-review.md M1/M3/M4) ──

describe('Task 10 M4: the verdict row stores the server\'s pre-check, never one the client sends', () => {
    test.each([['pc-B'], ['pc-old'], ['pc-nope']])('a client-sent precheckId %s is ignored', async (sent) => {
        const res = await asOfficer(
            request(buildApp()).post('/api/provider/applications/app-A/document-reviews'),
            'document_reviewer',
        ).send({ slotId: 'land_rights', verdict: 'ACCEPTED', precheckId: sent });

        expect(res.status).toBe(200);
        const [{ create, update }] = mockPrisma.applicationDocumentReview.upsert.mock.calls[0];
        expect(create.precheckId).toBe('pc-1');
        expect(update.precheckId).toBe('pc-1');
    });
});

describe('Task 10 M3: the officer\'s snippet is capped at 200 characters, and still masked', () => {
    test('a long snippet comes back at most 200 characters, with no full id even where the cut falls', async () => {
        // The id starts at character 190: a cut before masking would leave its
        // first digits on the page; masking first leaves none.
        const longSnippet = `${'ก'.repeat(190)}${RAW_ID_ARABIC}${'ข'.repeat(400)}`;
        mockDb.flags.push({
            id: 'pc-1-VALIDITY', precheckId: 'pc-1', organizationId: 'org-A',
            check: 'VALIDITY', result: 'PASS', reasonTH: 'ยังไม่หมดอายุ', confidence: 0.9, evidenceSnippet: longSnippet,
        });

        const res = await asOfficer(request(buildApp()).get('/api/provider/applications/app-A/document-check'), 'document_reviewer');

        expect(res.status).toBe(200);
        const validity = slotOf(res.body, 'land_rights').precheck.flags.find((f) => f.check === 'VALIDITY');
        expect(validity.evidenceSnippet.length).toBeLessThanOrEqual(200);
        expect(validity.evidenceSnippet.startsWith('ก'.repeat(190))).toBe(true);
        expect(validity.evidenceSnippet).not.toMatch(/[0-9๐-๙]{5,}/);
    });

    test('a short snippet is returned whole', async () => {
        const res = await asOfficer(request(buildApp()).get('/api/provider/applications/app-A/document-check'), 'document_reviewer');

        const docType = slotOf(res.body, 'land_rights').precheck.flags.find((f) => f.check === 'DOC_TYPE');
        expect(docType.evidenceSnippet).toBe(`${SNIPPET_TEXT} เลขที่ …2345`);
    });
});

describe('Task 10 M1: a missing pre-check table or column in the verdict path is logged at error', () => {
    const logger = require('../../../shared/logger');
    const post = () => asOfficer(
        request(buildApp()).post('/api/provider/applications/app-A/document-reviews'),
        'document_reviewer',
    ).send({ slotId: 'land_rights', verdict: 'ACCEPTED' });

    test.each([['P2021'], ['P2022']])('Prisma %s: the verdict is recorded with precheckId null, and the loss is an error, not a warning', async (code) => {
        mockPrisma.documentPrecheck.findFirst.mockRejectedValueOnce(Object.assign(new Error('schema not migrated'), { code }));

        const res = await post();

        expect(res.status).toBe(200);
        expect(mockPrisma.applicationDocumentReview.upsert.mock.calls[0][0].create.precheckId).toBeNull();
        const errorLines = logger.error.mock.calls.map((c) => String(c[0]));
        expect(errorLines.some((l) => l.includes('pre-check') && l.includes(code))).toBe(true);
        expect(logger.warn.mock.calls.map((c) => String(c[0])).some((l) => l.includes('pre-check id unavailable'))).toBe(false);
    });

    test('any other read failure stays a warning', async () => {
        mockPrisma.documentPrecheck.findFirst.mockRejectedValueOnce(new Error('connection reset'));

        const res = await post();

        expect(res.status).toBe(200);
        expect(logger.warn.mock.calls.map((c) => String(c[0])).some((l) => l.includes('pre-check id unavailable'))).toBe(true);
        expect(logger.error.mock.calls.map((c) => String(c[0])).some((l) => l.includes('pre-check'))).toBe(false);
    });
});
