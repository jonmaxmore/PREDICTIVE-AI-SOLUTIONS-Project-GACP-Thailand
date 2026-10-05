/**
 * H17 — ADVERSARIAL VERIFICATION of the application-visibility scope fix.
 *
 * Written by the verifier, not the fixer. Three things the fixer's own suite
 * did not prove:
 *
 *   A. NO PROVIDER ROLE WAS OVER-RESTRICTED. Every role in
 *      PROVIDER_CANONICAL_ROLES must land in a bucket that can still match a
 *      row (or be assignment-scoped) — a fix that denies a working role is its
 *      own bug. Also pinned for the LEGACY RAW role strings real tokens carry
 *      (a live preview accountant token has role='finance_officer_platform'), in case
 *      `canonicalRole` is absent on an older token.
 *
 *   B. A FOURTH SURFACE. POST /provider/applications/:id/comments runs the
 *      same withVisibility predicate and was NOT in the bug report's list of
 *      three. Pre-fix, an accountant could write a comment onto any
 *      application in the tenant.
 *
 *   C. THE CONTROL (the RED half). The same router is mounted a second time
 *      with the PRE-FIX filter injected (fall-through `return null`), and the
 *      same requests are asserted to leak — 200 + the 13-digit national id. If
 *      those control expectations ever go green-by-denial, the leak is being
 *      stopped by something other than this module and this suite is lying.
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
    const buildHeaderUser = (req, res, next) => {
        const role = req.headers['x-test-role'];
        if (!role || role === 'anonymous') {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        req.user = {
            id: req.headers['x-test-user-id'] || 'user-1',
            email: 'user-1@example.com',
            role,
            // Deliberately DO NOT set canonicalRole — the raw legacy string is
            // what the filter must normalise, mirroring a token that predates
            // the canonicalRole claim.
            providerId: 'provider-1',
            organizationId: 'org-1',
        };
        return next();
    };
    return {
        authenticateHealth: buildHeaderUser,
        authenticateAny: buildHeaderUser,
        authenticateProvider: buildHeaderUser,
        authenticateDTAM: buildHeaderUser,
        requireRole: () => (_req, _res, next) => next(),
        requirePermission: () => (_req, _res, next) => next(),
    };
});

jest.mock('../../shared/logger', () => {
    const l = {
        debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    };
    return { ...l, createLogger: jest.fn(() => l) };
});

jest.mock('../../services/prisma-database', () => ({
    prisma: { user: { findMany: jest.fn().mockResolvedValue([]) } },
}));

function mockMatchesWhere(where, row) {
    if (!where || typeof where !== 'object') { return true; }
    return Object.entries(where).every(([key, value]) => {
        if (key === 'AND') { return value.every((sub) => mockMatchesWhere(sub, row)); }
        if (key === 'OR') { return value.some((sub) => mockMatchesWhere(sub, row)); }
        if (key === 'NOT') { return !mockMatchesWhere(value, row); }
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            if (Array.isArray(value.in)) { return value.in.includes(row[key]); }
            if (Array.isArray(value.path)) {
                let cursor = row[key];
                for (const seg of value.path) { cursor = cursor == null ? cursor : cursor[seg]; }
                return cursor === value.equals;
            }
            return false;
        }
        return row[key] === value;
    });
}

const NATIONAL_ID = '1234567890123';

function mockMakeRow(id, status, extra = {}) {
    return {
        id,
        applicationNumber: `NUM-${id}`,
        status,
        isDeleted: false,
        reviewerId: null,
        auditorId: null,
        headAuditorId: null,
        sameReviewerAuditor: false,
        formData: { applicantInfo: { nationalId: NATIONAL_ID, address: '99/9' } },
        workflowHistory: [],
        createdAt: new Date('2026-08-01'),
        updatedAt: new Date('2026-08-02'),
        rejectCount: 0,
        phase1Status: 'PENDING',
        phase2Status: 'PENDING',
        applicant: {
            firstName: 'ส', lastName: 'ก', email: 'a@b.co', phoneNumber: '0800000000',
        },
        comments: [],
        ...extra,
    };
}

// Statuses taken from the live preview tenant (26 rows, 2026-08-23).
const mockDB = [
    mockMakeRow('app-draft', 'DRAFT'),
    mockMakeRow('app-certified', 'CERTIFIED'),
    mockMakeRow('app-approved', 'APPROVED'),
    mockMakeRow('app-auditpassed', 'AUDIT_PASSED'),
    mockMakeRow('app-submitted', 'SUBMITTED'),
    mockMakeRow('app-fee1', 'PENDING_DOC_FEE'),
    mockMakeRow('app-docfeepaid', 'DOC_FEE_PAID'),
    mockMakeRow('app-assigned', 'ASSIGNED_FOR_REVIEW', { reviewerId: 'user-reviewer' }),
];

const mockFindRow = ({ where }) => mockDB.find((row) => mockMatchesWhere(where, row)) || null;

jest.mock('../../services/application-service', () => ({
    findProviderApplicationDetail: jest.fn((args) => Promise.resolve(mockFindRow(args))),
    findVisibleApplicationIdSlice: jest.fn((args) => Promise.resolve(mockFindRow(args))),
    findFirstWithWhere: jest.fn((args) => Promise.resolve(mockFindRow(args))),
    listWorkActivitiesForApplication: jest.fn().mockResolvedValue([]),
    listProviderApplicationsPage: jest.fn((args) => Promise.resolve({
        rows: mockDB.filter((row) => mockMatchesWhere(args.where, row)),
        total: mockDB.filter((row) => mockMatchesWhere(args.where, row)).length,
    })),
    listProviderQueue: jest.fn((args) => Promise.resolve(mockDB.filter((r) => mockMatchesWhere(args.where, r)))),
    countProviderQueue: jest.fn((where) => Promise.resolve(mockDB.filter((r) => mockMatchesWhere(where, r)).length)),
    isApplicationCommentModelAvailable: jest.fn(() => true),
    createApplicationCommentIfAvailable: jest.fn(() => Promise.resolve({
        id: 'c-1', content: 'x', createdAt: new Date(), authorId: 'user-1', role: 'finance_officer_platform',
    })),
    writeAssignmentColumns: jest.fn(),
    listSchedulerDashboardApplications: jest.fn().mockResolvedValue([]),
    listAuditorsByIds: jest.fn().mockResolvedValue([]),
    resolveHealthIdentity: jest.fn().mockResolvedValue({ healthId: 'h-1', userId: 'u-1' }),
    getById: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/audit-trail', () => ({
    getTimelineForApplication: jest.fn().mockResolvedValue([]),
    listAuditEvents: jest.fn().mockResolvedValue([]),
    exportAuditEvents: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../services/invoice-service', () => ({
    listSettlementsForApplication: jest.fn().mockResolvedValue([]),
    listSettlementsByApplicationIds: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../services/notification-service', () => ({
    createNotification: jest.fn().mockResolvedValue(null),
    createBulkNotifications: jest.fn().mockResolvedValue({ count: 0 }),
}));
jest.mock('../../services/application-status-writer', () => ({ writeApplicationStatus: jest.fn() }));
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn(), logWithin: jest.fn() },
    AuditCategory: { APPLICATION: 'APPLICATION' },
    AuditSeverity: { MEDIUM: 'MEDIUM', INFO: 'INFO' },
    ResourceType: { APPLICATION: 'APPLICATION' },
}));
jest.mock('../../services/certificate-service', () => ({
    generateCertificate: jest.fn().mockResolvedValue(null),
    ensureCertificateIssuedForApplication: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../services/notification-fanout-service', () => ({ dispatch: jest.fn().mockResolvedValue(null) }));
jest.mock('../../services/user-lookup-service', () => ({
    resolveUserIdFromHealthIdSecurely: jest.fn().mockResolvedValue('u-1'),
}));

const { applicationVisibilityFilter } = require('../../shared/application-visibility');
const { CANONICAL_ROLES, isProviderRole, normalizeRole } = require('../../shared/canonical-rbac');

// canonical-rbac does not export PROVIDER_CANONICAL_ROLES, so mirror the set
// (canonical-rbac.js:235-246). isProviderRole is asserted per entry so the
// mirror cannot silently drift into listing a non-provider role.
const PROVIDER_CANONICAL_ROLES = [
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
    CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM,
    CANONICAL_ROLES.DISPATCHER,
    CANONICAL_ROLES.DOCUMENT_REVIEWER,
    CANONICAL_ROLES.FIELD_INSPECTOR,
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
];

function buildApp(router) {
    const app = express();
    app.use(express.json());
    app.use('/api/provider/applications', router);
    return app;
}

// eslint-disable-next-line global-require
const fixedApp = buildApp(require('../../routes/api/provider/applications'));

// ── The control: the SAME router wired to the PRE-FIX filter ────────────────
// Pre-fix shape (application-visibility.js before H17): auditor + reviewer
// narrowed, everything else falls through to `return null`.
let leakyApp;
beforeAll(() => {
    jest.isolateModules(() => {
        jest.doMock('../../shared/application-visibility', () => {
            const preFixFilter = (user) => {
                if (!user) { return { id: '__no_user__' }; }
                const role = String(user.canonicalRole || user.role || '').toLowerCase();
                if (role === 'field_inspector') { return { auditorId: user.id }; }
                if (role === 'document_reviewer') { return { reviewerId: user.id }; }
                return null; // the bug
            };
            return {
                applicationVisibilityFilter: preFixFilter,
                withVisibility: (base, user) => {
                    const v = preFixFilter(user);
                    return v ? { AND: [base, v] } : base;
                },
                DENY_ALL: { id: '__no_application_scope__' },
            };
        });
        // eslint-disable-next-line global-require
        leakyApp = buildApp(require('../../routes/api/provider/applications'));
    });
});

const SURFACES = [
    ['detail', (id) => `/api/provider/applications/${id}`],
    ['activities', (id) => `/api/provider/applications/${id}/activities`],
    ['audit-timelines', (id) => `/api/provider/applications/${id}/audit-timelines`],
];

const get = (app, role, path) => request(app)
    .get(path)
    .set('x-test-role', role)
    .set('x-test-user-id', `user-${role}`);

// ───────────────────────── A. no provider role over-restricted ──────────────

describe('H17 verify A — the fix did not lock out a role that used to work', () => {
    it('every canonical PROVIDER role lands in a bucket that is not a blanket deny', () => {
        const stuck = [];
        for (const role of PROVIDER_CANONICAL_ROLES) {
            expect(isProviderRole(role)).toBe(true);
            const filter = applicationVisibilityFilter({ id: 'u-1', canonicalRole: role });
            if (filter && filter.id === '__no_application_scope__') { stuck.push(role); }
        }
        expect(stuck).toEqual([]);
    });

    it.each([
        ['system_admin_dtam', CANONICAL_ROLES.SYSTEM_ADMIN_DTAM],
        ['system_admin_platform', CANONICAL_ROLES.SYSTEM_ADMIN_PLATFORM],
        ['dispatcher', CANONICAL_ROLES.DISPATCHER],
        ['finance_officer_platform', CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM],
        ['finance_officer_dtam', CANONICAL_ROLES.FINANCE_OFFICER_DTAM],
        ['finance_officer_platform', CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM],
        ['field_inspector', CANONICAL_ROLES.FIELD_INSPECTOR],
        ['field_inspector', CANONICAL_ROLES.FIELD_INSPECTOR],
    ])('legacy raw token role %s still resolves to a working scope', (raw, expectedCanonical) => {
        expect(normalizeRole(raw)).toBe(expectedCanonical);
        const filter = applicationVisibilityFilter({ id: 'u-1', role: raw });
        expect(filter && filter.id).not.toBe('__no_application_scope__');
    });

    it('โทเคนการเงินจริง (role=ACCOUNTANT ไม่มี canonicalRole) ยังเห็นหน้าต่างการชำระเงินของตัวเอง', async () => {
        for (const [, pathFor] of SURFACES) {
            // eslint-disable-next-line no-await-in-loop
            const res = await get(fixedApp, 'finance_officer_platform', pathFor('app-fee1'));
            expect(res.status).toBe(200);
        }
    });

    it('a real scheduler token (role=SCHEDULER, no canonicalRole) still sees its pool', async () => {
        for (const [, pathFor] of SURFACES) {
            // eslint-disable-next-line no-await-in-loop
            const res = await get(fixedApp, 'dispatcher', pathFor('app-docfeepaid'));
            expect(res.status).toBe(200);
        }
    });

    it('the provider list endpoint still answers 200 for account/scheduler (narrowed, not broken)', async () => {
        for (const role of ['finance_officer_platform', 'dispatcher', 'system_admin_dtam']) {
            // eslint-disable-next-line no-await-in-loop
            const res = await get(fixedApp, role, '/api/provider/applications?limit=100');
            expect([role, res.status]).toEqual([role, 200]);
        }
    });
});

// ───────────────────────── B. the fourth surface ────────────────────────────

describe('H17 verify B — POST /:id/comments (a surface the report did not list)', () => {
    const post = (app, role, id) => request(app)
        .post(`/api/provider/applications/${id}/comments`)
        .set('x-test-role', role)
        .set('x-test-user-id', `user-${role}`)
        .send({ content: 'verifier probe' });

    it('accountant can no longer comment on a DRAFT application', async () => {
        const res = await post(fixedApp, 'finance_officer_platform', 'app-draft');
        expect(res.status).toBe(404);
    });

    it('scheduler can no longer comment on a CERTIFIED application', async () => {
        const res = await post(fixedApp, 'dispatcher', 'app-certified');
        expect(res.status).toBe(404);
    });

    it('การเงินยังคอมเมนต์บนคำขอที่ตัวเองกระทบยอดได้', async () => {
        const res = await post(fixedApp, 'finance_officer_platform', 'app-fee1');
        expect(res.status).toBeLessThan(400);
    });

    it('CONTROL — pre-fix, the same accountant comment on DRAFT was accepted', async () => {
        const res = await post(leakyApp, 'finance_officer_platform', 'app-draft');
        expect(res.status).toBeLessThan(400);
    });
});

// ───────────────────────── C. the control (RED half) ────────────────────────

describe('H17 verify C — control: pre-fix filter still leaks through this router', () => {
    describe.each(SURFACES)('%s', (name, pathFor) => {
        it.each(['finance_officer_platform', 'dispatcher'])('%s reads a DRAFT application pre-fix', async (role) => {
            const res = await get(leakyApp, role, pathFor('app-draft'));
            expect(res.status).toBe(200);
        });

        it('the pre-fix detail body carries the 13-digit national id', async () => {
            if (name !== 'detail') { return; }
            const res = await get(leakyApp, 'finance_officer_platform', pathFor('app-certified'));
            expect(res.status).toBe(200);
            expect(JSON.stringify(res.body)).toContain(NATIONAL_ID);
        });
    });

    describe.each(SURFACES)('%s — post-fix the same request is refused', (_n, pathFor) => {
        it.each(['finance_officer_platform', 'dispatcher'])('%s is denied on DRAFT', async (role) => {
            const res = await get(fixedApp, role, pathFor('app-draft'));
            expect(res.status).toBe(404);
            expect(JSON.stringify(res.body)).not.toContain(NATIONAL_ID);
        });

        it.each(['finance_officer_platform', 'dispatcher'])('%s is denied on CERTIFIED / APPROVED / AUDIT_PASSED / SUBMITTED', async (role) => {
            for (const id of ['app-certified', 'app-approved', 'app-auditpassed', 'app-submitted']) {
                // eslint-disable-next-line no-await-in-loop
                const res = await get(fixedApp, role, pathFor(id));
                expect([id, res.status]).toEqual([id, 404]);
            }
        });
    });
});
