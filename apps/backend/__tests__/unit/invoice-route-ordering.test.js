'use strict';

/**
 * L7 regression — the literal finance routes /invoices/revenue-summary and
 * /invoices/split-calculator live in the mounted invoice-payment-handlers
 * sub-router. They were UNREACHABLE because the single-segment param route
 * `GET /:invoiceId` was registered BEFORE the sub-router mount, so a request
 * to /revenue-summary matched `/:invoiceId` (invoiceId='revenue-summary') →
 * getById('revenue-summary') → 404 "Invoice not found". The fix moves the
 * sub-router mount above `/:invoiceId`. This test pins reachability + that the
 * genuine `/:invoiceId` route still works (no shadow regression the other way).
 *
 * Auth is mocked to attach an ADMIN req.user; canonical-rbac stays REAL so the
 * inline requirePermission(INVOICE_VIEW_ALL) gate is exercised, not stubbed.
 */
jest.mock('../../middleware/auth-middleware', () => {
  const attach = (req, _res, next) => {
    req.user = {
      id: 'user-1',
      role: req.headers['x-test-role'] || 'system_admin_dtam',
      canonicalRole: req.headers['x-test-canonical-role'] || 'system_admin_dtam',
      organizationId: 'org-1',
      providerId: 'provider-1',
    };
    return next();
  };
  return { authenticateProvider: attach, authenticateHealth: attach, authenticateAny: attach };
});

const express = require('express');
const request = require('supertest');
const invoiceService = require('../../services/invoice-service');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/invoices', require('../../routes/api/finance/invoices'));
  return app;
}

describe('finance/invoices route ordering (L7)', () => {
  beforeEach(() => {
    jest.spyOn(invoiceService, 'getById').mockResolvedValue(null);
    jest.spyOn(invoiceService, 'getRevenueSummary').mockResolvedValue({ stateRevenue: '0.00' });
  });
  afterEach(() => jest.restoreAllMocks());

  it('GET /invoices/revenue-summary reaches the revenue handler, not /:invoiceId', async () => {
    const res = await request(buildApp()).get('/invoices/revenue-summary');
    expect(res.status).toBe(200);
    expect(invoiceService.getRevenueSummary).toHaveBeenCalled();
    expect(invoiceService.getById).not.toHaveBeenCalledWith('revenue-summary');
  });

  it('GET /invoices/:invoiceId still routes to the param handler (no reverse shadow)', async () => {
    const res = await request(buildApp()).get('/invoices/real-invoice-uuid');
    expect(invoiceService.getById).toHaveBeenCalledWith('real-invoice-uuid');
    expect(res.status).toBe(404); // getById mocked → null → "Invoice not found"
  });
});
