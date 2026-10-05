/**
 * ฝ่ายการเงินสองบทบาทเห็นข้อมูลชุดเดียวกัน — ด่านอ่าน (operator 2026-09-11)
 *
 *   "finance ต้องเห็นเหมือนกัน หรือว่าตัวเลขที่ต้องมากระทบยอด ต้องเท่ากัน เพื่อแสดงความโปร่งใส
 *    คือทั้งคู่จะเห็น เป็นรูปแบบ billing ที่จะเห็น transaction, status ต่างๆ หมายเลขคำขอ
 *    เลขการจ่ายเงิน หรืออะไรที่ต้องมีที่บัญชี หรือระบบ billing ต้องมี"
 *
 * เทสนี้ยิงทุกประตู **อ่าน** ที่หน้า /provider/accounting ใช้ ด้วย finance_officer_dtam และ
 * finance_officer_platform แล้วเทียบ status + payload ต้องเท่ากันทุกไบต์
 *
 * ของจริง: router ทุกตัว · ด่านบทบาททุกตัว (middleware ใน route + assert ใน service
 * ของ wht / purchase-invoice / refund) · canonical-rbac · effective-permissions engine
 * ของปลอม: การยืนยันตัวตน (หัว x-test-role → req.user) และชั้นข้อมูล — ตัวที่ถูกปลอม
 * ตอบ "สะท้อนอาร์กิวเมนต์ที่ได้รับ" กลับไป ⇒ payload เท่ากันก็ต่อเมื่อ route ส่งคำถาม
 * ชุดเดียวกันลงชั้นข้อมูลให้ทั้งสองบทบาท (ตัวกรองฝั่งตามบทบาทจะโผล่เป็น payload ต่างกัน)
 * purchase-invoice + refund ใช้ service ของจริงทั้งตัวบน prisma ปลอม
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
    const headerUser = (req, res, next) => {
        const role = req.headers['x-test-role'];
        if (!role) { return res.status(401).json({ success: false, error: 'Unauthorized' }); }
        req.user = { id: 'user-1', email: 'u@example.com', role, organizationId: 'org-1' };
        return next();
    };
    return {
        authenticateProvider: headerUser,
        authenticateHealth: headerUser,
        authenticate: headerUser,
        authenticateAny: headerUser,
    };
});

// ชั้นข้อมูล — สะท้อนอาร์กิวเมนต์ (ตัด actor ออก เพราะ actor คือ "ใครถาม" ไม่ใช่ "ถามอะไร")
function mockEcho(name) {
    return (...args) => Promise.resolve({ echo: name, args: JSON.parse(JSON.stringify(args)) });
}

const mockPlatformInvoice = {
    id: 'inv-platform', invoiceNumber: 'INV-P-1', serviceType: 'PHASE_1_PLATFORM_FEE',
    totalAmount: 1070, status: 'PAID', organizationId: 'org-1',
};
const mockStateInvoice = {
    id: 'inv-state', invoiceNumber: 'INV-S-1', serviceType: 'PHASE_1_STATE_FEE',
    totalAmount: 5000, status: 'PAID', organizationId: 'org-1',
};

jest.mock('../../services/invoice-service', () => ({
    listAll: (...a) => mockEcho('listAll')(...a),
    getSummary: (...a) => mockEcho('getSummary')(...a),
    getRevenueSummary: (...a) => mockEcho('getRevenueSummary')(...a),
    listPendingReceipts: (...a) => mockEcho('listPendingReceipts')(...a).then((r) => [r]),
    listReceiptExceptions: (...a) => mockEcho('listReceiptExceptions')(...a).then((r) => [r]),
    getById: (id) => Promise.resolve(
        id === 'inv-platform' ? mockPlatformInvoice : id === 'inv-state' ? mockStateInvoice : null,
    ),
    generateReceiptPdf: (id) => Promise.resolve(Buffer.from(`%PDF receipt ${id}`)),
}));
jest.mock('../../services/financial-export-service', () => ({
    exportCSV: (...a) => Promise.resolve({
        buffer: Buffer.from(JSON.stringify(a)), filename: 'x.csv', contentType: 'text/csv',
    }),
}));
jest.mock('../../services/accounting-service', () => ({
    getRootSummary: (...a) => mockEcho('getRootSummary')(...a),
    getDashboardStats: (...a) => mockEcho('getDashboardStats')(...a),
}));
jest.mock('../../services/trial-balance-service', () => ({
    generateTrialBalance: (...a) => mockEcho('generateTrialBalance')(...a)
        .then((r) => ({ ...r, balanced: true, rows: [] })),
    generateTrialBalanceCSV: (...a) => Promise.resolve(JSON.stringify(a)),
}));
jest.mock('../../services/financial-statements-service', () => ({
    generateProfitAndLoss: (...a) => mockEcho('generateProfitAndLoss')(...a)
        .then((r) => ({ ...r, netProfit: 0, revenue: { total: 0 }, expense: { total: 0 } })),
    generateBalanceSheet: (...a) => mockEcho('generateBalanceSheet')(...a)
        .then((r) => ({ ...r, balanced: true, assets: { total: 0 }, liabilities: { total: 0 }, equity: { total: 0 } })),
}));
jest.mock('../../services/general-ledger-service', () => ({
    queryGeneralLedger: (...a) => mockEcho('queryGeneralLedger')(...a)
        .then((r) => ({ ...r, pagination: { returned: 0, totalRows: 0 } })),
}));
jest.mock('../../services/vat-report-service', () => ({
    generateOutputVatReport: (...a) => mockEcho('generateOutputVatReport')(...a),
    generateOutputVatReportCSV: (...a) => Promise.resolve(JSON.stringify(a)),
    checkPeriodClosable: (...a) => mockEcho('checkPeriodClosable')(...a),
}));
jest.mock('../../services/customer-statement-service', () => ({
    generateCustomerStatement: (...a) => mockEcho('generateCustomerStatement')(...a)
        .then((r) => ({ ...r, applicant: null, applications: [] })),
}));
jest.mock('../../services/ar-aging-service', () => ({
    generateArAgingReport: (...a) => mockEcho('generateArAgingReport')(...a),
    generateArAgingReportCSV: (...a) => Promise.resolve(JSON.stringify(a)),
}));
jest.mock('../../services/period-close-service', () => ({
    getPeriodCloseStatus: (...a) => mockEcho('getPeriodCloseStatus')(...a).then((r) => [r]),
    isPeriodClosed: () => Promise.resolve(false),
}));
jest.mock('../../services/manual-journal-entry-service', () => ({
    listDrafts: (...a) => mockEcho('listDrafts')(...a).then((r) => [r]),
    getDraftById: (id) => Promise.resolve({ id, organizationId: 'org-1', status: 'DRAFT' }),
    ACTIONS: {},
}));
// wht: ด่าน assertReadRole ของจริง · ปลอมแค่ตัวอ่านข้อมูล
jest.mock('../../services/wht-service', () => {
    const real = jest.requireActual('../../services/wht-service');
    return {
        ...real,
        listWhtCertificates: (...a) => mockEcho('listWhtCertificates')(...a).then((r) => [r]),
        isWhtApplicableForInvoice: (...a) => mockEcho('isWhtApplicableForInvoice')(...a),
    };
});
// purchase-invoice-service + refund-service = ของจริงทั้งตัว บน prisma ปลอม
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        userPermissionGrant: { findMany: () => Promise.resolve([]) },
        purchaseInvoice: {
            // resolvePrisma ของ service ถือว่ามี DB เมื่อมี create เท่านั้น
            create: () => Promise.reject(new Error("stub: no write in this test")),
            findMany: (q) => Promise.resolve([{ id: 'pi-1', organizationId: 'org-1', echo: q }]),
            findUnique: ({ where }) => Promise.resolve({ id: where.id, organizationId: 'org-1' }),
        },
        invoice: {
            findUnique: ({ where }) => Promise.resolve({
                id: where.id, invoiceNumber: 'INV-P-1', organizationId: 'org-1',
                metadata: {}, totalAmount: 1070, status: 'PAID',
            }),
        },
    },
}));
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue(null) },
    AuditCategory: { PAYMENT: 'PAYMENT' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
    ResourceType: { PAYMENT: 'PAYMENT' },
}));
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/invoices', require('../../routes/api/finance/invoices'));
    app.use('/api/accounting', require('../../routes/api/finance/accounting'));
    app.use('/api/finance/reports', require('../../routes/api/finance/reports'));
    app.use('/api/finance/tax-reports', require('../../routes/api/finance/tax-reports'));
    app.use('/api/finance/wht', require('../../routes/api/finance/wht'));
    app.use('/api/finance/purchase-invoices', require('../../routes/api/finance/purchase-invoices'));
    app.use('/api/finance/refunds', require('../../routes/api/finance/refunds'));
    app.use('/api/finance/manual-journal-entries', require('../../routes/api/finance/manual-journal-entries'));
    app.use('/api/finance/period-close', require('../../routes/api/finance/period-close'));
    app.use('/api/finance', require('../../routes/api/finance/customer-reports'));
    return app;
}

/** ทุกประตูอ่านที่หน้าบัญชีเรียก + สรุปบัญชี (routes/api/finance/accounting.js) */
const READ_ENDPOINTS = [
    '/api/invoices',
    '/api/invoices/summary',
    '/api/invoices/revenue-summary',
    '/api/invoices/receipts/pending',
    '/api/invoices/receipts/exceptions',
    '/api/invoices/export?type=monthly&month=9&year=2026',
    '/api/invoices/export?type=tax&month=9&year=2026',
    '/api/invoices/inv-platform',
    '/api/invoices/inv-state',
    '/api/invoices/inv-platform/receipt/pdf',
    '/api/accounting',
    '/api/accounting/dashboard',
    '/api/finance/reports/trial-balance?asOfDate=2026-09-27',
    '/api/finance/reports/trial-balance?asOfDate=2026-09-27&format=csv',
    '/api/finance/reports/profit-and-loss?from=2026-09-01&to=2026-09-27',
    '/api/finance/reports/balance-sheet?asOfDate=2026-09-27',
    '/api/finance/reports/general-ledger?accountCode=4110-001&from=2026-09-01&to=2026-09-27',
    '/api/finance/tax-reports/output-vat?year=2026&month=9',
    '/api/finance/tax-reports/output-vat?year=2026&month=9&format=csv',
    '/api/finance/tax-reports/period-closable?year=2026&month=9',
    '/api/finance/ar-aging?bookSide=DTAM&asOfDate=2026-09-27',
    '/api/finance/ar-aging?bookSide=PLATFORM&asOfDate=2026-09-27',
    '/api/finance/ar-aging?bookSide=PLATFORM&asOfDate=2026-09-27&format=csv',
    '/api/finance/customer-statement?applicantHealthId=h-1&asOfDate=2026-09-27',
    '/api/finance/period-close',
    '/api/finance/period-close/check?year=2026&month=9',
    '/api/finance/manual-journal-entries',
    '/api/finance/manual-journal-entries/je-1',
    '/api/finance/wht/certificates',
    '/api/finance/wht/applicable/inv-platform',
    '/api/finance/purchase-invoices',
    '/api/finance/purchase-invoices/pi-1',
    '/api/finance/refunds/inv-platform/status',
];

