/**
 * S1 (security review 2026-09-27) — การเงินเห็นบิล ไม่เห็นแฟ้มคำขอ
 *
 * invoice-service listAll / listPendingReceipts / getById และ quote-service listForProvider
 * เคยดึง `application: { include: { entity } }` / `application: { include: { applicant } }`
 * โดยไม่ระบุ select ⇒ ได้ทุก scalar ของ Application กลับไปถึงหน้าจอการเงิน: formData
 * (เลขบัตรประชาชน/เลขผู้เสียภาษีที่ถอดรหัสแล้ว), workflowHistory (เลขประจำตัวเจ้าหน้าที่),
 * auditNotes, labResults, IP · ขัดกับมติ F-SCOPE-01 (2026-09-07) "การเงินเห็นเฉพาะเรื่องเงิน"
 *
 * วิธีวัด: router จริง + invoice-service / quote-service จริง บน prisma ปลอมที่ "ทำตัวเหมือน
 * prisma": คืนเฉพาะคอลัมน์ที่ query ขอ (select) หรือทุก scalar (include) ของแถวตัวอย่างที่มี
 * ข้อมูลอ่อนไหวครบ ⇒ ถ้า query ขอกว้างเกิน ข้อมูลจะหลุดมาถึง body จริง ๆ
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
    const headerUser = (req, res, next) => {
        const role = req.headers['x-test-role'];
        if (!role) { return res.status(401).json({ success: false, error: 'Unauthorized' }); }
        req.user = { id: 'user-1', role, organizationId: 'org-1' };
        return next();
    };
    return { authenticateProvider: headerUser, authenticateHealth: headerUser, authenticate: headerUser, authenticateAny: headerUser };
});
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

// ── prisma ปลอมที่คืนตาม select / include จริง ─────────────────────────────
const SENSITIVE_APPLICATION = {
    id: 'app-1', applicationNumber: 'APP-2569-0001', status: 'AUDIT_PASSED', serviceType: 'new_application',
    areaType: 'OUTDOOR', healthId: 'h-1', organizationId: 'org-1',
    formData: { applicantData: { idCard: '1101700203451', taxId: '0105551234567' }, presidentIdCard: '3101700203452' },
    workflowHistory: [{ action: 'DOC_APPROVED', actorProviderId: '1101700203453' }],
    auditNotes: 'บันทึกผู้ตรวจ', labResults: { thc: 0.1 }, createdByIp: '10.0.0.1', updatedByIp: '10.0.0.2', meetingUrl: 'https://meet/x',
};
const ENTITY = { id: 'ent-1', type: 'JURISTIC', displayName: 'บริษัท สมุนไพร จำกัด', juristicId: '0105551234567', nationalId: '1101700203454' };
const APPLICANT = { id: 'u-9', firstName: 'สมชาย', lastName: 'ใจดี', email: 'a@x.th', phone: '0800000000', passwordHash: '$2b$hash', totpSecret: 'SECRET', canonicalId: 'h-1' };

const RELATIONS = {
    invoice: { application: 'application', applicant: 'user', lineItems: 'lineItem' },
    quote: { application: 'application' },
    application: { entity: 'entity', applicant: 'user' },
    entity: {}, user: {}, lineItem: {},
};
const DATA = {
    invoice: [{
        id: 'inv-1', invoiceNumber: 'INV-2569-0001', applicationId: 'app-1', healthId: 'h-1', organizationId: 'org-1',
        serviceType: 'PHASE_1_PLATFORM_FEE', subtotal: 33000, vat: 2310, totalAmount: 35310, status: 'PAID',
        receiptNumber: null, paidAt: '2026-09-18T00:00:00Z', dueDate: '2026-09-20T00:00:00Z', createdAt: '2026-09-10T00:00:00Z',
        isDeleted: false, metadata: { note: 'x' },
    }],
    quote: [{ id: 'q-1', quoteNumber: 'QT-1', applicationId: 'app-1', status: 'SENT', totalAmount: 35310, createdAt: '2026-09-10T00:00:00Z' }],
};
function relationRow(model, rel, parent) {
    if (model === 'invoice' || model === 'quote') {
        if (rel === 'application') { return SENSITIVE_APPLICATION; }
        if (rel === 'applicant') { return APPLICANT; }
        if (rel === 'lineItems') { return [{ id: 'li-1', lineNumber: 1, description: 'ค่าบริการ', amount: 33000 }]; }
    }
    if (model === 'application') {
        if (rel === 'entity') { return ENTITY; }
        if (rel === 'applicant') { return APPLICANT; }
    }
    return parent[rel];
}
function project(model, row, args) {
    if (row === null || row === undefined) { return row; }
    if (Array.isArray(row)) { return row.map((r) => project(model, r, args)); }
    const rels = RELATIONS[model] || {};
    const out = {};
    if (args && args.select) {
        for (const [k, v] of Object.entries(args.select)) {
            if (!v) { continue; }
            if (rels[k]) { out[k] = project(rels[k], relationRow(model, k, row), v === true ? null : v); }
            else { out[k] = row[k]; }
        }
        return out;
    }
    for (const [k, v] of Object.entries(row)) { if (!rels[k]) { out[k] = v; } }
    for (const [k, v] of Object.entries((args && args.include) || {})) {
        if (!v) { continue; }
        out[k] = project(rels[k], relationRow(model, k, row), v === true ? null : v);
    }
    return out;
}
const mockCalls = [];
function mockModel(name) {
    const find = (args) => { mockCalls.push({ model: name, args }); return DATA[name].map((r) => project(name, r, args)); };
    return {
        findMany: (args) => Promise.resolve(find(args)),
        findFirst: (args) => Promise.resolve(find(args)[0] || null),
        findUnique: (args) => Promise.resolve(find(args)[0] || null),
        count: () => Promise.resolve(DATA[name].length),
    };
}
jest.mock('../../services/prisma-database', () => ({
    prisma: { invoice: mockModel('invoice'), quote: mockModel('quote') },
}));

const invoiceService = require('../../services/invoice-service');
const quoteService = require('../../services/quote-service');

/** ชุดคอลัมน์ Application ที่หน้าจอการเงินใช้จริง — ไม่มีคอลัมน์อื่น */
const EXPECTED_APPLICATION_SELECT = {
    select: {
        id: true, applicationNumber: true, status: true, serviceType: true, areaType: true,
        entity: { select: { id: true, type: true, displayName: true } },
    },
};
const FORBIDDEN_KEYS = ['formData', 'workflowHistory', 'auditNotes', 'labResults', 'createdByIp', 'updatedByIp', 'meetingUrl',
    'passwordHash', 'totpSecret', 'juristicId', 'nationalId'];

