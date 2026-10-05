/**
 * ผู้อนุมัติคำขออนุโลม (waiver-reopen) — การเงินได้ทั้งสองฝั่ง (operator 2026-09-27)
 *
 * คำตัดสิน (AskUserQuestion): "การเงินได้ทั้งสองฝั่ง" — finance_officer_dtam และ
 * finance_officer_platform อนุมัติ/ปฏิเสธได้ทั้งคู่ · ห้ามอนุมัติเรื่องที่ตัวเองยื่นเหมือนเดิม
 * และช่องทางนี้ยังไม่มีการคืนเงินและไม่มีการเรียกเก็บใหม่ (service ไม่ถูกแตะส่วนนั้น)
 *
 * ยิงผ่าน router จริง `routes/api/provider/waiver-reopen.js` + ด่านจริงใน
 * `services/waiver-reopen-service.js` (assertApprover + ตรวจแถว User สด) บน prisma ปลอม
 * ของปลอม: การยืนยันตัวตน (หัว x-test-role / x-test-user-id) · ชั้นข้อมูล · การแจ้งเตือน
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
    const headerUser = (req, res, next) => {
        const role = req.headers['x-test-role'];
        if (!role) { return res.status(401).json({ success: false, error: 'Unauthorized' }); }
        req.user = { id: req.headers['x-test-user-id'] || `user-${role}`, role, organizationId: 'org-1' };
        return next();
    };
    return { authenticateProvider: headerUser, authenticateHealth: headerUser, authenticate: headerUser };
});
jest.mock('../../services/notification-service', () => ({
    sendNotification: jest.fn().mockResolvedValue(null),
    NotifyType: new Proxy({}, { get: (_t, k) => String(k) }),
}));
jest.mock('../../services/work-activity-service', () => ({
    createAdHocActivity: jest.fn().mockResolvedValue(null),
    completeAdHocActivity: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../services/application-status-writer', () => ({ writeApplicationStatus: jest.fn() }));
jest.mock('../../middleware/audit-logger', () => ({ statusTransitionAuditHook: jest.fn(() => jest.fn()) }));
jest.mock('../../services/phase-billing-service', () => ({
    ...jest.requireActual('../../services/phase-billing-service'),
    computePhaseSettlement: jest.fn(),
}));
jest.mock('../../services/invoice-service', () => ({ listSettlementsForApplication: jest.fn().mockResolvedValue([]) }));
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

// แถว User สด — id → { role, status } (ด่าน "ยังปฏิบัติงานอยู่" อ่านตรงนี้ ไม่ใช่จากโทเคน)
const mockUsers = new Map();
let mockRequestedBy = 'inspector-1';
const mockRequestUpdate = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        waiverReopenRequest: {
            findFirst: () => Promise.resolve({
                id: 'REQ-1', applicationId: 'APP-1', organizationId: 'org-1', status: 'PENDING',
                requestedBy: mockRequestedBy, expiredFromState: 'REVISION_REQUESTED',
            }),
            update: (args) => { mockRequestUpdate(args); return Promise.resolve({ id: 'REQ-1', ...args.data }); },
        },
        user: {
            findFirst: ({ where }) => {
                const row = mockUsers.get(where.id);
                if (!row) { return Promise.resolve(null); }
                const roleOk = !where.role || (where.role.in ? where.role.in.includes(row.role) : where.role === row.role);
                const statusOk = !where.status || where.status === row.status;
                const orgOk = !where.organizationId || where.organizationId === 'org-1';
                return Promise.resolve(roleOk && statusOk && orgOk ? { id: where.id } : null);
            },
        },
        application: { findFirst: () => Promise.resolve(null) },
    },
}));

const D = 'finance_officer_dtam';
const P = 'finance_officer_platform';
const NON_FINANCE = ['health', 'document_reviewer', 'dispatcher', 'field_inspector', 'certificate_approver', 'system_admin_dtam', 'system_admin_platform'];
const DENY_NOTE = { note: 'เหตุผลการปฏิเสธที่ยาวพอ' };

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/provider/waiver-reopen', require('../../routes/api/provider/waiver-reopen'));
    return app;
}

function asUser(req, role, id) {
    mockUsers.set(id, { role, status: 'ACTIVE' });
    return req.set('x-test-role', role).set('x-test-user-id', id);
}

describe('waiver-reopen — การเงินทั้งสองฝั่งเป็นผู้อนุมัติได้ (operator 2026-09-27)', () => {
    const app = buildApp();

    beforeEach(() => {
        mockUsers.clear();
        mockRequestUpdate.mockClear();
        mockRequestedBy = 'inspector-1';
    });

    test.each([[D, 'DTAM'], [P, 'PLATFORM']])('%s ปฏิเสธคำขอได้ และบันทึก approverSide ตามจริง (%s)', async (role, side) => {
        const res = await asUser(request(app).post('/api/provider/waiver-reopen/requests/REQ-1/deny'), role, `acct-${role}`)
            .send(DENY_NOTE);
        expect(res.status).toBe(200);
        expect(mockRequestUpdate).toHaveBeenCalledTimes(1);
        expect(mockRequestUpdate.mock.calls[0][0].data).toMatchObject({ status: 'DENIED', decidedBy: `acct-${role}`, approverSide: side });
    });

    test.each([D, P])('%s ผ่านด่านผู้อนุมัติบนประตู approve (ไปถึงขั้นหาใบสมัคร → 404)', async (role) => {
        const res = await asUser(request(app).post('/api/provider/waiver-reopen/requests/REQ-1/approve'), role, `acct-${role}`)
            .send({});
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NOT_FOUND');
    });

    test.each([D, P])('%s อนุมัติ/ปฏิเสธเรื่องที่ตัวเองยื่นไม่ได้ → 403 WAIVER_SELF_APPROVAL', async (role) => {
        mockRequestedBy = `acct-${role}`;
        for (const action of ['approve', 'deny']) {
            const res = await asUser(request(app).post(`/api/provider/waiver-reopen/requests/REQ-1/${action}`), role, `acct-${role}`)
                .send(DENY_NOTE);
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('WAIVER_SELF_APPROVAL');
        }
        expect(mockRequestUpdate).not.toHaveBeenCalled();
    });

    test.each([D, P])('%s ที่แถว User ถูกระงับแล้ว (โทเคนยังอ้างบทบาทเดิม) → 403 WAIVER_APPROVER_NOT_ACTIVE', async (role) => {
        mockUsers.set(`acct-${role}`, { role, status: 'SUSPENDED' });
        const res = await request(app).post('/api/provider/waiver-reopen/requests/REQ-1/deny')
            .set('x-test-role', role).set('x-test-user-id', `acct-${role}`).send(DENY_NOTE);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('WAIVER_APPROVER_NOT_ACTIVE');
        expect(mockRequestUpdate).not.toHaveBeenCalled();
    });

    test.each(NON_FINANCE)('%s ไม่ใช่การเงิน → 403 ทั้ง approve / deny / คิว', async (role) => {
        for (const [method, url] of [
            ['post', '/api/provider/waiver-reopen/requests/REQ-1/approve'],
            ['post', '/api/provider/waiver-reopen/requests/REQ-1/deny'],
            ['get', '/api/provider/waiver-reopen/requests'],
        ]) {
            const res = await asUser(request(app)[method](url), role, `u-${role}`).send(DENY_NOTE);
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('WAIVER_APPROVER_ROLE');
        }
        expect(mockRequestUpdate).not.toHaveBeenCalled();
    });
});
