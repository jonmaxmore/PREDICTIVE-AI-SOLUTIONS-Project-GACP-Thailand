'use strict';
/**
 * "Which states count as the applicant having accepted" is ONE vocabulary, and
 * services/billing/quotation-gate.js owns it (review r1, finding 2).
 *
 * Two rails and a settlement path already read QUOTATION_ACCEPTED_STATES from
 * the gate: payment-slip-service deleted its private copy for this exact reason
 * (its tombstone comment is at payment-slip-service.js:442), and
 * checkout-settlement-service imports the constant rather than re-typing it.
 * The one place that still carried a private copy was
 * recordPhaseInvoiced - the function that decides whether INVOICED may be
 * written at all, and whether the row is marked INVOICED_WITHOUT_ACCEPTANCE.
 *
 * Failure this pins: a later change to what "accepted" means (say a
 * PARTIALLY_INVOICED state) lands in the gate; the gate and settlement agree,
 * and recordPhaseInvoiced silently keeps treating the new state as
 * never-accepted - stamping without flipping, and writing
 * INVOICED_WITHOUT_ACCEPTANCE onto a row that WAS accepted. Nothing turns red,
 * because no test compared the constant with the literal array.
 *
 * The mock below IS the test: it moves the vocabulary and asserts the money
 * module moved with it. No database, no gate call - only where the list is read
 * from.
 */
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: () => l };
});

// A THIRD accepted state, declared in the one place that owns the vocabulary.
jest.mock('../../services/billing/quotation-gate', () => {
    const actual = jest.requireActual('../../services/billing/quotation-gate');
    return {
        ...actual,
        QUOTATION_ACCEPTED_STATES: Object.freeze(['ACCEPTED', 'INVOICED', 'PARTIALLY_INVOICED']),
    };
});

const mockRows = new Map();
const mockUpdate = jest.fn(async ({ where, data }) => {
    const row = { ...mockRows.get(where.id), ...data };
    mockRows.set(where.id, row);
    return row;
});
/**
 * The close is a guarded updateMany now (final round R4): the question "is
 * every instalment this document prices billed?" is asked of the DATABASE, so
 * the vocabulary travels in the WHERE clause instead of in an if. That is where
 * this suite now reads it from.
 */
const mockUpdateMany = jest.fn(async ({ where, data }) => {
    const row = mockRows.get(where.id);
    if (!row) { return { count: 0 }; }
    if (where.status && !where.status.in.includes(row.status)) { return { count: 0 }; }
    for (const [field, cond] of Object.entries(where)) {
        if (field === 'id' || field === 'status') { continue; }
        if (cond && cond.not === null && !row[field]) { return { count: 0 }; }
    }
    mockRows.set(where.id, { ...row, ...data });
    return { count: 1 };
});
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        quotation: {
            findFirst: jest.fn(async ({ where }) => {
                const row = mockRows.get(where.id);
                if (!row || (where.isDeleted === false && row.isDeleted)) { return null; }
                return { ...row };
            }),
            findMany: jest.fn(async () => []),
            update: (...a) => mockUpdate(...a),
            updateMany: (...a) => mockUpdateMany(...a),
        },
    },
}));

const { recordPhaseInvoiced } = require('../../services/quotation-service');

const AT = new Date('2026-08-29T10:00:00.000Z');

beforeEach(() => {
    jest.clearAllMocks();
    mockRows.clear();
    mockRows.set('qt-1', {
        id: 'qt-1',
        applicationId: 'app_1',
        issuerType: 'PLATFORM',
        status: 'PARTIALLY_INVOICED',
        isDeleted: false,
        installments: [
            { phase: 'PHASE_1', serviceFeeAmount: 5500, vatAmount: 385, scopeCount: 1 },
            { phase: 'PHASE_2', serviceFeeAmount: 27500, vatAmount: 1925, scopeCount: 1 },
        ],
        phase1InvoicedAt: new Date('2026-08-20T00:00:00.000Z'),
        phase2InvoicedAt: null,
        notes: null,
    });
});

test('a state the gate calls accepted is treated as accepted when the last instalment is billed', async () => {
    const r = await recordPhaseInvoiced({
        quotationId: 'qt-1', milestone: 'M2', invoiceNumber: 'TAX-PRD-2026-000009', at: AT,
    });

    const written = mockUpdate.mock.calls[0][0].data;
    // The stamp carries the fact this caller knows; the close is decided
    // against the row's own columns.
    expect(written.phase2InvoicedAt).toBe(AT);
    // The third state travels into the guard, so the document closes.
    expect(mockUpdateMany.mock.calls[0][0].where.status.in).toContain('PARTIALLY_INVOICED');
    expect(mockRows.get('qt-1').status).toBe('INVOICED');
    expect(r.closed).toBe(true);
    // and it is NOT libelled as billed without an acceptance.
    expect(written.notes).toBeUndefined();
});
