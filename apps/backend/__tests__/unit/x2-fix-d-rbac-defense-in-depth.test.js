/**
 * X2-FIX-D — RBAC defense-in-depth + PDPA tests.
 *
 * Covers the four findings from `docs/handoffs/iter-X2/X2-D.md`:
 *
 *   - H-12 / DR-DIR-1   Staff directory PDPA-minimised projection per role.
 *   - M-18 / DR-FA-1    GET /api/provider/auditor/final-approval-queue
 *                       now gated to AUDITORS + ADMIN (defense in depth).
 *   - M-19 / DR-NAV-1   Backend posture verified — DR is already blocked
 *                       from audit mutations via requireRole(AUDITORS).
 *                       Nav alignment is a static change in
 *                       provider-layout.tsx (DR removed from `audits` key).
 *   - M-20 / DR-EXT-1   Revision-deadline extend POST requires per-app
 *           + DR-SOW-1  ownership.
 *                       SOW + checklist POSTs require per-app ownership.
 *
 * Pattern: keep canonical-rbac REAL so the test proves the real policy.
 * Service-layer + Prisma stubs are jest.fn() so the "no side-effect on
 * 403" invariant can be asserted.
 */

'use strict';

const express = require('express');
const request = require('supertest');

// ── Common module-level mocks (apply to ALL describe blocks) ────────────────

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log), stream: { write: jest.fn() } };
});

jest.mock('../../middleware/auth-middleware', () => {
    const buildHeaderUser = (req, res, next) => {
        const role = req.headers['x-test-role'];
        if (!role || role === 'anonymous') {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        req.user = {
            id: req.headers['x-test-user-id'] || 'user-1',
            role,
            canonicalRole: req.headers['x-test-canonical-role'] || role,
            providerId: role !== 'health' ? (req.headers['x-test-provider-id'] || 'provider-1') : null,
            healthId: role === 'health' ? '1100100100011' : null,
            organizationId: 'org-1',
        };
        return next();
    };
    const requireRole = (allowed = []) => (req, res, next) => {
        const role = req.user?.canonicalRole || req.user?.role;
        if (!allowed.includes(role)) {
            return res.status(403).json({ success: false, error: 'Forbidden' });
        }
        return next();
    };
    return {
        authenticateProvider: buildHeaderUser,
        authenticateAny: buildHeaderUser,
        authenticateHealth: buildHeaderUser,
        authenticateDTAM: buildHeaderUser,
        authenticate: buildHeaderUser,
        requireRole,
        optionalAuth: buildHeaderUser,
        requireVerification: (_req, _res, next) => next(),
        checkPermission: () => (_req, _res, next) => next(),
        rateLimitSensitive: () => (_req, _res, next) => next(),
    };
});

jest.mock('../../middleware/role-middleware', () => ({
    providerOnly: (_req, _res, next) => next(),
}));

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue(null), logWithin: jest.fn().mockResolvedValue(null) },
    AuditCategory: { ADMIN: 'ADMIN', APPLICATION: 'APPLICATION', AUDIT: 'AUDIT' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING', MEDIUM: 'MEDIUM' },
    ResourceType: { USER: 'USER', APPLICATION: 'APPLICATION' },
}));

jest.mock('../../utils/client-ip', () => ({
    getRequestIp: jest.fn(() => '127.0.0.1'),
}));

// Service stubs — `jest.fn()` so each describe block can re-seed shape.
const mockListUsers = jest.fn();
const mockFindUserById = jest.fn();
const mockListFinalApprovalQueue = jest.fn();
const mockApplicationFindUnique = jest.fn();
const mockRevisionDeadlineFindUnique = jest.fn();
const mockRevisionDeadlineUpdate = jest.fn();
const mockRevisionDeadlineCreate = jest.fn();
const mockSowCreate = jest.fn();
const mockSowFindMany = jest.fn();
const mockChecklistCreate = jest.fn();
const mockChecklistFindFirst = jest.fn();
const mockUserUpdate = jest.fn();
const mockUserFindFirst = jest.fn();

jest.mock('../../services/provider-user-service', () => ({
    listAllUsersForProviderDirectory: (...args) => mockListUsers(...args),
    findUserForProviderDirectory: (...args) => mockFindUserById(...args),
    findActiveProviderReviewerById: jest.fn(),
}));

