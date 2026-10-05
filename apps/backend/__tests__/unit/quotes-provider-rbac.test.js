/**
 * SEC-FIN-001 / SEC-APP-001 regression — the provider quote→invoice and
 * document-renumber routes must be gated to FINANCE roles (account/admin),
 * not merely "any authenticated provider". A non-finance provider (e.g. an
 * auditor) must receive 403 AND the quote-service mutation must NOT fire.
 *
 * The test wires the REAL canonical `financeOnly` gate (role-middleware) so it
 * proves the contract rather than a mock.
 *
 * See docs/handoffs/audit-2026-05-31/security/SEC-FIN.md (SEC-FIN-001).
 */
'use strict';

const express = require('express');
const request = require('supertest');

// role-middleware imports prisma-database at module load; stub it — the gate
// only reads req.user.role, never the DB.
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

// quote-service is the side-effect surface — spy every method the routes call.
jest.mock('../../services/quote-service', () => ({
    findByIdWithApplicationSlim: jest.fn(),
    generateInvoiceNumberSequential: jest.fn(),
    createInvoiceFromQuote: jest.fn(),
    updateStatus: jest.fn(),
    findQuoteByNumber: jest.fn(),
    findInvoiceByNumber: jest.fn(),
    updateQuoteNumber: jest.fn(),
    updateInvoiceNumber: jest.fn(),
}));

const quoteService = require('../../services/quote-service');
const { financeOnly } = require('../../middleware/role-middleware'); // REAL canonical gate
const { registerQuoteProviderAdminRoutes } = require('../../routes/api/helpers/quotes-provider-routes');

// Header-based stand-in for authenticateProvider: attaches req.user.role.
const headerAuth = (req, res, next) => {
    const role = req.headers['x-test-role'];
    if (!role) { return res.status(401).json({ success: false, error: 'Unauthorized' }); }
    req.user = { id: 'u1', role, providerId: 'p1' };
    return next();
};

function buildApp() {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerQuoteProviderAdminRoutes({
        router,
        authenticateProvider: headerAuth,
        financeOnly,
        logger: { error: jest.fn(), info: jest.fn() },
    });
    app.use('/api/quotes', router);
    // Mirror the app's global error handler so AuthorizationError → 403.
    app.use((err, _req, res, _next) => {
        res.status(err.statusCode || err.status || 500).json({ success: false, error: err.message });
    });
    return app;
}

let app;
beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
});

describe('SEC-FIN-001 — finance-role gate on quote→invoice / renumber', () => {
    test('AUDITOR cannot mint an invoice from a quote (403, no service write)', async () => {
        const res = await request(app)
            .post('/api/quotes/q1/invoice')
            .set('x-test-role', 'field_inspector')
            .send({});
        expect(res.status).toBe(403);
        expect(quoteService.createInvoiceFromQuote).not.toHaveBeenCalled();
    });

    test('AUDITOR cannot renumber a tax document (403, no service write)', async () => {
        const res = await request(app)
            .put('/api/quotes/q1/number')
            .set('x-test-role', 'field_inspector')
            .send({ type: 'invoice', newNumber: 'INV-FAKE' });
        expect(res.status).toBe(403);
        expect(quoteService.updateInvoiceNumber).not.toHaveBeenCalled();
    });

    test('ACCOUNT role CAN mint an invoice (gate passes → handler runs)', async () => {
        quoteService.findByIdWithApplicationSlim.mockResolvedValue({
            id: 'q1', status: 'accepted', application: { healthId: 'h1' },
        });
        quoteService.generateInvoiceNumberSequential.mockResolvedValue('INV-001');
        quoteService.createInvoiceFromQuote.mockResolvedValue({ id: 'inv1', invoiceNumber: 'INV-001' });
        quoteService.updateStatus.mockResolvedValue({});

        const res = await request(app)
            .post('/api/quotes/q1/invoice')
            .set('x-test-role', 'finance_officer_platform')
            .send({});

        expect(res.status).toBe(201);
        expect(quoteService.createInvoiceFromQuote).toHaveBeenCalledTimes(1);
    });

    test('ADMIN is also allowed (not 403)', async () => {
        quoteService.findByIdWithApplicationSlim.mockResolvedValue(null); // handler then 404s
        const res = await request(app)
            .post('/api/quotes/q1/invoice')
            .set('x-test-role', 'system_admin_dtam')
            .send({});
        expect(res.status).not.toBe(403);
    });

    test('anonymous (no token) is rejected at auth (401)', async () => {
        const res = await request(app).post('/api/quotes/q1/invoice').send({});
        expect(res.status).toBe(401);
        expect(quoteService.createInvoiceFromQuote).not.toHaveBeenCalled();
    });
});
