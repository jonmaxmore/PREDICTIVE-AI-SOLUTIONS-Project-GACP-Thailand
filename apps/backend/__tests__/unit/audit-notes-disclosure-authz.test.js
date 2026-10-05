/**
 * Defect batch B item 5 — who may withhold or disclose an inspector's note (PDPA s.30 para 2).
 *
 * The door sat behind the router-wide AUDIT_STAFF gate only, so a dispatcher or a document
 * reviewer — anyone on staff — could flip the disclosure of a note on ANY application, and
 * the item was never checked against the audit named in the path. It is a controller's
 * judgement about one row, so it belongs to the inspector assigned to THAT application
 * (and to system_admin_dtam).
 */
'use strict';

const express = require('express');
const request = require('supertest');

let mockUser;
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (req, _res, next) => { req.user = mockUser; next(); },
    requireRole: () => (_q, _s, n) => n(),
}));

const mockItemFindUnique = jest.fn();
const mockItemUpdate = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        farmAuditChecklistItem: {
            findUnique: (...a) => mockItemFindUnique(...a),
            update: (...a) => mockItemUpdate(...a),
        },
    },
}));
jest.mock('../../shared/logger', () => {
    const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...l, createLogger: () => l };
});

const REASON = 'บันทึกอ้างถึงผู้ร้องเรียนซึ่งเป็นบุคคลที่สาม';

function onsiteApp() {
    jest.doMock('../../services/audit-onsite-service', () => ({}));
    const a = express();
    a.use(express.json());
    a.use('/api/audit/onsite', require('../../routes/api/audit/onsite'));
    return a;
}
const patch = (auditId = 'audit-1') => request(onsiteApp())
    .patch(`/api/audit/onsite/${auditId}/checklist-items/item-1/disclosure`)
    .send({ withheld: true, reason: REASON });

beforeEach(() => {
    jest.clearAllMocks();
    // the item belongs to audit-1 of application app-1, whose assigned inspector is insp-1
    mockItemFindUnique.mockResolvedValue({
        id: 'item-1', auditId: 'audit-1',
        audit: { id: 'audit-1', applicationId: 'app-1', auditorId: 'insp-1', application: { id: 'app-1', auditorId: 'insp-1' } },
    });
    mockItemUpdate.mockResolvedValue({ id: 'item-1', disclosureWithheld: true, withholdReason: REASON });
});

describe('PATCH /:auditId/checklist-items/:itemId/disclosure — who may decide', () => {
    test('the inspector assigned to that application may', async () => {
        mockUser = { id: 'insp-1', role: 'field_inspector', canonicalRole: 'field_inspector' };
        await patch().expect(200);
        expect(mockItemUpdate).toHaveBeenCalledTimes(1);
    });

    test('system_admin_dtam may', async () => {
        mockUser = { id: 'admin-1', role: 'system_admin_dtam', canonicalRole: 'system_admin_dtam' };
        await patch().expect(200);
        expect(mockItemUpdate).toHaveBeenCalledTimes(1);
    });

    test.each([
        ['dispatcher', 'dispatcher'],
        ['document_reviewer', 'document_reviewer'],
    ])('a %s on staff may NOT (403, Thai reason, nothing written)', async (_n, role) => {
        mockUser = { id: 'staff-9', role, canonicalRole: role };
        const res = await patch().expect(403);
        expect(res.body.code).toBe('DISCLOSURE_NOT_PERMITTED');
        expect(res.body.messageTh).toMatch(/[฀-๿]/);
        expect(mockItemUpdate).not.toHaveBeenCalled();
    });

    test('a field_inspector assigned to a DIFFERENT application may NOT', async () => {
        mockUser = { id: 'insp-2', role: 'field_inspector', canonicalRole: 'field_inspector' };
        const res = await patch().expect(403);
        expect(res.body.code).toBe('DISCLOSURE_NOT_PERMITTED');
        expect(mockItemUpdate).not.toHaveBeenCalled();
    });

    test('an item that is not part of the audit named in the path is 404, even for the right inspector', async () => {
        mockUser = { id: 'insp-1', role: 'field_inspector', canonicalRole: 'field_inspector' };
        const res = await patch('audit-OTHER').expect(404);
        expect(res.body.code).toBe('CHECKLIST_ITEM_NOT_FOUND');
        expect(mockItemUpdate).not.toHaveBeenCalled();
    });

    test('disclosing (withheld:false) is the same decision and is gated the same way', async () => {
        mockUser = { id: 'staff-9', role: 'dispatcher', canonicalRole: 'dispatcher' };
        const res = await request(onsiteApp())
            .patch('/api/audit/onsite/audit-1/checklist-items/item-1/disclosure')
            .send({ withheld: false })
            .expect(403);
        expect(res.body.code).toBe('DISCLOSURE_NOT_PERMITTED');
        expect(mockItemUpdate).not.toHaveBeenCalled();
    });
});
