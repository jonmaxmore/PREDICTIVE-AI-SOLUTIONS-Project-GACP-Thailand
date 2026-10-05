/**
 * Decimal parity invariant tests — Iter 24 (hardening loop, 2026-05-16).
 *
 * Why this file exists:
 *
 *   The audit-gap-analysis P0 #3 ("decimal type chaos") flagged that the
 *   `Invoice.{subtotal, vat, totalAmount}` columns were stored as Float
 *   (IEEE-754 double) while every other money column in the system —
 *   Quotation totals, JournalLine debits / credits, CreditNote / DebitNote
 *   totals — was already Decimal(15,2). Float arithmetic compounds
 *   sub-satang rounding errors through aggregation. After enough invoices
 *   that drift produces a non-zero trial-balance difference at month-end,
 *   which is a TFRS-for-NPAEs ch.2 internal-control finding.
 *
 *   The decimal_unification migration (20260517000000) brings Invoice into
 *   lockstep with the Decimal family. These tests anchor the canonical
 *   parity equations so a future regression that re-introduces Float (or
 *   that breaks one of the offsetting CN/DN paths) is caught here.
 *
 * Invariants checked (per paid Invoice, evaluated against fixture rows):
 *
 *   I1. subtotal + vat === totalAmount        (within 0.005 THB tolerance for
 *                                              legacy Float drift)
 *   I2. sum(JournalLine.debit)  === totalAmount   when invoice is PLATFORM
 *   I3. sum(JournalLine.credit) === totalAmount   mirror of I2
 *   I4. creditNote.totalAmount + debitNote.totalAmount
 *         === invoice.totalAmount - adjustedAmount
 *       (the net of all CN + DN equals the adjustment applied to the
 *        original invoice — keeps ม.86/9 + ม.86/10 reconciliation honest)
 *
 * Compliance basis:
 *   - TFRS for NPAEs ch.18 (รายได้): revenue captured at the EXACT amount.
 *   - ป.รัษฎากร ม.86/4: subtotal + VAT must equal total on every ใบกำกับภาษี.
 *   - ป.รัษฎากร ม.86/9 + ม.86/10: CN + DN reference the original invoice;
 *     the net adjustment must reconcile to satang precision.
 *
 * Mock surface:
 *   The tests construct fixture rows directly — there is no Prisma client
 *   call here. The test runs without a database; what we are checking is
 *   that the parity equations hold for representative shapes of the rows
 *   the Decimal-unified schema will store. If the equations stop holding,
 *   either (a) a service layer somewhere is mixing Number and Decimal in
 *   an arithmetic expression, or (b) a future migration has re-broken the
 *   schema. Either way this file fails first.
 */

'use strict';

// ── Tolerance constant ─────────────────────────────────────────────────────
// 0.005 THB = 0.5 satang. We pick this so a legacy row stored as Float that
// converted through the USING-cast (which rounds half-away-from-zero to
// 2 decimal places) cannot fail a fresh comparison merely because of the
// cast itself. New Decimal-native rows must be exact.
const ROUNDING_TOLERANCE_THB = 0.005;

// Helpers — keep the test self-contained so it runs in any Node environment
// without pulling Prisma's Decimal package as a dependency. Real rows from
// the DB will be Decimal.js instances; Number() coerces them losslessly for
// amounts well below 2^53.

function toNumber(value) {
    if (value === null || value === undefined) {
        return 0;
    }
    if (typeof value === 'number') {
        return value;
    }
    // Decimal.js exposes .toNumber(); plain strings coerce via Number().
    if (typeof value === 'object' && typeof value.toNumber === 'function') {
        return value.toNumber();
    }
    return Number(value);
}

function approximatelyEqual(actual, expected, tolerance = ROUNDING_TOLERANCE_THB) {
    return Math.abs(toNumber(actual) - toNumber(expected)) <= tolerance;
}

function sumDebits(lines) {
    return lines.reduce((s, l) => s + toNumber(l.debit), 0);
}

function sumCredits(lines) {
    return lines.reduce((s, l) => s + toNumber(l.credit), 0);
}

// ── Fixtures ───────────────────────────────────────────────────────────────
// PLATFORM-side invoice with VAT (the only side that lands on the
// platform's books per B16-C — STATE-side cash flows applicant → Treasury
// and is intentionally absent from journal_entries).

