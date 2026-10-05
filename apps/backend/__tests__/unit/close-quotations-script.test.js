'use strict';
/**
 * The repair closes the quotations of applications that paid in full through
 * checkout BEFORE the acceptance gate existed — WITHOUT inventing an
 * acceptance that never happened (F-G4-64 R5).
 *
 * Expected on the register of 2026-08-28 (register.md B, E, Q2):
 *   QT-PRD-2026-000001 (A1) — M1 + M2 SETTLED  -> close
 *   QT-PRD-2026-000002 (A3) — M1 + M2 SETTLED  -> close
 *   QT-PRD-2026-000003 (A4) — nothing paid     -> leave PENDING, correctly
 *   A2 (29422e73)           — no quotation row -> nothing to close, and nothing
 *                             is created: ledger F-G4-68 records that 35,310 THB
 *                             was collected with no pricing document.
 *
 * Requiring this module must never construct a PrismaClient (pattern:
 * __tests__/unit/bind-checkout-receipts-script.test.js).
 */
const path = require('path');

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn() }));

const { PrismaClient } = require('@prisma/client');
const { planQuotationClosures, summarise, parseArgs } = require(path.join(
    __dirname, '..', '..', 'scripts', 'close-quotations-settled-before-gate'));

const M1_AT = new Date('2026-08-25T12:18:48.000Z');
const M2_AT = new Date('2026-08-25T12:39:26.000Z');

const twoPhase = [
    { phase: 'PHASE_1', amount: 5885, serviceFeeAmount: 5500, vatAmount: 385, scopeCount: 1 },
    { phase: 'PHASE_2', amount: 29425, serviceFeeAmount: 27500, vatAmount: 1925, scopeCount: 1 },
];

function quotation(over = {}) {
    return {
        id: 'qt-1',
        quotationNumber: 'QT-PRD-2026-000001',
        status: 'PENDING',
        acceptedAt: null,
        notes: null,
        phase1InvoicedAt: null,
        phase2InvoicedAt: null,
        installments: twoPhase,
        application: {
            id: 'app-1',
            checkoutOrders: [
                { milestone: 'M1', status: 'SETTLED', settledAt: M1_AT },
                { milestone: 'M2', status: 'SETTLED', settledAt: M2_AT },
            ],
        },
        ...over,
    };
}

test('requiring the script constructs no PrismaClient', () => {
    expect(PrismaClient).not.toHaveBeenCalled();
});

test('a fully settled quotation is closed with each phase stamped from its own order', () => {
    const { closures, skipped } = planQuotationClosures({ quotations: [quotation()] });
    expect(skipped).toHaveLength(0);
    expect(closures).toHaveLength(1);
    expect(closures[0].data).toMatchObject({
        status: 'INVOICED',
        phase1InvoicedAt: M1_AT,
        phase2InvoicedAt: M2_AT,
    });
});

test('it never writes an acceptance that did not happen', () => {
    const { closures } = planQuotationClosures({ quotations: [quotation()] });
    expect(closures[0].data).not.toHaveProperty('acceptedAt');
    expect(closures[0].data).not.toHaveProperty('acceptedBy');
    expect(closures[0].data).not.toHaveProperty('acceptedSnapshot');
    expect(closures[0].data).not.toHaveProperty('acceptedSnapshotHash');
});

test('the note says exactly what happened, and keeps any note already there', () => {
    const { closures } = planQuotationClosures({ quotations: [quotation({ notes: 'เดิม' })] });
    expect(closures[0].data.notes).toContain('เดิม');
    expect(closures[0].data.notes).toMatch(
        /CLOSED_BY_REPAIR 2026-08-28 F-G4-64: settled via checkout before the acceptance gate; no acceptance recorded/);
});

test('an unpaid quotation is left alone (A4 is correctly PENDING)', () => {
    const { closures, skipped } = planQuotationClosures({
        quotations: [quotation({
            id: 'qt-3', quotationNumber: 'QT-PRD-2026-000003',
            application: { id: 'app-4', checkoutOrders: [] },
        })],
    });
    expect(closures).toHaveLength(0);
    expect(skipped).toEqual([{ quotationNumber: 'QT-PRD-2026-000003', reason: 'NOT_FULLY_SETTLED' }]);
});

