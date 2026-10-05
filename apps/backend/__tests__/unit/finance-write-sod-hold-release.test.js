'use strict';

/**
 * Bundle A (multi-role system test 2026-06-24, P1) — write-side SoD on the
 * invoice-by-id mutations hold / release / forfeit. #545 closed the READ side
 * (receipt queues + export); these WRITE mutations still skipped the side check,
 * so a single-side accountant could hold/release/forfeit the OPPOSITE wallet's
 * invoice. Now gated by assertInvoiceSideWritable (mirror of approveSlip/rejectSlip)
 * → 403 INVALID_REVIEWER_SIDE. invoiceVisibleSide + classifyInvoiceSide are REAL.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
    const headerUser = (req, res, next) => {
        const role = req.headers['x-test-role'];
        if (!role) { return res.status(401).json({ success: false }); }
        req.user = { id: 'u1', role, canonicalRole: role, organizationId: 'org-1' };
        return next();
    };
    return { authenticateProvider: headerUser, authenticateAny: headerUser, authenticateHealth: headerUser };
});
jest.mock('../../shared/canonical-rbac', () => jest.requireActual('../../shared/canonical-rbac'));
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

const mockGetById = jest.fn();
const mockHoldInvoice = jest.fn().mockResolvedValue({ id: 'inv-1' });
const mockReleaseHold = jest.fn().mockResolvedValue({ id: 'inv-1' });
const mockForfeitRevenue = jest.fn().mockResolvedValue({ id: 'inv-1' });
jest.mock('../../services/invoice-service', () => ({
    getById: (...a) => mockGetById(...a),
    holdInvoice: (...a) => mockHoldInvoice(...a),
    releaseHold: (...a) => mockReleaseHold(...a),
    forfeitRevenue: (...a) => mockForfeitRevenue(...a),
}));
jest.mock('../../services/financial-export-service', () => ({ exportCSV: jest.fn() }));
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

const STATE_INVOICE = { id: 'inv-1', serviceType: 'DOC_REVIEW_STATE_FEE' };      // → DTAM
const PLATFORM_INVOICE = { id: 'inv-1', serviceType: 'DOC_REVIEW_PLATFORM_FEE' }; // → PLATFORM

describe('Bundle A — write-side SoD on hold/release/forfeit', () => {
    let app;
    beforeAll(() => { app = buildApp(); });
    beforeEach(() => jest.clearAllMocks());

    // operator 2026-09-27 "กรมฯ ดูอย่างเดียว" — การเงินกรมไม่มี RECEIPT_ISSUE แล้ว ⇒ ถูกปฏิเสธที่ด่าน
    // สิทธิ์ก่อนถึงด่านฝั่ง ไม่ว่าใบจะเป็นฝั่งไหน · เดิม: PLATFORM → 403 INVALID_REVIEWER_SIDE และ
    // STATE → 200 (hold ได้)
    test.each([['PLATFORM', PLATFORM_INVOICE], ['STATE', STATE_INVOICE]])(
        'account_dtam CANNOT hold a %s invoice → 403 at the permission gate, mutation not called',
        async (_side, invoice) => {
            mockGetById.mockResolvedValue(invoice);
            const res = await request(app).post('/api/invoices/inv-1/hold').set('x-test-role', 'finance_officer_dtam').send({ reason: 'x' });
            expect(res.status).toBe(403);
            expect(mockHoldInvoice).not.toHaveBeenCalled();
            expect(mockGetById).not.toHaveBeenCalled();
        },
    );

    test('account_platform CAN hold a PLATFORM invoice → proceeds (mutation called)', async () => {
        mockGetById.mockResolvedValue(PLATFORM_INVOICE);
        const res = await request(app).post('/api/invoices/inv-1/hold').set('x-test-role', 'finance_officer_platform').send({ reason: 'x' });
        expect(res.status).toBe(200);
        expect(mockHoldInvoice).toHaveBeenCalledTimes(1);
    });

    test('account_platform CANNOT release a STATE invoice → 403', async () => {
        mockGetById.mockResolvedValue(STATE_INVOICE);
        const res = await request(app).post('/api/invoices/inv-1/release').set('x-test-role', 'finance_officer_platform').send({});
        expect(res.status).toBe(403);
        expect(mockReleaseHold).not.toHaveBeenCalled();
    });

    // Wave 0: the /forfeit endpoint was removed (zero callers). The write-side
    // SoD wall is still pinned above through hold/release, which share the
    // same assertInvoiceSideWritable gate the forfeit route used.

    test('missing invoice → 404', async () => {
        mockGetById.mockResolvedValue(null);
        const res = await request(app).post('/api/invoices/inv-1/hold').set('x-test-role', 'finance_officer_platform').send({ reason: 'x' });
        expect(res.status).toBe(404);
    });
});
