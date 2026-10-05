'use strict';
/**
 * A quotation on a money path is resolved by the APPLICATION, never by who
 * happens to be pressing the button (F-G4-64 final round, R6).
 *
 * This branch put 'Quotation' in TENANT_SCOPED_MODELS
 * (services/tenant-prisma-extension.js), so with a tenant context bound every
 * findMany/findFirst on quotations is narrowed to the CALLER's organization.
 * Two of the new paths do not run under the applicant:
 *
 *   - recordPhaseInvoiced from an ACCOUNT reviewer's slip approval, and from
 *     settlement (a webhook worker with whatever context the request bound);
 *   - the gate's row lookup, which both rails call before minting anything.
 *
 * For an applicant outside the acting staff member's organization the lookup
 * would find no row: the gate would refuse a legitimate payment as
 * QUOTATION_NOT_ISSUED, and the closure would silently never happen (a
 * logger.error and nothing else). Both lookups therefore run inside
 * withoutTenantScope, which is what `isWithoutTenantScope()` reports here.
 *
 * The context is REAL (services/tenant-context AsyncLocalStorage), not a mock:
 * the thing under test is whether the escape hatch is actually entered.
 */

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: () => l, stream: { write: jest.fn() } };
});

const { runWithTenantContext, isWithoutTenantScope } = require('../../services/tenant-context');

/** Every lookup records whether it ran inside the escape hatch. */
const seen = [];
const ROW = {
    id: 'qt-1',
    applicationId: 'app-1',
    issuerType: 'PLATFORM',
    status: 'ACCEPTED',
    isDeleted: false,
    validUntil: new Date('2026-12-31T00:00:00.000Z'),
    installments: [{ phase: 'PHASE_1' }, { phase: 'PHASE_2' }],
    phase1InvoicedAt: null,
    phase2InvoicedAt: null,
    acceptedSnapshot: null,
    notes: null,
};

let mockPrisma;
jest.mock('../../services/prisma-database', () => ({
    get prisma() { return mockPrisma; },
}));

beforeEach(() => {
    seen.length = 0;
    mockPrisma = {
        quotation: {
            findFirst: jest.fn(async () => {
                seen.push({ op: 'findFirst', unscoped: isWithoutTenantScope() });
                return { ...ROW };
            }),
            findMany: jest.fn(async () => {
                seen.push({ op: 'findMany', unscoped: isWithoutTenantScope() });
                return [{ ...ROW }];
            }),
            update: jest.fn(async ({ data }) => ({ ...ROW, ...data })),
            updateMany: jest.fn(async () => ({ count: 0 })),
        },
    };
});

const FOREIGN = { organizationId: 'org-the-accountants-own' };

describe('recordPhaseInvoiced resolves the document under withoutTenantScope', () => {
    it('the by-id lookup (settlement, order-bound) is not narrowed by the actor`s org', async () => {
        const { recordPhaseInvoiced } = require('../../services/quotation-service');

        await runWithTenantContext(FOREIGN, () => recordPhaseInvoiced({
            quotationId: 'qt-1', milestone: 'M1', at: new Date('2026-08-29T00:00:00.000Z'),
        }));

        expect(seen).toContainEqual({ op: 'findFirst', unscoped: true });
    });

    it('the applicationId fallback (slip approval by an ACCOUNT reviewer) is not narrowed either', async () => {
        const { recordPhaseInvoiced } = require('../../services/quotation-service');

        await runWithTenantContext(FOREIGN, () => recordPhaseInvoiced({
            applicationId: 'app-1', milestone: 'M1', chargedAmount: null,
            at: new Date('2026-08-29T00:00:00.000Z'),
        }));

        expect(seen).toContainEqual({ op: 'findMany', unscoped: true });
    });
});

describe('the gate resolves the row under withoutTenantScope', () => {
    it('a bound foreign tenant context does not turn a real quotation into QUOTATION_NOT_ISSUED', async () => {
        const { assertQuotationAcceptedForPayment } = require('../../services/billing/quotation-gate');

        const out = await runWithTenantContext(FOREIGN, () => assertQuotationAcceptedForPayment({
            applicationId: 'app-1', milestone: 'M1',
        }));

        expect(out.quotation.id).toBe('qt-1');
        expect(seen).toContainEqual({ op: 'findMany', unscoped: true });
    });
});

describe('the applicant`s own read is untouched', () => {
    it('findQuotationsByApplicationId called with no context bound still reads', async () => {
        const { findQuotationsByApplicationId } = require('../../services/quotation-service');
        const out = await findQuotationsByApplicationId('app-1');
        expect(out.platform.id).toBe('qt-1');
    });
});
