/**
 * Accounting Service — frontend client for the Finance Dashboard
 *
 * Mirrors the standard accounting reports a Thai SME under
 * TFRS for NPAEs needs: Trial Balance, P&L, Balance Sheet,
 * General Ledger, and the monthly ภ.พ.30 Output VAT report.
 *
 * Backend endpoints (batch B19-A/B/C territory):
 *   GET /api/finance/reports/trial-balance
 *   GET /api/finance/reports/profit-and-loss
 *   GET /api/finance/reports/balance-sheet
 *   GET /api/finance/reports/general-ledger
 *   GET /api/finance/tax-reports/output-vat
 *   GET /api/finance/tax-reports/period-closable
 *
 * For CSV downloads we return the absolute URL so the browser
 * handles the file download natively — we do not stream a blob
 * through JS because finance staff often save the file directly
 * from the browser's download manager.
 */

import { apiClient } from '../api/api-client';
import { THAI_TIME_ZONE, bangkokTodayIso, bangkokFirstOfMonthIso } from '@/lib/format/thai-date';

// ── Shared types ───────────────────────────────────────────────

/**
 * บัญชีหมวด (Thai accounting category) — matches the 5-class
 * chart used by TFRS for NPAEs (Assets / Liabilities / Equity /
 * Revenue / Expense).
 */
export type AccountCategory =
    | 'ASSET'
    | 'LIABILITY'
    | 'EQUITY'
    | 'REVENUE'
    | 'EXPENSE';

export interface AccountSummary {
    /** 4-digit account code, e.g. "4110" for รายได้ค่าบริการ */
    accountCode: string;
    /** Thai account name */
    accountNameTh: string;
    /** English account name (optional, falls back to TH in UI) */
    accountNameEn?: string;
    category: AccountCategory;
}

// ── Trial Balance ──────────────────────────────────────────────

export interface TrialBalanceRow extends AccountSummary {
    debit: number;
    credit: number;
}

export interface TrialBalanceResponse {
    asOfDate: string;          // ISO date — end of accounting period
    rows: TrialBalanceRow[];
    totals: {
        debit: number;
        credit: number;
        /** Whether totals balance (debit == credit) — backend-asserted */
        isBalanced: boolean;
    };
    /** ISO timestamp when the snapshot was generated server-side. */
    generatedAt?: string;
}

// ── Profit & Loss ──────────────────────────────────────────────

export interface PLLineItem {
    accountCode: string;
    accountNameTh: string;
    amount: number;
}

export interface PLResponse {
    from: string;              // ISO date — period start
    to: string;                // ISO date — period end
    revenue: {
        lines: PLLineItem[];
        total: number;
    };
    expenses: {
        lines: PLLineItem[];
        total: number;
    };
    /** Revenue total minus expenses total — may be negative (loss). */
    netProfit: number;
    generatedAt?: string;
}

// ── Balance Sheet ──────────────────────────────────────────────

export interface BSLineItem {
    accountCode: string;
    accountNameTh: string;
    amount: number;
}

export interface BSResponse {
    asOfDate: string;
    assets: {
        lines: BSLineItem[];
        total: number;
    };
    liabilities: {
        lines: BSLineItem[];
        total: number;
    };
    equity: {
        lines: BSLineItem[];
        total: number;
    };
    /** liabilities.total + equity.total — must equal assets.total */
    totalLiabilitiesAndEquity: number;
    /** True if the accounting equation holds: A = L + E */
    isBalanced: boolean;
    generatedAt?: string;
}

// ── General Ledger ─────────────────────────────────────────────

export interface GLEntry {
    /** Posting date — ISO string */
    date: string;
    /** Reference number (journal voucher, invoice, receipt) */
    referenceNo: string;
    /** Free-text narrative */
    description: string;
    debit: number;
    credit: number;
    /** Running balance after this entry. Sign follows account category. */
    balance: number;
}

export interface GLResponse {
    accountCode: string;
    accountNameTh: string;
    from: string;
    to: string;
    openingBalance: number;
    entries: GLEntry[];
    closingBalance: number;
}

// ── Output VAT (ภ.พ.30) ────────────────────────────────────────

