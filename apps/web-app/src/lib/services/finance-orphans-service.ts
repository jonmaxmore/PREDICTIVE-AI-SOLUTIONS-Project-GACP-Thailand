/**
 * Finance Orphans Service — frontend client for the 4 PLATFORM-side
 * orphan finance services (Iter R1, 2026-05-17).
 *
 * Wraps the backend HTTP contracts at:
 *   /api/finance/period-close            (period-close-service)
 *   /api/finance/purchase-invoices       (purchase-invoice-service)
 *   /api/finance/manual-journal-entries  (manual-journal-entry-service)
 *   /api/finance/wht                     (wht-service)
 *
 * Boundary:
 *   - This file is OWNED by R1-A. R1-B/C/D import from it; they do NOT
 *     redefine these methods or types in their own pages.
 *   - Mirrors the existing `accounting-service.ts` pattern: BASE constant,
 *     `ok()` unwrap, typed Promise returns. Errors propagate as a thrown
 *     Error with a `code` (string) and optional metadata fields the UI
 *     can read (e.g. `openInvoices`, `originalCloser`).
 *
 * Compliance basis (mirrored from the backend services so callers can
 * read the contract here):
 *   - TFRS for NPAEs ch.2  — segregation of duties on close/reopen and
 *                            manual-JE approve/post
 *   - TFRS for NPAEs ch.5  — monthly period close
 *   - ป.รัษฎากร ม.50       — WHT duty of payer (corporate buyer)
 *   - ป.รัษฎากร ม.69 ทวิ   — WHT certificate (ทบ.50 ทวิ) issuance
 *   - ป.รัษฎากร ม.82/3,4   — Input VAT netting against Output VAT
 *   - ป.รัษฎากร ม.86/4     — full-tax-invoice field minima
 *   - ป.รัษฎากร ม.87/3     — 7-year retention of audit trail
 */

import { apiClient, type ApiResponse } from '../api/api-client';
import { THAI_TIME_ZONE, bangkokTodayIso, bangkokFirstOfMonthIso } from '@/lib/format/thai-date';

// ── Shared internals ───────────────────────────────────────────────────

const BASE = '/finance';

/**
 * Unwrap the canonical `{ success, data }` envelope. Throws a uniform
 * error when the backend says `success: false`.
 *
 * The thrown Error carries:
 *   - `.message`        — apiClient's user-friendly Thai translation
 *                         (suitable for direct display).
 *   - `.code`           — the RAW backend identifier (e.g.
 *                         `PENDING_INVOICES_IN_PERIOD`) sourced from
 *                         the envelope's new `code` field. Defaults to
 *                         the legacy `payload.error` for back-compat
 *                         when the envelope does not include `code`.
 *   - all `payload.meta.*` keys — spread onto the Error so callers can
 *                         read structured metadata (`openInvoices`,
 *                         `warnings`, `periodCloseId`, `originalCloser`)
 *                         that the backend ships as siblings of `error`.
 *
 * See Iter R5-C / R1 review H-3 for rationale.
 */
function ok<T>(payload: ApiResponse<T>): T {
    if (!payload?.success || payload.data === undefined) {
        const err = new Error(payload?.error || 'การเรียกข้อมูลล้มเหลว');
        // Prefer the RAW backend identifier from the new `code` field,
        // falling back to `payload.error` for back-compat with envelopes
        // produced before the R5-C plumbing landed.
        (err as Error & { code?: string }).code =
            payload?.code || payload?.error || 'UNKNOWN';
        // Spread structured metadata onto the error so call sites that
        // catch and read `(err as any).openInvoices` etc. actually
        // receive populated values.
        if (payload?.meta && typeof payload.meta === 'object') {
            Object.assign(err, payload.meta);
        }
        throw err;
    }
    return payload.data as T;
}

/**
 * Build a query string from a flat record, skipping null/undefined.
 */
function qs(params: Record<string, string | number | null | undefined>): string {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v === null || v === undefined || v === '') continue;
        search.set(k, String(v));
    }
    const s = search.toString();
    return s ? `?${s}` : '';
}

// ── Period Close ──────────────────────────────────────────────────────

export type PeriodCloseStatus = 'OPEN' | 'CLOSED' | 'REOPENED';

export interface PeriodCloseRecord {
    id: string;
    organizationId: string | null;
    year: number;
    month: number;
    status: PeriodCloseStatus;
    closedAt: string | null;
    closedBy: string | null;
    notes: string | null;
    reopenedAt?: string | null;
    reopenedBy?: string | null;
    reopenReason?: string | null;
    createdAt?: string;
    updatedAt?: string;
}