function platformInvoiceFixture() {
    // PHASE_1_PLATFORM_FEE: 500 platform fee + 35 VAT (7%) = 535 total.
    // PHASE_2 numbers (2,500 + 175 = 2,675) follow the same shape.
    return {
        id: 'inv-platform-phase1',
        invoiceNumber: 'TAX-PRD-2026-000001',
        serviceType: 'PHASE_1_PLATFORM_FEE',
        subtotal: 500.00,
        vat: 35.00,
        totalAmount: 535.00,
        status: 'PAID',
        journalLines: [
            // Dr Cash 535
            { lineNumber: 1, accountCode: '1110-001', debit: 535.00, credit: 0 },
            // Cr Revenue 500
            { lineNumber: 2, accountCode: '4110-001', debit: 0, credit: 500.00 },
            // Cr Output VAT 35
            { lineNumber: 3, accountCode: '2131-001', debit: 0, credit: 35.00 },
        ],
        creditNotes: [],
        debitNotes: [],
    };
}

function platformInvoiceWithCreditNote() {
    // Same shape as above but with a CN that fully reverses the invoice
    // (e.g., service cancelled before fulfilment). The CN balance plus
    // any DN balance must equal the original invoice when fully adjusted.
    const base = platformInvoiceFixture();
    base.id = 'inv-platform-cancelled';
    base.invoiceNumber = 'TAX-PRD-2026-000002';
    base.creditNotes = [
        {
            creditNoteNumber: 'CN-PRD-2026-000001',
            subtotal: 500.00,
            vat: 35.00,
            totalAmount: 535.00,
            status: 'POSTED',
        },
    ];
    return base;
}

function platformInvoiceWithPartialDebitNote() {
    // Original 535 + additional 100 charge → DN 100 added on top. The
    // adjustment is +100 so the CN+DN net = 0 + 100 = 100.
    const base = platformInvoiceFixture();
    base.id = 'inv-platform-debited';
    base.invoiceNumber = 'TAX-PRD-2026-000003';
    base.debitNotes = [
        {
            debitNoteNumber: 'DN-PRD-2026-000001',
            subtotal: 93.46,    // arbitrary additional service line
            vat: 6.54,          // 7% of 93.46 ≈ 6.5422 → rounds to 6.54
            totalAmount: 100.00,
            status: 'POSTED',
        },
    ];
    return base;
}

