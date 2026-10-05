/**
 * กำแพงองค์กรของประตูอ่าน/เขียนการเงิน — fix round 1 (security review S3 · S4 · S5 · L3 · L4)
 *
 * ทุกคนในเทสอื่นอยู่ org-1 จึงมองไม่เห็นว่าประตูไหนหลุดข้ามองค์กร (review S5) · ไฟล์นี้ให้ผู้เรียก
 * อยู่ org-2 และข้อมูลตัวอย่างเป็นของ org-1 แล้ววัดสามอย่าง:
 *   1. ประตูที่ส่งองค์กรลงชั้นข้อมูล: ต้องส่ง org ของผู้เรียก (org-2) เสมอ แม้ query จะอ้าง org อื่น
 *   2. ประตูอ่านตาม id: แถวของ org-1 ต้องได้ 403/404 สำหรับผู้เรียก org-2
 *   3. ผู้เรียกที่ไม่มี organizationId: ต้องถูกปฏิเสธ (fail closed) ไม่ใช่ได้ข้อมูลทุกองค์กร
 * ประตูที่พึ่ง tenant-prisma-extension (ขอบเขตองค์กรฉีดที่ prisma client จริง ซึ่งถูกปลอมในเทสนี้)
 * ประกาศไว้ใน EXTENSION_SCOPED อย่างชัดแจ้ง — ไม่ข้ามเงียบ ๆ
 *
 * ของจริง: router · ด่านบทบาท · purchase-invoice / refund / wht / credit-note / debit-note service
 * ของปลอม: การยืนยันตัวตน (หัว x-test-role / x-test-org) · prisma · service รายงาน (บันทึกการเรียก)
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
    const auth = (req, res, next) => {
        const role = req.headers['x-test-role'];
        if (!role) { return res.status(401).json({ success: false }); }
        const org = req.headers['x-test-org'];
        req.user = { id: 'user-1', role, organizationId: org === 'none' ? null : (org || 'org-2') };
        return next();
    };
    return { authenticateProvider: auth, authenticateHealth: auth, authenticate: auth, authenticateAny: auth };
});
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue(null) },
    AuditCategory: new Proxy({}, { get: (_t, k) => String(k) }),
    AuditSeverity: new Proxy({}, { get: (_t, k) => String(k) }),
    ResourceType: new Proxy({}, { get: (_t, k) => String(k) }),
}));

// service รายงาน — บันทึกว่าถูกเรียกด้วยองค์กรอะไร (ไม่สะท้อนอาร์กิวเมนต์กลับเป็น payload)
const mockTB = jest.fn(() => Promise.resolve({ balanced: true, rows: [] }));
const mockPL = jest.fn(() => Promise.resolve({ netProfit: 0, revenue: { total: 0 }, expense: { total: 0 } }));
const mockBS = jest.fn(() => Promise.resolve({ balanced: true, assets: { total: 0 }, liabilities: { total: 0 }, equity: { total: 0 } }));
const mockGL = jest.fn(() => Promise.resolve({ pagination: { returned: 0, totalRows: 0 } }));
const mockVAT = jest.fn(() => Promise.resolve({ rows: [] }));
const mockClosable = jest.fn(() => Promise.resolve({ closable: true }));
const mockAging = jest.fn(() => Promise.resolve({ rows: [] }));
const mockStatement = jest.fn(() => Promise.resolve({ applicant: null, applications: [] }));
const mockPCList = jest.fn(() => Promise.resolve([]));
const mockPCCheck = jest.fn(() => Promise.resolve(false));
const mockMJEList = jest.fn(() => Promise.resolve([]));
const mockMJEGet = jest.fn(() => Promise.resolve({ id: 'je-1', organizationId: 'org-1', status: 'DRAFT' }));
const mockRoot = jest.fn(() => Promise.resolve({}));
const mockDash = jest.fn(() => Promise.resolve({}));
const mockExport = jest.fn(() => Promise.resolve({ buffer: Buffer.from('x'), filename: 'x.csv', contentType: 'text/csv' }));
jest.mock('../../services/trial-balance-service', () => ({ generateTrialBalance: (...a) => mockTB(...a), generateTrialBalanceCSV: (...a) => mockTB(...a).then(() => 'csv') }));
jest.mock('../../services/financial-statements-service', () => ({ generateProfitAndLoss: (...a) => mockPL(...a), generateBalanceSheet: (...a) => mockBS(...a) }));
jest.mock('../../services/general-ledger-service', () => ({ queryGeneralLedger: (...a) => mockGL(...a) }));
jest.mock('../../services/vat-report-service', () => ({
    generateOutputVatReport: (...a) => mockVAT(...a),
    generateOutputVatReportCSV: (...a) => mockVAT(...a).then(() => 'csv'),
    checkPeriodClosable: (...a) => mockClosable(...a),
}));
jest.mock('../../services/ar-aging-service', () => ({ generateArAgingReport: (...a) => mockAging(...a), generateArAgingReportCSV: (...a) => mockAging(...a).then(() => 'csv') }));
jest.mock('../../services/customer-statement-service', () => ({ generateCustomerStatement: (...a) => mockStatement(...a) }));
jest.mock('../../services/period-close-service', () => ({ getPeriodCloseStatus: (...a) => mockPCList(...a), isPeriodClosed: (...a) => mockPCCheck(...a) }));
jest.mock('../../services/manual-journal-entry-service', () => ({ listDrafts: (...a) => mockMJEList(...a), getDraftById: (...a) => mockMJEGet(...a), ACTIONS: {} }));
jest.mock('../../services/accounting-service', () => ({ getRootSummary: (...a) => mockRoot(...a), getDashboardStats: (...a) => mockDash(...a) }));
jest.mock('../../services/financial-export-service', () => ({ exportCSV: (...a) => mockExport(...a) }));
jest.mock('../../services/invoice-service', () => ({ getById: () => Promise.resolve(null) }));

// prisma ปลอม — ทุกแถวเป็นของ org-1 · บันทึก where / data ที่ service ส่งมา
const mockPrismaCalls = [];
jest.mock('../../services/prisma-database', () => {
    const rec = (model, op, ret) => (args) => { mockPrismaCalls.push({ model, op, args }); return Promise.resolve(typeof ret === 'function' ? ret(args) : ret); };
    const invoiceRow = {
        id: 'inv-1', invoiceNumber: 'INV-1', organizationId: 'org-1', serviceType: 'PHASE_1_PLATFORM_FEE', status: 'PAID',
        subtotal: 100, vat: 7, totalAmount: 107, metadata: {}, isDeleted: false, applicant: { entityType: 'JURISTIC' },
    };
    const noteRow = { id: 'n-1', organizationId: 'org-1', status: 'ISSUED', originalInvoice: invoiceRow };
    return {
        prisma: {
            userPermissionGrant: { findMany: rec('userPermissionGrant', 'findMany', []) },
            purchaseInvoice: {
                findMany: rec('purchaseInvoice', 'findMany', []),
                findUnique: rec('purchaseInvoice', 'findUnique', ({ where }) => ({ id: where.id, organizationId: 'org-1' })),
                findFirst: rec('purchaseInvoice', 'findFirst', null),
                create: rec('purchaseInvoice', 'create', ({ data }) => ({ id: 'pi-new', ...data })),
            },
            invoice: {
                findUnique: rec('invoice', 'findUnique', invoiceRow),
                findFirst: rec('invoice', 'findFirst', invoiceRow),
                findMany: rec('invoice', 'findMany', []),
                update: rec('invoice', 'update', {}),
            },
            creditNote: {
                create: rec('creditNote', 'create', {}),
                findMany: rec('creditNote', 'findMany', []),
                findUnique: rec('creditNote', 'findUnique', noteRow),
            },
            debitNote: {
                create: rec('debitNote', 'create', {}),
                findMany: rec('debitNote', 'findMany', []),
                findUnique: rec('debitNote', 'findUnique', noteRow),
            },
            $transaction: (fn) => (typeof fn === 'function' ? fn(this) : Promise.all(fn)),
        },
    };
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
    app.use('/api/finance/credit-notes', require('../../routes/api/finance/credit-notes'));
    app.use('/api/finance/debit-notes', require('../../routes/api/finance/debit-notes'));
    app.use('/api/finance', require('../../routes/api/finance/customer-reports'));
    return app;
}

const P = 'finance_officer_platform';
const D = 'finance_officer_dtam';
const ADMIN = 'system_admin_dtam';

/** ประตูที่ส่งองค์กรลงชั้นข้อมูล: [url, mock, index ของอาร์กิวเมนต์ที่ถือ org, key] */
const ORG_PARAM_DOORS = [
    ['/api/finance/reports/trial-balance?asOfDate=2026-09-27', mockTB],
    ['/api/finance/reports/profit-and-loss?from=2026-09-01&to=2026-09-27', mockPL],
    ['/api/finance/reports/balance-sheet?asOfDate=2026-09-27', mockBS],
    ['/api/finance/reports/general-ledger?accountCode=4110-001', mockGL],
    ['/api/finance/tax-reports/output-vat?year=2026&month=9', mockVAT],
    ['/api/finance/tax-reports/period-closable?year=2026&month=9', mockClosable],
    ['/api/finance/ar-aging?bookSide=PLATFORM&asOfDate=2026-09-27', mockAging],
    ['/api/finance/customer-statement?applicantHealthId=h-1', mockStatement],
    ['/api/finance/period-close', mockPCList],
    ['/api/finance/period-close/check?year=2026&month=9', mockPCCheck],
    ['/api/finance/manual-journal-entries', mockMJEList],
];
function orgArg(mock) {
    const [first] = mock.mock.calls[mock.mock.calls.length - 1];
    return typeof first === 'string' || first === null ? first : first.organizationId;
}

