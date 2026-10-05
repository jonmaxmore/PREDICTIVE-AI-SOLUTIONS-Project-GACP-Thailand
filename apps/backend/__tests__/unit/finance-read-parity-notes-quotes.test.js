/**
 * E2 (engineering review 2026-09-27) + S6 (operator 2026-09-27)
 *
 * (A) "กรมฯ ดูอย่างเดียว" — การเงินกรมเห็นทุกอย่างที่การเงินบริษัทเห็น · สามประตูอ่านยังปฏิเสธ
 * การเงินกรมอยู่: รายการใบลดหนี้ (credit-note-service READ_ROLES), ใบเพิ่มหนี้ (debit-note-service
 * READ_ROLES) และรายการใบเสนอราคา (GET /api/quotes ใช้ financeOnly)
 * S6 — "ผู้ตรวจประเมินไม่ต้องเห็นเรื่องเงิน": งานตรวจถึงมือผู้ตรวจหลังจ่ายเงินแล้ว
 *
 * ของจริง: router · ด่านบทบาท · credit-note / debit-note / quote service
 * ของปลอม: การยืนยันตัวตน · prisma (คืนแถวคงที่ชุดเดียว ไม่สะท้อนอาร์กิวเมนต์)
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
    const providerAuth = (req, res, next) => {
        const role = req.headers['x-test-role'];
        if (!role || role === 'health') { return res.status(401).json({ success: false }); }
        req.user = { id: 'user-1', role, organizationId: 'org-1' };
        return next();
    };
    const anyAuth = (req, res, next) => {
        const role = req.headers['x-test-role'];
        if (!role) { return res.status(401).json({ success: false }); }
        req.user = { id: 'user-1', role, organizationId: 'org-1' };
        return next();
    };
    return { authenticateProvider: providerAuth, authenticateHealth: anyAuth, authenticate: anyAuth, authenticateAny: anyAuth };
});
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});
jest.mock('../../services/prisma-database', () => {
    const note = {
        id: 'n-1', noteNumber: 'CN-2569-0001', organizationId: 'org-1', status: 'ISSUED', subtotal: 100, vat: 7, totalAmount: 107,
        originalInvoiceId: 'inv-1', createdAt: '2026-09-20T00:00:00Z',
    };
    const quote = { id: 'q-1', quoteNumber: 'QT-2569-0001', status: 'SENT', totalAmount: 35310, createdAt: '2026-09-10T00:00:00Z', application: { id: 'app-1', applicationNumber: 'APP-1' } };
    const ok = (v) => () => Promise.resolve(v);
    return {
        prisma: {
            creditNote: { create: ok({}), findMany: ok([note]), findUnique: ok(note) },
            debitNote: { create: ok({}), findMany: ok([{ ...note, noteNumber: 'DN-2569-0001' }]), findUnique: ok(note) },
            quote: { findMany: ok([quote]), count: ok(1) },
        },
    };
});

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/finance/credit-notes', require('../../routes/api/finance/credit-notes'));
    app.use('/api/finance/debit-notes', require('../../routes/api/finance/debit-notes'));
    app.use('/api/quotes', require('../../routes/api/finance/quotes'));
    app.use((err, _req, res, _next) => {
        if (err && err.name === 'AuthorizationError') { return res.status(403).json({ success: false }); }
        return res.status(500).json({ success: false });
    });
    return app;
}

const DOORS = [
    '/api/finance/credit-notes',
    '/api/finance/credit-notes/n-1',
    '/api/finance/debit-notes',
    '/api/finance/debit-notes/n-1',
    '/api/quotes',
];
const NOT_FINANCE = ['field_inspector', 'certificate_approver', 'document_reviewer', 'dispatcher', 'health'];

describe('E2 — การเงินสองบทบาทอ่านใบลดหนี้ ใบเพิ่มหนี้ ใบเสนอราคา ได้คำตอบเดียวกัน', () => {
    const app = buildApp();

    test.each(DOORS)('GET %s — dtam = platform ทั้ง status และ body และเป็น 200', async (url) => {
        const [d, p] = await Promise.all(['finance_officer_dtam', 'finance_officer_platform']
            .map((role) => request(app).get(url).set('x-test-role', role)));
        expect({ status: d.status, body: d.body }).toEqual({ status: p.status, body: p.body });
        expect(p.status).toBe(200);
    });
});

describe('S6 + ไม่ใช่การเงิน — ถูกปฏิเสธทุกประตูอ่านในไฟล์นี้', () => {
    const app = buildApp();
    const cases = DOORS.flatMap((url) => NOT_FINANCE.map((role) => [role, url]));

    test.each(cases)('%s → GET %s ได้ 401/403', async (role, url) => {
        const res = await request(app).get(url).set('x-test-role', role);
        expect([401, 403]).toContain(res.status);
    });
});