export interface ClosePeriodInput {
    year: number;
    month: number;
    notes?: string;
}

export interface ClosePeriodResult {
    id: string;
    year: number;
    month: number;
    closedAt: string;
    status: PeriodCloseStatus;
}

export interface ReopenPeriodInput {
    reason: string;
}

export interface PeriodCloseListFilters {
    fromYear?: number;
    toYear?: number;
}

export interface PeriodClosedCheck {
    year: number;
    month: number;
    closed: boolean;
}

export const PeriodCloseService = {
    /** GET /api/finance/period-close?fromYear=&toYear= */
    async listPeriodCloses(filters: PeriodCloseListFilters = {}): Promise<PeriodCloseRecord[]> {
        const res = await apiClient.get<PeriodCloseRecord[]>(
            `${BASE}/period-close${qs({
                fromYear: filters.fromYear,
                toYear: filters.toYear,
            })}`,
        );
        return ok(res);
    },

    /** POST /api/finance/period-close — close a (year, month). */
    async closePeriod(input: ClosePeriodInput): Promise<ClosePeriodResult> {
        const res = await apiClient.post<ClosePeriodResult>(
            `${BASE}/period-close`,
            {
                year: input.year,
                month: input.month,
                notes: input.notes,
            },
        );
        return ok(res);
    },

    /** POST /api/finance/period-close/:id/reopen — ADMIN-only. */
    async reopenPeriod(id: string, input: ReopenPeriodInput): Promise<PeriodCloseRecord> {
        const res = await apiClient.post<PeriodCloseRecord>(
            `${BASE}/period-close/${encodeURIComponent(id)}/reopen`,
            { reason: input.reason },
        );
        return ok(res);
    },

    /** GET /api/finance/period-close/check?year=&month= */
    async checkPeriodClosed(args: { year: number; month: number }): Promise<PeriodClosedCheck> {
        const res = await apiClient.get<PeriodClosedCheck>(
            `${BASE}/period-close/check${qs({ year: args.year, month: args.month })}`,
        );
        return ok(res);
    },
};

// ── Purchase Invoices ─────────────────────────────────────────────────

export type PurchaseInvoiceStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

export type PurchaseInvoiceCategory =
    | 'OFFICE_SUPPLIES'
    | 'PROFESSIONAL_SERVICES'
    | 'UTILITIES'
    | 'OTHER';

export const PURCHASE_INVOICE_CATEGORIES: ReadonlyArray<PurchaseInvoiceCategory> = [
    'OFFICE_SUPPLIES',
    'PROFESSIONAL_SERVICES',
    'UTILITIES',
    'OTHER',
];

export interface PurchaseInvoice {
    id: string;
    invoiceNumber: string;
    supplierName: string;
    supplierTaxId: string;
    supplierAddress?: string | null;
    invoiceDate: string;
    subtotal: number;
    vat: number;
    totalAmount: number;
    category: PurchaseInvoiceCategory;
    description?: string | null;
    notes?: string | null;
    attachmentId?: string | null;
    status: PurchaseInvoiceStatus;
    organizationId?: string | null;
    paidAt?: string | null;
    paidBy?: string | null;
    reviewedAt?: string | null;
    reviewedBy?: string | null;
    rejectionReason?: string | null;
    journalEntryId?: string | null;
    createdAt?: string;
    createdBy?: string;
    updatedAt?: string;
    isDeleted?: boolean;
}

export interface CreatePurchaseInvoiceInput {
    invoiceNumber: string;
    supplierName: string;
    /** 13-digit Thai TIN. Backend validates with /^\d{13}$/. */
    supplierTaxId: string;
    supplierAddress?: string | null;
    /** ISO date (yyyy-mm-dd) or Date — backend `new Date(...)`s it. */
    invoiceDate: string;
    subtotal: number;
    vat: number;
    totalAmount: number;
    category: PurchaseInvoiceCategory;
    description?: string | null;
    notes?: string | null;
    attachmentId?: string | null;
    organizationId?: string | null;
}

export interface PurchaseInvoiceListFilters {
    status?: PurchaseInvoiceStatus | 'ALL';
    /** invoiceDate >= from (ISO date). */
    from?: string;
    /** invoiceDate < to (ISO date). */
    to?: string;
    organizationId?: string | null;
}

export interface RejectPurchaseInvoiceInput {
    reason: string;
}

export interface MarkPaidInput {
    paidAt?: string;
}