test('a partially settled quotation is left alone: half-paid is not closed', () => {
    const { closures, skipped } = planQuotationClosures({
        quotations: [quotation({
            application: { id: 'app-1', checkoutOrders: [{ milestone: 'M1', status: 'SETTLED', settledAt: M1_AT }] },
        })],
    });
    expect(closures).toHaveLength(0);
    expect(skipped[0].reason).toBe('NOT_FULLY_SETTLED');
});

test('an order that is not SETTLED does not count as paid', () => {
    const { closures } = planQuotationClosures({
        quotations: [quotation({
            application: { id: 'app-1', checkoutOrders: [
                { milestone: 'M1', status: 'SETTLED', settledAt: M1_AT },
                { milestone: 'M2', status: 'PENDING_PAYMENT', settledAt: null },
            ] },
        })],
    });
    expect(closures).toHaveLength(0);
});

test('a renewal quotation (PHASE_2 only) closes on its single settled M2', () => {
    const { closures } = planQuotationClosures({
        quotations: [quotation({
            installments: [twoPhase[1]],
            application: { id: 'app-r', checkoutOrders: [{ milestone: 'M2', status: 'SETTLED', settledAt: M2_AT }] },
        })],
    });
    expect(closures).toHaveLength(1);
    expect(closures[0].data.phase2InvoicedAt).toBe(M2_AT);
    expect(closures[0].data).not.toHaveProperty('phase1InvoicedAt');
});

test('an already-closed quotation is skipped, not re-stamped', () => {
    const { closures, skipped } = planQuotationClosures({
        quotations: [quotation({ status: 'INVOICED', phase1InvoicedAt: M1_AT, phase2InvoicedAt: M2_AT })],
    });
    expect(closures).toHaveLength(0);
    expect(skipped[0].reason).toBe('ALREADY_CLOSED');
});

test('an ACCEPTED quotation is skipped: the live settlement path owns it now', () => {
    const { closures, skipped } = planQuotationClosures({
        quotations: [quotation({ status: 'ACCEPTED', acceptedAt: new Date() })],
    });
    expect(closures).toHaveLength(0);
    expect(skipped[0].reason).toBe('ACCEPTED_NOT_A_REPAIR_CASE');
});

test('the whole register of 2026-08-28 plans exactly 2 closures', () => {
    const { closures } = planQuotationClosures({
        quotations: [
            quotation(),
            quotation({ id: 'qt-2', quotationNumber: 'QT-PRD-2026-000002', application: {
                id: 'app-3', checkoutOrders: [
                    { milestone: 'M1', status: 'SETTLED', settledAt: M1_AT },
                    { milestone: 'M2', status: 'SETTLED', settledAt: M2_AT },
                ] } }),
            quotation({ id: 'qt-3', quotationNumber: 'QT-PRD-2026-000003', application: { id: 'app-4', checkoutOrders: [] } }),
        ],
    });
    expect(closures.map((c) => c.quotationNumber)).toEqual(['QT-PRD-2026-000001', 'QT-PRD-2026-000002']);
});

/**
 * Review r0 MINOR 1 — spec §3.7 says the repair closes "ใบ PENDING": the planner
 * must select PENDING rows, not "everything that is not already accepted".
 * QUOTATION_STATUS also holds DRAFT (the schema default), SENT, REJECTED and
 * EXPIRED. A REJECTED row stamped INVOICED would keep its rejectedAt and open
 * the pay gate on a document the applicant refused — a self-contradicting row on
 * a money register, written by the script whose whole purpose is not to
 * manufacture records.
 */
describe('only a PENDING row is a repair case', () => {
    for (const status of ['DRAFT', 'SENT', 'REJECTED', 'EXPIRED']) {
        test(`a ${status} quotation is skipped even when both instalments are settled`, () => {
            const { closures, skipped } = planQuotationClosures({
                quotations: [quotation({ status })],
            });
            expect(closures).toHaveLength(0);
            expect(skipped).toEqual([
                { quotationNumber: 'QT-PRD-2026-000001', reason: 'NOT_A_PENDING_ROW' },
            ]);
        });
    }

    test('PENDING still closes (pin: the repair case itself must not be locked out)', () => {
        const { closures } = planQuotationClosures({ quotations: [quotation({ status: 'PENDING' })] });
        expect(closures).toHaveLength(1);
    });
});

