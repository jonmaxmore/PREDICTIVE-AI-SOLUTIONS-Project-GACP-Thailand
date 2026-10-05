/**
 * audit-onsite-routes — V3-A (DI-1 fix, 2026-05-17).
 *
 * Proves the /api/audit/onsite/* router is mounted and the new
 * GET /:auditId/context endpoint returns the shape the inspect-page
 * frontend expects.
 *
 * Background (DI-1, see docs/handoffs/iter-V3/00-rfc.md): the
 * apps/backend/routes/api/audit/onsite.js file existed on disk but was
 * never required nor mounted in routes/api/index.js. Every page load
 * of /provider/audits/[id]/inspect 404'd on the initial
 * AuditService.getOnsiteContext() call. This test pins the mount so
 * a regression instantly fails CI.
 *
 * Pattern: mirrors applications-route-rbac.test.js — mock the auth
 * middleware to attach req.user from x-test-* headers; mock prisma +
 * the audit-onsite-service so the supertest can run without a DB.
 */

'use strict';

const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

// I-008: mock every collaborator the router transitively requires. The
// shared/canonical-rbac module is NOT mocked — tests rely on its real
// CANONICAL_ROLES + normalizeRole so the gate logic matches production.
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
            organizationId: req.headers['x-test-organization-id'] || 'org-1',
            providerId: req.headers['x-test-provider-id'] || 'provider-1',
        };
        return next();
    };
    // requireRole comes from role-middleware; the inline mock below
    // re-implements the AUDIT_STAFF / AUDITORS shape used by onsite.js so
    // we don't have to import the real one (which pulls prisma).
    const requireRole = (allowedRoles) => (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        const allowed = (allowedRoles || []).map((r) => String(r).toLowerCase());
        const have = String(req.user.canonicalRole || req.user.role || '').toLowerCase();
        if (allowed.includes(have)) {return next();}
        return res.status(403).json({
            success: false,
            error: `Access denied. Required roles: ${allowedRoles.join(', ')}`,
            code: 'ROLE_DENIED',
        });
    };
    return {
        authenticateHealth: buildHeaderUser,
        authenticateAny: buildHeaderUser,
        authenticateProvider: buildHeaderUser,
        requireRole,
    };
});

// Build a per-call prisma mock so each test can wire its own audit row.
const mockAudits = new Map();
const mockChecklistItems = new Map();
const mockPhotos = new Map(); // auditId -> FarmAuditPhoto[]
// Named so a describe block that .mockImplementation()s this away (e.g. the
// applicationId-route block below, which must answer resolver-shaped where
// clauses too) can restore the exact original behavior afterward — jest.clearAllMocks()
// in the outer beforeEach clears call history but NOT a swapped-in implementation.
const baseAuditChecklistFindFirst = async ({ where }) => mockAudits.get(where.id) || null;
const mockAuditChecklist = {
    findFirst: jest.fn(baseAuditChecklistFindFirst),
};
const mockFarmAuditChecklistItem = {
    findMany: jest.fn(async ({ where }) => mockChecklistItems.get(where.auditId) || []),
};
const mockFarmAuditPhoto = {
    findMany: jest.fn(async ({ where }) => mockPhotos.get(where.auditId) || []),
};
const mockStartLogs = new Map(); // auditId -> AUDIT_INSPECTION_START GpsVerificationLog row
const mockGpsVerificationLog = {
    create: jest.fn(async ({ data }) => ({ id: 'gps-log-1', ...data })),
    findFirst: jest.fn(async ({ where }) => {
        if (where?.entityType && where.entityType !== 'AUDIT_INSPECTION_START') { return null; }
        return mockStartLogs.get(where?.entityId) || null;
    }),
};
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        auditChecklist: mockAuditChecklist,
        farmAuditChecklistItem: mockFarmAuditChecklistItem,
        farmAuditPhoto: mockFarmAuditPhoto,
        gpsVerificationLog: mockGpsVerificationLog,
    },
}));

jest.mock('../../shared/logger', () => {
    const mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    };
    return {
        ...mockLogger,
        createLogger: jest.fn(() => mockLogger),
        default: mockLogger,
    };
});