async function _piList(filters: PurchaseInvoiceListFilters = {}): Promise<PurchaseInvoice[]> {
    const params: Record<string, string | number | null | undefined> = {
        from: filters.from,
        to: filters.to,
        organizationId: filters.organizationId ?? undefined,
    };
    // 'ALL' is the UI sentinel — omit the query param entirely.
    if (filters.status && filters.status !== 'ALL') {
        params.status = filters.status;
    }
    const res = await apiClient.get<PurchaseInvoice[]>(
        `${BASE}/purchase-invoices${qs(params)}`,
    );
    return ok(res);
}

async function _piGet(id: string): Promise<PurchaseInvoice> {
    const res = await apiClient.get<PurchaseInvoice>(
        `${BASE}/purchase-invoices/${encodeURIComponent(id)}`,
    );
    return ok(res);
}

async function _piCreate(input: CreatePurchaseInvoiceInput): Promise<PurchaseInvoice> {
    const res = await apiClient.post<PurchaseInvoice>(
        `${BASE}/purchase-invoices`,
        input,
    );
    return ok(res);
}

async function _piApprove(id: string): Promise<PurchaseInvoice> {
    const res = await apiClient.post<PurchaseInvoice>(
        `${BASE}/purchase-invoices/${encodeURIComponent(id)}/approve`,
    );
    return ok(res);
}

/**
 * R1-B may call this as either `reject(id, reasonString)` (legacy ergonomics)
 * or `reject(id, { reason })`. We accept both for source-compatibility.
 */
async function _piReject(
    id: string,
    input: RejectPurchaseInvoiceInput | string,
): Promise<PurchaseInvoice> {
    const reason = typeof input === 'string' ? input : input.reason;
    const res = await apiClient.post<PurchaseInvoice>(
        `${BASE}/purchase-invoices/${encodeURIComponent(id)}/reject`,
        { reason },
    );
    return ok(res);
}

async function _piMarkPaid(
    id: string,
    input: MarkPaidInput | string | undefined = undefined,
): Promise<PurchaseInvoice> {
    // Accept (id), (id, isoDate), or (id, { paidAt }).
    let paidAt: string | undefined;
    if (typeof input === 'string') {
        paidAt = input;
    } else if (input && typeof input === 'object') {
        paidAt = input.paidAt;
    }
    const res = await apiClient.post<PurchaseInvoice>(
        `${BASE}/purchase-invoices/${encodeURIComponent(id)}/mark-paid`,
        paidAt ? { paidAt } : {},
    );
    return ok(res);
}

export const PurchaseInvoiceService = {
    // Canonical (long-form) names used in R1-A.
    listPurchaseInvoices: _piList,
    getPurchaseInvoice: _piGet,
    createPurchaseInvoice: _piCreate,
    approvePurchaseInvoice: _piApprove,
    rejectPurchaseInvoice: _piReject,
    markPurchaseInvoicePaid: _piMarkPaid,
    // Short-form aliases consumed by R1-B (kept stable for parallel
    // build — both names point at the same backend route).
    list: _piList,
    get: _piGet,
    create: _piCreate,
    approve: _piApprove,
    reject: _piReject,
    markPaid: _piMarkPaid,
};

// ── Manual Journal Entries ────────────────────────────────────────────

export type ManualJournalEntryStatus = 'DRAFT' | 'APPROVED' | 'POSTED' | 'REJECTED';

export interface ManualJournalEntryLine {
    lineNumber: number;
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
}

/**
 * Alias used by R1-C — names the post-validation "draft line" type
 * consistently with `ManualJournalEntryDraft`. Identical to
 * `ManualJournalEntryLine`.
 */
export type ManualJournalEntryDraftLine = ManualJournalEntryLine;

/**
 * The line shape the UI submits to `createDraft` — `lineNumber` is
 * optional (backend derives from array index) and `accountName` is
 * always looked up server-side from the chart of accounts, so the
 * client does NOT have to send it.
 */
export interface ManualJournalEntryDraftLineInput {
    lineNumber?: number;
    accountCode: string;
    debit?: number;
    credit?: number;
}

export interface ManualJournalEntryDraft {
    id: string;
    draftNumber: string;
    description: string;
    postingDate: string;
    reason: string;
    status: ManualJournalEntryStatus;
    linesJson: ManualJournalEntryLine[];
    totalDebit: number;
    totalCredit: number;
    createdBy: string;
    organizationId?: string | null;
    approvedBy?: string | null;
    approvedAt?: string | null;
    postedAt?: string | null;
    postedJournalEntryId?: string | null;
    rejectedAt?: string | null;
    rejectedBy?: string | null;
    rejectionReason?: string | null;
    createdAt?: string;
    updatedAt?: string;
}