/**
 * Review r0 MINOR 2 — the operator approves --apply from the printed table, so
 * the table must be readable as a before/after. Printing only the PLANNED status
 * reads as "this row's status column is null in the register" on every KEEP row.
 */
describe('the printed decision shows the register as it is and as it would become', () => {
    test('a CLOSE row shows PENDING before and INVOICED after, with both stamps', () => {
        const row = quotation();
        const { closures } = planQuotationClosures({ quotations: [row] });
        expect(summarise('CLOSE', row, closures[0].data, 'F-G4-64 repair')).toEqual({
            decision: 'CLOSE',
            quotation: 'QT-PRD-2026-000001',
            statusBefore: 'PENDING',
            statusAfter: 'INVOICED',
            phase1Before: null,
            phase1After: M1_AT.toISOString(),
            phase2Before: null,
            phase2After: M2_AT.toISOString(),
            reason: 'F-G4-64 repair',
        });
    });

    test('a KEEP row shows its own status on both sides, never null', () => {
        const row = quotation({
            id: 'qt-3', quotationNumber: 'QT-PRD-2026-000003',
            application: { id: 'app-4', checkoutOrders: [] },
        });
        const { skipped } = planQuotationClosures({ quotations: [row] });
        expect(summarise('KEEP', row, null, skipped[0].reason)).toEqual({
            decision: 'KEEP',
            quotation: 'QT-PRD-2026-000003',
            statusBefore: 'PENDING',
            statusAfter: 'PENDING',
            phase1Before: null,
            phase1After: null,
            phase2Before: null,
            phase2After: null,
            reason: 'NOT_FULLY_SETTLED',
        });
    });

    test('a KEEP row that already carries stamps prints them unchanged on both sides', () => {
        const row = quotation({ status: 'ACCEPTED', acceptedAt: M1_AT, phase1InvoicedAt: M1_AT });
        const { skipped } = planQuotationClosures({ quotations: [row] });
        const line = summarise('KEEP', row, null, skipped[0].reason);
        expect(line.statusBefore).toBe('ACCEPTED');
        expect(line.statusAfter).toBe('ACCEPTED');
        expect(line.phase1Before).toBe(M1_AT.toISOString());
        expect(line.phase1After).toBe(M1_AT.toISOString());
        expect(line.reason).toBe('ACCEPTED_NOT_A_REPAIR_CASE');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Whole-branch review S23 — `parseArgs` is exported so it can be tested, and
// was not. It is the only mechanical safeguard on an operator-run write to a
// money table: --apply refuses without an --expect count that survives
// Number.isInteger, and an unknown flag stops the run rather than being
// ignored. These are PINS: the behaviour below is what the script already does,
// and they exist so a later edit cannot loosen it silently.
// ─────────────────────────────────────────────────────────────────────────────
describe('parseArgs — the --apply/--expect safety contract', () => {
    test('no arguments is a dry run with nothing expected and nowhere to write evidence', () => {
        expect(parseArgs([])).toEqual({ apply: false, expect: null, evidence: null });
    });

    test.each([
        [['--apply', '--expect=2']],
        [['--apply', '--expect', '2']],
    ])('%j parses to apply with an integer expectation', (argv) => {
        const args = parseArgs(argv);
        expect(args.apply).toBe(true);
        expect(args.expect).toBe(2);
        expect(Number.isInteger(args.expect)).toBe(true);
    });

    test.each([
        [['--apply', '--expect=abc']],
        [['--apply', '--expect']],
    ])('%j yields an expectation that --apply refuses', (argv) => {
        const args = parseArgs(argv);
        expect(args.apply).toBe(true);
        // main() gates the transaction on Number.isInteger(args.expect); NaN and
        // undefined both fail it, which is what makes them safe.
        expect(Number.isInteger(args.expect)).toBe(false);
    });

    test('--evidence takes the next argument as the directory', () => {
        expect(parseArgs(['--evidence', 'evidence/f-g4-64-task-12'])).toEqual({
            apply: false, expect: null, evidence: 'evidence/f-g4-64-task-12',
        });
    });

    test('an unknown argument stops the run instead of being ignored', () => {
        expect(() => parseArgs(['--bogus'])).toThrow(/unknown argument: --bogus/);
    });

    test('a dry run is the default: --expect alone never turns on the write', () => {
        expect(parseArgs(['--expect=3']).apply).toBe(false);
    });
});
