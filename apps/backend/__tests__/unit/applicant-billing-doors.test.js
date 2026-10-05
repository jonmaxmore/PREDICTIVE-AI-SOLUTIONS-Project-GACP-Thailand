'use strict';

/**
 * The applicant's billing doors (staging walk 2026-09-29, defects P1 + P6).
 *
 * P1 — after payment the only PDF the applicant could download was the
 *      invoice ("ใบวางบิล / ใบแจ้งหนี้"); the receipt the system issued
 *      (TAX-PRD-…) sat behind a staff-only door
 *      (routes/api/finance/invoice-payment-handlers.js GET /:id/receipt/pdf).
 *      The owner now has GET /api/invoices/my/:invoiceId/receipt/pdf, with the
 *      same ownership check as GET /:invoiceId/pdf, for a PAID invoice that
 *      carries a receipt number. Anything else is refused BEFORE a render.
 *
 * P6 — GET /api/invoices/my returned every invoice the account ever paid,
 *      whichever workspace was active, while /api/applications/my followed the
 *      active workspace. The list now asks for the active entity's invoices only.
 *
 * Task 5 (2026-09-30-remove-workspace-mode): the list and both owner doors read
 * Invoice through the holder fragment (invoiceService.listForHolders,
 * invoice-helpers.findHealthInvoice). R2 Task 12: the fragment alone decides
 * (no filer pin, no workspace); an invoice outside it is 404, never 403.
 *
 * Route-level unit: the service is stubbed, canonical-rbac is real, holderScope
 * is stubbed. The same doors run on a real Postgres with the real middlewares and
 * the witness in throw mode in
 * __tests__/integration/applicant-billing-holder-real-postgres.test.js, and the
 * R1→R2 matrix in r1-billing-doors-neutral-real-postgres.test.js.
 */

const mockActor = { current: null };
jest.mock('../../middleware/auth-middleware', () => {
    const attach = (req, _res, next) => {
        req.user = { ...mockActor.current.user };
        return next();
    };
    return { authenticateProvider: attach, authenticateHealth: attach, authenticateAny: attach };
});

const SCOPE = Object.freeze({ userId: 'user-owner', readIds: ['entity-personal', 'entity-company'], editIds: [] });
const mockHolderScope = jest.fn(async () => SCOPE);
jest.mock('../../services/holder-access', () => ({
    ...jest.requireActual('../../services/holder-access'),
    holderScope: (...args) => mockHolderScope(...args),
}));

const express = require('express');
const request = require('supertest');
const invoiceService = require('../../services/invoice-service');

const OWNER = { id: 'user-owner', canonicalId: 'canon-owner', role: 'health', canonicalRole: 'health' };
const STRANGER = { id: 'user-stranger', canonicalId: 'canon-stranger', role: 'health', canonicalRole: 'health' };

function paidInvoice(overrides = {}) {
    return {
        id: 'inv-paid',
        invoiceNumber: 'INV-CO-TEST-M1',
        healthId: OWNER.canonicalId,
        applicant: { id: OWNER.id },
        status: 'RECEIPT_ISSUED',
        receiptNumber: 'TAX-PRD-2026-000002',
        ...overrides,
    };
}

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/invoices', require('../../routes/api/finance/invoices'));
    return app;
}

