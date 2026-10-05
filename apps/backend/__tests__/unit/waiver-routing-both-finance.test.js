/**
 * E4 (engineering review 2026-09-27) — คำขออนุโลมต้องไปถึงการเงินทั้งสองฝั่ง
 *
 * operator 2026-09-27 (B) "การเงินได้ทั้งสองฝั่ง" ทำให้การเงินบริษัทตัดสินคำขออนุโลมได้ แต่
 * สัญญาณทั้งสามทางยังส่งถึงการเงินกรมอย่างเดียว ⇒ การเงินบริษัทมีอำนาจแต่ไม่มีทางรู้ว่ามีคำขอรอ:
 *   1. แจ้งเตือนคำขอใหม่ (routes/api/provider/waiver-reopen.js)
 *   2. ยกระดับ SLA ทุกวัน (jobs/waiver-sla-escalation-job.js)
 *   3. งานใน inbox /provider/work (candidateGroup ของ WAIVER_APPROVAL)
 *
 * ของจริง: router waiver-reopen · SLA job · user-groups · ตัวเลือกผู้รับ (services/waiver-approvers)
 * ของปลอม: การยืนยันตัวตน · prisma (ตาราง user ขนาดเล็กที่กรองตาม where จริง) · การส่งแจ้งเตือน
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (req, res, next) => {
        req.user = { id: 'inspector-1', role: 'field_inspector', organizationId: 'org-1' };
        return next();
    },
}));
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});
const mockSent = [];
jest.mock('../../services/notification-service', () => ({
    sendNotification: (userId, type) => { mockSent.push({ userId, type }); return Promise.resolve({ id: 'n' }); },
    NotifyType: new Proxy({}, { get: (_t, k) => String(k) }),
}));
jest.mock('../../services/waiver-reopen-service', () => ({
    createReopenRequest: () => Promise.resolve({
        request: { id: 'REQ-1', reasonCode: 'LENIENCY', status: 'PENDING' },
        application: { id: 'APP-1', applicationNumber: 'GACP-1', organizationId: 'org-1' },
    }),
}));

// ตาราง user ขนาดเล็ก — กรองตาม where.role / where.organizationId / status / isDeleted จริง
const MOCK_USERS = [
    { id: 'fin-dtam-1', role: 'finance_officer_dtam', organizationId: 'org-1', status: 'ACTIVE', isDeleted: false, isLocked: false },
    { id: 'fin-plat-1', role: 'finance_officer_platform', organizationId: 'org-1', status: 'ACTIVE', isDeleted: false, isLocked: false },
    { id: 'fin-plat-other-org', role: 'finance_officer_platform', organizationId: 'org-2', status: 'ACTIVE', isDeleted: false, isLocked: false },
    { id: 'fin-plat-suspended', role: 'finance_officer_platform', organizationId: 'org-1', status: 'SUSPENDED', isDeleted: false, isLocked: false },
    { id: 'inspector-1', role: 'field_inspector', organizationId: 'org-1', status: 'ACTIVE', isDeleted: false, isLocked: false },
    { id: 'reviewer-1', role: 'document_reviewer', organizationId: 'org-1', status: 'ACTIVE', isDeleted: false, isLocked: false },
];
function mockMatch(row, where) {
    return Object.entries(where || {}).every(([k, v]) => {
        if (v && typeof v === 'object' && Array.isArray(v.in)) { return v.in.includes(row[k]); }
        if (v && typeof v === 'object') { return true; }
        return row[k] === v;
    });
}
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: {
            findMany: ({ where }) => Promise.resolve(MOCK_USERS.filter((u) => mockMatch(u, where)).map((u) => ({ id: u.id }))),
            findFirst: ({ where }) => Promise.resolve(MOCK_USERS.find((u) => mockMatch(u, where)) || null),
            findUnique: ({ where }) => Promise.resolve(MOCK_USERS.find((u) => u.id === where.id) || null),
        },
        roleGroup: { findMany: () => Promise.resolve([]), findFirst: () => Promise.resolve(null) },
        userGroupMembership: { findMany: () => Promise.resolve([]) },
        waiverReopenRequest: {
            findMany: () => Promise.resolve([{
                id: 'REQ-OLD', organizationId: 'org-1', requestedBy: 'inspector-1', reasonCode: 'LENIENCY',
                createdAt: '2026-01-05T00:00:00Z', application: { applicationNumber: 'GACP-1' },
            }]),
        },
    },
}));

const FINANCE_ORG_1 = ['fin-dtam-1', 'fin-plat-1'];

describe('E4 — ผู้รับสัญญาณคำขออนุโลม = การเงินทั้งสองฝั่งของ org เดียวกัน', () => {
    beforeEach(() => { mockSent.length = 0; });

    test('แจ้งเตือนคำขอใหม่ (router จริง) ถึงการเงินกรม + การเงินบริษัท ไม่ข้าม org ไม่ถึงคนที่ถูกระงับ', async () => {
        const app = express();
        app.use(express.json());
        app.use('/api/provider/waiver-reopen', require('../../routes/api/provider/waiver-reopen'));
        const res = await request(app).post('/api/provider/waiver-reopen/applications/APP-1/requests').send({ reason: 'เหตุผลการขออนุโลมที่ยาวพอ' });
        expect(res.status).toBe(201);
        const got = mockSent.filter((s) => s.type === 'WAIVER_REOPEN_REQUESTED').map((s) => s.userId).sort();
        expect(got).toEqual([...FINANCE_ORG_1].sort());
    });

    test('ยกระดับ SLA (job จริง) ถึงการเงินทั้งสองฝั่ง + ผู้ยื่นเรื่อง', async () => {
        const { runWaiverSlaEscalation } = require('../../jobs/waiver-sla-escalation-job');
        await runWaiverSlaEscalation({ now: new Date('2026-09-27T00:00:00Z') });
        const got = mockSent.filter((s) => s.type === 'WAIVER_REOPEN_SLA_OVERDUE').map((s) => s.userId).sort();
        expect(got).toEqual([...FINANCE_ORG_1, 'inspector-1'].sort());
    });

    test('งาน WAIVER_APPROVAL ใน inbox: กลุ่มผู้รับเห็นและรับงานได้ทั้งสองฝั่ง แต่ไม่ใช่บทบาทอื่น', async () => {
        const userGroups = require('../../shared/user-groups');
        const { WAIVER_APPROVAL_GROUP } = require('../../services/waiver-approvers');
        const { prisma } = require('../../services/prisma-database');
        expect(await userGroups.userInGroup(prisma, 'fin-dtam-1', WAIVER_APPROVAL_GROUP)).toBe(true);
        expect(await userGroups.userInGroup(prisma, 'fin-plat-1', WAIVER_APPROVAL_GROUP)).toBe(true);
        expect(await userGroups.userInGroup(prisma, 'inspector-1', WAIVER_APPROVAL_GROUP)).toBe(false);
        expect(await userGroups.userInGroup(prisma, 'reviewer-1', WAIVER_APPROVAL_GROUP)).toBe(false);
        // listGroupMemberUserIds คัดตาม org + ไม่ถูกลบ/ล็อก (ไม่ดู status เหมือนทุกกลุ่ม) — ต้องมีการเงินทั้งสองฝั่ง
        // ของ org-1 และไม่มีบทบาทอื่นหรือ org อื่น
        const members = await userGroups.listGroupMemberUserIds(prisma, 'org-1', WAIVER_APPROVAL_GROUP);
        expect(members).toEqual(expect.arrayContaining(FINANCE_ORG_1));
        for (const other of ['inspector-1', 'reviewer-1', 'fin-plat-other-org']) { expect(members).not.toContain(other); }
        expect(await userGroups.getUserGroups(prisma, 'fin-plat-1')).toContain(WAIVER_APPROVAL_GROUP);
    });

    test('services/waiver-reopen-service สร้างงาน inbox ด้วยกลุ่มผู้อนุมัติร่วม ไม่ใช่การเงินกรมอย่างเดียว', () => {
        const src = require('fs').readFileSync(require('path').join(__dirname, '../../services/waiver-reopen-service.js'), 'utf8');
        expect(src).toMatch(/candidateGroup:\s*WAIVER_APPROVAL_GROUP/);
        expect(src).not.toMatch(/candidateGroup:\s*CANONICAL_ROLES\.FINANCE_OFFICER_DTAM/);
    });
});