// Multer fallback — onsite.js does its own try/catch so the require
// returns null silently if absent. Provide a noop so the photo route
// (not under test here) doesn't crash module load.
jest.mock('multer', () => {
    const m = () => ({ single: () => (_req, _res, next) => next() });
    m.memoryStorage = () => ({});
    return m;
});

const onsiteRouter = require('../../routes/api/audit/onsite');

const API_INDEX_PATH = path.resolve(__dirname, '../../routes/api/index.js');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/audit/onsite', onsiteRouter);
    return app;
}

beforeEach(() => {
    mockAudits.clear();
    mockChecklistItems.clear();
    mockPhotos.clear();
    mockStartLogs.clear();
    jest.clearAllMocks();
});

describe('V3-A DI-1 — /api/audit/onsite router mount', () => {
    // Regression guard for DI-1: the routes/api/index.js file MUST
    // require + mount audit/onsite under /audit/onsite. We assert this
    // by reading the source of the canonical index — that's faster and
    // more robust than booting the full router tree (which would pull
    // in dozens of unrelated services). The mount line is unique
    // enough that a future refactor that drops it will instantly fail
    // this test rather than 404 silently in the wild.
    test('routes/api/index.js mounts /audit/onsite (source-level regression guard)', () => {
        const source = fs.readFileSync(API_INDEX_PATH, 'utf8');
        // The mount must be present and wired to the onsite router file.
        expect(source).toMatch(/router\.use\(\s*['"]\/audit\/onsite['"]\s*,\s*require\(\s*['"]\.\/audit\/onsite['"]\s*\)\s*\)/);
    });

    test('the onsite router responds to GET /:auditId/context (proves the router is wired and the handler exists)', async () => {
        mockAudits.set('aud-mount-1', {
            id: 'aud-mount-1',
            applicationId: 'app-1',
            auditorId: 'user-1',
            status: 'IN_PROGRESS',
            application: {
                id: 'app-1',
                applicationNumber: 'GACP-2026-00001',
                formData: { applicantName: 'สมชาย ใจดี' },
            },
        });

        const app = buildApp();
        const response = await request(app)
            .get('/api/audit/onsite/aud-mount-1/context')
            .set('x-test-role', 'field_inspector')
            .set('x-test-user-id', 'user-1');

        // Prior to V3-A this returned 404 "Cannot GET ...". Now the
        // router resolves the route and our handler answers 200.
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
    });

    test('anonymous request returns 401 (auth middleware fires before any handler)', async () => {
        const app = buildApp();
        const response = await request(app)
            .get('/api/audit/onsite/aud-1/context');
        expect(response.status).toBe(401);
    });

    test('a role outside AUDIT_STAFF (e.g. account_dtam) is rejected by the file-level gate', async () => {
        const app = buildApp();
        const response = await request(app)
            .get('/api/audit/onsite/aud-1/context')
            .set('x-test-role', 'finance_officer_dtam');
        expect(response.status).toBe(403);
    });
});

describe('V3-A — GET /:auditId/context shape', () => {
    test('returns the inspect-page initial state for an assigned auditor', async () => {
        mockAudits.set('aud-ctx-1', {
            id: 'aud-ctx-1',
            applicationId: 'app-101',
            auditorId: 'user-1',
            status: 'IN_PROGRESS',
            createdAt: new Date('2026-05-17T03:00:00.000Z'),
            application: {
                id: 'app-101',
                applicationNumber: 'GACP-2026-00101',
                formData: {
                    applicantName: 'นางสาวฟาร์มดี ใจดี',
                    locationData: {
                        farmAddress: '99 หมู่ 1 ต.เมือง อ.เมือง จ.เชียงใหม่',
                        latitude: 18.7883,
                        longitude: 98.9853,
                    },
                    scope: 'CANNABIS',
                },
            },
        });
        mockChecklistItems.set('aud-ctx-1', [
            {
                id: 'item-row-1',
                itemCode: '1.1',
                response: 'PASS',
                notes: 'ผ่าน',
                recordedAt: new Date('2026-05-17T03:05:00.000Z'),
            },
        ]);
        // B10 fix: photoIds is NOT a FarmAuditChecklistItem scalar (the schema has
        // no such column — see audit-onsite-evidence.prisma). The real linkage is
        // FarmAuditPhoto.checklistItemId; register it here so loadSavedAnswers'
        // join has something real to find.
        mockPhotos.set('aud-ctx-1', [{ id: 'photo-1', checklistItemId: 'item-row-1' }]);

        const app = buildApp();
        const response = await request(app)
            .get('/api/audit/onsite/aud-ctx-1/context')
            .set('x-test-role', 'field_inspector')
            .set('x-test-user-id', 'user-1');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);

        const data = response.body.data;
        // Audit metadata — the 5 fields the StartScreen renders.
        expect(data.audit).toMatchObject({
            id: 'aud-ctx-1',
            applicationId: 'app-101',
            applicationNumber: 'GACP-2026-00101',
            applicantName: 'นางสาวฟาร์มดี ใจดี',
            farmAddress: '99 หมู่ 1 ต.เมือง อ.เมือง จ.เชียงใหม่',
            farmLat: 18.7883,
            farmLng: 98.9853,
            scope: 'CANNABIS',
        });

        // Checklist mapped from CHECKLIST_TEMPLATE_2026 — first item is
        // the 1.1 site-selection prompt (proves the mapping ran).
        expect(Array.isArray(data.checklist)).toBe(true);
        expect(data.checklist.length).toBeGreaterThanOrEqual(20);
        expect(data.checklist[0]).toMatchObject({
            itemId: '1.1',
            category: 'SITE_SELECTION',
            required: true,
        });

        // Saved answers round-trip — itemCode is mapped to itemId.
        expect(data.savedAnswers).toEqual([
            expect.objectContaining({
                itemId: '1.1',
                response: 'PASS',
                notes: 'ผ่าน',
                photoIds: ['photo-1'],
            }),
        ]);

        // F-ONSITE-GPS-CHECKIN-UNREACHABLE (2026-08-19, Phase 0 C12 real walk):
        // this pin used to assert startedAt === audit.createdAt. That row is
        // born at scheduler-ASSIGN (audit-scheduling-service.js:565-583), so
        // reporting its createdAt as "started" made the field app skip the GPS
        // check-in screen for every fresh audit
        // (inspect/client-view.tsx:128 `setStage(startedAt ? 'checklist' : 'start')`),
        // photos then uploaded with no coordinates and were all rejected
        // (evidence/phase0/s05/C12-photos.txt — 5×500), leaving the ≥5-photo
        // evidence gate unsatisfiable through the UI. The only real start
        // marker is the AUDIT_INSPECTION_START GpsVerificationLog row written
        // by startInspection (audit-onsite-service.js:473-487); with no such
        // row (as here) the honest answer is null → the field app opens on
        // its start screen.
        expect(data.startedAt).toBeNull();
    });

    test('context returns the AUDIT_INSPECTION_START marker time as startedAt once the check-in exists', async () => {
        mockAudits.set('aud-ctx-2', {
            id: 'aud-ctx-2',
            applicationId: 'app-102',
            auditorId: 'user-1',
            status: 'IN_PROGRESS',
            createdAt: new Date('2026-05-17T03:00:00.000Z'), // assign time — must NOT be reported
            application: {
                id: 'app-102',
                applicationNumber: 'GACP-2026-00102',
                formData: {},
            },
        });
        mockStartLogs.set('aud-ctx-2', {
            id: 'gps-log-2',
            entityType: 'AUDIT_INSPECTION_START',
            entityId: 'aud-ctx-2',
            verifiedAt: new Date('2026-05-17T06:30:00.000Z'), // the auditor's actual check-in
        });

        const app = buildApp();
        const response = await request(app)
            .get('/api/audit/onsite/aud-ctx-2/context')
            .set('x-test-role', 'field_inspector')
            .set('x-test-user-id', 'user-1');

        expect(response.status).toBe(200);
        expect(response.body.data.startedAt).toBe('2026-05-17T06:30:00.000Z');
    });

    test('returns 404 with code AUDIT_NOT_FOUND when the audit row is absent', async () => {
        const app = buildApp();
        const response = await request(app)
            .get('/api/audit/onsite/does-not-exist/context')
            .set('x-test-role', 'field_inspector')
            .set('x-test-user-id', 'user-1');
        expect(response.status).toBe(404);
        expect(response.body).toMatchObject({
            success: false,
            code: 'AUDIT_NOT_FOUND',
        });
    });

    // H5 regression: gps-verify previously blanket-500'd a missing auditId (the
    // service threw a codeless Error). It must 404 AUDIT_NOT_FOUND like /context.
    test('GET /:auditId/gps-verify → 404 AUDIT_NOT_FOUND for an unknown audit (not 500)', async () => {
        const app = buildApp();
        const response = await request(app)
            .get('/api/audit/onsite/does-not-exist/gps-verify?lat=18.78&lng=98.98')
            .set('x-test-role', 'field_inspector')
            .set('x-test-user-id', 'user-1');
        expect(response.status).toBe(404);
        expect(response.body).toMatchObject({
            success: false,
            code: 'AUDIT_NOT_FOUND',
        });
    });

    test('AUDITOR B is denied when the audit is assigned to AUDITOR A (scope correctness)', async () => {
        mockAudits.set('aud-scope-1', {
            id: 'aud-scope-1',
            applicationId: 'app-202',
            auditorId: 'user-A',
            status: 'IN_PROGRESS',
            application: {
                id: 'app-202',
                applicationNumber: 'GACP-2026-00202',
                formData: {},
            },
        });

        const app = buildApp();
        const response = await request(app)
            .get('/api/audit/onsite/aud-scope-1/context')
            .set('x-test-role', 'field_inspector')
            .set('x-test-user-id', 'user-B');

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
            success: false,
            code: 'AUDIT_AUDITOR_MISMATCH',
        });
    });

    test('ADMIN sees any audit regardless of auditor assignment', async () => {
        mockAudits.set('aud-admin-1', {
            id: 'aud-admin-1',
            applicationId: 'app-303',
            auditorId: 'user-A',
            status: 'IN_PROGRESS',
            application: {
                id: 'app-303',
                applicationNumber: 'GACP-2026-00303',
                formData: { applicantName: 'Admin Test' },
            },
        });

        const app = buildApp();
        const response = await request(app)
            .get('/api/audit/onsite/aud-admin-1/context')
            .set('x-test-role', 'system_admin_dtam')
            .set('x-test-user-id', 'user-admin');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data.audit.id).toBe('aud-admin-1');
    });

    // PDPA-001: /context returns applicantName only to those with need-to-know
    // (the assigned auditor + admin). document_reviewer / scheduler reach the
    // preview via the file-level AUDIT_STAFF gate but get the name redacted.
    test('PDPA: assigned AUDITOR sees applicantName', async () => {
        mockAudits.set('aud-pdpa-1', {
            id: 'aud-pdpa-1', applicationId: 'app-pdpa', auditorId: 'auditor-assigned', status: 'IN_PROGRESS',
            application: { id: 'app-pdpa', applicationNumber: 'GACP-PDPA-1', formData: { applicantName: 'สมชาย ใจดี' } },
        });
        const res = await request(buildApp()).get('/api/audit/onsite/aud-pdpa-1/context')
            .set('x-test-role', 'field_inspector').set('x-test-user-id', 'auditor-assigned');
        expect(res.status).toBe(200);
        expect(res.body.data.audit.applicantName).toBe('สมชาย ใจดี');
    });
    test('PDPA: ADMIN sees applicantName', async () => {
        mockAudits.set('aud-pdpa-2', {
            id: 'aud-pdpa-2', applicationId: 'app-pdpa', auditorId: 'auditor-assigned', status: 'IN_PROGRESS',
            application: { id: 'app-pdpa', applicationNumber: 'GACP-PDPA-2', formData: { applicantName: 'สมชาย ใจดี' } },
        });
        const res = await request(buildApp()).get('/api/audit/onsite/aud-pdpa-2/context')
            .set('x-test-role', 'system_admin_dtam').set('x-test-user-id', 'admin-1');
        expect(res.status).toBe(200);
        expect(res.body.data.audit.applicantName).toBe('สมชาย ใจดี');
    });
    test('PDPA: SCHEDULER (no need-to-know) gets applicantName redacted to null', async () => {
        mockAudits.set('aud-pdpa-3', {
            id: 'aud-pdpa-3', applicationId: 'app-pdpa', auditorId: 'auditor-assigned', status: 'IN_PROGRESS',
            application: { id: 'app-pdpa', applicationNumber: 'GACP-PDPA-3', formData: { applicantName: 'สมชาย ใจดี' } },
        });
        const res = await request(buildApp()).get('/api/audit/onsite/aud-pdpa-3/context')
            .set('x-test-role', 'dispatcher').set('x-test-user-id', 'sched-1');
        expect(res.status).toBe(200);
        expect(res.body.data.audit.applicantName).toBeNull();
    });
    test('PDPA: DOCUMENT_REVIEWER gets applicantName redacted to null', async () => {
        mockAudits.set('aud-pdpa-4', {
            id: 'aud-pdpa-4', applicationId: 'app-pdpa', auditorId: 'auditor-assigned', status: 'IN_PROGRESS',
            application: { id: 'app-pdpa', applicationNumber: 'GACP-PDPA-4', formData: { applicantName: 'สมชาย ใจดี' } },
        });
        const res = await request(buildApp()).get('/api/audit/onsite/aud-pdpa-4/context')
            .set('x-test-role', 'document_reviewer').set('x-test-user-id', 'rev-1');
        expect(res.status).toBe(200);
        expect(res.body.data.audit.applicantName).toBeNull();
    });

    test('handles formData.location fallback shape when locationData is absent', async () => {
        mockAudits.set('aud-loc-1', {
            id: 'aud-loc-1',
            applicationId: 'app-404',
            auditorId: 'user-1',
            status: 'IN_PROGRESS',
            application: {
                id: 'app-404',
                applicationNumber: 'GACP-2026-00404',
                formData: {
                    applicantData: { firstName: 'ทดสอบ', lastName: 'สำรอง' },
                    location: {
                        address: '5 หมู่ 7 จ.เชียงราย',
                        latitude: 19.9105,
                        longitude: 99.8406,
                    },
                },
            },
        });

        const app = buildApp();
        const response = await request(app)
            .get('/api/audit/onsite/aud-loc-1/context')
            .set('x-test-role', 'field_inspector')
            .set('x-test-user-id', 'user-1');

        expect(response.status).toBe(200);
        expect(response.body.data.audit).toMatchObject({
            applicantName: 'ทดสอบ สำรอง',
            farmAddress: '5 หมู่ 7 จ.เชียงราย',
            farmLat: 19.9105,
            farmLng: 99.8406,
        });
    });
});