function binaryParser(res, callback) {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('GET /api/invoices/my reads by holder (P6, review I-1; Task 5, R2 Task 12)', () => {
    afterEach(() => jest.restoreAllMocks());

    it('hands the service the request\'s holder scope and nothing else (no workspace, no filer)', async () => {
        mockActor.current = { user: OWNER };
        const list = jest.spyOn(invoiceService, 'listForHolders').mockResolvedValue([]);
        mockHolderScope.mockClear();

        const res = await request(buildApp()).get('/api/invoices/my');

        expect(res.status).toBe(200);
        expect(list).toHaveBeenCalledWith({ scope: SCOPE, status: undefined });
        expect(mockHolderScope).toHaveBeenCalledTimes(1);
    });
});

const FRAGMENT = { application: { entityId: { in: ['entity-personal', 'entity-company'] } } };

// Values only: the HOLDER_SCOPED marker is a symbol key, checked on its own below.
const plain = (value) => JSON.parse(JSON.stringify(value));

function expectHolderShape(where) {
    const { hasHolderMarker } = require('../../services/holder-marker');
    // R2 Task 12: the holder fragment alone, spread at the top level; no OR legacy
    // branch, no AND pin, no filer key.
    expect(plain(where.application)).toEqual(FRAGMENT.application);
    expect(hasHolderMarker(where)).toBe(true);
    expect(where).not.toHaveProperty('OR');
    expect(where).not.toHaveProperty('AND');
    expect(where).not.toHaveProperty('healthId');
    expect(where.isDeleted).toBe(false);
}

describe('invoice-service.listForHolders — the holder fragment alone (Task 5, R2 Task 12)', () => {
    let findMany;
    beforeEach(() => {
        const { prisma } = require('../../services/prisma-database');
        findMany = jest.spyOn(prisma.invoice, 'findMany').mockResolvedValue([]);
    });
    afterEach(() => jest.restoreAllMocks());

    it('every invoice of the caller\'s holders: the fragment, nothing else', async () => {
        await invoiceService.listForHolders({ scope: SCOPE });
        expectHolderShape(findMany.mock.calls[0][0].where);
    });

    it('the status filter is added beside the scope', async () => {
        await invoiceService.listForHolders({ scope: SCOPE, status: 'pending' });
        expect(findMany.mock.calls[0][0].where.status).toBeDefined();
        expectHolderShape(findMany.mock.calls[0][0].where);
    });

    it.each([[undefined], [null], [{ userId: 'u' }]])('no holder scope (%p): fail closed, no query', async (scope) => {
        await expect(invoiceService.listForHolders({ scope })).resolves.toEqual([]);
        expect(findMany).not.toHaveBeenCalled();
    });
});

describe('findHealthInvoice — one scoped read, 404 for everything outside it (Task 5, R2 Task 12)', () => {
    let findFirst;
    beforeEach(() => {
        const { prisma } = require('../../services/prisma-database');
        findFirst = jest.spyOn(prisma.invoice, 'findFirst');
    });
    afterEach(() => jest.restoreAllMocks());

    const helpers = () => require('../../routes/api/finance/invoice-helpers');

    it('reads by id through the holder fragment (findFirst, never findUnique) and returns the row', async () => {
        findFirst.mockResolvedValueOnce(paidInvoice());
        const invoice = await helpers().findHealthInvoice('inv-paid', SCOPE);
        expect(invoice.id).toBe('inv-paid');
        expect(findFirst).toHaveBeenCalledTimes(1);
        const { where } = findFirst.mock.calls[0][0];
        expect(where.id).toBe('inv-paid');
        expectHolderShape(where);
    });

    it('not readable (live or not): 404 after the one read, never a 403 existence probe', async () => {
        findFirst.mockResolvedValueOnce(null);
        await expect(helpers().findHealthInvoice('inv-paid', SCOPE)).rejects.toMatchObject({ statusCode: 404 });
        expect(findFirst).toHaveBeenCalledTimes(1);
        expect(invoiceService.r1LiveInvoiceExists).toBeUndefined();
    });

    it('no holder scope: 404 with no query (fail closed)', async () => {
        await expect(helpers().findHealthInvoice('inv-paid', undefined)).rejects.toMatchObject({ statusCode: 404 });
        expect(findFirst).not.toHaveBeenCalled();
    });
});

describe('the owner doors gate before they render, and render through the same scoped read (Task 5)', () => {
    let render;
    beforeEach(() => {
        render = jest.spyOn(invoiceService, 'generateReceiptPdf').mockResolvedValue(Buffer.from('%PDF-1.4 receipt'));
    });
    afterEach(() => jest.restoreAllMocks());

    it('the receipt door passes the scope to the gate and to the renderer', async () => {
        mockActor.current = { user: OWNER };
        const gate = jest.spyOn(invoiceService, 'getForHolder').mockResolvedValue(paidInvoice());

        const res = await request(buildApp()).get('/api/invoices/my/inv-paid/receipt/pdf');

        expect(res.status).toBe(200);
        expect(gate).toHaveBeenCalledWith('inv-paid', { scope: SCOPE });
        expect(render).toHaveBeenCalledWith('inv-paid', { scope: SCOPE });
    });

    it('the invoice PDF door: outside the scope (404) never renders', async () => {
        mockActor.current = { user: STRANGER };
        jest.spyOn(invoiceService, 'getForHolder').mockResolvedValue(null);
        const pdf = jest.spyOn(invoiceService, 'generatePdf').mockResolvedValue(Buffer.from('%PDF'));

        const res = await request(buildApp()).get('/api/invoices/inv-paid/pdf');

        expect(res.status).toBe(404);
        expect(pdf).not.toHaveBeenCalled();
    });

    it('the invoice PDF door renders through the scoped read', async () => {
        mockActor.current = { user: OWNER };
        jest.spyOn(invoiceService, 'getForHolder').mockResolvedValue(paidInvoice());
        const pdf = jest.spyOn(invoiceService, 'generatePdf').mockResolvedValue(Buffer.from('%PDF'));

        const res = await request(buildApp()).get('/api/invoices/inv-paid/pdf');

        expect(res.status).toBe(200);
        expect(pdf).toHaveBeenCalledWith('inv-paid', { scope: SCOPE });
    });

    it('a soft-deleted or missing invoice is 404 on both owner doors, and nothing renders', async () => {
        mockActor.current = { user: OWNER };
        jest.spyOn(invoiceService, 'getForHolder').mockResolvedValue(null);
        const pdf = jest.spyOn(invoiceService, 'generatePdf').mockResolvedValue(Buffer.from('%PDF'));

        expect((await request(buildApp()).get('/api/invoices/my/inv-paid/receipt/pdf')).status).toBe(404);
        expect((await request(buildApp()).get('/api/invoices/inv-paid/pdf')).status).toBe(404);
        expect(render).not.toHaveBeenCalled();
        expect(pdf).not.toHaveBeenCalled();
    });
});

describe('invoice-service scoped document read (Task 5)', () => {
    afterEach(() => jest.restoreAllMocks());

    it('getForDocument with a scope adds the holder where; without one (staff, worker) it keeps { id }', async () => {
        const { prisma } = require('../../services/prisma-database');
        const findFirst = jest.spyOn(prisma.invoice, 'findFirst').mockResolvedValue(null);
        await invoiceService.getForDocument('inv-1', { scope: SCOPE });
        expect(findFirst.mock.calls[0][0].where.id).toBe('inv-1');
        expect(plain(findFirst.mock.calls[0][0].where.application)).toEqual(FRAGMENT.application);
        await invoiceService.getForDocument('inv-1');
        expect(findFirst.mock.calls[1][0].where).toEqual({ id: 'inv-1' });
    });
});

describe('GET /api/invoices/my/:invoiceId/receipt/pdf — the owner\'s receipt (P1)', () => {
    let render;
    beforeEach(() => {
        render = jest.spyOn(invoiceService, 'generateReceiptPdf').mockResolvedValue(Buffer.from('%PDF-1.4 receipt'));
    });
    afterEach(() => jest.restoreAllMocks());

    it('serves the receipt PDF to the owner of a paid invoice that carries a receipt number', async () => {
        mockActor.current = { user: OWNER };
        jest.spyOn(invoiceService, 'getForHolder').mockResolvedValue(paidInvoice());

        const res = await request(buildApp()).get('/api/invoices/my/inv-paid/receipt/pdf')
            .buffer(true).parse(binaryParser);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/application\/pdf/);
        expect(res.headers['content-disposition']).toContain('TAX-PRD-2026-000002');
        expect(render).toHaveBeenCalledWith('inv-paid', expect.objectContaining({ scope: SCOPE }));
        expect(res.body.toString()).toContain('receipt');
    });

    it('accepts the lower-case "paid" status the demo register stores', async () => {
        mockActor.current = { user: OWNER };
        jest.spyOn(invoiceService, 'getForHolder').mockResolvedValue(paidInvoice({ status: 'paid' }));

        const res = await request(buildApp()).get('/api/invoices/my/inv-paid/receipt/pdf');

        expect(res.status).toBe(200);
        expect(render).toHaveBeenCalledTimes(1);
    });

    it('refuses someone else\'s invoice with 404 (R2 Task 12: never told apart from a missing one) and never renders it', async () => {
        mockActor.current = { user: STRANGER };
        jest.spyOn(invoiceService, 'getForHolder').mockResolvedValue(null);

        const res = await request(buildApp()).get('/api/invoices/my/inv-paid/receipt/pdf');

        expect(res.status).toBe(404);
        expect(render).not.toHaveBeenCalled();
    });

    it('answers 404 for an invoice that does not exist', async () => {
        mockActor.current = { user: OWNER };
        jest.spyOn(invoiceService, 'getForHolder').mockResolvedValue(null);

        const res = await request(buildApp()).get('/api/invoices/my/missing/receipt/pdf');

        expect(res.status).toBe(404);
        expect(render).not.toHaveBeenCalled();
    });

    it.each([
        ['unpaid', { status: 'PENDING', receiptNumber: null }],
        ['paid but no receipt number yet', { status: 'PAID_PENDING_RECEIPT', receiptNumber: null }],
        ['cancelled after a receipt', { status: 'CANCELLED' }],
    ])('refuses an invoice that is %s with 409 RECEIPT_NOT_ISSUED', async (_label, overrides) => {
        mockActor.current = { user: OWNER };
        jest.spyOn(invoiceService, 'getForHolder').mockResolvedValue(paidInvoice(overrides));

        const res = await request(buildApp()).get('/api/invoices/my/inv-paid/receipt/pdf');

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('RECEIPT_NOT_ISSUED');
        expect(render).not.toHaveBeenCalled();
    });

    it('leaves the staff receipt door behind INVOICE_VIEW_ALL (an applicant is still 403 there)', async () => {
        mockActor.current = { user: OWNER };
        jest.spyOn(invoiceService, 'getForHolder').mockResolvedValue(paidInvoice());

        const res = await request(buildApp()).get('/api/invoices/inv-paid/receipt/pdf');

        expect(res.status).toBe(403);
        expect(render).not.toHaveBeenCalled();
    });
});

describe('the error register agrees with the door (review m10)', () => {
    it('RECEIPT_NOT_ISSUED is a 409 in the register, as both doors answer it', () => {
        const { ERROR_CODES } = require('../../shared/error-codes');
        expect(ERROR_CODES.RECEIPT_NOT_ISSUED.httpStatus).toBe(409);
    });
});
