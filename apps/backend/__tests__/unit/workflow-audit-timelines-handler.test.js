/**
 * Handler tests for workflow-audit-timelines-handler — verifies the
 * application-scoped audit timeline now routes through
 * services/audit-trail (canonical service layer) instead of touching
 * prisma.auditLog directly.
 */

'use strict';

function buildRes() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
}

function loadHandler({
    application,
    getTimelineForApplication,
    permitted = true,
} = {}) {
    jest.resetModules();

    const PERMISSIONS = { AUDIT_TIMELINE_READ: 'AUDIT_TIMELINE_READ' };

    // workflow-handler-deps is a fan-out of shared.js + workflow services.
    // Mock the whole module so we don't drag in prisma / workflow code.
    // VIS-1 (2026-06-23): the handler now scopes the lookup via withVisibility +
    // applicationService.findFirstWithWhere (was findApplicationByIdOrNumberTimelineSlice)
    // so a document_reviewer can only read the timelines of applications assigned to it.
    // The real withVisibility runs (not mocked); the `prisma` mock stays as a regression
    // guard — a stray prisma.auditLog.findMany must still throw.
    jest.doMock('../../routes/api/provider/handlers/workflow-handler-deps', () => ({
        prisma: {
            // The handler doesn't touch prisma.auditLog any more — but if it
            // regresses, this jest.fn would surface a hit in test output.
            auditLog: {
                findMany: jest.fn(() => {
                    throw new Error(
                        'Handler must NOT call prisma.auditLog.findMany — use service layer',
                    );
                }),
            },
        },
        applicationService: {
            findFirstWithWhere: jest.fn().mockResolvedValue(application ?? null),
        },
        authenticateProvider: (_req, _res, next) => next(),
        logger: { error: jest.fn() },
        PERMISSIONS,
        requireCanonicalPermission: () => (req, res, next) => {
            if (!permitted) {
                return res.status(403).json({ success: false, error: 'Forbidden' });
            }
            return next();
        },
        obj: (v) => (v && typeof v === 'object' ? v : {}),
        arr: (v) => (Array.isArray(v) ? v : []),
        workflowTransitionService: {
            resolveStateFromApplication: jest.fn(() => 'STATE_FROM_FALLBACK'),
        },
    }));

    const serviceMock = {
        listAuditEvents: jest.fn(),
        exportAuditEvents: jest.fn(),
        getTimelineForApplication: getTimelineForApplication || jest.fn().mockResolvedValue([]),
    };
    jest.doMock('../../services/audit-trail', () => serviceMock);

    const mod = require('../../routes/api/provider/handlers/workflow-audit-timelines-handler');
    const deps = require('../../routes/api/provider/handlers/workflow-handler-deps');
    const chain = mod.applicationsAuditTimelines;
    return {
        chain,
        handler: chain[chain.length - 1],
        permissionMw: chain[1],
        serviceMock,
        findFirstWithWhere: deps.applicationService.findFirstWithWhere,
    };
}

