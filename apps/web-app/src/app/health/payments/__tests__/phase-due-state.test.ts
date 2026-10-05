/**
 * phase-due-state.test.ts — "ไม่รู้จ่ายบิลไหนตอนไหน" (operator, 2026-09-10).
 *
 * The screen showed งวดที่ 1 and งวดที่ 2 as two equal cards with a total each, and
 * nothing said which one was collectable today. This is the rule that answers it,
 * tested where it can be tested exhaustively: as a function, with no DOM.
 *
 * Pinned here:
 *   1. งวดที่ 2 is NOT due while the documents are still under review — the same
 *      boundary checkoutEntryOwes already enforces for the pay button. The two must
 *      never disagree, so the shared case is asserted from both sides.
 *   2. A cancelled invoice is not a debt: it cannot be collected by anyone, so it must
 *      not hold a phase open, and it must not shadow a live bill beside it.
 *   3. An unknown application status answers UNKNOWN, not DUE_NOW — the screen may not
 *      invite a payment it cannot know is collectable. But an unreadable INVOICE counts
 *      as owed: "ชำระครบแล้ว" said wrongly is a farmer who misses a payment and a filing
 *      that stalls in silence.
 *   4. The rule counts a debt with the same two fields as the page's own "รอชำระ" filter
 *      (client-view.tsx: `!item.isPaid && !item.isCancelled`), so the chip and the filter
 *      cannot drift apart.
 */

import { phaseDueState, isOutstanding, PHASE_DUE_ORDER, type DueInvoice } from '../phase-due-state';
import { checkoutEntryOwes } from '../checkout-entry-owes';

/** As payment-service's mapping hands them over (payment-service.ts:787-790). */
const APP = 'APP-1';
const owed: DueInvoice = { isPaid: false, isCancelled: false, applicationId: APP };
const paid: DueInvoice = { isPaid: true, isCancelled: false, applicationId: APP };
const voided: DueInvoice = { isPaid: false, isCancelled: true, applicationId: APP };
/** A bill belonging to a DIFFERENT filing — the page groups by งวด, not by คำขอ. */
const otherOwed: DueInvoice = { isPaid: false, isCancelled: false, applicationId: 'APP-2' };

describe('which instalment is collectable today', () => {
    test('งวดที่ 1 is due while the filing sits at PENDING_DOC_FEE', () => {
        expect(phaseDueState('PHASE_1', 'PENDING_DOC_FEE', [owed])).toBe('DUE_NOW');
    });

    test('งวดที่ 2 is NOT due at the same moment — the queue has not reached it', () => {
        expect(phaseDueState('PHASE_2', 'PENDING_DOC_FEE', [owed])).toBe('NOT_YET');
    });

    test('งวดที่ 2 becomes due once the documents are approved', () => {
        expect(phaseDueState('PHASE_2', 'DOC_APPROVED', [owed])).toBe('DUE_NOW');
        expect(phaseDueState('PHASE_2', 'PENDING_AUDIT_FEE', [owed])).toBe('DUE_NOW');
    });

    test('งวดที่ 1 stops being due once its own bill is paid, whatever the filing is doing', () => {
        expect(phaseDueState('PHASE_1', 'PENDING_DOC_FEE', [paid])).toBe('SETTLED');
    });

    test('a filing status nobody can pay in is NOT_YET, not DUE_NOW', () => {
        expect(phaseDueState('PHASE_1', 'DRAFT', [owed])).toBe('NOT_YET');
        expect(phaseDueState('PHASE_1', 'REJECTED', [owed])).toBe('NOT_YET');
    });

    test('the filing status is read case-insensitively — the register is not consistent', () => {
        expect(phaseDueState('PHASE_1', 'submitted', [owed])).toBe('DUE_NOW');
        expect(phaseDueState('PHASE_2', ' doc_approved ', [owed])).toBe('DUE_NOW');
    });

    test('the chip and the pay button agree on งวดที่ 2 under review', () => {
        // The case that produced the complaint: phase 1 collected, filing under review.
        // The button is (correctly) absent — so the card must say why, rather than sit
        // there looking payable.
        const status = 'PENDING_DOC_REVIEW';
        expect(phaseDueState('PHASE_2', status, [owed])).toBe('NOT_YET');
        expect(checkoutEntryOwes({
            pendingAmount: 0,
            quotationAccepted: true,
            applicationStatus: status,
            phase1InvoicedAt: '2026-09-06T00:00:00Z',
            phase2InvoicedAt: null,
            invoicedPhases: new Set(['PHASE_1']),
        })).toBe(false);
    });

    test('the chip and the pay button agree on งวดที่ 2 the moment it opens', () => {
        const status = 'DOC_APPROVED';
        expect(phaseDueState('PHASE_2', status, [owed])).toBe('DUE_NOW');
        expect(checkoutEntryOwes({
            pendingAmount: 0,
            quotationAccepted: true,
            applicationStatus: status,
            phase1InvoicedAt: '2026-09-06T00:00:00Z',
            phase2InvoicedAt: null,
            invoicedPhases: new Set(['PHASE_1']),
        })).toBe(true);
    });
});

