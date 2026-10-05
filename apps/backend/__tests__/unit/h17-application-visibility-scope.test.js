/**
 * H17 — ACCOUNTANT / SCHEDULER / (unknown) roles could read ANY application by
 * raw id, including the applicant's 13-digit national ID and address.
 *
 * Root cause: `shared/application-visibility.js` fell through to `return null`
 * for every role it did not explicitly narrow, and `withVisibility()` reads
 * `null` as "no restriction" — so "no scope defined" meant "see everything"
 * instead of "see nothing".
 *
 * This suite pins BOTH halves of the fix:
 *   (a) DENY — a role with no business need for an application cannot read it
 *       through any of the three leaking surfaces (detail / activities /
 *       audit-timelines), and an unknown role gets nothing at all.
 *   (b) ALLOW — the roles that legitimately need broad read keep it:
 *         · admin / platform_admin  → unnarrowed (tenant operator)
 *         · scheduler               → the scheduling work pool
 *         · account*                → the money-state pool it settles
 *
 * The route-level half runs the REAL `shared/application-visibility` and the
 * REAL canonical-rbac permission gate; only the persistence layer is faked, by
 * an in-memory matcher that evaluates the Prisma `where` the route builds. A
 * 404 in these tests therefore means "the filter excluded the row", not "the
 * mock returned null".
 */

'use strict';

const express = require('express');
const request = require('supertest');

// ── Auth mock: attach req.user from x-test-* headers (cross-role-boundary
//    pattern). canonical-rbac stays REAL so the permission gate is genuine.
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
            canonicalRole: req.headers['x-test-canonical-role'] || role,
            providerId: 'provider-1',
            organizationId: 'org-1',
        };
        return next();
    };
    const requireRole = () => (_req, _res, next) => next();
    return {
        authenticateHealth: buildHeaderUser,
        authenticateAny: buildHeaderUser,
        authenticateProvider: buildHeaderUser,
        authenticateDTAM: buildHeaderUser,
        requireRole,
        requirePermission: () => (_req, _res, next) => next(),
    };
});

jest.mock('../../shared/logger', () => {
    const mockLogger = {
        debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    };
    return { ...mockLogger, createLogger: jest.fn(() => mockLogger) };
});

jest.mock('../../services/prisma-database', () => ({
    prisma: { user: { findMany: jest.fn().mockResolvedValue([]) } },
}));

// ── The fake persistence layer ──────────────────────────────────────────────
// A minimal Prisma-`where` evaluator. Supports exactly the node shapes the
// visibility filter + the routes produce: AND / OR / scalar equality /
// { in: [...] } / { path: [...], equals } (the reviewer's legacy formData
// fallback).
function matchesWhere(where, row) {
    if (!where || typeof where !== 'object') {
        return true;
    }
    return Object.entries(where).every(([key, value]) => {
        if (key === 'AND') {
            return value.every((sub) => matchesWhere(sub, row));
        }
        if (key === 'OR') {
            return value.some((sub) => matchesWhere(sub, row));
        }
        if (key === 'NOT') {
            return !matchesWhere(value, row);
        }
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            if (Array.isArray(value.in)) {
                return value.in.includes(row[key]);
            }
            if (Array.isArray(value.path)) {
                let cursor = row[key];
                for (const segment of value.path) {
                    cursor = cursor == null ? cursor : cursor[segment];
                }
                return cursor === value.equals;
            }
            return false;
        }
        return row[key] === value;
    });
}

const applicant = { firstName: 'สมชาย', lastName: 'เกษตรทอง', email: 'a@b.co', phoneNumber: '0800000000' };

function makeRow(id, status, extra = {}) {
    return {
        id,
        applicationNumber: `NUM-${id}`,
        status,
        isDeleted: false,
        reviewerId: null,
        auditorId: null,
        headAuditorId: null,
        sameReviewerAuditor: false,
        // The PII the bug leaks — a 13-digit national id + address inside formData.
        formData: { applicantInfo: { nationalId: '1234567890123', address: '99/9 ...' } },
        workflowHistory: [],
        createdAt: new Date('2026-08-01'),
        updatedAt: new Date('2026-08-02'),
        rejectCount: 0,
        phase1Status: 'PENDING',
        phase2Status: 'PENDING',
        applicant,
        comments: [],
        ...extra,
    };
}

