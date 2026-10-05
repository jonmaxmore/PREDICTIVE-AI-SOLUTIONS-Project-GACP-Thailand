'use strict';

/**
 * Defect batch B item 3 — reassigning an inspector must move the evidence row too.
 *
 * POST /audits-reassign/:id/reassign wrote Application.auditorId only. The AuditChecklist
 * row armed at scheduling kept the OLD inspector's id, and every field-app door
 * (context / start / photo / decision) compares AuditChecklist.auditorId with the caller
 * (audit-onsite-service._ensureAuditorMatches, onsite.js) -> the NEW inspector got
 * 403 AUDIT_AUDITOR_MISMATCH on the audit he had just been given.
 *
 * Both writes now happen in ONE transaction.
 *
 * Why this is a unit test and not a real-Postgres one: no suite under __tests__/integration
 * covers the audit-reassign door or AuditChecklist (grep: zero hits for "reassign" or
 * "auditChecklist" in *-real-postgres.test.js), so there is no harness to extend; and this
 * session had no reachable Postgres. The atomicity claim here is therefore proven by what
 * the code hands to $transaction (same tx client for both writes), not by a rollback on a
 * real database. Stated, not hidden.
 */

describe('audits-reassign: Application.auditorId and AuditChecklist.auditorId move together', () => {
    let request;
    let express;
    let store;
    let order;
    let mockTrackedUpdate;
    let tx;
    let prisma;
    let reviewerId;

    const baseApp = () => ({
        id: 'APP-1',
        applicationNumber: 'GACP-2569-0007',
        status: 'AUDIT_CONFIRMED',
        auditorId: 'insp-old',
        reviewerId,
        organizationId: 'org-1',
        formData: {},
        applicant: { id: 'applicant-1', firstName: 'เกษตรกร', lastName: 'ทดสอบ' },
    });

    beforeEach(() => {
        jest.resetModules();
        reviewerId = 'rev-1';
        order = [];
        store = [
            { id: 'chk-live', applicationId: 'APP-1', auditorId: 'insp-old', status: 'IN_PROGRESS', isDeleted: false },
            { id: 'chk-decided', applicationId: 'APP-1', auditorId: 'insp-old', status: 'SUBMITTED', isDeleted: false },
            { id: 'chk-gone', applicationId: 'APP-1', auditorId: 'insp-old', status: 'IN_PROGRESS', isDeleted: true },
            { id: 'chk-other', applicationId: 'APP-2', auditorId: 'insp-old', status: 'IN_PROGRESS', isDeleted: false },
        ];
        tx = {
            auditChecklist: {
                updateMany: jest.fn(async ({ where, data }) => {
                    order.push('rebind');
                    let count = 0;
                    store.forEach((r) => {
                        if ((!where.applicationId || r.applicationId === where.applicationId)
                            && (where.isDeleted === undefined || r.isDeleted === where.isDeleted)
                            && (!where.status || r.status === where.status)) {
                            Object.assign(r, data); count += 1;
                        }
                    });
                    return { count };
                }),
            },
        };
        prisma = { $transaction: jest.fn(async (cb) => cb(tx)) };
        mockTrackedUpdate = jest.fn(async (args) => { order.push(args.prisma === tx ? 'tracked-in-tx' : 'tracked-OUTSIDE-tx'); return {}; });

        jest.doMock('../../shared/logger', () => {
            const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
            return { ...l, createLogger: jest.fn(() => l) };
        });
        jest.doMock('../../services/prisma-database', () => ({ prisma }));
        jest.doMock('../../middleware/auth-middleware', () => ({
            authenticateProvider: (req, _res, next) => {
                req.user = { id: 'disp-1', role: 'dispatcher', canonicalRole: 'dispatcher', organizationId: 'org-1' };
                next();
            },
        }));
        jest.doMock('../../middleware/role-middleware', () => ({ providerOnly: (_q, _r, n) => n() }));
        jest.doMock('../../services/tracked-writer', () => ({ trackedUpdate: (...a) => mockTrackedUpdate(...a) }));
        jest.doMock('../../middleware/audit-logger', () => ({
            auditLogger: { log: jest.fn() },
            AuditCategory: { APPLICATION: 'APPLICATION' },
            AuditSeverity: { HIGH: 'HIGH' },
            ResourceType: { APPLICATION: 'APPLICATION' },
        }));
        jest.doMock('../../services/application-service', () => ({
            findAuditApplication: jest.fn(async () => baseApp()),
            listReassignableAudits: jest.fn().mockResolvedValue([]),
        }));
        jest.doMock('../../services/provider-user-service', () => ({
            findReassignmentTargetUser: jest.fn(async ({ id }) => ({
                id, isDeleted: false, status: 'ACTIVE', providerId: 'P-1', role: 'field_inspector', firstName: 'ผู้ตรวจ', lastName: 'ใหม่',
            })),
        }));
        jest.doMock('../../services/assignment-ledger-service', () => ({ recordAssignment: jest.fn().mockResolvedValue(null) }));
        jest.doMock('../../services/notification-service', () => ({
            sendNotification: jest.fn().mockResolvedValue({ id: 'n' }),
            NotifyType: new Proxy({}, { get: (_t, k) => String(k) }),
        }));
        express = require('express');
        request = require('supertest');
    });

    const appFor = () => {
        const app = express();
        app.use(express.json());
        app.use('/audits-reassign', require('../../routes/api/audit/audits-reassign'));
        return app;
    };

    test('the live evidence row now names the new inspector; decided / deleted / other-application rows are untouched', async () => {
        const res = await request(appFor()).post('/audits-reassign/APP-1/reassign').send({ newAuditorId: 'insp-new', reason: 'ผู้ตรวจเดิมลาป่วย' });
        expect(res.status).toBe(200);
        const byId = Object.fromEntries(store.map((r) => [r.id, r.auditorId]));
        expect(byId['chk-live']).toBe('insp-new');
        expect(byId['chk-decided']).toBe('insp-old');
        expect(byId['chk-gone']).toBe('insp-old');
        expect(byId['chk-other']).toBe('insp-old');
    });

    test('both writes run on the SAME transaction client', async () => {
        await request(appFor()).post('/audits-reassign/APP-1/reassign').send({ newAuditorId: 'insp-new', reason: 'ผู้ตรวจเดิมลาป่วย' });
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(order).toEqual(['tracked-in-tx', 'rebind']);
    });

    test('a failure of the second write fails the request (nothing reports success)', async () => {
        tx.auditChecklist.updateMany.mockRejectedValueOnce(new Error('boom'));
        prisma.$transaction.mockImplementationOnce(async (cb) => cb(tx));
        const res = await request(appFor()).post('/audits-reassign/APP-1/reassign').send({ newAuditorId: 'insp-new', reason: 'ผู้ตรวจเดิมลาป่วย' });
        expect(res.status).toBe(500);
    });

    test('item 7: the application\'s own document reviewer cannot be given the inspection (409, Thai catalogue error, no write)', async () => {
        const res = await request(appFor()).post('/audits-reassign/APP-1/reassign').send({ newAuditorId: 'rev-1', reason: 'ผู้ตรวจเดิมลาป่วย' });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('INSPECTOR_IS_APPLICATION_REVIEWER');
        expect(res.body.messageTh).toMatch(/[฀-๿]/);
        expect(mockTrackedUpdate).not.toHaveBeenCalled();
        expect(store.find((r) => r.id === 'chk-live').auditorId).toBe('insp-old');
    });
});