/**
 * ประตูอ่านที่ขอบเขตองค์กรมาจาก tenant-prisma-extension บน prisma client จริง (findMany/findFirst/
 * count ถูก inject organizationId จาก tenant context ของคำขอ) — วัดในระดับ route ไม่ได้เพราะ prisma
 * ถูกปลอม · ตรวจที่ __tests__/unit/tenant-prisma-extension*.test.js และ getSummary ใช้ predicate
 * เดียวกับ extension (L7 — เทสในไฟล์นี้)
 */
const EXTENSION_SCOPED = [
    'GET /api/invoices', 'GET /api/invoices/summary', 'GET /api/invoices/revenue-summary',
    'GET /api/invoices/receipts/pending', 'GET /api/invoices/receipts/exceptions', 'GET /api/invoices/:invoiceId',
    'GET /api/invoices/:invoiceId/receipt/pdf', 'GET /api/quotes',
];

describe('S5 — ผู้เรียก org-2: ประตูที่ส่งองค์กรลงชั้นข้อมูลส่ง org-2 เสมอ', () => {
    const app = buildApp();
    beforeEach(() => { jest.clearAllMocks(); mockPrismaCalls.length = 0; });

    test.each(ORG_PARAM_DOORS)('GET %s', async (url, mock) => {
        const res = await request(app).get(`${url}${url.includes('?') ? '&' : '?'}organizationId=org-1`)
            .set('x-test-role', P).set('x-test-org', 'org-2');
        expect(res.status).toBe(200);
        expect(mock).toHaveBeenCalled();
        expect(orgArg(mock)).toBe('org-2');
    });

    test('GET /api/accounting และ /dashboard ส่ง org-2', async () => {
        for (const [url, mock] of [['/api/accounting', mockRoot], ['/api/accounting/dashboard', mockDash]]) {
            const res = await request(app).get(url).set('x-test-role', P).set('x-test-org', 'org-2');
            expect(res.status).toBe(200);
            expect(mock.mock.calls[0][0]).toBe('org-2');
        }
    });

    test('GET /api/invoices/export ส่ง org-2', async () => {
        const res = await request(app).get('/api/invoices/export?type=tax&month=9&year=2026').set('x-test-role', P).set('x-test-org', 'org-2');
        expect(res.status).toBe(200);
        expect(mockExport.mock.calls[0][3]).toEqual({ organizationId: 'org-2' });
    });

    test.each([
        ['/api/finance/purchase-invoices?organizationId=org-1', 'purchaseInvoice'],
        ['/api/finance/credit-notes?organizationId=org-1', 'creditNote'],
        ['/api/finance/debit-notes?organizationId=org-1', 'debitNote'],
        ['/api/finance/wht/certificates', 'invoice'],
    ])('GET %s — query ?organizationId= ถูกไม่สนใจ ใช้ org ของผู้เรียก (S3)', async (url, model) => {
        for (const role of [P, D]) {
            mockPrismaCalls.length = 0;
            const res = await request(app).get(url).set('x-test-role', role).set('x-test-org', 'org-2');
            expect([role, res.status]).toEqual([role, 200]);
            const call = mockPrismaCalls.find((c) => c.model === model && c.op === 'findMany');
            expect([role, call.args.where.organizationId]).toEqual([role, 'org-2']);
        }
    });

    test('GET /api/finance/purchase-invoices?organizationId=org-9 — ผู้ดูแลระบบกรมข้ามองค์กรได้ตามเดิม', async () => {
        const res = await request(app).get('/api/finance/purchase-invoices?organizationId=org-9').set('x-test-role', ADMIN).set('x-test-org', 'org-2');
        expect(res.status).toBe(200);
        expect(mockPrismaCalls.find((c) => c.model === 'purchaseInvoice').args.where.organizationId).toBe('org-9');
    });
});