function deepKeys(value, acc = new Set()) {
    if (Array.isArray(value)) { value.forEach((v) => deepKeys(v, acc)); }
    else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) { acc.add(k); deepKeys(v, acc); }
    }
    return acc;
}

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/invoices', require('../../routes/api/finance/invoices'));
    app.use('/api/quotes', require('../../routes/api/finance/quotes'));
    return app;
}

describe('S1 — ประตูการเงินคืนเฉพาะคอลัมน์บิล (router + service จริง บน prisma ปลอมที่ project ตาม select)', () => {
    const app = buildApp();

    test.each([
        ['GET /api/invoices', '/api/invoices'],
        ['GET /api/invoices/:id', '/api/invoices/inv-1'],
        ['GET /api/invoices/receipts/pending', '/api/invoices/receipts/pending'],
        ['GET /api/quotes', '/api/quotes'],
    ])('%s — body ไม่มี formData / workflowHistory / PII ใด ๆ', async (_name, url) => {
        const res = await request(app).get(url).set('x-test-role', 'finance_officer_platform');
        expect(res.status).toBe(200);
        const keys = deepKeys(res.body);
        for (const k of FORBIDDEN_KEYS) { expect([k, keys.has(k)]).toEqual([k, false]); }
        expect(JSON.stringify(res.body)).toContain('APP-2569-0001');
    });
});

describe('S1 — รูปของ query ที่ส่งลง prisma', () => {
    beforeEach(() => { mockCalls.length = 0; });

    test.each([
        ['listAll', () => invoiceService.listAll({})],
        ['listPendingReceipts', () => invoiceService.listPendingReceipts()],
        ['getById', () => invoiceService.getById('inv-1')],
    ])('invoice-service.%s ขอ application ด้วย select ชุดบิลเท่านั้น', async (_name, call) => {
        await call();
        const invoiceCalls = mockCalls.filter((c) => c.model === 'invoice');
        expect(invoiceCalls.length).toBeGreaterThan(0);
        for (const c of invoiceCalls) {
            const application = (c.args.include || c.args.select || {}).application;
            expect(application).toEqual(EXPECTED_APPLICATION_SELECT);
        }
    });

    test('quote-service.listForProvider ไม่ดึงทุก scalar ของ application', async () => {
        await quoteService.listForProvider({ page: 1, limit: 20 });
        const call = mockCalls.find((c) => c.model === 'quote');
        const application = (call.args.include || call.args.select).application;
        expect(application.include).toBeUndefined();
        expect(application.select).toBeDefined();
        expect(application.select.formData).toBeUndefined();
        expect(application.select.workflowHistory).toBeUndefined();
    });
});
