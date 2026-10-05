/**
 * Does this applicant owe anything the checkout entry can collect?
 *
 * Deep QA 2026-09-06, real browser: a farmer accepted their quotation (✓ ยอมรับแล้ว on
 * screen, ACCEPTED in the register) and the page then offered NOTHING — no pay button,
 * "ไม่พบรายการชำระเงิน". The entry's old gate was `pendingAmount > 0`, and pendingAmount
 * counts INVOICE rows; under the checkout rail the first invoice is minted by the checkout
 * the button starts. The button was waiting for a row that only the button could create —
 * the same circular gate the page had one layer up (payments-application-id.ts).
 *
 * Debt, honestly stated:
 *   - an unpaid invoice row (the old rule — right once a row exists), or
 *   - an ACCEPTED quotation instalment that is DUE by the application's own state and that
 *     nobody has collected by any means (no checkout stamp, no invoice/receipt row).
 *
 * DUE matters: an accepted quotation prices both instalments up front, but งวดที่ 2 is
 * payable only after the documents are approved — offering the button earlier walks the
 * farmer into the checkout door's own refusal. And an UNKNOWN application state answers
 * no-debt (fail-closed), which is exactly the old behaviour.
 */

/** Mirror of PAYABLE_STATES (shared/checkout-status.js) — per instalment. */
const PHASE1_PAYABLE = new Set(['SUBMITTED', 'PENDING_DOC_FEE']);
const PHASE2_PAYABLE = new Set(['DOC_APPROVED', 'PENDING_AUDIT_FEE']);

export function checkoutEntryOwes({
    pendingAmount,
    quotationAccepted,
    applicationStatus,
    phase1InvoicedAt,
    phase2InvoicedAt,
    invoicedPhases,
}: {
    pendingAmount: number;
    quotationAccepted: boolean;
    applicationStatus?: string | null;
    phase1InvoicedAt?: string | null;
    phase2InvoicedAt?: string | null;
    /** Phases with an INVOICE or RECEIPT row — the trace collection leaves. */
    invoicedPhases?: ReadonlySet<string>;
}): boolean {
    if (pendingAmount > 0) return true;
    if (!quotationAccepted) return false;

    const status = String(applicationStatus || '').toUpperCase();
    const rows = invoicedPhases ?? new Set<string>();
    if (PHASE1_PAYABLE.has(status) && !phase1InvoicedAt && !rows.has('PHASE_1')) return true;
    if (PHASE2_PAYABLE.has(status) && !phase2InvoicedAt && !rows.has('PHASE_2')) return true;
    return false;
}

/**
 * The phases somebody has already collected on, for this application: any INVOICE row
 * (billed — paid or not; pendingAmount covers the unpaid case) and any RECEIPT row
 * (paid — the only trace a checkout-settled phase leaves once its invoice becomes one).
 */
export function invoicedPhasesOf(
    payments: ReadonlyArray<{ type?: string; applicationId?: string | null; phase?: string | null }>,
    applicationId: string,
): Set<string> {
    const out = new Set<string>();
    for (const row of payments) {
        if (row.type !== 'INVOICE' && row.type !== 'RECEIPT') continue;
        if (!applicationId || row.applicationId !== applicationId) continue;
        if (row.phase === 'PHASE_1' || row.phase === 'PHASE_2') out.add(row.phase);
    }
    return out;
}