const DB = [
    makeRow('app-draft', 'DRAFT'),
    makeRow('app-certified', 'CERTIFIED'),
    makeRow('app-fee1', 'PENDING_DOC_FEE'),
    makeRow('app-docfeepaid', 'DOC_FEE_PAID'),
    makeRow('app-assigned', 'ASSIGNED_FOR_REVIEW', { reviewerId: 'user-reviewer' }),
];

const findRow = ({ where }) => DB.find((row) => matchesWhere(where, row)) || null;

jest.mock('../../services/application-service', () => ({
    findProviderApplicationDetail: jest.fn((args) => Promise.resolve(findRow(args))),
    findVisibleApplicationIdSlice: jest.fn((args) => Promise.resolve(findRow(args))),
    findFirstWithWhere: jest.fn((args) => Promise.resolve(findRow(args))),
    listWorkActivitiesForApplication: jest.fn().mockResolvedValue([]),
    listProviderApplicationsPage: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    listProviderQueue: jest.fn().mockResolvedValue([]),
    countProviderQueue: jest.fn().mockResolvedValue(0),
    createApplicationCommentIfAvailable: jest.fn().mockResolvedValue(null),
    writeAssignmentColumns: jest.fn(),
    listSchedulerDashboardApplications: jest.fn().mockResolvedValue([]),
    listAuditorsByIds: jest.fn().mockResolvedValue([]),
    resolveHealthIdentity: jest.fn().mockResolvedValue({ healthId: 'h-1', userId: 'u-1' }),
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

jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: jest.fn(),
}));

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn(), logWithin: jest.fn() },
    AuditCategory: { APPLICATION: 'APPLICATION' },
    AuditSeverity: { MEDIUM: 'MEDIUM' },
    ResourceType: { APPLICATION: 'APPLICATION' },
}));

jest.mock('../../services/certificate-service', () => ({
    generateCertificate: jest.fn().mockResolvedValue(null),
    ensureCertificateIssuedForApplication: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/notification-fanout-service', () => ({
    dispatch: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/user-lookup-service', () => ({
    resolveUserIdFromHealthIdSecurely: jest.fn().mockResolvedValue('u-1'),
}));

const {
    applicationVisibilityFilter,
    withVisibility,
} = require('../../shared/application-visibility');

const providerApplicationsRouter = require('../../routes/api/provider/applications');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/provider/applications', providerApplicationsRouter);
    return app;
}

const SURFACES = [
    ['detail', (id) => `/api/provider/applications/${id}`],
    ['activities', (id) => `/api/provider/applications/${id}/activities`],
    ['audit-timelines', (id) => `/api/provider/applications/${id}/audit-timelines`],
];

async function get(app, role, path) {
    return request(app)
        .get(path)
        .set('x-test-role', role)
        .set('x-test-canonical-role', role)
        .set('x-test-user-id', `user-${role}`);
}

// ───────────────────────────── unit level ───────────────────────────────────

describe('H17 unit — an absent scope means DENY, not "see everything"', () => {
    it('denies a role that has no declared scope (unknown / future role)', () => {
        const filter = applicationVisibilityFilter({ id: 'u-x', canonicalRole: 'some_new_role' });
        expect(filter).not.toBeNull();
        // The filter must be one no row can satisfy.
        expect(DB.some((row) => matchesWhere(filter, row))).toBe(false);
    });

    it('denies a user object with no canonicalRole at all', () => {
        const filter = applicationVisibilityFilter({ id: 'u-x' });
        expect(filter).not.toBeNull();
        expect(DB.some((row) => matchesWhere(filter, row))).toBe(false);
    });

    it('keeps admin and platform_admin unnarrowed (tenant operator)', () => {
        expect(applicationVisibilityFilter({ id: 'u-a', canonicalRole: 'system_admin_dtam' })).toBeNull();
        expect(applicationVisibilityFilter({ id: 'u-p', canonicalRole: 'system_admin_platform' })).toBeNull();
        const base = { isDeleted: false };
        expect(withVisibility(base, { id: 'u-a', canonicalRole: 'system_admin_dtam' })).toBe(base);
    });

    it('narrows scheduler to the scheduling pool (not the whole table)', () => {
        const filter = applicationVisibilityFilter({ id: 'u-s', canonicalRole: 'dispatcher' });
        expect(filter).not.toBeNull();
        const visible = DB.filter((row) => matchesWhere(filter, row)).map((r) => r.status);
        expect(visible).toContain('DOC_FEE_PAID');
        expect(visible).not.toContain('DRAFT');
        expect(visible).not.toContain('CERTIFIED');
    });

    it.each(['finance_officer_platform', 'finance_officer_dtam'])(
        'narrows %s to the money-state pool (not the whole table)',
        (role) => {
            const filter = applicationVisibilityFilter({ id: 'u-ac', canonicalRole: role });
            expect(filter).not.toBeNull();
            const visible = DB.filter((row) => matchesWhere(filter, row)).map((r) => r.status);
            expect(visible).toContain('PENDING_DOC_FEE');
            expect(visible).toContain('DOC_FEE_PAID');
            expect(visible).not.toContain('DRAFT');
            expect(visible).not.toContain('CERTIFIED');
            expect(visible).not.toContain('ASSIGNED_FOR_REVIEW');
        },
    );
});