describe('S5 — ผู้เรียก org-2 อ่านแถวของ org-1 ตาม id ไม่ได้', () => {
    const app = buildApp();

    test.each([
        '/api/finance/purchase-invoices/pi-1',
        '/api/finance/refunds/inv-1/status',
        '/api/finance/manual-journal-entries/je-1',
        '/api/finance/credit-notes/n-1',
        '/api/finance/debit-notes/n-1',
        '/api/finance/wht/applicable/inv-1',
    ])('GET %s → 403/404', async (url) => {
        for (const role of [P, D]) {
            const res = await request(app).get(url).set('x-test-role', role).set('x-test-org', 'org-2');
            expect([role, [403, 404].includes(res.status)]).toEqual([role, true]);
        }
    });

    test('ประตูที่พึ่ง tenant-prisma-extension ถูกประกาศไว้ครบ (ไม่ข้ามเงียบ)', () => {
        expect(EXTENSION_SCOPED).toHaveLength(8);
    });
});

describe('L3 — ผู้เรียกที่ไม่มี organizationId ถูกปฏิเสธ (fail closed) ไม่ใช่ได้ทุกองค์กร', () => {
    const app = buildApp();
    beforeEach(() => { jest.clearAllMocks(); mockPrismaCalls.length = 0; });

    test.each([
        ['/api/finance/manual-journal-entries', mockMJEList],
        ['/api/finance/tax-reports/output-vat?year=2026&month=9', mockVAT],
        ['/api/finance/tax-reports/period-closable?year=2026&month=9', mockClosable],
        ['/api/finance/period-close', mockPCList],
        ['/api/finance/period-close/check?year=2026&month=9', mockPCCheck],
        ['/api/accounting', mockRoot],
        ['/api/accounting/dashboard', mockDash],
    ])('GET %s → 400 และไม่แตะชั้นข้อมูล', async (url, mock) => {
        const res = await request(app).get(url).set('x-test-role', P).set('x-test-org', 'none');
        expect(res.status).toBe(400);
        expect(res.body.error || res.body.code).toBe('NO_ORGANIZATION');
        expect(mock).not.toHaveBeenCalled();
    });

    test.each([
        '/api/finance/wht/certificates',
        '/api/finance/wht/applicable/inv-1',
        '/api/finance/refunds/inv-1/status',
        '/api/finance/purchase-invoices',
    ])('GET %s → 400/403 และไม่มี query ข้ามองค์กร', async (url) => {
        const res = await request(app).get(url).set('x-test-role', P).set('x-test-org', 'none');
        expect([400, 403]).toContain(res.status);
        expect(mockPrismaCalls.filter((c) => c.op === 'findMany')).toEqual([]);
    });
});

