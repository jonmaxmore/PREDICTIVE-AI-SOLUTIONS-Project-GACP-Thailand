'use strict';

/**
 * F2 + F3 — receipt queue + CSV export: ขาอ่านไม่แคบตามบทบาทแล้ว (operator 2026-09-11)
 *
 * เดิมไฟล์นี้ตรึงว่า การเงินฝั่งกรมดึงได้แค่แถว STATE และฝั่งบริษัทได้แค่แถว NOT-STATE
 * (VIS-ACCT read-SoD, multi-role system test 2026-06-24) · คำตัดสิน "finance ต้องเห็นเหมือนกัน
 * ... ตัวเลขที่ต้องมากระทบยอด ต้องเท่ากัน" กลับข้อนั้นสำหรับการอ่าน ⇒ ตอนนี้ตรึงสิ่งตรงข้าม:
 * ทั้งสองบทบาทส่งคำถามชุดเดียวกันลงชั้นข้อมูล · ขอบเขตองค์กร (organizationId) ยังอยู่ครบ
 * canonical RBAC ของจริง (requirePermission ใน handler)
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
    const headerUser = (req, res, next) => {
        const role = req.headers['x-test-role'];
        if (!role) { return res.status(401).json({ success: false, error: 'Unauthorized' }); }
        req.user = { id: 'u1', role, canonicalRole: role, organizationId: 'org-1' };
        return next();
    };
    return { authenticateProvider: headerUser, authenticateAny: headerUser, authenticateHealth: headerUser };
});

// canonical-rbac REAL — requirePermission (defined in the handler) consults it.
jest.mock('../../shared/canonical-rbac', () => jest.requireActual('../../shared/canonical-rbac'));
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

const mockListPendingReceipts = jest.fn().mockResolvedValue([]);
const mockListReceiptFailures = jest.fn().mockResolvedValue([]);
jest.mock('../../services/invoice-service', () => ({
    listPendingReceipts: (...a) => mockListPendingReceipts(...a),
    listReceiptFailures: (...a) => mockListReceiptFailures(...a),
    getById: jest.fn(),
}));

const mockExportCSV = jest.fn().mockResolvedValue({ buffer: Buffer.from('x'), filename: 'f.csv', contentType: 'text/csv' });
jest.mock('../../services/financial-export-service', () => ({ exportCSV: (...a) => mockExportCSV(...a) }));

jest.mock('../../shared/logger', () => {
    const l = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    return { ...l, createLogger: () => l };
});

const paymentHandlers = require('../../routes/api/finance/invoice-payment-handlers');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/invoices', paymentHandlers);
    return app;
}

const FINANCE_ROLES = ['finance_officer_dtam', 'finance_officer_platform'];

describe('F2+F3 receipt queue + CSV export — การเงินสองบทบาทได้คำถามชุดเดียวกัน', () => {
    let app;
    beforeAll(() => { app = buildApp(); });
    beforeEach(() => jest.clearAllMocks());

    // เดิม: dtam → listPendingReceipts(STATE_MATCH) · ใหม่: ทั้งสองบทบาท → listPendingReceipts({})
    test.each(FINANCE_ROLES)('%s /receipts/pending — ไม่มีตัวกรองฝั่ง', async (role) => {
        const res = await request(app).get('/api/invoices/receipts/pending').set('x-test-role', role);
        expect(res.status).toBe(200);
        expect(mockListPendingReceipts).toHaveBeenCalledWith({});
    });

    // Wave 0: /receipts/issued and /receipts/failures were removed (zero product callers).

    // เดิม: platform → { NOT: STATE_MATCH, organizationId } · dtam → { ...STATE_MATCH, organizationId }
    // ใหม่: ทั้งสองบทบาท → { organizationId } เท่านั้น (ขอบเขตองค์กรคงเดิม)
    test.each(FINANCE_ROLES)('%s /export — ส่งแค่ขอบเขตองค์กร ไม่มีตัวกรองฝั่ง', async (role) => {
        const res = await request(app)
            .get('/api/invoices/export?type=tax&month=5&year=2026')
            .set('x-test-role', role);
        expect(res.status).toBe(200);
        expect(mockExportCSV).toHaveBeenCalledWith('tax', 5, 2026, { organizationId: 'org-1' });
    });
});