describe('workflow-audit-timelines-handler', () => {
    test('routes through audit-trail.getTimelineForApplication (no direct prisma.auditLog)', async () => {
        const application = {
            id: 'app-uuid-1',
            applicationNumber: 'GACP-001',
            status: 'APPROVED',
            formData: { workflowState: 'CERTIFICATE_ISSUED' },
            workflowHistory: [{ from: 'A', to: 'B' }],
            createdAt: new Date('2026-04-01'),
            updatedAt: new Date('2026-05-01'),
        };
        const getTimelineForApplication = jest.fn().mockResolvedValue([
            {
                id: 'audit-1',
                logId: 'L1',
                sequenceNumber: 1,
                action: 'SUBMIT',
                actorId: 'u-1',
                actorRole: 'APPLICANT',
                createdAt: new Date('2026-04-02'),
                metadata: { source: 'web' },
            },
        ]);

        const { handler, serviceMock } = loadHandler({ application, getTimelineForApplication });

        const req = { params: { id: 'GACP-001' }, user: {} };
        const res = buildRes();

        await handler(req, res);

        // The service was called with the resolved application.id, NOT the URL
        // applicationNumber — the handler resolves the canonical id first.
        expect(serviceMock.getTimelineForApplication).toHaveBeenCalledWith(
            'app-uuid-1',
            expect.objectContaining({ limit: 500 }),
        );
    });

    test('preserves frontend-facing JSON envelope (data.application + auditLogs keys)', async () => {
        const application = {
            id: 'app-uuid-2',
            applicationNumber: 'GACP-002',
            status: 'APPROVED',
            formData: { workflowState: 'AUDIT_PASSED' },
            workflowHistory: [{ from: 'X', to: 'Y' }],
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const createdAt = new Date('2026-04-02');
        const getTimelineForApplication = jest.fn().mockResolvedValue([
            {
                id: 'audit-1',
                logId: 'L1',
                sequenceNumber: 1,
                action: 'SUBMIT',
                actorId: 'u-1',
                actorRole: 'APPLICANT',
                createdAt,
                metadata: '{"source":"web"}', // string metadata — handler must JSON-parse
            },
        ]);

        const { handler } = loadHandler({ application, getTimelineForApplication });
        const req = { params: { id: 'GACP-002' }, user: {} };
        const res = buildRes();

        await handler(req, res);

        expect(res.json).toHaveBeenCalledTimes(1);
        const body = res.json.mock.calls[0][0];

        // Top-level envelope unchanged.
        expect(body.success).toBe(true);
        expect(body.data.application).toEqual({
            id: 'app-uuid-2',
            applicationNumber: 'GACP-002',
            status: 'APPROVED',
            workflowState: 'AUDIT_PASSED',
        });
        expect(body.data.workflowHistory).toEqual([{ from: 'X', to: 'Y' }]);
        // auditLogs mapped to the legacy shape: id/logId/sequenceNumber/action/
        // actorId/actorRole/createdAt/metadata, with metadata JSON-parsed when
        // it's a string. The frontend reads exactly these keys.
        expect(body.data.auditLogs).toEqual([
            {
                id: 'audit-1',
                logId: 'L1',
                sequenceNumber: 1,
                action: 'SUBMIT',
                actorId: 'u-1',
                actorRole: 'APPLICANT',
                createdAt,
                metadata: { source: 'web' },
            },
        ]);
    });

    test('returns 404 when the application is not found (and never hits the audit service)', async () => {
        const { handler, serviceMock } = loadHandler({ application: null });

        const req = { params: { id: 'NOT-FOUND' }, user: {} };
        const res = buildRes();

        await handler(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Application not found' });
        expect(serviceMock.getTimelineForApplication).not.toHaveBeenCalled();
    });

    test('permission middleware returns 403 when the caller lacks AUDIT_TIMELINE_READ', async () => {
        const { permissionMw } = loadHandler({ permitted: false });

        const req = { params: { id: 'X' }, user: { role: 'APPLICANT' } };
        const res = buildRes();
        const next = jest.fn();

        permissionMw(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    // VIS-1: AUDIT_TIMELINE_READ is a FUNCTION permission document_reviewer holds; the
    // lookup must ALSO be data-scoped (withVisibility) so a reviewer can't read a
    // same-tenant peer's workflowHistory + audit log by id.
    test('VIS-1: a document_reviewer lookup is visibility-scoped to its own reviewerId assignments (peer → 404)', async () => {
        // Not visible to this reviewer → findFirstWithWhere yields null → 404.
        const { handler, serviceMock, findFirstWithWhere } = loadHandler({ application: null });
        const req = { params: { id: 'PEER-APP' }, user: { canonicalRole: 'document_reviewer', id: 'u-1' } };
        const res = buildRes();

        await handler(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(serviceMock.getTimelineForApplication).not.toHaveBeenCalled();
        // The query WAS scoped — the where ANDs the reviewer's own-assignment filter.
        const passedWhere = findFirstWithWhere.mock.calls[0][0].where;
        expect(JSON.stringify(passedWhere)).toContain('reviewerId');
    });

    test('VIS-1: the assigned reviewer still sees its own application timeline (scoped query, 200)', async () => {
        const application = {
            id: 'app-mine',
            applicationNumber: 'GACP-MINE',
            status: 'ASSIGNED_FOR_REVIEW',
            formData: {},
            workflowHistory: [],
        };
        const { handler, findFirstWithWhere } = loadHandler({ application });
        const req = { params: { id: 'GACP-MINE' }, user: { canonicalRole: 'document_reviewer', id: 'u-1' } };
        const res = buildRes();

        await handler(req, res);

        const body = res.json.mock.calls[0][0];
        expect(body.success).toBe(true);
        expect(body.data.application.id).toBe('app-mine');
        // Still scoped (the AND filter is applied; this row matched because it's assigned).
        expect(JSON.stringify(findFirstWithWhere.mock.calls[0][0].where)).toContain('reviewerId');
    });
});