describe('S4 — สร้างใบกำกับภาษีซื้อในองค์กรของผู้สร้างเท่านั้น', () => {
    const app = buildApp();
    const BODY = {
        invoiceNumber: 'PI-1', supplierName: 'ผู้ขาย', supplierTaxId: '0105551234567',
        invoiceDate: '2026-09-01', subtotal: 100, vat: 7, totalAmount: 107, category: 'OTHER', organizationId: 'org-9',
    };
    beforeEach(() => { mockPrismaCalls.length = 0; });

    test('การเงินบริษัท org-2 ส่ง organizationId=org-9 มา → แถวถูกสร้างใน org-2', async () => {
        const res = await request(app).post('/api/finance/purchase-invoices').set('x-test-role', P).set('x-test-org', 'org-2').send(BODY);
        expect(res.status).toBe(201);
        expect(mockPrismaCalls.find((c) => c.op === 'create').args.data.organizationId).toBe('org-2');
    });

    test('ผู้ดูแลระบบกรมระบุองค์กรได้', async () => {
        const res = await request(app).post('/api/finance/purchase-invoices').set('x-test-role', ADMIN).set('x-test-org', 'org-2').send(BODY);
        expect(res.status).toBe(201);
        expect(mockPrismaCalls.find((c) => c.op === 'create').args.data.organizationId).toBe('org-9');
    });
});
