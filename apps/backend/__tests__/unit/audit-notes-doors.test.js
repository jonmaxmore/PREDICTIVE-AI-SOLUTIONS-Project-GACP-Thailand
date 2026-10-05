/**
 * The ม.30 doors on the wire.
 *
 * The service suite proves the rule. This proves the routes reach it, that the applicant's
 * door is scoped to the applicant, that the officer's door is behind staff auth, and that
 * the refusals arrive in a form a farmer can read — `messageTh`, because the envelope
 * strips `message` from every non-2xx body and that is exactly how a refusal reached a
 * farmer as a bare code once already (d183f506).
 */
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => { req.user = { id: 'user-1', healthId: 'health-1', canonicalRole: 'health' }; next(); },
    authenticateProvider: (req, _res, next) => { req.user = { id: 'officer-1', role: 'field_inspector', canonicalRole: 'field_inspector' }; next(); },
    authenticateAny: (req, _res, next) => { req.user = { id: 'user-1' }; next(); },
    requireRole: () => (_q, _s, n) => n(),
}));

const mockAppFindFirst = jest.fn();
const mockItemFindMany = jest.fn();
const mockItemFindUnique = jest.fn();
const mockItemUpdate = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        application: { findFirst: (...a) => mockAppFindFirst(...a) },
        farmAuditChecklistItem: {
            findMany: (...a) => mockItemFindMany(...a),
            findUnique: (...a) => mockItemFindUnique(...a),
            update: (...a) => mockItemUpdate(...a),
        },
    },
}));
jest.mock('../../services/application-service', () => ({
    resolveHealthIdentity: jest.fn(async () => ({ healthId: 'health-1', userId: 'user-1' })),
}));
jest.mock('../../routes/api/helpers/applications-helpers', () => ({
    getHealthScopeOptions: jest.fn((user) => ({ healthId: user.healthId })),
}));
jest.mock('../../shared/logger', () => {
    const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...l, createLogger: () => l };
});

function farmerApp() {
    const a = express();
    a.use(express.json());
    a.use('/api/applications', require('../../routes/api/applications/audit-notes'));
    return a;
}

const DISCLOSED = {
    id: 'item-1', itemCode: 'GAP-1.1', section: 'บุคลากร', response: 'PASS',
    notes: 'อบรมครบตามหลักสูตร', isCritical: false, recordedAt: new Date('2026-08-01T00:00:00Z'),
    disclosureWithheld: false, withholdReason: null,
    audit: { id: 'audit-1', applicationId: 'app-1', submittedAt: null },
};
const WITHHELD = {
    ...DISCLOSED, id: 'item-2', itemCode: 'GAP-2.4', notes: 'เพื่อนบ้านร้องเรียนเรื่องกลิ่น',
    disclosureWithheld: true, withholdReason: 'บันทึกอ้างถึงผู้ร้องเรียนซึ่งเป็นบุคคลที่สาม',
};

beforeEach(() => {
    jest.clearAllMocks();
    mockAppFindFirst.mockResolvedValue({ id: 'app-1' });
    mockItemFindMany.mockResolvedValue([DISCLOSED, WITHHELD]);
});

describe("GET /:id/audit-notes — the applicant's own copy", () => {
    test('returns both rows, and only the withheld one loses its text', async () => {
        const res = await request(farmerApp()).get('/api/applications/app-1/audit-notes').expect(200);

        expect(res.body.data.total).toBe(2);
        expect(res.body.data.withheldCount).toBe(1);
        const [first, second] = res.body.data.items;
        expect(first.notes).toBe('อบรมครบตามหลักสูตร');
        expect(second.notes).toBeNull();
        expect(second.withheld).toBe(true);
        expect(second.withholdReason).toContain('บุคคลที่สาม');
        // The withheld text must not travel anywhere in the body.
        expect(JSON.stringify(res.body)).not.toContain('กลิ่น');
    });

    test("another applicant's filing is 404 with a Thai sentence, and reads nothing", async () => {
        mockAppFindFirst.mockResolvedValue(null);
        const res = await request(farmerApp()).get('/api/applications/not-mine/audit-notes').expect(404);

        expect(res.body.code).toBe('APPLICATION_NOT_FOUND');
        expect(res.body.messageTh).toMatch(/[ก-๙]/);
        expect(mockItemFindMany).not.toHaveBeenCalled();
    });
});

describe('PATCH /:auditId/checklist-items/:itemId/disclosure — the officer side', () => {
    function onsiteApp() {
        jest.doMock('../../services/audit-onsite-service', () => ({}), { virtual: false });
        const a = express();
        a.use(express.json());
        a.use('/api/audit/onsite', require('../../routes/api/audit/onsite'));
        return a;
    }

    test('withholding without a real reason is refused in Thai and writes nothing', async () => {
        mockItemFindUnique.mockResolvedValue({ id: 'item-2', auditId: 'audit-1', audit: { id: 'audit-1', application: { id: 'app-1', auditorId: 'officer-1' } } });
        const res = await request(onsiteApp())
            .patch('/api/audit/onsite/audit-1/checklist-items/item-2/disclosure')
            .send({ withheld: true, reason: 'ไม่ให้' })
            .expect(422);

        expect(res.body.code).toBe('WITHHOLD_REASON_REQUIRED');
        expect(res.body.messageTh).toMatch(/มาตรา 30/);
        expect(mockItemUpdate).not.toHaveBeenCalled();
    });

    test('a missing state is refused — this is a decision, not a toggle', async () => {
        const res = await request(onsiteApp())
            .patch('/api/audit/onsite/audit-1/checklist-items/item-2/disclosure')
            .send({ reason: 'บันทึกอ้างถึงบุคคลที่สามซึ่งไม่ได้ยินยอม' })
            .expect(422);

        expect(res.body.code).toBe('DISCLOSURE_STATE_REQUIRED');
        expect(mockItemFindUnique).not.toHaveBeenCalled();
    });

    test('a justified withholding is recorded with who and when', async () => {
        mockItemFindUnique.mockResolvedValue({ id: 'item-2', auditId: 'audit-1', audit: { id: 'audit-1', application: { id: 'app-1', auditorId: 'officer-1' } } });
        mockItemUpdate.mockResolvedValue({ id: 'item-2', disclosureWithheld: true, withholdReason: 'ok' });

        await request(onsiteApp())
            .patch('/api/audit/onsite/audit-1/checklist-items/item-2/disclosure')
            .send({ withheld: true, reason: 'บันทึกอ้างถึงผู้ร้องเรียนซึ่งเป็นบุคคลที่สาม' })
            .expect(200);

        const { data } = mockItemUpdate.mock.calls[0][0];
        expect(data).toMatchObject({ disclosureWithheld: true, withheldBy: 'officer-1' });
        expect(data.withheldAt).toBeInstanceOf(Date);
    });
});