export interface VATLineItem {
    date: string;
    /** เลขที่ใบกำกับภาษี */
    taxInvoiceNo: string;
    /** ชื่อผู้ซื้อสินค้า/ผู้รับบริการ */
    buyerName: string;
    /** เลขประจำตัวผู้เสียภาษีของผู้ซื้อ (13 หลัก, optional for B2C) */
    buyerTaxId: string | null;
    /** มูลค่าสินค้า/บริการ (excl. VAT) */
    netAmount: number;
    /** จำนวนภาษีมูลค่าเพิ่ม (VAT 7%) */
    vatAmount: number;
}

export interface VATResponse {
    year: number;
    month: number;
    lines: VATLineItem[];
    totals: {
        netAmount: number;
        vatAmount: number;
    };
    /** True when no invoices are still open (awaiting receipt) for this period. */
    periodClosable: boolean;
    /** Helpful message when periodClosable is false. */
    warnings: string[];
    generatedAt?: string;
}

// ── AR Aging (B20-D, รายงานลูกหนี้ค้างชำระ) ────────────────────

export type ArAgingBucket =
    | 'NOT_YET_DUE'
    | '0_30'
    | '31_60'
    | '61_90'
    | 'OVER_90';

export interface ArAgingRow {
    invoiceId: string;
    invoiceNumber: string;
    applicantHealthIdMasked: string | null;
    applicantNameMasked: string | null;
    applicationId: string | null;
    applicationNumber: string | null;
    invoiceDate: string;
    dueDate: string;
    daysOverdue: number;
    bucket: ArAgingBucket;
    amount: number;
    serviceType: string;
}

export interface ArAgingResponse {
    asOfDate: string;
    bookSide: 'DTAM' | 'PLATFORM';
    organizationId: string;
    totalsByBucket: Record<ArAgingBucket, { amount: number; count: number }>;
    totalOutstanding: number;
    rowCount: number;
    rows: ArAgingRow[];
}

export interface PeriodClosableResponse {
    year: number;
    month: number;
    closable: boolean;
    /** Invoices still awaiting receipt issuance. */
    openInvoices: Array<{
        invoiceNumber: string;
        amount: number;
        status: string;
    }>;
    warnings: string[];
}

// ── Service ────────────────────────────────────────────────────

interface CsvCapable {
    format?: 'csv';
}

const BASE = '/finance';

function ok<T>(payload: { success: boolean; data?: T }): T {
    if (!payload?.success || payload.data === undefined) {
        throw new Error('การเรียกข้อมูลล้มเหลว');
    }
    return payload.data as T;
}

/**
 * Build an absolute URL the browser can hit directly for CSV
 * downloads. Auth is via the JWT cookie + Authorization header
 * which the browser carries automatically because the API is
 * same-origin under /api/* via the Next.js proxy.
 */
function buildAbsoluteUrl(path: string, params: Record<string, string | number>): string {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null) continue;
        search.set(k, String(v));
    }
    const qs = search.toString();
    return qs ? `/api${path}?${qs}` : `/api${path}`;
}

