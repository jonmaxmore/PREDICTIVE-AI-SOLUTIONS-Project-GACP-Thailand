'use strict';

/**
 * provider-UAT-round2 2026-07-09 cluster — admin-mutation AuditLog gap.
 *
 * Four privileged admin mutations changed state / blasted messages but left no
 * IMMUTABLE hash-chained AuditLog row (attribution lived only in mutable
 * workflowHistory JSON, a hardcoded updatedBy='ADMIN', or fire-and-forget
 * notification rows). Each now emits an audit record:
 *
 *   - PATCH /admin/config/:key  → real actorId + SYSTEM_CONFIG_UPDATED
 *   - admin batch-actions       → onAudit hook, atomic per-write tx
 *   - admin deadline extension  → ADMIN_DEADLINE_EXTENSION
 *   - admin broadcast           → ADMIN_BROADCAST_SENT
 */

describe('PATCH /admin/config/:key stamps the real actor + emits SYSTEM_CONFIG_UPDATED', () => {
    let express;
    let mockUpsert;
    let mockAuditLog;

    beforeEach(() => {
        jest.resetModules();
        mockUpsert = jest.fn().mockResolvedValue({ key: 'FEATURE_X', value: 'true' });
        mockAuditLog = jest.fn().mockResolvedValue({ id: 'a-1' });

        jest.doMock('../../shared/logger', () => {
            const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
            return { ...l, createLogger: jest.fn(() => l) };
        });
        jest.doMock('../../services/prisma-database', () => ({
            prisma: { systemConfig: { upsert: (...a) => mockUpsert(...a) } },
        }));
        jest.doMock('../../services/cache-service', () => ({
            getOrSet: jest.fn(), del: jest.fn().mockResolvedValue(undefined),
        }));
        jest.doMock('../../middleware/audit-logger', () => ({
            auditLogger: { log: (...a) => mockAuditLog(...a) },
            AuditCategory: { ADMIN: 'ADMIN' },
            AuditSeverity: { WARNING: 'WARNING' },
        }));
        jest.doMock('../../utils/client-ip', () => ({ getRequestIp: () => '1.2.3.4' }));

        express = require('supertest');
    });

    function buildApp() {
        const app = require('express')();
        app.use(require('express').json());
        // config router has no inline auth (auth is applied at mount upstream) —
        // inject a req.user so we can assert the real actor is stamped.
        app.use((req, _res, next) => {
            req.user = { id: 'admin-99', role: 'admin', canonicalRole: 'admin' };
            next();
        });
        app.use('/admin/config', require('../../routes/api/admin/config'));
        return app;
    }

    test('upsert uses req.user.id (not the hardcoded "ADMIN") + audit row emitted', async () => {
        const res = await express(buildApp())
            .patch('/admin/config/FEATURE_X')
            .send({ value: 'true', type: 'BOOLEAN' });

        expect(res.status).toBe(200);
        // Real actor stamped in BOTH update + create branches of the upsert.
        const call = mockUpsert.mock.calls[0][0];
        expect(call.update.updatedBy).toBe('admin-99');
        expect(call.create.updatedBy).toBe('admin-99');

        expect(mockAuditLog).toHaveBeenCalledTimes(1);
        const audit = mockAuditLog.mock.calls[0][0];
        expect(audit.action).toBe('SYSTEM_CONFIG_UPDATED');
        expect(audit.actorId).toBe('admin-99');
        expect(audit.resourceId).toBe('FEATURE_X');
        // The config VALUE must NOT be logged (could be a secret).
        expect(JSON.stringify(audit)).not.toContain('"value"');
    });
});