// Task 4: the inspect page's route param [id] is the applicationId, not an
// auditId (the whole /provider/audits/[id] tree is keyed by applicationId).
// This explicit route resolves the current audit via the Task 2 resolver and
// hands back the real audit.id the FE uses for every subsequent write.
describe('onsite — GET /application/:applicationId/context (explicit applicationId route)', () => {
    // The resolver (resolveCurrentOnsiteAuditId) queries auditChecklist.findFirst
    // keyed by applicationId (possibly twice: IN_PROGRESS-first, then latest).
    // Teach the shared mock to answer both that shape and the plain by-id shape
    // the rest of the file relies on.
    function wireResolverByApplicationId() {
        mockAuditChecklist.findFirst.mockImplementation(async ({ where }) => {
            if (where.applicationId) {
                return [...mockAudits.values()].find((a) => (
                    a.applicationId === where.applicationId
                    && !a.isDeleted
                    // Honor the resolver's organizationId filter as a real hard AND —
                    // the route always passes one (defaults to 'org-1' via the
                    // x-test-organization-id fallback below), so this is exercised on
                    // every call, not just the org-mismatch test.
                    && (!where.organizationId || a.organizationId === where.organizationId)
                )) || null;
            }
            return mockAudits.get(where.id) || null;
        });
    }

    // wireResolverByApplicationId() swaps the module-scoped findFirst mock via
    // .mockImplementation(); jest.clearAllMocks() in the outer beforeEach clears
    // call history but not implementations, so without this restore the override
    // would silently leak into any test appended after this describe block.
    afterEach(() => {
        mockAuditChecklist.findFirst.mockImplementation(baseAuditChecklistFindFirst);
    });

    test('resolves the current audit by applicationId and returns the real audit.id', async () => {
        mockAudits.set('aud-appctx-1', {
            id: 'aud-appctx-1', applicationId: 'app-777', auditorId: 'user-1', organizationId: 'org-1', status: 'IN_PROGRESS',
            createdAt: new Date('2026-08-17T03:00:00.000Z'),
            application: { id: 'app-777', applicationNumber: 'GACP-2026-00777', formData: {} },
        });
        wireResolverByApplicationId();

        const res = await request(buildApp())
            .get('/api/audit/onsite/application/app-777/context')
            .set('x-test-role', 'field_inspector').set('x-test-user-id', 'user-1');

        expect(res.status).toBe(200);
        expect(res.body.data.audit.id).toBe('aud-appctx-1');
        expect(res.body.data.audit.applicationId).toBe('app-777');
        // F-ONSITE-STARTEDAT-LIES also bit THIS route (it is the one the field
        // app actually calls — inspect/client-view fetches by applicationId).
        // Pin the fix at this call-site too so a partial revert cannot stay
        // green (review 2026-08-19): createdAt above is the ASSIGN time and
        // must NOT surface as startedAt; with no AUDIT_INSPECTION_START marker
        // the honest answer is null.
        expect(res.body.data.startedAt).toBeNull();
    });

    test('startedAt on the applicationId route reflects the real check-in marker when one exists', async () => {
        mockAudits.set('aud-appctx-5', {
            id: 'aud-appctx-5', applicationId: 'app-785', auditorId: 'user-1', organizationId: 'org-1', status: 'IN_PROGRESS',
            createdAt: new Date('2026-08-17T03:00:00.000Z'), // assign time — must not be reported
            application: { id: 'app-785', applicationNumber: 'GACP-2026-00785', formData: {} },
        });
        mockStartLogs.set('aud-appctx-5', {
            id: 'gps-log-5',
            entityType: 'AUDIT_INSPECTION_START',
            entityId: 'aud-appctx-5',
            verifiedAt: new Date('2026-08-17T08:15:00.000Z'),
        });
        wireResolverByApplicationId();

        const res = await request(buildApp())
            .get('/api/audit/onsite/application/app-785/context')
            .set('x-test-role', 'field_inspector').set('x-test-user-id', 'user-1');

        expect(res.status).toBe(200);
        expect(res.body.data.startedAt).toBe('2026-08-17T08:15:00.000Z');
    });

    test('savedAnswers photoIds come from the FarmAuditPhoto join, not a scalar', async () => {
        mockAudits.set('aud-appctx-2', {
            id: 'aud-appctx-2', applicationId: 'app-778', auditorId: 'user-1', organizationId: 'org-1', status: 'IN_PROGRESS',
            createdAt: new Date('2026-08-17T03:00:00.000Z'),
            application: { id: 'app-778', applicationNumber: 'GACP-2026-00778', formData: {} },
        });
        wireResolverByApplicationId();
        mockChecklistItems.set('aud-appctx-2', [
            {
                id: 'item-row-9',
                itemCode: '1.1',
                response: 'PASS',
                notes: null,
                recordedAt: new Date('2026-08-17T03:05:00.000Z'),
            },
        ]);
        mockPhotos.set('aud-appctx-2', [{ id: 'photo-9', checklistItemId: 'item-row-9' }]);

        const res = await request(buildApp())
            .get('/api/audit/onsite/application/app-778/context')
            .set('x-test-role', 'field_inspector').set('x-test-user-id', 'user-1');

        expect(res.status).toBe(200);
        expect(res.body.data.audit.id).toBe('aud-appctx-2');
        expect(res.body.data.savedAnswers).toEqual([
            expect.objectContaining({
                itemId: '1.1',
                response: 'PASS',
                photoIds: ['photo-9'],
            }),
        ]);
    });

    test('a different auditor (not assigned) is denied 403 AUDIT_AUDITOR_MISMATCH', async () => {
        mockAudits.set('aud-appctx-3', {
            id: 'aud-appctx-3', applicationId: 'app-779', auditorId: 'user-A', organizationId: 'org-1', status: 'IN_PROGRESS',
            createdAt: new Date('2026-08-17T03:00:00.000Z'),
            application: { id: 'app-779', applicationNumber: 'GACP-2026-00779', formData: {} },
        });
        wireResolverByApplicationId();

        const res = await request(buildApp())
            .get('/api/audit/onsite/application/app-779/context')
            .set('x-test-role', 'field_inspector').set('x-test-user-id', 'user-B');

        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ success: false, code: 'AUDIT_AUDITOR_MISMATCH' });
    });

    // Fix round 1: pins the org filter as a real hard AND, not decorative. The
    // caller's auditorId ('user-1') WOULD match this audit's auditorId — if org
    // were not enforced, this would 200. It's the org mismatch alone that must
    // produce 404, proving resolveCurrentOnsiteAuditId's organizationId filter
    // is load-bearing for this route, not just a comment.
    test('org mismatch (auditorId would match) excludes the audit via the resolver hard filter -> 404 AUDIT_NOT_FOUND', async () => {
        mockAudits.set('aud-appctx-4', {
            id: 'aud-appctx-4', applicationId: 'app-780', auditorId: 'user-1', organizationId: 'org-OTHER', status: 'IN_PROGRESS',
            createdAt: new Date('2026-08-17T03:00:00.000Z'),
            application: { id: 'app-780', applicationNumber: 'GACP-2026-00780', formData: {} },
        });
        wireResolverByApplicationId();

        // No x-test-organization-id header -> caller org defaults to 'org-1'
        // (see buildHeaderUser mock), which does not match the audit's 'org-OTHER'.
        const res = await request(buildApp())
            .get('/api/audit/onsite/application/app-780/context')
            .set('x-test-role', 'field_inspector').set('x-test-user-id', 'user-1');

        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ success: false, code: 'AUDIT_NOT_FOUND' });
    });

    // Sibling coverage: the existing /:auditId/context route has this same case
    // ('ADMIN sees any audit regardless of auditor assignment'); the new route
    // needs it too, since it re-implements the same isAdmin/isAuditor branch.
    test('ADMIN reaches the audit context regardless of auditorId assignment', async () => {
        mockAudits.set('aud-appctx-5', {
            id: 'aud-appctx-5', applicationId: 'app-781', auditorId: 'user-A', organizationId: 'org-1', status: 'IN_PROGRESS',
            createdAt: new Date('2026-08-17T03:00:00.000Z'),
            application: { id: 'app-781', applicationNumber: 'GACP-2026-00781', formData: { applicantName: 'Admin Test' } },
        });
        wireResolverByApplicationId();

        const res = await request(buildApp())
            .get('/api/audit/onsite/application/app-781/context')
            .set('x-test-role', 'system_admin_dtam').set('x-test-user-id', 'admin-1');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.audit.id).toBe('aud-appctx-5');
    });

    test('returns 404 AUDIT_NOT_FOUND when the resolver finds no audit for the applicationId', async () => {
        wireResolverByApplicationId();

        const res = await request(buildApp())
            .get('/api/audit/onsite/application/app-does-not-exist/context')
            .set('x-test-role', 'field_inspector').set('x-test-user-id', 'user-1');

        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ success: false, code: 'AUDIT_NOT_FOUND' });
    });
});