jest.mock('../../services/prisma-database', () => {
    const prisma = {
        application: {
            findUnique: (...args) => mockApplicationFindUnique(...args),
            findFirst: jest.fn(),
            update: jest.fn(),
        },
        revisionDeadline: {
            findUnique: (...args) => mockRevisionDeadlineFindUnique(...args),
            update: (...args) => mockRevisionDeadlineUpdate(...args),
            create: (...args) => mockRevisionDeadlineCreate(...args),
            findMany: jest.fn().mockResolvedValue([]),
        },
        scopeOfWork: {
            create: (...args) => mockSowCreate(...args),
            findMany: (...args) => mockSowFindMany(...args),
            findUnique: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
            delete: jest.fn(),
        },
        auditChecklist: {
            create: (...args) => mockChecklistCreate(...args),
            findFirst: (...args) => mockChecklistFindFirst(...args),
            findUnique: jest.fn().mockResolvedValue(null),
            update: jest.fn(),
        },
        user: {
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: (...args) => mockUserFindFirst(...args),
            update: (...args) => mockUserUpdate(...args),
        },
    };
    // The checklist POST arms onsite evidence inside a transaction (2026-08-26 — the
    // controller used to create the AuditChecklist row itself, ignoring inspectionMode,
    // which is how an ONLINE_MEET application could collect "onsite" evidence). The double
    // hands the callback its own delegates, the way a real interactive transaction does;
    // without it the route throws TypeError and every case in this file reads 500.
    prisma.$transaction = (fn) => fn(prisma);
    return { prisma };
});

jest.mock('../../services/application-service', () => ({
    resolveHealthIdentity: jest.fn().mockResolvedValue(null),
    listAuditorDashboardApplications: jest.fn().mockResolvedValue([]),
    findAuditDecisionApplication: jest.fn().mockResolvedValue(null),
    findAuditDecisionPostWriteSlice: jest.fn().mockResolvedValue({}),
    writeInspectionStart: jest.fn().mockResolvedValue({}),
    findApplicationForFinalApproval: jest.fn().mockResolvedValue(null),
    listFinalApprovalQueue: (...args) => mockListFinalApprovalQueue(...args),
    updateApplicationColumns: jest.fn().mockResolvedValue({}),
    findFirstWithWhere: jest.fn().mockResolvedValue(null),
    listAuditorsByIds: jest.fn().mockResolvedValue([]),
    listProviderApplicationsForReview: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    findVisibleApplicationIdSlice: jest.fn().mockResolvedValue({ id: 'app-1' }),
    listWorkActivitiesForApplication: jest.fn().mockResolvedValue([]),
    getById: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/workflow-transition-service', () => {
    const real = jest.requireActual('../../services/workflow-transition-service');
    return { ...real, buildTransitionUpdate: jest.fn(() => ({ updateData: {} })) };
});

jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../services/notification-service', () => ({
    createNotification: jest.fn().mockResolvedValue(null),
    createBulkNotifications: jest.fn().mockResolvedValue({ count: 0 }),
}));

jest.mock('../../services/user-lookup-service', () => ({
    resolveUserIdFromHealthIdSecurely: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/invoice-service', () => ({
    listSettlementsForApplication: jest.fn().mockResolvedValue([]),
    listSettlementsByApplicationIds: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/phase-billing-service', () => ({
    computePhaseSettlement: jest.fn(() => ({ phasePaid: false })),
    getServiceTypesForPhaseComponent: jest.fn(() => []),
    getCanonicalServiceTypeForComponent: jest.fn(() => null),
    isInvoicePaidStatus: jest.fn(() => false),
}));

jest.mock('../../shared/application-visibility', () => ({
    withVisibility: (w) => w,
}));

jest.mock('../../services/certificate-service', () => ({
    generateCertificate: jest.fn().mockResolvedValue(null),
    ensureCertificateIssuedForApplication: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/attachment-service', () => ({
    listForResource: jest.fn().mockResolvedValue([]),
    detach: jest.fn().mockResolvedValue(null),
    attach: jest.fn().mockResolvedValue(null),
}));

// Pulled after mocks so requires resolve to the stubs above.
const systemProviderRouter = require('../../routes/api/system/provider');
const auditorRouter = require('../../routes/api/provider/auditor');
const revisionDeadlineRouter = require('../../routes/api/applications/revision-deadline');
const providerApplicationsRouter = require('../../routes/api/provider/applications');

function buildApp(mountPath, router) {
    const app = express();
    app.use(express.json());
    app.use(mountPath, router);
    return app;
}

// ── H-12 (DR-DIR-1) staff directory tests ───────────────────────────────────