describe('admin handlers emit immutable AuditLog rows', () => {
    let mockAuditLog;
    let mockWriteApplicationStatus;
    let mockTxRun;
    let adminHandlers;
    let broadcastHandlers;

    // obj/arr mirror ./shared helpers (coerce to {}/[]).
    const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    const arr = (v) => (Array.isArray(v) ? v : []);

    beforeEach(() => {
        jest.resetModules();
        mockAuditLog = jest.fn().mockResolvedValue({ id: 'a-1' });
        mockWriteApplicationStatus = jest.fn().mockResolvedValue({});
        // $transaction(cb) → runs cb with a tx stub, records that it ran.
        mockTxRun = jest.fn(async (cb) => cb({ __tx: true }));

        const loggerStub = () => {
            const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
            return { ...l, createLogger: jest.fn(() => l) };
        };

        // ./shared — resolved to the SAME absolute module the handler requires.
        jest.doMock('../../routes/api/provider/handlers/shared', () => ({
            prisma: { $transaction: (...a) => mockTxRun(...a) },
            authenticateProvider: (_req, _res, next) => next(),
            requireRole: () => (_req, _res, next) => next(),
            logger: loggerStub(),
            adminRoles: [],
            resolveUserIdFromHealthId: jest.fn(),
            obj,
            arr,
        }));
        jest.doMock('../../services/application-status-writer', () => ({
            writeApplicationStatus: (...a) => mockWriteApplicationStatus(...a),
        }));
        jest.doMock('../../middleware/audit-logger', () => ({
            // statusTransitionAuditHook returns a hook that, when called, would
            // logWithin(tx). We only need to assert it is passed + is a function.
            statusTransitionAuditHook: ({ tx, metadata } = {}) => {
                const hook = () => {};
                hook.__tx = tx; hook.__metadata = metadata;
                return hook;
            },
            auditLogger: { log: (...a) => mockAuditLog(...a) },
            AuditCategory: { APPLICATION: 'APPLICATION', ADMIN: 'ADMIN' },
            AuditSeverity: { WARNING: 'WARNING' },
        }));
        jest.doMock('../../utils/client-ip', () => ({ getRequestIp: () => '1.2.3.4' }));
        jest.doMock('../../services/workflow-transition-service', () => ({ WORKFLOW_STATES: ['ASSIGNED_FOR_REVIEW', 'REVISION_REQUESTED'] }));
        jest.doMock('../../services/notification-service', () => ({
            createNotification: jest.fn(),
            createBulkNotifications: jest.fn().mockResolvedValue({ count: 2 }),
            listRecentAdminBroadcasts: jest.fn().mockResolvedValue([]),
        }));
        jest.doMock('../../services/admin-application-service', () => ({
            findApplicationsByIds: jest.fn().mockResolvedValue([
                { id: 'APP-1', status: 'ASSIGNED_FOR_REVIEW', formData: {}, workflowHistory: [], organizationId: 'org-1' },
            ]),
            findLatestPendingRevisionDeadline: jest.fn().mockResolvedValue({ id: 'D-1', revisionDue: new Date('2026-07-10T00:00:00Z') }),
            updateRevisionDeadlineDue: jest.fn().mockResolvedValue({}),
            findApplicationWorkflowSlice: jest.fn().mockResolvedValue({ workflowHistory: [] }),
            appendWorkflowHistoryOnly: jest.fn().mockResolvedValue({}),
        }));
        jest.doMock('../../services/assignment-ledger-service', () => ({ recordAssignment: jest.fn().mockResolvedValue(null) }));
        jest.doMock('../../services/provider-user-service', () => ({
            findReassignmentTargetUser: jest.fn(),
            listUserIdsForBroadcast: jest.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]),
        }));
        // 2026-09-10 — mock ตัวนี้เคยส่งคืนแค่ normalizeRole ทำให้ admin.js ที่อ่าน
        // CANONICAL_ROLES ตอนโหลดโมดูลระเบิดเป็น TypeError · คำศัพท์บทบาทเป็นสัญญา
        // ไม่ใช่รายละเอียดที่ควรถูกปลอม — ใช้ของจริง แล้วทับเฉพาะพฤติกรรมที่เทสต้องคุม
        jest.doMock('../../shared/canonical-rbac', () => ({
            ...jest.requireActual('../../shared/canonical-rbac'),
            normalizeRole: (r) => String(r || '').toLowerCase(),
        }));

        adminHandlers = require('../../routes/api/provider/handlers/admin');
        broadcastHandlers = require('../../routes/api/provider/handlers/communication');
    });

    // Grab the actual handler (last element of the [auth, role, handler] array).
    const handlerOf = (arrHandlers) => arrHandlers[arrHandlers.length - 1];

    function mockRes() {
        const res = {};
        res.status = jest.fn(() => res);
        res.json = jest.fn(() => res);
        return res;
    }

    test('batch-actions wraps each write in a tx and passes an onAudit hook', async () => {
        const req = {
            body: { applicationIds: ['APP-1'], action: 'REQUEST_DOCUMENTS', reason: 'ขอเอกสารเพิ่ม' },
            user: { id: 'admin-1', role: 'admin', canonicalRole: 'admin' },
        };
        const res = mockRes();
        await handlerOf(adminHandlers.adminBatchActions)(req, res);

        // Each write ran inside its own $transaction.
        expect(mockTxRun).toHaveBeenCalledTimes(1);
        expect(mockWriteApplicationStatus).toHaveBeenCalledTimes(1);
        const writeArgs = mockWriteApplicationStatus.mock.calls[0][0];
        expect(writeArgs.prisma).toEqual({ __tx: true }); // the tx, not the base client
        expect(typeof writeArgs.onAudit).toBe('function'); // audit hook wired
        expect(writeArgs.onAudit.__tx).toEqual({ __tx: true });
        expect(writeArgs.onAudit.__metadata.batchAction).toBe('BATCH_REQUEST_DOCUMENTS');
    });

    test('deadline extension emits ADMIN_DEADLINE_EXTENSION for the application', async () => {
        const req = {
            body: { applicationId: 'APP-1', extensionDays: 5, reason: 'เหตุสุดวิสัย' },
            user: { id: 'admin-1', role: 'admin', canonicalRole: 'admin' },
            get: () => 'jest',
        };
        const res = mockRes();
        await handlerOf(adminHandlers.adminDeadlineExtension)(req, res);

        expect(mockAuditLog).toHaveBeenCalledTimes(1);
        const audit = mockAuditLog.mock.calls[0][0];
        expect(audit.action).toBe('ADMIN_DEADLINE_EXTENSION');
        expect(audit.actorId).toBe('admin-1');
        expect(audit.resourceId).toBe('APP-1');
        expect(audit.metadata.extensionDays).toBe(5);
    });

    test('broadcast emits ADMIN_BROADCAST_SENT with recipient count (not the message body)', async () => {
        const req = {
            body: { subject: 'ประกาศ', message: 'ข้อความถึงทุกคน', targetType: 'role', targetValue: 'auditor' },
            user: { id: 'admin-1', role: 'admin', canonicalRole: 'admin' },
            get: () => 'jest',
        };
        const res = mockRes();
        await handlerOf(broadcastHandlers.adminBroadcast)(req, res);

        expect(mockAuditLog).toHaveBeenCalledTimes(1);
        const audit = mockAuditLog.mock.calls[0][0];
        expect(audit.action).toBe('ADMIN_BROADCAST_SENT');
        expect(audit.resourceId).toBe('BROADCAST');
        expect(audit.metadata.recipientCount).toBe(2);
        // The free-text body must NOT be in the audit row.
        expect(JSON.stringify(audit)).not.toContain('ข้อความถึงทุกคน');
    });
});