/**
 * หลักฐานที่ระบบเก็บไว้ครบ แต่ไม่มีใครเปิดดูได้
 *
 * ระบบวัด "ภาพใบนี้ถ่ายห่างจากฟาร์มกี่เมตร" ของภาพตรวจแปลงทุกใบ และเก็บลงคอลัมน์จริง
 * (`farmDistanceMeters` / `farmDistanceStatus` — audit-onsite-service.capturePhotoProvenance)
 * พร้อมเวลาถ่ายและ perceptual hash · แล้วมีฟังก์ชัน `reviewPhotoProvenance` ที่แปลงแถวพวกนั้น
 * เป็นคำตัดสินให้คนอ่าน ตามที่คอมเมนต์ของมันเขียนไว้เองว่า "reads them back for a human"
 *
 * วัดเมื่อ 2026-09-07: ฟังก์ชันนั้นถูกเรียกจาก **เทสของตัวเองเท่านั้น** — 8 จุดใน
 * __tests__/unit/onsite-photo-provenance.test.js และศูนย์จุดใน routes/ หรือ services/
 * ⇒ ไม่มีประตูใดในระบบที่ทำให้มนุษย์คนไหนเห็นข้อมูลนี้ได้เลย
 *
 * ผลจริงที่ตามมา: เดินตรวจแปลงจนออกใบรับรองได้บน demo เมื่อ 2026-09-07 โดยอัปโหลดภาพ 6 ใบ
 * พร้อมพิกัดที่ไคลเอนต์กรอกเอง ระบบวัดระยะและบันทึกไว้เรียบร้อย แล้วไม่มีใครได้เห็นตัวเลขนั้น
 * ก่อนออกใบรับรอง · เป็นตระกูล "มีแต่ไม่คุ้มครอง": ชุดทดสอบเขียวเพราะฟังก์ชันทำงานถูก
 * แต่ฟีเจอร์ไม่มีอยู่จริงสำหรับผู้ใช้คนใด
 *
 * ประตูนี้เป็นแบบอ่านอย่างเดียว และไม่ตัดสินแทนคน — การจะให้ระยะทางเกินพิกัด "ปฏิเสธ"
 * การตรวจเลยเป็นมติของ operator เพราะฟาร์มที่ไม่มีพิกัดในระบบจะถูกบล็อกไปด้วย
 */