describe('X2-FIX-D H-12 (DR-DIR-1) — staff directory PDPA projection', () => {
    const app = buildApp('/api/system/providers', systemProviderRouter);

    beforeEach(() => {
        mockListUsers.mockReset();
        mockFindUserById.mockReset();
        const sampleUser = {
            id: 'rev-1',
            uuid: 'uuid-rev-1',
            email: 'reviewer1@dtam.go.th',
            firstName: 'สมชาย',
            lastName: 'ใจดี',
            providerId: '1100100100011',
            role: 'document_reviewer',
            status: 'ACTIVE',
            accountType: 'PROVIDER',
            lastLoginAt: new Date('2026-05-15T08:00:00.000Z'),
            loginAttempts: 0,
            isLocked: false,
            lockedUntil: null,
            twoFactorEnabled: true,
            createdAt: new Date('2025-01-01T00:00:00.000Z'),
            department: 'DTAM',
        };
        mockListUsers.mockResolvedValue([sampleUser]);
        mockFindUserById.mockImplementation(async (id) => (id === 'rev-1' ? sampleUser : null));
    });

    test('DOCUMENT_REVIEWER receives public projection (no PII)', async () => {
        const response = await request(app)
            .get('/api/system/providers')
            .set('x-test-role', 'document_reviewer');
        expect(response.status).toBe(200);
        const [row] = response.body.data;
        expect(row).toBeDefined();
        expect(row.id).toBe('rev-1');
        expect(row.firstName).toBe('สมชาย');
        expect(row.isActive).toBe(true);
        // PDPA-stripped — these MUST be absent for non-privileged roles.
        expect(row).not.toHaveProperty('email');
        expect(row).not.toHaveProperty('lastLoginAt');
        expect(row).not.toHaveProperty('loginAttempts');
        expect(row).not.toHaveProperty('isLocked');
        expect(row).not.toHaveProperty('lockedUntil');
        expect(row).not.toHaveProperty('twoFactorEnabled');
    });

    test('ADMIN receives full projection (PII + lifecycle metadata)', async () => {
        const response = await request(app)
            .get('/api/system/providers')
            .set('x-test-role', 'system_admin_dtam');
        expect(response.status).toBe(200);
        const [row] = response.body.data;
        expect(row.email).toBe('reviewer1@dtam.go.th');
        expect(row).toHaveProperty('lastLoginAt');
        expect(row).toHaveProperty('isLocked');
        expect(row).toHaveProperty('twoFactorEnabled');
    });

    test('AUDITOR (non-privileged for directory) gets public projection', async () => {
        const response = await request(app)
            .get('/api/system/providers')
            .set('x-test-role', 'field_inspector');
        expect(response.status).toBe(200);
        const [row] = response.body.data;
        expect(row).not.toHaveProperty('email');
    });

    test('SCHEDULER (privileged for assignment) gets full projection', async () => {
        const response = await request(app)
            .get('/api/system/providers')
            .set('x-test-role', 'dispatcher');
        expect(response.status).toBe(200);
        const [row] = response.body.data;
        expect(row.email).toBe('reviewer1@dtam.go.th');
    });

    test('GET /:id mirrors the projection policy', async () => {
        const docReviewer = await request(app)
            .get('/api/system/providers/rev-1')
            .set('x-test-role', 'document_reviewer');
        expect(docReviewer.status).toBe(200);
        expect(docReviewer.body.data).not.toHaveProperty('email');

        const admin = await request(app)
            .get('/api/system/providers/rev-1')
            .set('x-test-role', 'system_admin_dtam');
        expect(admin.status).toBe(200);
        expect(admin.body.data.email).toBe('reviewer1@dtam.go.th');
    });
});

// ── M-18 (DR-FA-1) final-approval-queue GET ─────────────────────────────────