export const AccountingService = {
    /**
     * GET /api/finance/reports/trial-balance?asOfDate=YYYY-MM-DD
     */
    async getTrialBalance(args: { asOfDate: string }): Promise<TrialBalanceResponse> {
        const params = new URLSearchParams({ asOfDate: args.asOfDate });
        const res = await apiClient.get<TrialBalanceResponse>(
            `${BASE}/reports/trial-balance?${params.toString()}`,
        );
        return ok(res);
    },

    /**
     * GET /api/finance/reports/profit-and-loss?from=YYYY-MM-DD&to=YYYY-MM-DD
     */
    async getProfitAndLoss(args: { from: string; to: string }): Promise<PLResponse> {
        const params = new URLSearchParams({ from: args.from, to: args.to });
        const res = await apiClient.get<PLResponse>(
            `${BASE}/reports/profit-and-loss?${params.toString()}`,
        );
        return ok(res);
    },

    /**
     * GET /api/finance/reports/balance-sheet?asOfDate=YYYY-MM-DD
     */
    async getBalanceSheet(args: { asOfDate: string }): Promise<BSResponse> {
        const params = new URLSearchParams({ asOfDate: args.asOfDate });
        const res = await apiClient.get<BSResponse>(
            `${BASE}/reports/balance-sheet?${params.toString()}`,
        );
        return ok(res);
    },

    /**
     * GET /api/finance/reports/general-ledger?accountCode=…&from=…&to=…
     */
    async getGeneralLedger(args: {
        accountCode: string;
        from: string;
        to: string;
    }): Promise<GLResponse> {
        const params = new URLSearchParams({
            accountCode: args.accountCode,
            from: args.from,
            to: args.to,
        });
        const res = await apiClient.get<GLResponse>(
            `${BASE}/reports/general-ledger?${params.toString()}`,
        );
        return ok(res);
    },

    /**
     * GET /api/finance/tax-reports/output-vat?year=YYYY&month=MM
     */
    async getOutputVatReport(args: { year: number; month: number }): Promise<VATResponse> {
        const params = new URLSearchParams({
            year: String(args.year),
            month: String(args.month).padStart(2, '0'),
        });
        const res = await apiClient.get<VATResponse>(
            `${BASE}/tax-reports/output-vat?${params.toString()}`,
        );
        return ok(res);
    },

    /**
     * GET /api/finance/tax-reports/period-closable?year=…&month=…
     */
    async getPeriodClosable(args: {
        year: number;
        month: number;
    }): Promise<PeriodClosableResponse> {
        const params = new URLSearchParams({
            year: String(args.year),
            month: String(args.month).padStart(2, '0'),
        });
        const res = await apiClient.get<PeriodClosableResponse>(
            `${BASE}/tax-reports/period-closable?${params.toString()}`,
        );
        return ok(res);
    },

    /**
     * Optional — fetch the chart of accounts to populate the
     * General Ledger account selector. Falls back to a hardcoded
     * list if the endpoint isn't yet wired up.
     */
    async getChartOfAccounts(): Promise<AccountSummary[]> {
        const res = await apiClient.get<{ accounts: AccountSummary[] }>(
            `${BASE}/reports/chart-of-accounts`,
        );
        if (res?.success && res.data && Array.isArray(res.data.accounts)) {
            return res.data.accounts;
        }
        return FALLBACK_CHART_OF_ACCOUNTS;
    },

    // ── CSV download URL builders ──────────────────────────────

    trialBalanceCsvUrl(args: { asOfDate: string } & CsvCapable): string {
        return buildAbsoluteUrl('/finance/reports/trial-balance', {
            asOfDate: args.asOfDate,
            format: 'csv',
        });
    },

    profitAndLossCsvUrl(args: { from: string; to: string }): string {
        return buildAbsoluteUrl('/finance/reports/profit-and-loss', {
            from: args.from,
            to: args.to,
            format: 'csv',
        });
    },

    balanceSheetCsvUrl(args: { asOfDate: string }): string {
        return buildAbsoluteUrl('/finance/reports/balance-sheet', {
            asOfDate: args.asOfDate,
            format: 'csv',
        });
    },

    generalLedgerCsvUrl(args: {
        accountCode: string;
        from: string;
        to: string;
    }): string {
        return buildAbsoluteUrl('/finance/reports/general-ledger', {
            accountCode: args.accountCode,
            from: args.from,
            to: args.to,
            format: 'csv',
        });
    },

    outputVatCsvUrl(args: { year: number; month: number }): string {
        return buildAbsoluteUrl('/finance/tax-reports/output-vat', {
            year: args.year,
            month: String(args.month).padStart(2, '0'),
            format: 'csv',
        });
    },

    /**
     * GET /api/finance/ar-aging?bookSide=…&asOfDate=YYYY-MM-DD
     * B20-D — AR Aging Report (รายงานลูกหนี้ค้างชำระ).
     */
    async getArAging(args: {
        bookSide: 'DTAM' | 'PLATFORM';
        asOfDate: string;
    }): Promise<ArAgingResponse> {
        const params = new URLSearchParams({
            bookSide: args.bookSide,
            asOfDate: args.asOfDate,
        });
        const res = await apiClient.get<ArAgingResponse>(
            `${BASE}/ar-aging?${params.toString()}`,
        );
        return ok(res);
    },

    arAgingCsvUrl(args: {
        bookSide: 'DTAM' | 'PLATFORM';
        asOfDate: string;
    }): string {
        return buildAbsoluteUrl('/finance/ar-aging', {
            bookSide: args.bookSide,
            asOfDate: args.asOfDate,
            format: 'csv',
        });
    },

};