describe('GET /:auditId/photo-provenance — หลักฐานภาพที่วัดไว้ ต้องมีคนเปิดดูได้', () => {
    const PHOTO_ROWS = [
        {
            id: 'photo-near', createdAt: new Date('2026-09-07T07:00:00.000Z'),
            capturedAt: new Date('2026-09-07T07:00:00.000Z'), uploadedBy: 'user-1',
            fileHash: 'hash-a', gpsLatitude: 18.7953, gpsLongitude: 98.9986,
            farmDistanceMeters: 42, farmDistanceStatus: 'MEASURED',
            captureTimeSource: 'SUPPLIED', captureWindowSource: 'INSPECTION_START',
            captureWindowStatus: 'WITHIN_WINDOW', captureWindowOffsetSec: 120,
            perceptualHash: null, perceptualHashAlgo: null,
        },
        {
            id: 'photo-far', createdAt: new Date('2026-09-07T07:05:00.000Z'),
            capturedAt: new Date('2026-09-07T07:05:00.000Z'), uploadedBy: 'user-1',
            fileHash: 'hash-b', gpsLatitude: 13.7563, gpsLongitude: 100.5018,
            farmDistanceMeters: 580000, farmDistanceStatus: 'MEASURED',
            captureTimeSource: 'SUPPLIED', captureWindowSource: 'INSPECTION_START',
            captureWindowStatus: 'WITHIN_WINDOW', captureWindowOffsetSec: 400,
            perceptualHash: null, perceptualHashAlgo: null,
        },
    ];

    test('ผู้ตรวจแปลงเปิดดูระยะทางที่วัดไว้ของภาพแต่ละใบได้', async () => {
        mockPhotos.set('aud-prov-1', PHOTO_ROWS);

        const response = await request(buildApp())
            .get('/api/audit/onsite/aud-prov-1/photo-provenance')
            .set('x-test-role', 'field_inspector')
            .set('x-test-user-id', 'user-1');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        const photos = response.body.data.photos;
        expect(photos).toHaveLength(2);
        expect(photos[0].place.distanceMeters).toBe(42);
        expect(photos[0].place.beyondTolerance).toBe(false);
    });

    test('ภาพที่ถ่ายไกลจากฟาร์มถูกทำเครื่องหมายไว้ให้คนตัดสินเห็น', async () => {
        mockPhotos.set('aud-prov-2', PHOTO_ROWS);

        const response = await request(buildApp())
            .get('/api/audit/onsite/aud-prov-2/photo-provenance')
            .set('x-test-role', 'field_inspector')
            .set('x-test-user-id', 'user-1');

        expect(response.status).toBe(200);
        const far = response.body.data.photos.find((p) => p.photoId === 'photo-far');
        expect(far.place.beyondTolerance).toBe(true);
        expect(far.place.distanceMeters).toBe(580000);
    });

    test('คนนอกทีมตรวจเปิดไม่ได้', async () => {
        mockPhotos.set('aud-prov-3', PHOTO_ROWS);

        const response = await request(buildApp())
            .get('/api/audit/onsite/aud-prov-3/photo-provenance')
            .set('x-test-role', 'finance_officer_dtam')
            .set('x-test-user-id', 'user-9');

        expect(response.status).toBe(403);
    });

    test('ฟังก์ชันที่มีเทสครบแต่ไม่มีประตู เท่ากับไม่มีฟีเจอร์ — ประตูต้องเรียกมันจริง', () => {
        const src = fs.readFileSync(
            path.resolve(__dirname, '../../routes/api/audit/onsite.js'), 'utf8',
        );
        expect(src).toContain('reviewPhotoProvenance');
    });
});
