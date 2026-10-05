/**
 * WHICH application the payments page shows and gates on.
 *
 * Deep QA 2026-09-06, walked in a real browser: a farmer submitted a filing (quotation
 * QT-PRD-2026-000003 waiting, PENDING_DOC_FEE) and opened ชำระเงิน from the nav menu. The
 * page said "ยอดรอชำระ ฿0 · ไม่พบรายการชำระเงิน" — a dead end with money actually due.
 *
 * The old derivation read the INVOICE rows only. Under the checkout rail no invoice
 * exists until the quotation is accepted, and the accept button lives on this very page —
 * so the page waited for a row that only itself could cause. Arriving from the submit
 * hand-over worked (`?app=` in the URL); arriving any other way did not, and "any other
 * way" is every farmer who comes back the next day.
 *
 * Order: the URL's explicit `?app=` → an invoice row's application → a payable
 * application from the applicant's own list. Pure, so the rule is testable without
 * rendering the page.
 */

/**
 * The application the URL names. Links into this page carried two spellings:
 * `?app=` (every in-app link and the QR printed on the quotation PDF) and
 * `?applicationId=` (the name the rest of the app uses for the same id). Reading
 * only `?app=` made an `?applicationId=` link fall through to another
 * application's quotation (staging walk 2026-09-29). Both are read;
 * `?applicationId=` wins when a link carries both, and new links should use it.
 */
export function readPaymentsApplicationParam(
    searchParams: { get(name: string): string | null } | null | undefined,
): string {
    const applicationId = String(searchParams?.get('applicationId') || '').trim();
    if (applicationId) return applicationId;
    return String(searchParams?.get('app') || '').trim();
}

/** The M1 states whose quotation this page must surface (mirror of PAYABLE_STATES.M1). */
const PAYABLE_APPLICATION_STATUSES = new Set(['SUBMITTED', 'PENDING_DOC_FEE', 'PENDING_AUDIT_FEE', 'DOC_APPROVED']);

export function resolvePaymentsApplicationId({
    appFilter,
    payments,
    applications,
}: {
    appFilter: string;
    payments: ReadonlyArray<{ applicationId?: string | null }>;
    applications: ReadonlyArray<{ id: string; status?: string | null }>;
}): string {
    if (appFilter) return appFilter;

    const fromInvoices = payments.find((item) => !!item.applicationId)?.applicationId;
    if (fromInvoices) return fromInvoices;

    const payable = applications.find(
        (app) => PAYABLE_APPLICATION_STATUSES.has(String(app.status || '').toUpperCase()),
    );
    return payable?.id || '';
}