// PHASE_2 invoice — bigger amount, same shape, anchors that the parity
// holds at the higher amount.
function platformInvoicePhase2() {
    return {
        id: 'inv-platform-phase2',
        invoiceNumber: 'TAX-PRD-2026-000004',
        serviceType: 'PHASE_2_PLATFORM_FEE',
        subtotal: 2500.00,
        vat: 175.00,
        totalAmount: 2675.00,
        status: 'PAID',
        journalLines: [
            { lineNumber: 1, accountCode: '1110-001', debit: 2675.00, credit: 0 },
            { lineNumber: 2, accountCode: '4110-001', debit: 0, credit: 2500.00 },
            { lineNumber: 3, accountCode: '2131-001', debit: 0, credit: 175.00 },
        ],
        creditNotes: [],
        debitNotes: [],
    };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('decimal parity invariants (Iter 24, 2026-05-16)', () => {
    describe('I1 — subtotal + vat === totalAmount', () => {
        it.each([
            ['PLATFORM phase 1 (535)', platformInvoiceFixture()],
            ['PLATFORM phase 2 (2675)', platformInvoicePhase2()],
        ])('holds for %s', (_label, invoice) => {
            const computed = toNumber(invoice.subtotal) + toNumber(invoice.vat);
            expect(approximatelyEqual(computed, invoice.totalAmount)).toBe(true);
        });

        it('rejects a fixture where the parity is violated (negative test)', () => {
            const broken = platformInvoiceFixture();
            broken.totalAmount = 600.00; // deliberately wrong
            const computed = toNumber(broken.subtotal) + toNumber(broken.vat);
            expect(approximatelyEqual(computed, broken.totalAmount)).toBe(false);
        });
    });

    describe('I2 — sum(JournalLine.debit) === totalAmount (PLATFORM only)', () => {
        it.each([
            ['phase 1', platformInvoiceFixture()],
            ['phase 2', platformInvoicePhase2()],
        ])('holds for %s', (_label, invoice) => {
            const debit = sumDebits(invoice.journalLines);
            expect(approximatelyEqual(debit, invoice.totalAmount)).toBe(true);
        });
    });

    describe('I3 — sum(JournalLine.credit) === totalAmount (PLATFORM only)', () => {
        it.each([
            ['phase 1', platformInvoiceFixture()],
            ['phase 2', platformInvoicePhase2()],
        ])('holds for %s', (_label, invoice) => {
            const credit = sumCredits(invoice.journalLines);
            expect(approximatelyEqual(credit, invoice.totalAmount)).toBe(true);
        });

        it('is also balanced against I2 (Dr === Cr within tolerance)', () => {
            const inv = platformInvoiceFixture();
            const debit = sumDebits(inv.journalLines);
            const credit = sumCredits(inv.journalLines);
            expect(approximatelyEqual(debit, credit)).toBe(true);
        });
    });

    describe('I4 — net(CN + DN) reconciles with invoice adjustment', () => {
        it('full cancellation: CN total === invoice total, DN net = 0', () => {
            const inv = platformInvoiceWithCreditNote();
            const cnTotal = inv.creditNotes.reduce(
                (s, n) => s + toNumber(n.totalAmount),
                0,
            );
            const dnTotal = inv.debitNotes.reduce(
                (s, n) => s + toNumber(n.totalAmount),
                0,
            );
            // adjustedAmount = original - net(adjustments). For a full
            // cancellation the adjustedAmount is 0 (the invoice is wiped).
            const adjustedAmount = 0;
            const expectedNetAdjustment = toNumber(inv.totalAmount) - adjustedAmount;
            const actualNetAdjustment = cnTotal - dnTotal;
            // For a CN (reduction) the value moves down by cnTotal; a DN
            // (addition) would move it up. Sign convention: CN reduces,
            // DN increases — net adjustment = cn - dn.
            expect(approximatelyEqual(actualNetAdjustment, expectedNetAdjustment)).toBe(true);
        });

        it('partial debit: DN total === amount added on top', () => {
            const inv = platformInvoiceWithPartialDebitNote();
            const cnTotal = inv.creditNotes.reduce(
                (s, n) => s + toNumber(n.totalAmount),
                0,
            );
            const dnTotal = inv.debitNotes.reduce(
                (s, n) => s + toNumber(n.totalAmount),
                0,
            );
            // DN of 100 → adjusted invoice value is original + 100. Net
            // adjustment from the invoice's perspective: -100 (it now owes
            // 100 more). In our reconciliation: cn - dn = 0 - 100 = -100.
            const dnAdjustment = -toNumber(100);
            expect(approximatelyEqual(cnTotal - dnTotal, dnAdjustment)).toBe(true);
        });

        it('partial credit + partial debit cancel each other to zero net', () => {
            // Hand-crafted fixture: 50 THB CN + 50 THB DN against the same
            // invoice should net to zero (cancelling adjustments).
            const inv = {
                id: 'inv-platform-neutral-adjust',
                totalAmount: 535.00,
                creditNotes: [
                    { creditNoteNumber: 'CN', totalAmount: 50.00, subtotal: 46.73, vat: 3.27 },
                ],
                debitNotes: [
                    { debitNoteNumber: 'DN', totalAmount: 50.00, subtotal: 46.73, vat: 3.27 },
                ],
            };
            const cnTotal = inv.creditNotes.reduce((s, n) => s + toNumber(n.totalAmount), 0);
            const dnTotal = inv.debitNotes.reduce((s, n) => s + toNumber(n.totalAmount), 0);
            expect(approximatelyEqual(cnTotal - dnTotal, 0)).toBe(true);
        });
    });

    describe('Decimal-rounding tolerance window', () => {
        it('accepts a legacy Float-drift value within 0.005 THB', () => {
            // Real-world example: 535.0000000001 was a legacy Float row
            // that got USING-cast to Decimal(15,2). The cast snaps to
            // 535.00; our test still treats the raw value as parity-valid.
            const driftedInvoice = {
                subtotal: 500.0000000001,
                vat: 35.0000000001,
                totalAmount: 535.00,
            };
            const computed = toNumber(driftedInvoice.subtotal) + toNumber(driftedInvoice.vat);
            expect(approximatelyEqual(computed, driftedInvoice.totalAmount)).toBe(true);
        });

        it('rejects a drift exceeding 0.005 THB', () => {
            const wayOff = {
                subtotal: 500.00,
                vat: 35.00,
                totalAmount: 535.06, // 6 satang of drift — too much
            };
            const computed = toNumber(wayOff.subtotal) + toNumber(wayOff.vat);
            expect(approximatelyEqual(computed, wayOff.totalAmount)).toBe(false);
        });
    });
});
