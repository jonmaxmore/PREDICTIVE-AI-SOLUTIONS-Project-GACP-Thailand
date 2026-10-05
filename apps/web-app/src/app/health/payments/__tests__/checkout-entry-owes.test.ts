import { checkoutEntryOwes, invoicedPhasesOf } from '../checkout-entry-owes';

describe('when the checkout entry has something to collect', () => {
    test('an unpaid invoice row is debt — the old rule holds', () => {
        expect(checkoutEntryOwes({ pendingAmount: 17655, quotationAccepted: false })).toBe(true);
    });

    test('an accepted quotation nobody has collected on is debt — the walked dead end', () => {
        // ✓ ยอมรับแล้ว on screen, PENDING_DOC_FEE, zero invoice rows, and no way to pay.
        expect(checkoutEntryOwes({
            pendingAmount: 0, quotationAccepted: true, applicationStatus: 'PENDING_DOC_FEE',
            phase1InvoicedAt: null, phase2InvoicedAt: null,
            invoicedPhases: new Set(),
        })).toBe(true);
    });

    test('งวดที่ 2 is NOT offered before the documents are approved — not due yet', () => {
        // Phase 1 collected, still under review: pressing pay would meet the checkout
        // door's own refusal, so the entry must not offer it.
        expect(checkoutEntryOwes({
            pendingAmount: 0, quotationAccepted: true, applicationStatus: 'PENDING_DOC_REVIEW',
            phase1InvoicedAt: '2026-09-06T00:00:00Z', phase2InvoicedAt: null,
            invoicedPhases: new Set(['PHASE_1']),
        })).toBe(false);
    });

    test('an UNKNOWN application state is no debt — fail closed, the old behaviour', () => {
        expect(checkoutEntryOwes({
            pendingAmount: 0, quotationAccepted: true,
            phase1InvoicedAt: null, phase2InvoicedAt: null, invoicedPhases: new Set(),
        })).toBe(false);
    });

    test('phase 2 due (PENDING_AUDIT_FEE) and uncollected — debt', () => {
        expect(checkoutEntryOwes({
            pendingAmount: 0, quotationAccepted: true, applicationStatus: 'PENDING_AUDIT_FEE',
            phase1InvoicedAt: '2026-09-06T00:00:00Z', phase2InvoicedAt: null,
            invoicedPhases: new Set(['PHASE_1']),
        })).toBe(true);
    });

    test('LEGACY-paid application: rows exist for both phases, quotation never stamped — no debt (F-G4-49 stands)', () => {
        // The old rail never writes phaseNInvoicedAt, but its paid invoice rows exist —
        // the money is visibly collected, so nothing renders next to ฿0.
        expect(checkoutEntryOwes({
            pendingAmount: 0, quotationAccepted: true, applicationStatus: 'CERTIFIED',
            phase1InvoicedAt: null, phase2InvoicedAt: null,
            invoicedPhases: new Set(['PHASE_1', 'PHASE_2']),
        })).toBe(false);
    });

    test('everything billed through checkout and everything paid — no debt', () => {
        expect(checkoutEntryOwes({
            pendingAmount: 0, quotationAccepted: true, applicationStatus: 'CERTIFIED',
            phase1InvoicedAt: '2026-09-06T00:00:00Z', phase2InvoicedAt: '2026-09-07T00:00:00Z',
            invoicedPhases: new Set(['PHASE_1', 'PHASE_2']),
        })).toBe(false);
    });

    test("an unaccepted quotation is not debt — accepting it is the applicant's call", () => {
        expect(checkoutEntryOwes({
            pendingAmount: 0, quotationAccepted: false,
            phase1InvoicedAt: null, phase2InvoicedAt: null, invoicedPhases: new Set(),
        })).toBe(false);
    });
});

describe('which phases already have an invoice row', () => {
    test('reads INVOICE and RECEIPT rows of this application only', () => {
        // A RECEIPT is the only trace a checkout-settled phase leaves once its invoice
        // becomes one — refusing to count it re-opened the entry next to ฿0.
        expect([...invoicedPhasesOf([
            { type: 'INVOICE', applicationId: 'a1', phase: 'PHASE_1' },
            { type: 'INVOICE', applicationId: 'OTHER', phase: 'PHASE_2' },
            { type: 'RECEIPT', applicationId: 'a1', phase: 'PHASE_2' },
            { type: 'QUOTATION', applicationId: 'a1', phase: 'PHASE_1' },
        ], 'a1')]).toEqual(['PHASE_1', 'PHASE_2']);
    });
});