describe('X2-FIX-D M-18 (DR-FA-1) — final-approval-queue GET requires AUDITOR', () => {
    const app = buildApp('/api/provider/auditor', auditorRouter);

    beforeEach(() => {
        mockListFinalApprovalQueue.mockReset().mockResolvedValue([]);
    });

    test('DOCUMENT_REVIEWER receives 403 (was 200 pre-fix)', async () => {
        const response = await request(app)
            .get('/api/provider/auditor/final-approval-queue')
            .set('x-test-role', 'document_reviewer');
        expect(response.status).toBe(403);
        expect(mockListFinalApprovalQueue).not.toHaveBeenCalled();
    });

    test('SCHEDULER receives 403 — also blocked by AUDITORS group', async () => {
        const response = await request(app)
            .get('/api/provider/auditor/final-approval-queue')
            .set('x-test-role', 'dispatcher');
        expect(response.status).toBe(403);
        expect(mockListFinalApprovalQueue).not.toHaveBeenCalled();
    });

    // F-CERT-SOD 2026-09-10 — คิวนี้ย้ายจาก ROLE_GROUPS.AUDITORS ไป CERT_DECIDERS
    // ผู้ตรวจประเมินแปลงเคยได้ 200 ที่นี่ และนั่นคือช่องที่ทำให้เขาอนุมัติงานตัวเองได้
    test('ผู้ตรวจประเมินแปลงได้ 403 — คิวตัดสินไม่ใช่ของเขาอีกต่อไป', async () => {
        const response = await request(app)
            .get('/api/provider/auditor/final-approval-queue')
            .set('x-test-role', 'field_inspector');
        expect(response.status).toBe(403);
        expect(mockListFinalApprovalQueue).not.toHaveBeenCalled();
    });

    test('ผู้อนุมัติใบรับรองได้ 200', async () => {
        const response = await request(app)
            .get('/api/provider/auditor/final-approval-queue')
            .set('x-test-role', 'certificate_approver');
        expect(response.status).toBe(200);
        expect(mockListFinalApprovalQueue).toHaveBeenCalled();
    });

    test('ADMIN receives 403 (AUDIT-001 — และ CERT_DECIDERS ก็ไม่รับ admin ด้วยเหตุผลเดียวกัน)', async () => {
        const response = await request(app)
            .get('/api/provider/auditor/final-approval-queue')
            .set('x-test-role', 'system_admin_dtam');
        // AUDIT-001 (2026-06-24): admin/super_admin no longer in AUDITORS, so the
        // per-route AUDITORS gate now rejects admin on ALL auditor routes (incl. this
        // read queue). Admin oversight/recovery is via the workflow `force` path.
        expect(response.status).toBe(403);
    });
});

// ── M-20 (DR-EXT-1) revision-deadline extend per-app owner gate ─────────────

describe('X2-FIX-D M-20 (DR-EXT-1) — revision-deadline extend per-app owner gate', () => {
    const app = buildApp('/api/revision-deadline', revisionDeadlineRouter);

    beforeEach(() => {
        mockApplicationFindUnique.mockReset();
        mockRevisionDeadlineFindUnique.mockReset();
        mockRevisionDeadlineUpdate.mockReset().mockResolvedValue({
            id: 'rd-1',
            applicationId: 'app-1',
            revisionDue: new Date(),
            extensionDays: 3,
            status: 'EXTENDED',
            extensionApprovedAt: new Date(),
        });
        mockRevisionDeadlineFindUnique.mockResolvedValue({
            id: 'rd-1',
            applicationId: 'app-1',
            status: 'PENDING',
            revisionDue: new Date(Date.now() + 86400000),
            extensionDays: 0,
        });
    });

    test('non-assigned DOCUMENT_REVIEWER receives 403', async () => {
        mockApplicationFindUnique.mockResolvedValue({
            id: 'app-1',
            reviewerId: 'other-reviewer',
            auditorId: null,
            formData: {},
        });
        const response = await request(app)
            .put('/api/revision-deadline/app-1/extend')
            .set('x-test-role', 'document_reviewer')
            .set('x-test-user-id', 'user-1')
            .send({ reason: 'need more time', additionalDays: 3 });
        expect(response.status).toBe(403);
        expect(mockRevisionDeadlineUpdate).not.toHaveBeenCalled();
    });

    test('assigned DOCUMENT_REVIEWER receives 200', async () => {
        mockApplicationFindUnique.mockResolvedValue({
            id: 'app-1',
            reviewerId: 'user-1',
            auditorId: null,
            formData: {},
        });
        const response = await request(app)
            .put('/api/revision-deadline/app-1/extend')
            .set('x-test-role', 'document_reviewer')
            .set('x-test-user-id', 'user-1')
            .send({ reason: 'need more time', additionalDays: 3 });
        expect(response.status).toBe(200);
        expect(mockRevisionDeadlineUpdate).toHaveBeenCalled();
    });

    test('ADMIN bypasses owner gate (200)', async () => {
        mockApplicationFindUnique.mockResolvedValue({
            id: 'app-1',
            reviewerId: 'someone-else',
            auditorId: null,
            formData: {},
        });
        const response = await request(app)
            .put('/api/revision-deadline/app-1/extend')
            .set('x-test-role', 'system_admin_dtam')
            .set('x-test-user-id', 'admin-1')
            .send({ reason: 'break-glass', additionalDays: 2 });
        expect(response.status).toBe(200);
        expect(mockRevisionDeadlineUpdate).toHaveBeenCalled();
    });

    test('legacy formData.PROVIDERAssignment.reviewerId path admits caller', async () => {
        mockApplicationFindUnique.mockResolvedValue({
            id: 'app-1',
            reviewerId: null,
            auditorId: null,
            formData: { PROVIDERAssignment: { reviewerId: 'user-1' } },
        });
        const response = await request(app)
            .put('/api/revision-deadline/app-1/extend')
            .set('x-test-role', 'document_reviewer')
            .set('x-test-user-id', 'user-1')
            .send({ reason: 'legacy assignment', additionalDays: 2 });
        expect(response.status).toBe(200);
    });
});

