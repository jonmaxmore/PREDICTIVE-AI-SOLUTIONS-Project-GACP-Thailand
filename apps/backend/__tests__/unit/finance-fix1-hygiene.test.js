/**
 * fix round 1 (2026-09-27) — เรื่องเล็กที่ review ชี้ แต่ละข้อวัดกับโค้ดจริง
 *
 *   L1  403 ของประตูการเงินคืนแค่รหัส ไม่พิมพ์รายชื่อบทบาทที่ผ่านได้ / บทบาทของผู้เรียก
 *   L2  5xx ไม่คืน err.message ดิบ (ข้อความจากชั้นฐานข้อมูลอาจมีรายละเอียดภายใน)
 *   L5  การเงินกรมไม่ถือสิทธิ์เขียนที่ไม่มีประตูใช้ (บัญชีธนาคาร / รีวิวสลิป) · S6 ผู้ตรวจประเมิน
 *       ไม่ถือสิทธิ์อ่านสลิปการเงิน
 *   L7  getSummary ใช้ predicate เดียวกับ tenant-prisma-extension (ค่าที่ไม่ใช่ 'false' = เปิด)
 *   E3  ลบพารามิเตอร์ "ฝั่ง" ที่ไม่มีผู้เรียกแล้ว (ผนังอ่านที่ถูกรื้อ) ทั้งหลังบ้านและเว็บ
 *   —   ชุดบทบาทฝั่งเว็บมาจากที่เดียวและตรงกับหลังบ้าน
 */

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
    const auth = (req, res, next) => {
        const role = req.headers['x-test-role'];
        if (!role) { return res.status(401).json({ success: false }); }
        req.user = { id: 'user-1', role, organizationId: 'org-1' };
        return next();
    };
    return { authenticateProvider: auth, authenticateHealth: auth, authenticate: auth, authenticateAny: auth };
});
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});
const RAW = 'relation "purchase_invoices" does not exist at host db-internal-7';
jest.mock('../../services/prisma-database', () => {
    const boom = () => Promise.reject(new Error('relation "purchase_invoices" does not exist at host db-internal-7'));
    return {
        prisma: {
            purchaseInvoice: { create: boom, findMany: boom, findUnique: boom, findFirst: boom },
            invoice: { update: boom, findMany: boom, findUnique: boom, findFirst: boom, aggregate: boom, count: boom },
            creditNote: { create: boom, findMany: boom, findUnique: boom, findFirst: boom, count: boom, update: boom },
            debitNote: { create: boom, findMany: boom, findUnique: boom, findFirst: boom, count: boom, update: boom },
        },
    };
});
jest.mock('../../services/manual-journal-entry-service', () => ({ listDrafts: () => Promise.resolve([]), ACTIONS: {} }));
jest.mock('../../services/period-close-service', () => ({ getPeriodCloseStatus: () => Promise.resolve([]) }));

const REPO = path.join(__dirname, '../../../..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/finance/purchase-invoices', require('../../routes/api/finance/purchase-invoices'));
    a.use('/api/finance/wht', require('../../routes/api/finance/wht'));
    a.use('/api/finance/refunds', require('../../routes/api/finance/refunds'));
    a.use('/api/finance/manual-journal-entries', require('../../routes/api/finance/manual-journal-entries'));
    a.use('/api/finance/period-close', require('../../routes/api/finance/period-close'));
    a.use('/api/finance/credit-notes', require('../../routes/api/finance/credit-notes'));
    a.use('/api/finance/debit-notes', require('../../routes/api/finance/debit-notes'));
    return a;
}

describe('L1 — 403 คืนรหัส ไม่คืนรายชื่อบทบาท', () => {
    test.each([
        ['get', '/api/finance/manual-journal-entries'],
        ['get', '/api/finance/period-close'],
    ])('%s %s โดย document_reviewer', async (method, url) => {
        const res = await request(app())[method](url).set('x-test-role', 'document_reviewer').send({});
        expect(res.status).toBe(403);
        expect(res.body.code).toBeTruthy();
        const text = JSON.stringify(res.body);
        for (const role of ['system_admin_dtam', 'finance_officer_platform', 'finance_officer_dtam', 'document_reviewer']) {
            expect([role, text.includes(role)]).toEqual([role, false]);
        }
    });
});

describe('L2 — 5xx ไม่คืนข้อความดิบจากชั้นข้อมูล', () => {
    test.each([
        ['get', '/api/finance/purchase-invoices'],
        ['get', '/api/finance/wht/certificates'],
        ['get', '/api/finance/refunds/inv-1/status'],
        // fix round 2 N2 — CN/DN routers kept their own sendServiceError
        ['get', '/api/finance/credit-notes'],
        ['get', '/api/finance/credit-notes/n-1'],
        ['get', '/api/finance/debit-notes'],
        ['get', '/api/finance/debit-notes/n-1'],
    ])('%s %s', async (method, url) => {
        const res = await request(app())[method](url).set('x-test-role', 'finance_officer_platform');
        expect(res.status).toBeGreaterThanOrEqual(500);
        expect(JSON.stringify(res.body)).not.toContain(RAW);
        expect(JSON.stringify(res.body)).not.toContain('db-internal-7');
    });
});