const FINANCE = ['finance_officer_dtam', 'finance_officer_platform'];
// S5: certificate_approver ถูกเพิ่ม · S6 (operator 2026-09-27): field_inspector ไม่เห็นเรื่องเงิน
const NON_FINANCE = ['health', 'document_reviewer', 'dispatcher', 'certificate_approver', 'field_inspector'];

describe('การเงินสองบทบาท — ทุกประตูอ่านตอบเหมือนกันทุกไบต์ (operator 2026-09-11)', () => {
    const app = buildApp();

    test.each(READ_ENDPOINTS)('GET %s → dtam กับ platform ได้ status + payload เดียวกัน และเป็น 200', async (url) => {
        const [dtam, platform] = await Promise.all(
            FINANCE.map((role) => request(app).get(url).set('x-test-role', role)),
        );
        expect({ status: dtam.status, body: dtam.body, text: dtam.text })
            .toEqual({ status: platform.status, body: platform.body, text: platform.text });
        expect(platform.status).toBe(200);
    });
});

describe('บทบาทที่ไม่ใช่การเงินยังถูกปฏิเสธทุกประตูที่แตะ', () => {
    const app = buildApp();
    const cases = READ_ENDPOINTS.flatMap((url) => NON_FINANCE.map((role) => [role, url]));

    test.each(cases)('%s → GET %s ได้ 403', async (role, url) => {
        const res = await request(app).get(url).set('x-test-role', role);
        expect(res.status).toBe(403);
    });
});
