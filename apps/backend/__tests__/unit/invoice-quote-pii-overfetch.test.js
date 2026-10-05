/**
 * SEC — invoice and quote reads must not ship the applicant's credentials.
 *
 * `invoice-service.getById()` used `include: { applicant: true, application: {
 * include: { entity: true } } }`. In Prisma, `include: true` returns EVERY
 * column of the related row, so the object handed to `res.json()` carried the
 * applicant's bcrypt password hash, TOTP secret and password-reset token, plus
 * the Entity's plaintext Thai national ID and juristic ID.
 *
 * `quote-service.updateQuote()` had the same shape via
 * `include: { application: { include: { applicant: true } } }`.
 *
 * The routes serialise the service result directly
 * (routes/api/finance/invoices.js:132 — `res.json({ success: true, data: invoice })`),
 * so anything the query returns reaches the client. The endpoints are gated on
 * a provider role holding INVOICE_VIEW_ALL — that is finance staff, not the
 * applicant. A TOTP secret in that payload is a permanent 2FA bypass for the
 * applicant's account, and a bcrypt hash is an offline cracking target.
 *
 * These tests assert on the SHAPE OF THE PRISMA QUERY rather than on a mocked
 * response body: the defect is that the query asks for too much, and pinning
 * the query is what stops a future edit from widening it back to `true`.
 */

'use strict';

const SENSITIVE = [
    'password',
    'twoFactorSecret',
    'mfaSecret',
    'resetToken',
    'resetTokenExpiry',
    'refreshToken',
];

/**
 * An `include: true` (or a select that names a sensitive column) is the defect.
 * A `select` listing only display fields is the fix.
 */
function assertRelationIsNarrow(relationValue, label) {
    expect(relationValue).toBeDefined();
    // `true` means "every column" — the exact bug.
    expect(relationValue).not.toBe(true);
    expect(typeof relationValue).toBe('object');

    const select = relationValue.select;
    expect(select).toBeDefined();

    for (const field of SENSITIVE) {
        expect(Object.prototype.hasOwnProperty.call(select, field)).toBe(false);
    }
    // A narrow select must actually name what it wants.
    expect(Object.keys(select).length).toBeGreaterThan(0);
    expect(label).toBeTruthy();
}

describe('SEC — invoice detail does not over-fetch the applicant', () => {
    let prismaMock;
    let invoiceService;

    beforeEach(() => {
        jest.resetModules();
        prismaMock = {
            invoice: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
        };
        jest.doMock('../../services/prisma-database', () => ({ prisma: prismaMock }));
        // eslint-disable-next-line global-require
        invoiceService = require('../../services/invoice-service');
    });

    it('selects only display fields from the applicant, never credentials', async () => {
        const svc = invoiceService.getById ? invoiceService : invoiceService.default;
        await svc.getById('inv-1');

        expect(prismaMock.invoice.findFirst).toHaveBeenCalled();
        const args = prismaMock.invoice.findFirst.mock.calls[0][0];
        assertRelationIsNarrow(args.include.applicant, 'invoice.applicant');
    });

    it('selects only display fields from the application entity, never the national ID', async () => {
        const svc = invoiceService.getById ? invoiceService : invoiceService.default;
        await svc.getById('inv-1');

        const args = prismaMock.invoice.findFirst.mock.calls[0][0];
        // S1 (2026-09-27): application itself is now a narrow `select` (billing columns)
        expect(args.include.application.include).toBeUndefined();
        expect(args.include.application.select.formData).toBeUndefined();
        const entity = args.include.application.select.entity;
        assertRelationIsNarrow(entity, 'invoice.application.entity');

        const select = entity.select;
        for (const idField of ['nationalId', 'idCard', 'taxId', 'juristicId']) {
            expect(Object.prototype.hasOwnProperty.call(select, idField)).toBe(false);
        }
    });
});

describe('SEC — quote status update does not echo the applicant row', () => {
    let prismaMock;
    let quoteService;

    beforeEach(() => {
        jest.resetModules();
        prismaMock = { quote: { update: jest.fn(async () => ({})) } };
        jest.doMock('../../services/prisma-database', () => ({ prisma: prismaMock }));
        // eslint-disable-next-line global-require
        quoteService = require('../../services/quote-service');
    });

    it('narrows the nested applicant include on updateQuote', async () => {
        const svc = quoteService.updateQuote ? quoteService : quoteService.default;
        await svc.updateQuote('quote-1', { status: 'ACCEPTED' });

        expect(prismaMock.quote.update).toHaveBeenCalled();
        const args = prismaMock.quote.update.mock.calls[0][0];
        // S1 (2026-09-27): application is a narrow `select`; its applicant is narrow too
        expect(args.include.application.include).toBeUndefined();
        assertRelationIsNarrow(args.include.application.select.applicant, 'quote.application.applicant');
    });
});