// ───────────────────────────── route level ──────────────────────────────────

describe('H17 route — cross-boundary reads are refused on all three surfaces', () => {
    const app = buildApp();

    describe.each(SURFACES)('%s', (_name, pathFor) => {
        it('scheduler cannot read a DRAFT application (outside the scheduling pool)', async () => {
            const res = await get(app, 'dispatcher', pathFor('app-draft'));
            expect(res.status).toBe(404);
            expect(JSON.stringify(res.body)).not.toContain('1234567890123');
        });

        it('scheduler cannot read a CERTIFIED application (work already done)', async () => {
            const res = await get(app, 'dispatcher', pathFor('app-certified'));
            expect(res.status).toBe(404);
        });

        it.each(['finance_officer_platform', 'finance_officer_dtam', 'finance_officer_platform'])(
            '%s cannot read a DRAFT application',
            async (role) => {
                const res = await get(app, role, pathFor('app-draft'));
                expect(res.status).toBe(404);
                expect(JSON.stringify(res.body)).not.toContain('1234567890123');
            },
        );

        it('account cannot read an application that is out in document review', async () => {
            const res = await get(app, 'finance_officer_platform', pathFor('app-assigned'));
            expect(res.status).toBe(404);
        });

        it('account cannot read a CERTIFIED application', async () => {
            const res = await get(app, 'finance_officer_platform', pathFor('app-certified'));
            expect(res.status).toBe(404);
        });
    });
});

describe('H17 route — the legitimate reads still work', () => {
    const app = buildApp();

    describe.each(SURFACES)('%s', (_name, pathFor) => {
        it('admin still reads any application', async () => {
            for (const id of ['app-draft', 'app-certified', 'app-fee1', 'app-docfeepaid']) {
                const res = await get(app, 'system_admin_dtam', pathFor(id));
                expect([id, res.status]).toEqual([id, 200]);
            }
        });

        it('scheduler still reads an application waiting for reviewer assignment', async () => {
            const res = await get(app, 'dispatcher', pathFor('app-docfeepaid'));
            expect(res.status).toBe(200);
        });

        it('scheduler still reads an application in document review (its pipeline pool)', async () => {
            const res = await get(app, 'dispatcher', pathFor('app-assigned'));
            expect(res.status).toBe(200);
        });

        it.each(['finance_officer_platform', 'finance_officer_dtam', 'finance_officer_platform'])(
            '%s still reads the application whose fee it has to settle',
            async (role) => {
                const res = await get(app, role, pathFor('app-fee1'));
                expect(res.status).toBe(200);
            },
        );

        it('account still reads the application it just settled', async () => {
            const res = await get(app, 'finance_officer_platform', pathFor('app-docfeepaid'));
            expect(res.status).toBe(200);
        });

        it('assigned document_reviewer still reads its own case', async () => {
            const res = await request(app)
                .get(pathFor('app-assigned'))
                .set('x-test-role', 'document_reviewer')
                .set('x-test-canonical-role', 'document_reviewer')
                .set('x-test-user-id', 'user-reviewer');
            expect(res.status).toBe(200);
        });
    });
});