describe('L5 + S6 — สิทธิ์ที่ไม่ควรถือ', () => {
    const { hasPermission, PERMISSIONS, CANONICAL_ROLES } = require('../../shared/canonical-rbac');
    test.each(['BANK_ACCOUNT_MANAGE', 'PAYMENT_SLIP_REVIEW', 'PAYMENT_SLIP_REVIEW_DTAM'])('finance_officer_dtam ไม่ถือ %s', (perm) => {
        expect(hasPermission(CANONICAL_ROLES.FINANCE_OFFICER_DTAM, PERMISSIONS[perm])).toBe(false);
    });
    test('field_inspector ไม่ถือ PAYMENT_SLIP_READ_ALL (เรื่องเงิน — operator 2026-09-27 S6)', () => {
        expect(hasPermission(CANONICAL_ROLES.FIELD_INSPECTOR, PERMISSIONS.PAYMENT_SLIP_READ_ALL)).toBe(false);
    });
});

describe('L7 — getSummary ใช้ predicate เดียวกับ tenant-prisma-extension', () => {
    test('invoice-service ไม่มี === \'true\' สำหรับ TENANT_READ_ORG_SCOPE และเรียก orgReadScopeEnabled()', () => {
        const src = read('apps/backend/services/invoice-service.js');
        expect(src).not.toMatch(/TENANT_READ_ORG_SCOPE\s*===\s*'true'/);
        expect(src).toMatch(/orgReadScopeEnabled\(\)/);
    });
});

describe('E3 — พารามิเตอร์ "ฝั่ง" ที่ไม่มีผู้เรียกถูกลบ', () => {
    test('arity ของฟังก์ชันที่เคยรับ sideWhere', () => {
        const invoiceService = require('../../services/invoice-service');
        const accountingService = jest.requireActual('../../services/accounting-service');
        expect(invoiceService.getSummary.length).toBe(2);
        expect(invoiceService.getRevenueSummary.length).toBe(2);
        expect(invoiceService.listPendingReceipts.length).toBe(0);
        // (orgId = null) has a default, so .length is 0 — check the parameter list itself
        expect(String(accountingService.getRootSummary).split(')')[0]).toBe('async getRootSummary(orgId = null');
        expect(String(accountingService.getDashboardStats).split(')')[0]).toBe('async getDashboardStats(orgId = null');
    });
    test.each([
        'apps/backend/services/invoice-service.js',
        'apps/backend/services/accounting-service.js',
        'apps/backend/services/invoice/invoice-finance-ops.js',
        'apps/backend/services/finance/invoice-side.js',
    ])('%s ไม่มี sideWhere / invoiceSideWhere', (rel) => {
        expect(read(rel)).not.toMatch(/sideWhere|invoiceSideWhere/);
    });
    test('routes/api/index.js ไม่มีคอมเมนต์ที่บอกว่าการเงินกรมถูกปฏิเสธ', () => {
        const src = read('apps/backend/routes/api/index.js');
        expect(src).not.toMatch(/ACCOUNT_DTAM is denied|DTAM books live in/);
    });
    test('เว็บ payment-service.ts ไม่มี InvoiceSide / classifyInvoiceSide ที่ไม่มีผู้ใช้', () => {
        const src = read('apps/web-app/src/lib/services/payment-service.ts');
        expect(src).not.toMatch(/classifyInvoiceSide|export type InvoiceSide/);
    });
});

describe('ชุดบทบาทฝั่งเว็บมาจากที่เดียวและตรงกับหลังบ้าน', () => {
    const src = read('apps/web-app/src/lib/constants/canonical-roles.ts');
    const { CANONICAL_ROLES, hasPermission, PERMISSIONS } = require('../../shared/canonical-rbac');
    const KEY = Object.fromEntries(Object.entries(CANONICAL_ROLES).map(([k, v]) => [k, v]));
    function webSet(name) {
        const m = src.match(new RegExp(`export const ${name}[^=]*= new Set<CanonicalRole>\\(\\[([\\s\\S]*?)\\]\\)`));
        expect([name, Boolean(m)]).toEqual([name, true]);
        return [...m[1].matchAll(/CANONICAL_ROLES\.(\w+)/g)].map((x) => KEY[x[1]]).sort();
    }
    const human = Object.values(CANONICAL_ROLES).filter((r) => r !== 'system');

    test('ACCOUNTING_READ_ROLES = ชุดอ่านของหลังบ้าน และชุดอ่านทุก service ตรงกัน', () => {
        const base = [...require('../../services/purchase-invoice-service').READ_ROLES].sort();
        for (const svc of ['refund-service', 'credit-note-service', 'debit-note-service']) {
            expect([svc, [...require(`../../services/${svc}`).READ_ROLES].sort()]).toEqual([svc, base]);
        }
        expect(webSet('ACCOUNTING_READ_ROLES')).toEqual(base);
    });
    test('ACCOUNTING_WRITE_ROLES = purchase-invoice-service WRITE_ROLES', () => {
        expect(webSet('ACCOUNTING_WRITE_ROLES')).toEqual([...require('../../services/purchase-invoice-service').WRITE_ROLES].sort());
    });
    test('RECEIPT_ISSUE_ROLES = ทุกบทบาทที่ถือ RECEIPT_ISSUE', () => {
        expect(webSet('RECEIPT_ISSUE_ROLES')).toEqual(human.filter((r) => hasPermission(r, PERMISSIONS.RECEIPT_ISSUE)).sort());
    });
    test('wht/client-view.tsx ไม่มีชุดบทบาทของตัวเอง', () => {
        const wht = read('apps/web-app/src/app/provider/accounting/wht/client-view.tsx');
        expect(wht).not.toMatch(/const READ_ROLES|const WRITE_ROLES/);
    });
});