/**
 * Hardcoded fallback chart of accounts — used until the backend
 * /finance/reports/chart-of-accounts endpoint is wired. Mirrors
 * the GACP platform's working chart for the most common postings.
 */
export const FALLBACK_CHART_OF_ACCOUNTS: AccountSummary[] = [
    // สินทรัพย์ (Assets)
    { accountCode: '1110', accountNameTh: 'เงินสด', accountNameEn: 'Cash', category: 'ASSET' },
    {
        accountCode: '1120',
        accountNameTh: 'เงินฝากธนาคาร',
        accountNameEn: 'Bank',
        category: 'ASSET',
    },
    {
        accountCode: '1121',
        accountNameTh: 'เงินฝากธนาคาร (บริษัท)',
        accountNameEn: 'Bank — Company',
        category: 'ASSET',
    },
    { accountCode: '1130', accountNameTh: 'ลูกหนี้การค้า', accountNameEn: 'Accounts Receivable', category: 'ASSET' },
    // หนี้สิน (Liabilities)
    {
        accountCode: '2110',
        accountNameTh: 'เจ้าหนี้กรมการแพทย์แผนไทยฯ',
        accountNameEn: 'Payable to DTAM',
        category: 'LIABILITY',
    },
    { accountCode: '2120', accountNameTh: 'ภาษีขาย', accountNameEn: 'Output VAT Payable', category: 'LIABILITY' },
    { accountCode: '2130', accountNameTh: 'รายได้รับล่วงหน้า', accountNameEn: 'Deferred Revenue', category: 'LIABILITY' },
    // ส่วนของผู้ถือหุ้น (Equity)
    { accountCode: '3110', accountNameTh: 'ทุนจดทะเบียน', accountNameEn: 'Capital', category: 'EQUITY' },
    { accountCode: '3120', accountNameTh: 'กำไรสะสม', accountNameEn: 'Retained Earnings', category: 'EQUITY' },
    // รายได้ (Revenue)
    {
        accountCode: '4110',
        accountNameTh: 'รายได้ค่าบริการ · Platform Fee',
        accountNameEn: 'Service Revenue — Platform Fee',
        category: 'REVENUE',
    },
    {
        accountCode: '4120',
        accountNameTh: 'รายได้ค่าสมาชิก · Subscription',
        accountNameEn: 'Subscription Revenue',
        category: 'REVENUE',
    },
    // ค่าใช้จ่าย (Expenses)
    { accountCode: '5110', accountNameTh: 'ค่าใช้จ่ายเงินเดือน', accountNameEn: 'Salaries Expense', category: 'EXPENSE' },
    { accountCode: '5120', accountNameTh: 'ค่าธรรมเนียมธนาคาร', accountNameEn: 'Bank Fees', category: 'EXPENSE' },
    { accountCode: '5130', accountNameTh: 'ค่าเช่าและสาธารณูปโภค', accountNameEn: 'Rent & Utilities', category: 'EXPENSE' },
    { accountCode: '5140', accountNameTh: 'ค่าใช้จ่ายเบ็ดเตล็ด', accountNameEn: 'Miscellaneous Expense', category: 'EXPENSE' },
];

// ── Utility formatters used across the report components ───────

/**
 * Format a numeric amount as Thai Baht with thousand separators.
 * Pass `withSymbol=false` for inline table cells where the
 * column header already says "เดบิต / เครดิต".
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

/** Format ISO date as Thai short date (DD/MM/YYYY in Buddhist era). */
export function formatThaiDate(iso: string): string {
    if (!iso) return '-';
    try {
        return new Date(iso).toLocaleDateString('th-TH', {
            timeZone: THAI_TIME_ZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
    } catch {
        return iso;
    }
}

/** Default the "as of" date picker to today (ISO YYYY-MM-DD). */
export function todayIso(): string {
    return bangkokTodayIso(); // today in Bangkok, not UTC
}

/** Default the period picker to the first day of the current month. */
export function firstOfMonthIso(): string {
    // The 1st of the Bangkok month. The old local-midnight → toISOString() read
    // gave the last day of the previous month even in a Bangkok browser.
    return bangkokFirstOfMonthIso();
}