export interface CreateManualJournalEntryInput {
    description: string;
    /** ISO date (yyyy-mm-dd) — accounting period this lands in. */
    postingDate: string;
    /** Business reason (≥ 1 char; UI enforces ≥ 10 by RFC). */
    reason: string;
    /** ≥ 2 lines, debits == credits within 0.005 THB. */
    lines: ManualJournalEntryDraftLineInput[];
}

export interface ManualJournalEntryListFilters {
    status?: ManualJournalEntryStatus | 'ALL';
    limit?: number;
}

export interface ApproveManualJournalEntryResult {
    /** The updated draft row (status flipped to APPROVED). */
    draft: ManualJournalEntryDraft;
}

export interface PostManualJournalEntryResult {
    /** Updated draft (status = POSTED, postedJournalEntryId set). */
    draft: ManualJournalEntryDraft;
    /** The newly created JournalEntry row, with `lines`. */
    entry: {
        id: string;
        reference: string;
        entryDate: string;
        description: string;
        totalDebit: number;
        totalCredit: number;
        lines: ManualJournalEntryLine[];
    };
}

export interface RejectManualJournalEntryInput {
    /** ≥ 10 chars. */
    reason: string;
}

export const ManualJournalEntryService = {
    /** GET /api/finance/manual-journal-entries?status=&limit= */
    async listDrafts(filters: ManualJournalEntryListFilters = {}): Promise<ManualJournalEntryDraft[]> {
        const params: Record<string, string | number | null | undefined> = {
            limit: filters.limit,
        };
        if (filters.status && filters.status !== 'ALL') {
            params.status = filters.status;
        }
        const res = await apiClient.get<ManualJournalEntryDraft[]>(
            `${BASE}/manual-journal-entries${qs(params)}`,
        );
        return ok(res);
    },

    /** GET /api/finance/manual-journal-entries/:id */
    async getDraft(id: string): Promise<ManualJournalEntryDraft> {
        const res = await apiClient.get<ManualJournalEntryDraft>(
            `${BASE}/manual-journal-entries/${encodeURIComponent(id)}`,
        );
        return ok(res);
    },

    /** POST /api/finance/manual-journal-entries */
    async createDraft(input: CreateManualJournalEntryInput): Promise<ManualJournalEntryDraft> {
        const res = await apiClient.post<ManualJournalEntryDraft>(
            `${BASE}/manual-journal-entries`,
            input,
        );
        return ok(res);
    },

    /** POST /api/finance/manual-journal-entries/:id/approve — ADMIN only. */
    async approveDraft(id: string): Promise<ManualJournalEntryDraft> {
        const res = await apiClient.post<ManualJournalEntryDraft>(
            `${BASE}/manual-journal-entries/${encodeURIComponent(id)}/approve`,
        );
        return ok(res);
    },

    /** POST /api/finance/manual-journal-entries/:id/post — ADMIN only. */
    async postDraft(id: string): Promise<PostManualJournalEntryResult> {
        const res = await apiClient.post<PostManualJournalEntryResult>(
            `${BASE}/manual-journal-entries/${encodeURIComponent(id)}/post`,
        );
        return ok(res);
    },

    /** POST /api/finance/manual-journal-entries/:id/reject — ADMIN only. */
    async rejectDraft(id: string, input: RejectManualJournalEntryInput): Promise<ManualJournalEntryDraft> {
        const res = await apiClient.post<ManualJournalEntryDraft>(
            `${BASE}/manual-journal-entries/${encodeURIComponent(id)}/reject`,
            { reason: input.reason },
        );
        return ok(res);
    },
};

// ── WHT (Withholding Tax 3%) ──────────────────────────────────────────

/**
 * Reason codes returned by `isWhtApplicable`. Mirrors the strings in
 * `apps/backend/services/wht-service.js:531-580` so the UI can switch
 * on them without round-tripping a free-text Thai label.
 */
export type WhtApplicabilityReason =
    | 'CORPORATE_BUYER_PLATFORM_PAID'
    | 'INDIVIDUAL_BUYER'
    | 'INVOICE_NOT_PAID'
    | 'NOT_PLATFORM_INVOICE'
    | 'INVOICE_NOT_FOUND'
    | 'DB_UNAVAILABLE';