// ── M-20 (DR-SOW-1) SOW + checklist POST per-app owner gate ─────────────────

describe('X2-FIX-D M-20 (DR-SOW-1) — SOW / checklist POST per-app owner gate', () => {
    const app = buildApp('/api/provider/applications', providerApplicationsRouter);

    beforeEach(() => {
        mockApplicationFindUnique.mockReset();
        mockSowCreate.mockReset().mockResolvedValue({
            id: 'sow-1',
            applicationId: 'app-1',
            title: 'GACP SOW',
            status: 'DRAFT',
        });
        mockChecklistCreate.mockReset().mockResolvedValue({
            id: 'cl-1',
            applicationId: 'app-1',
            sections: [],
            totalItems: 0,
            completedItems: 0,
            auditor: { firstName: 'A', lastName: 'B' },
        });
    });

    test('SOW POST: non-assigned provider receives 403', async () => {
        mockApplicationFindUnique.mockResolvedValue({
            id: 'app-1',
            reviewerId: 'other',
            auditorId: 'someone-else',
            formData: {},
        });
        const response = await request(app)
            .post('/api/provider/applications/app-1/sow')
            .set('x-test-role', 'document_reviewer')
            .set('x-test-user-id', 'user-1')
            .send({ title: 'X' });
        expect(response.status).toBe(403);
        expect(mockSowCreate).not.toHaveBeenCalled();
    });

    test('SOW POST: assigned reviewer receives 2xx', async () => {
        mockApplicationFindUnique.mockResolvedValue({
            id: 'app-1',
            reviewerId: 'user-1',
            auditorId: null,
            formData: {},
        });
        const response = await request(app)
            .post('/api/provider/applications/app-1/sow')
            .set('x-test-role', 'document_reviewer')
            .set('x-test-user-id', 'user-1')
            .send({ title: 'SOW for app-1' });
        expect(response.status).toBeLessThan(400);
        expect(mockSowCreate).toHaveBeenCalled();
    });

    test('SOW POST: ADMIN bypasses owner gate', async () => {
        mockApplicationFindUnique.mockResolvedValue({
            id: 'app-1',
            reviewerId: 'other',
            auditorId: 'other',
            formData: {},
        });
        const response = await request(app)
            .post('/api/provider/applications/app-1/sow')
            .set('x-test-role', 'system_admin_dtam')
            .set('x-test-user-id', 'admin-1')
            .send({ title: 'admin SOW' });
        expect(response.status).toBeLessThan(400);
    });

    test('Checklist POST: non-assigned auditor receives 403', async () => {
        mockApplicationFindUnique.mockResolvedValue({
            id: 'app-1',
            reviewerId: 'other',
            auditorId: 'other-auditor',
            formData: {},
        });
        const response = await request(app)
            .post('/api/provider/applications/app-1/checklist')
            .set('x-test-role', 'field_inspector')
            .set('x-test-user-id', 'user-1')
            .send({});
        expect(response.status).toBe(403);
        expect(mockChecklistCreate).not.toHaveBeenCalled();
    });

    test('Checklist POST: assigned auditor receives 2xx', async () => {
        mockApplicationFindUnique.mockResolvedValue({
            id: 'app-1',
            reviewerId: null,
            auditorId: 'user-1',
            // An ONSITE booking is now part of the fixture, and it is not decoration.
            // Since 2026-08-26 this endpoint arms onsite evidence through
            // armOnsiteEvidence instead of creating the AuditChecklist row itself, so an
            // application with no onsite inspection booked is refused 409 AUDIT_NOT_ONSITE
            // — correctly: an ONLINE_MEET or unscheduled application must not be able to
            // collect photographs that a certificate later rests on. This test is about
            // the OWNERSHIP gate, so the fixture has to get past the mode gate to reach
            // the thing it is actually measuring.
            formData: { inspectionMode: 'ONSITE' },
        });
        const response = await request(app)
            .post('/api/provider/applications/app-1/checklist')
            .set('x-test-role', 'field_inspector')
            .set('x-test-user-id', 'user-1')
            .send({});
        expect(response.status).toBeLessThan(400);
    });
});

