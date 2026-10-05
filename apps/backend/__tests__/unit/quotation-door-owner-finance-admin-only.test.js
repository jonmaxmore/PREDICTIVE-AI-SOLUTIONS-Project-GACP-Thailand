/**
 * fix round 2 N4 — operator 2026-09-27 S6: ผู้ตรวจประเมินไม่อ่านข้อมูลการเงิน
 *
 * GET /api/applications/:id/quotations (และ /:issuerType/pdf) ให้ราคาและรายการของใบเสนอราคา
 * แก่ทุกบทบาทเจ้าหน้าที่ รวมผู้ตรวจประเมิน · ไม่มีหน้าจอเจ้าหน้าที่ใดเรียกประตูนี้ (ผู้เรียกบนเว็บ
 * อยู่ใต้ /health ทั้งหมด) ⇒ ปิดสำหรับผู้ตรวจประเมิน และต้องไม่ไปถึงการออกใบเสนอราคาย้อนหลัง
 *
 * ของจริง: router quotations · normalizeRole / CANONICAL_ROLES
 * ของปลอม: การยืนยันตัวตน · application-service · quotation-service · การออกใบย้อนหลัง · PDF
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: () => l };
});
jest.mock('../../middleware/auth-middleware', () => {
    const auth = (req, res, next) => {
        const role = req.headers['x-test-role'];
        if (!role) { return res.status(401).json({ success: false }); }
        req.user = { id: 'user-1', role, organizationId: 'org-1' };
        return next();
    };
    return { authenticateAny: auth, authenticateHealth: auth, authenticateProvider: auth };
});
jest.mock('../../services/application-service', () => ({
    getApplicationSlice: jest.fn(async () => ({ id: 'app-1', status: 'SUBMITTED', applicationNumber: 'APP-1', organizationId: 'org-1', formData: {} })),
    findOwnedApplicationForApplicant: jest.fn(async () => null),
}));
const mockEnsure = jest.fn(async () => ({ platform: null }));
jest.mock('../../services/quotation-issuance-on-submit', () => ({
    ensureQuotationForIssuedApplication: (...a) => mockEnsure(...a),
}));
jest.mock('../../services/quotation-service', () => ({
    findQuotationsByApplicationId: jest.fn(async () => ({ platform: null })),
}));
// The list door now also hands the web the quotation signatory (payer-block-by-type)
// and the issuer block + wording (fix/web-quotation-truth).
jest.mock('../../services/pdf/invoice-template-service', () => ({
    buildQuotationSignatory: () => ({ org: 'ในนาม ผู้ออกเอกสาร', name: 'ผู้มีอำนาจลงนาม', title1: '', title2: '' }),
    buildQuotationIssuer: () => ({ name: 'ผู้ออกเอกสาร', taxId: '-', address: '-', email: null, branch: 'สำนักงานใหญ่', contact: '-' }),
    buildQuotationCopy: () => ({ intro: 'ย่อหน้าเปิด', note: 'บรรทัดการชำระเงิน' }),
}));

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/applications/:applicationId/quotations', require('../../routes/api/applications/quotations'));
    return app;
}

describe('N4 — ประตูใบเสนอราคาของคำขอ ปิดสำหรับผู้ตรวจประเมิน', () => {
    const app = buildApp();
    beforeEach(() => mockEnsure.mockClear());

    test('GET /quotations — field_inspector ได้ 403 และไม่ไปถึงการออกใบย้อนหลัง', async () => {
        const res = await request(app).get('/api/applications/app-1/quotations').set('x-test-role', 'field_inspector');
        expect(res.status).toBe(403);
        expect(mockEnsure).not.toHaveBeenCalled();
    });

    test('GET /quotations/PLATFORM/pdf — field_inspector ได้ 403', async () => {
        const res = await request(app).get('/api/applications/app-1/quotations/PLATFORM/pdf').set('x-test-role', 'field_inspector');
        expect(res.status).toBe(403);
    });

    // positive control — ด่านใหม่ต้องไม่ปิดการเงิน/แอดมิน
    test.each(['finance_officer_platform', 'finance_officer_dtam', 'system_admin_dtam', 'system_admin_platform'])('GET /quotations — %s ยังได้ 200', async (role) => {
        const res = await request(app).get('/api/applications/app-1/quotations').set('x-test-role', role);
        expect(res.status).toBe(200);
    });
});

/**
 * fix round 3 — operator 2026-09-27: "ปิด เห็นได้เฉพาะผู้ยื่น+การเงิน+แอดมิน"
 * ประตูใบเสนอราคาของคำขอเปิดให้: ผู้ยื่นที่เป็นเจ้าของ · การเงินสองบทบาท · แอดมินสองบทบาท เท่านั้น
 * บทบาทอื่นถูกปฏิเสธก่อนถึงการออกใบย้อนหลัง (self-heal write)
 */
describe('fix round 3 — เห็นได้เฉพาะผู้ยื่น + การเงิน + แอดมิน', () => {
    const app = buildApp();
    const appService = require('../../services/application-service');
    beforeEach(() => mockEnsure.mockClear());

    test.each(['document_reviewer', 'dispatcher', 'certificate_approver', 'field_inspector'])(
        'GET /quotations — %s ได้ 403 และไม่ออกใบเสนอราคา', async (role) => {
            const res = await request(app).get('/api/applications/app-1/quotations').set('x-test-role', role);
            expect(res.status).toBe(403);
            expect(mockEnsure).not.toHaveBeenCalled();
        });

    test.each(['document_reviewer', 'dispatcher', 'certificate_approver', 'field_inspector'])(
        'GET /quotations/PLATFORM/pdf — %s ได้ 403', async (role) => {
            const res = await request(app).get('/api/applications/app-1/quotations/PLATFORM/pdf').set('x-test-role', role);
            expect(res.status).toBe(403);
        });

    test('ผู้ยื่นที่เป็นเจ้าของคำขอยังได้ 200 · ผู้ยื่นที่ไม่ใช่เจ้าของได้ 404 และไม่ออกใบ', async () => {
        appService.findOwnedApplicationForApplicant.mockResolvedValueOnce({ id: 'app-1', isDeleted: false });
        const own = await request(app).get('/api/applications/app-1/quotations').set('x-test-role', 'health');
        expect(own.status).toBe(200);
        mockEnsure.mockClear();
        const other = await request(app).get('/api/applications/app-1/quotations').set('x-test-role', 'health');
        expect(other.status).toBe(404);
        expect(mockEnsure).not.toHaveBeenCalled();
    });
});