export interface WhtApplicabilityResult {
    applicable: boolean;
    reason: WhtApplicabilityReason | string;
    /** Indicative 3% withholding amount when applicable. */
    indicativeWht?: number;
    /** True when a cert is already on file. */
    alreadyRecorded?: boolean;
}

export interface WhtCertificateRecord {
    invoiceId: string;
    invoiceNumber: string;
    organizationId?: string | null;
    invoiceSubtotal: number;
    certificateNumber: string;
    issuedByTaxId: string;
    issuedByName: string;
    certificateDate: string;
    whtAmount: number;
    rate: number;
    attachmentId?: string | null;
    recordedAt: string;
    recordedBy?: string | null;
    source: 'BUYER_ISSUED';
}

export interface WhtCertificatesListResponse {
    count: number;
    certificates: WhtCertificateRecord[];
}

export interface RecordWhtCertificateInput {
    invoiceId: string;
    certificateNumber: string;
    /** 13-digit Thai TIN (buyer). */
    issuedByTaxId: string;
    issuedByName: string;
    /** ISO date stamped on the ทบ.50 ทวิ cert. */
    certificateDate: string;
    /** > 0; capped by invoice.subtotal on backend. */
    whtAmount: number;
    attachmentId?: string | null;
    /** Reserved for future GL hook; default false. */
    recordJournal?: boolean;
}

export interface RecordWhtCertificateResult {
    invoiceId: string;
    invoiceNumber?: string;
    certificateNumber: string;
    whtAmount: number;
    recordedAt: string;
    journalRef?: unknown;
    /** True when the same certificateNumber was already on file. */
    alreadyRecorded?: boolean;
}

export interface WhtCertificatesListFilters {
    /** ISO date — inclusive lower bound on certificateDate. */
    startDate?: string;
    /** ISO date — exclusive upper bound on certificateDate. */
    endDate?: string;
}

async function _whtRecord(input: RecordWhtCertificateInput): Promise<RecordWhtCertificateResult> {
    const res = await apiClient.post<RecordWhtCertificateResult>(
        `${BASE}/wht/certificate`,
        input,
    );
    return ok(res);
}

async function _whtList(
    filters: WhtCertificatesListFilters = {},
): Promise<WhtCertificatesListResponse> {
    const res = await apiClient.get<WhtCertificatesListResponse>(
        `${BASE}/wht/certificates${qs({
            startDate: filters.startDate,
            endDate: filters.endDate,
        })}`,
    );
    return ok(res);
}

async function _whtApplicable(invoiceId: string): Promise<WhtApplicabilityResult> {
    const res = await apiClient.get<WhtApplicabilityResult>(
        `${BASE}/wht/applicable/${encodeURIComponent(invoiceId)}`,
    );
    return ok(res);
}

export const WhtCertificateService = {
    /** POST /api/finance/wht/certificate — ACCOUNT_PLATFORM / ADMIN. */
    recordCertificate: _whtRecord,
    /** GET /api/finance/wht/certificates?startDate=&endDate= */
    listCertificates: _whtList,
    /** GET /api/finance/wht/applicable/:invoiceId */
    isWhtApplicable: _whtApplicable,
    /** Alias consumed by R1-D's applicability-probe component. */
    checkApplicable: _whtApplicable,
};

// ── Shared formatters (small to keep clients self-contained) ─────────

/**
 * Format a numeric amount as Thai Baht with thousand separators.
 */
export function formatTHB(amount: number, withSymbol = true): string {
    const value = Number.isFinite(amount) ? amount : 0;
    return new Intl.NumberFormat('th-TH', {
        style: withSymbol ? 'currency' : 'decimal',
        currency: 'THB',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value);
}

/**
 * Format an ISO datetime/date as Thai short date (DD/MM/YYYY in
 * Buddhist era).
 */
export function formatThaiDate(iso: string | null | undefined): string {
    if (!iso) return '-';
    try {
        return new Date(iso).toLocaleDateString('th-TH', {
            timeZone: THAI_TIME_ZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
    } catch {
        return String(iso);
    }
}

/** First day of the current month as ISO yyyy-mm-dd. */
export function firstOfMonthIso(): string {
    // The 1st of the Bangkok month. The old local-midnight → toISOString() read
    // gave the last day of the previous month even in a Bangkok browser.
    return bangkokFirstOfMonthIso();
}

/** Today as ISO yyyy-mm-dd. */
export function todayIso(): string {
    return bangkokTodayIso(); // today in Bangkok, not UTC
}