describe('what counts as a debt', () => {
    test('an unpaid, uncancelled bill is owed — the page’s own รอชำระ rule', () => {
        expect(isOutstanding(owed)).toBe(true);
    });

    test('a paid bill is not owed', () => {
        expect(isOutstanding(paid)).toBe(false);
    });

    test('a cancelled bill is not owed, and does not hold the phase open', () => {
        expect(isOutstanding(voided)).toBe(false);
        expect(phaseDueState('PHASE_1', 'PENDING_DOC_FEE', [voided])).toBe('SETTLED');
    });

    test('a cancelled bill never shadows a live one beside it', () => {
        expect(phaseDueState('PHASE_1', 'PENDING_DOC_FEE', [voided, owed])).toBe('DUE_NOW');
    });

    test('a row that says neither is treated as owed — silence is not a receipt', () => {
        expect(isOutstanding({})).toBe(true);
        expect(phaseDueState('PHASE_1', 'PENDING_DOC_FEE', [{}])).toBe('DUE_NOW');
    });

    test('a phase with no bills at all is settled — there is nothing to pay', () => {
        expect(phaseDueState('PHASE_1', 'PENDING_DOC_FEE', [])).toBe('SETTLED');
    });
});

describe('what the screen may not claim', () => {
    test('an unknown filing status with money owed says UNKNOWN — never DUE_NOW', () => {
        expect(phaseDueState('PHASE_1', null, [owed])).toBe('UNKNOWN');
        expect(phaseDueState('PHASE_2', '', [owed])).toBe('UNKNOWN');
    });

    test('an unknown status with nothing owed is still SETTLED — no debt needs no status', () => {
        expect(phaseDueState('PHASE_1', null, [paid])).toBe('SETTLED');
        expect(phaseDueState('PHASE_1', undefined, [])).toBe('SETTLED');
    });
});

describe('a box holding more than one filing’s bills', () => {
    // /health/payments groups by งวด alone, so a farmer with two filings sees both
    // filings' งวดที่ 1 bills in ONE box. The status handed to the rule belongs to one
    // of them. Claiming "ถึงกำหนดชำระตอนนี้" over the other farmer-facing bill would be
    // the page speaking for money it was not told about.
    test('refuses to claim a due state when another filing’s bill is in the box', () => {
        expect(phaseDueState('PHASE_1', 'PENDING_DOC_FEE', [owed, otherOwed], APP)).toBe('UNKNOWN');
    });

    test('still says SETTLED when nothing in the box is owed, whoever owns it', () => {
        expect(phaseDueState('PHASE_1', 'PENDING_DOC_FEE', [paid, { ...paid, applicationId: 'APP-2' }], APP))
            .toBe('SETTLED');
    });

    test('answers normally when every bill in the box is this filing’s', () => {
        expect(phaseDueState('PHASE_1', 'PENDING_DOC_FEE', [owed, owed], APP)).toBe('DUE_NOW');
    });

    test('a row that names no filing does not block the answer', () => {
        // The mapper leaves applicationId undefined for a subscription invoice; that is
        // an absence of a claim, not a claim about another filing.
        expect(phaseDueState('PHASE_1', 'PENDING_DOC_FEE', [owed, { isPaid: false }], APP)).toBe('DUE_NOW');
    });

    test('with no filing named, the caller gets the old unscoped answer', () => {
        expect(phaseDueState('PHASE_1', 'PENDING_DOC_FEE', [owed, otherOwed])).toBe('DUE_NOW');
    });
});

describe('the order the phases are shown in', () => {
    test('what can be paid today sorts above what cannot', () => {
        expect(PHASE_DUE_ORDER.DUE_NOW).toBeLessThan(PHASE_DUE_ORDER.NOT_YET);
        expect(PHASE_DUE_ORDER.DUE_NOW).toBeLessThan(PHASE_DUE_ORDER.SETTLED);
        expect(PHASE_DUE_ORDER.NOT_YET).toBeLessThan(PHASE_DUE_ORDER.SETTLED);
    });

    test('a phase whose state cannot be decided is not buried under settled ones', () => {
        expect(PHASE_DUE_ORDER.UNKNOWN).toBeLessThan(PHASE_DUE_ORDER.SETTLED);
    });
});