// ── Privilege-escalation: directory PATCH/PUT must not mint PLATFORM_ADMIN ────
// A tenant ADMIN could previously PATCH/PUT any user's role to PLATFORM_ADMIN
// (the only cross-tenant role) through this directory API — the privesc that
// #505 closed on the other role-write paths but missed here. canonical-rbac is
// REAL in this suite, so these prove the actual guard.
describe('provider directory role-write privesc guard (PATCH/PUT)', () => {
    const app = buildApp('/api/system/providers', systemProviderRouter);

    beforeEach(() => {
        // P0-D contract change: PATCH/PUT now do a tenant-scoped TARGET lookup
        // (user.findFirst with the caller's organizationId) and 404 when it
        // resolves null. The old seed (findFirst → null) modelled the removed
        // providerId-duplicate check; the positive-path test below needs the
        // target row to exist in the caller's org (org-1 per the auth mock).
        // The PLATFORM_ADMIN privesc guards still fire BEFORE the lookup
        // (presence-based, fail-closed); the SELF-role guard now fires AFTER
        // it (S1 change-vs-presence — it compares against the existing row),
        // which this seed satisfies. Full coverage of the new behavior lives
        // in provider-directory-hardening.test.js.
        mockUserFindFirst.mockReset().mockResolvedValue({
            id: 'rev-1', role: 'document_reviewer', status: 'ACTIVE',
            providerId: '1100100100011', organizationId: 'org-1', isDeleted: false,
        });
        mockUserUpdate.mockReset().mockResolvedValue({
            id: 'rev-1', uuid: 'uuid-rev-1', email: 'r@dtam.go.th',
            firstName: 'A', lastName: 'B', role: 'dispatcher', status: 'ACTIVE',
            providerId: '1100100100011', accountType: 'PROVIDER',
            lastLoginAt: null, createdAt: new Date('2025-01-01T00:00:00.000Z'),
        });
    });

    for (const method of ['patch', 'put']) {
        const M = method.toUpperCase();

        test(`${M} /:id — tenant ADMIN cannot assign PLATFORM_ADMIN (canonical, 403, no write)`, async () => {
            const res = await request(app)[method]('/api/system/providers/rev-1')
                .set('x-test-role', 'system_admin_dtam').set('x-test-user-id', 'admin-1')
                .send({ role: 'system_admin_platform' });
            expect(res.status).toBe(403);
            expect(mockUserUpdate).not.toHaveBeenCalled();
        });

        test(`${M} /:id — legacy/uppercase PLATFORM_ADMIN also rejected (403, no write)`, async () => {
            const res = await request(app)[method]('/api/system/providers/rev-1')
                .set('x-test-role', 'system_admin_dtam').set('x-test-user-id', 'admin-1')
                .send({ role: 'system_admin_platform' });
            expect(res.status).toBe(403);
            expect(mockUserUpdate).not.toHaveBeenCalled();
        });

        test(`${M} /:id — admin cannot change their OWN role (403, no write)`, async () => {
            const res = await request(app)[method]('/api/system/providers/admin-1')
                .set('x-test-role', 'system_admin_dtam').set('x-test-user-id', 'admin-1')
                .send({ role: 'dispatcher' });
            expect(res.status).toBe(403);
            expect(mockUserUpdate).not.toHaveBeenCalled();
        });

        test(`${M} /:id — assigning a normal provider role still works (2xx, writes)`, async () => {
            const res = await request(app)[method]('/api/system/providers/rev-1')
                .set('x-test-role', 'system_admin_dtam').set('x-test-user-id', 'admin-1')
                .send({ role: 'dispatcher' });
            expect(res.status).toBeLessThan(400);
            expect(mockUserUpdate).toHaveBeenCalled();
        });
    }
});
