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
 * invoice-helpers.findHealthInvoice). R1 (operator ruling C1) keeps the pre-R1
 * rows exactly: the 9616ccdf where of each door is the registered legacy OR
 * branch and the AND pin (R1-legacy-pin, removed in Task 12).
 *
 * Route-level unit: the service is stubbed, canonical-rbac is real, holderScope
 * is stubbed. The same doors run on a real Postgres with the real middlewares and
 * the witness in throw mode in
 * __tests__/integration/applicant-billing-holder-real-postgres.test.js, and the
 * R1 neutrality matrix in r1-billing-doors-neutral-real-postgres.test.js.
 */

const mockActor = { current: null };
jest.mock('../../middleware/auth-middleware', () => {
    const attach = (req, _res, next) => {
        req.user = { ...mockActor.current.user };
        if (mockActor.current.activeEntity) { req.activeEntity = { ...mockActor.current.activeEntity }; }
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

describe('GET /api/invoices/my reads by holder (P6, review I-1; Task 5)', () => {
    afterEach(() => jest.restoreAllMocks());

    it('hands the service the request\'s holder scope, plus the pre-R1 identity and workspace (R1-legacy-pin)', async () => {
        const activeEntity = { entityId: 'entity-personal', role: 'OWNER', personal: true };
        mockActor.current = { user: OWNER, activeEntity };
        const list = jest.spyOn(invoiceService, 'listForHolders').mockResolvedValue([]);
        mockHolderScope.mockClear();

        const res = await request(buildApp()).get('/api/invoices/my');

        expect(res.status).toBe(200);
        expect(list).toHaveBeenCalledWith({
            scope: SCOPE, status: undefined, r1Legacy: { healthId: OWNER.canonicalId, activeEntity },
        });
        expect(mockHolderScope).toHaveBeenCalledTimes(1);
    });

    it('no active workspace: the pre-R1 workspace is null, never a broad question', async () => {
        mockActor.current = { user: OWNER };
        const list = jest.spyOn(invoiceService, 'listForHolders').mockResolvedValue([]);

        await request(buildApp()).get('/api/invoices/my');

        expect(list).toHaveBeenCalledWith({
            scope: SCOPE, status: undefined, r1Legacy: { healthId: OWNER.canonicalId, activeEntity: null },
        });
    });
});

// The pre-R1 (9616ccdf) wheres, verbatim: R1 keeps each as the registered legacy
// OR branch and as the AND pin, so the rows stay exactly the pre-R1 rows.
const OWN_NULL_ENTITY = {
    healthId: 'canon-owner',
    OR: [{ applicationId: null }, { application: { is: { entityId: null } } }],
};
const FRAGMENT = { application: { entityId: { in: ['entity-personal', 'entity-company'] } } };

// Values only: the HOLDER_SCOPED marker is a symbol key, checked on its own below.
const plain = (value) => JSON.parse(JSON.stringify(value));

function expectHolderShape(where, legacy) {
    const { hasHolderMarker } = require('../../services/holder-marker');
    // The holder fragment and the legacy branch sit in one top-level OR, both marked
    // (and registered); the pin is the AND member.
    expect(plain(where.OR)).toEqual([FRAGMENT, legacy]);
    expect(hasHolderMarker({ OR: where.OR })).toBe(true);
    expect(plain(where.AND)).toEqual([legacy]);
    // No filer key and no relation key at the top level: nothing outside OR/AND decides the rows.
    expect(where).not.toHaveProperty('healthId');
    expect(where).not.toHaveProperty('application');
    expect(where.isDeleted).toBe(false);
}

describe('invoice-service.listForHolders — the holder fragment, with the pre-R1 rows kept (Task 5)', () => {
    let findMany;
    beforeEach(() => {
        const { prisma } = require('../../services/prisma-database');
        findMany = jest.spyOn(prisma.invoice, 'findMany').mockResolvedValue([]);
    });
    afterEach(() => jest.restoreAllMocks());

    it('company workspace: the pre-R1 entity where (no filer pin) beside the fragment', async () => {
        await invoiceService.listForHolders({
            scope: SCOPE, r1Legacy: { healthId: 'canon-owner', activeEntity: { entityId: 'entity-company', personal: false } },
        });
        expectHolderShape(findMany.mock.calls[0][0].where, { application: { is: { entityId: 'entity-company' } } });
    });

    it('personal workspace: the personal entity\'s invoices plus the caller\'s own entity-less ones', async () => {
        await invoiceService.listForHolders({
            scope: SCOPE, r1Legacy: { healthId: 'canon-owner', activeEntity: { entityId: 'entity-personal', personal: true } },
        });
        expectHolderShape(findMany.mock.calls[0][0].where, {
            OR: [{ application: { is: { entityId: 'entity-personal' } } }, OWN_NULL_ENTITY],
        });
    });

    it('no active workspace: only the caller\'s own entity-less invoices, and a warning', async () => {
        const logger = require('../../shared/logger');
        const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
        await invoiceService.listForHolders({ scope: SCOPE, r1Legacy: { healthId: 'canon-owner', activeEntity: null } });
        expectHolderShape(findMany.mock.calls[0][0].where, OWN_NULL_ENTITY);
        expect(warn).toHaveBeenCalled();
    });

    it('the status filter is added beside the scope', async () => {
        await invoiceService.listForHolders({
            scope: SCOPE, status: 'pending', r1Legacy: { healthId: 'canon-owner', activeEntity: { entityId: 'entity-company' } },
        });
        expect(findMany.mock.calls[0][0].where.status).toBeDefined();
    });

    it('no active workspace and no caller identity: no query at all', async () => {
        const logger = require('../../shared/logger');
        jest.spyOn(logger, 'warn').mockImplementation(() => {});
        await expect(invoiceService.listForHolders({ scope: SCOPE, r1Legacy: { healthId: '', activeEntity: null } })).resolves.toEqual([]);
        expect(findMany).not.toHaveBeenCalled();
    });

    it.each([[undefined], [null], [{ userId: 'u' }]])('no holder scope (%p): fail closed, no query', async (scope) => {
        await expect(invoiceService.listForHolders({
            scope, r1Legacy: { healthId: 'canon-owner', activeEntity: { entityId: 'entity-company' } },
        })).resolves.toEqual([]);
        expect(findMany).not.toHaveBeenCalled();
    });
});

describe('findHealthInvoice — one scoped read; R1 keeps the pre-R1 membership/filer rule and 403/404 (Task 5)', () => {
    let findFirst;
    beforeEach(() => {
        const { prisma } = require('../../services/prisma-database');
        findFirst = jest.spyOn(prisma.invoice, 'findFirst');
    });
    afterEach(() => jest.restoreAllMocks());

    // assertHealthOwnsInvoice (9616ccdf) as a where: an ACTIVE membership, any role,
    // on the application's entity; or, with no entity, the filer pin.
    const NO_ENTITY = { OR: [{ applicationId: null }, { application: { is: { entityId: null } } }] };
    const OWNER_RULE = {
        OR: [
            { application: { is: { entity: { is: { members: { some: { userId: 'user-owner', status: 'ACTIVE' } } } } } } },
            { AND: [NO_ENTITY, { OR: [{ healthId: 'canon-owner' }, { applicant: { is: { id: 'user-owner' } } }] }] },
        ],
    };
    const r1Owner = { userId: 'user-owner', healthId: 'canon-owner' };
    const helpers = () => require('../../routes/api/finance/invoice-helpers');

    it('reads by id through the holder fragment (findFirst, never findUnique) and returns the row', async () => {
        findFirst.mockResolvedValueOnce(paidInvoice());
        const invoice = await helpers().findHealthInvoice('inv-paid', SCOPE, { r1Owner });
        expect(invoice.id).toBe('inv-paid');
        expect(findFirst).toHaveBeenCalledTimes(1);
        const { where } = findFirst.mock.calls[0][0];
        expect(where.id).toBe('inv-paid');
        expectHolderShape(where, OWNER_RULE);
    });

    it('not readable but live: 403 as pre-R1 (R2/Task 12: 404)', async () => {
        findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'inv-paid' });
        await expect(helpers().findHealthInvoice('inv-paid', SCOPE, { r1Owner })).rejects.toMatchObject({ statusCode: 403 });
        const existence = findFirst.mock.calls[1][0];
        expect(plain(existence.where)).toEqual({ id: 'inv-paid', isDeleted: false });
        expect(require('../../services/holder-marker').hasHolderMarker(existence.where)).toBe(true);
        expect(existence.select).toEqual({ id: true });
    });

    it('missing or soft-deleted: 404', async () => {
        findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
        await expect(helpers().findHealthInvoice('inv-gone', SCOPE, { r1Owner })).rejects.toMatchObject({ statusCode: 404 });
    });

    it('only the filer pin when the caller has no user id; matches nothing with no identity', async () => {
        findFirst.mockResolvedValue(null);
        await helpers().findHealthInvoice('inv-paid', SCOPE, { r1Owner: { healthId: 'canon-owner' } }).catch(() => {});
        expectHolderShape(findFirst.mock.calls[0][0].where, {
            OR: [{ AND: [NO_ENTITY, { OR: [{ healthId: 'canon-owner' }] }] }],
        });
        findFirst.mockClear();
        await helpers().findHealthInvoice('inv-paid', SCOPE, { r1Owner: {} }).catch(() => {});
        expect(plain(findFirst.mock.calls[0][0].where.AND)).toEqual([{ id: { in: [] } }]);
    });

    it('no holder scope: 404 with no query (fail closed)', async () => {
        await expect(helpers().findHealthInvoice('inv-paid', undefined, { r1Owner })).rejects.toMatchObject({ statusCode: 404 });
        expect(findFirst).not.toHaveBeenCalled();
    });
});

describe('the owner doors gate before they render, and render through the same scoped read (Task 5)', () => {
    let render;
    beforeEach(() => {
        render = jest.spyOn(invoiceService, 'generateReceiptPdf').mockResolvedValue(Buffer.from('%PDF-1.4 receipt'));
    });
    afterEach(() => jest.restoreAllMocks());

    const r1Owner = { userId: OWNER.id, healthId: OWNER.canonicalId };

    it('the receipt door passes the scope and the pre-R1 identity to the gate and to the renderer', async () => {
        mockActor.current = { user: OWNER };
        const gate = jest.spyOn(invoiceService, 'getForHolder').mockResolvedValue(paidInvoice());

        const res = await request(buildApp()).get('/api/invoices/my/inv-paid/receipt/pdf');

        expect(res.status).toBe(200);
        expect(gate).toHaveBeenCalledWith('inv-paid', { scope: SCOPE, r1Owner });
        expect(render).toHaveBeenCalledWith('inv-paid', { scope: SCOPE, r1Owner });
    });

    it('the invoice PDF door: refused (403) never renders', async () => {
        mockActor.current = { user: STRANGER };
        jest.spyOn(invoiceService, 'getForHolder').mockResolvedValue(null);
        jest.spyOn(invoiceService, 'r1LiveInvoiceExists').mockResolvedValue(true);
        const pdf = jest.spyOn(invoiceService, 'generatePdf').mockResolvedValue(Buffer.from('%PDF'));

        const res = await request(buildApp()).get('/api/invoices/inv-paid/pdf');

        expect(res.status).toBe(403);
        expect(pdf).not.toHaveBeenCalled();
    });

    it('the invoice PDF door renders through the scoped read', async () => {
        mockActor.current = { user: OWNER };
        jest.spyOn(invoiceService, 'getForHolder').mockResolvedValue(paidInvoice());
        const pdf = jest.spyOn(invoiceService, 'generatePdf').mockResolvedValue(Buffer.from('%PDF'));

        const res = await request(buildApp()).get('/api/invoices/inv-paid/pdf');

        expect(res.status).toBe(200);
        expect(pdf).toHaveBeenCalledWith('inv-paid', { scope: SCOPE, r1Owner });
    });

    it('a soft-deleted or missing invoice is 404 on both owner doors, and nothing renders', async () => {
        mockActor.current = { user: OWNER };
        jest.spyOn(invoiceService, 'getForHolder').mockResolvedValue(null);
        jest.spyOn(invoiceService, 'r1LiveInvoiceExists').mockResolvedValue(false);
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
        await invoiceService.getForDocument('inv-1', { scope: SCOPE, r1Owner: { userId: 'user-owner', healthId: 'canon-owner' } });
        expect(findFirst.mock.calls[0][0].where.id).toBe('inv-1');
        expect(plain(findFirst.mock.calls[0][0].where.OR[0])).toEqual(FRAGMENT);
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

    it('refuses someone else\'s invoice with 403 and never renders it', async () => {
        mockActor.current = { user: STRANGER };
        jest.spyOn(invoiceService, 'getForHolder').mockResolvedValue(null);
        jest.spyOn(invoiceService, 'r1LiveInvoiceExists').mockResolvedValue(true);

        const res = await request(buildApp()).get('/api/invoices/my/inv-paid/receipt/pdf');

        expect(res.status).toBe(403);
        expect(render).not.toHaveBeenCalled();
    });

    it('answers 404 for an invoice that does not exist', async () => {
        mockActor.current = { user: OWNER };
        jest.spyOn(invoiceService, 'getForHolder').mockResolvedValue(null);
        jest.spyOn(invoiceService, 'r1LiveInvoiceExists').mockResolvedValue(false);

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
