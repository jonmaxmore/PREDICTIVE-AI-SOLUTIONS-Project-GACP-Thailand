/**
 * Chart of Accounts Service — canonical Thai-NPAE-compliant CoA for the
 * platform's books.
 *
 * System deep-dive Tier 14 — Backend + Compliance + Accounting (B19-A,
 * 2026-05-16). Sits alongside `journal-entry-service.js` so the journal
 * stream + the chart it credits/debits against live in one place and
 * reference each other without circular imports.
 *
 * Per TFRS for NPAEs (Thai Financial Reporting Standards for
 * Non-Publicly Accountable Entities) and Federation of Accounting
 * Professions (สภาวิชาชีพบัญชี) convention, accounts use a 4-digit
 * hierarchy:
 *
 *   1xxx — Assets        (สินทรัพย์)
 *   2xxx — Liabilities   (หนี้สิน)
 *   3xxx — Equity        (ส่วนของผู้ถือหุ้น)
 *   4xxx — Revenue       (รายได้)
 *   5xxx — Expenses      (ค่าใช้จ่าย)
 *   9xxx — Memo / off-books (suspense, statistical accounts)
 *
 * Memo accounts (9xxx) are NOT part of the double-entry GL — they are
 * statistical buckets used to track items that flow OUTSIDE the
 * platform's books. The DTAM state-revenue suspense (9110) is the
 * canonical example: state-fee cash never lands on the platform's
 * books (see journal-entry-service header — owner-confirmed
 * 2026-05-16), so any reference to it from a report / dashboard reads
 * from the 9110 memo bucket, not from a real GL account.
 *
 * Compliance basis:
 *   - TFRS for NPAEs ch.2 (financial reporting framework — chart of
 *     accounts forms the basis for every required statement)
 *   - TFRS for NPAEs ch.18 (รายได้ — revenue recognition principles)
 *   - TFRS for NPAEs ch.21 (income tax — links 4xxx revenue + 5xxx
 *     expense rows to the ภ.ง.ด.50 corporate tax return)
 *   - Revenue Department guidance for ภ.พ.30 (monthly VAT remittance)
 *     — Output VAT 7% must sit on a separate liability account; this
 *     module exposes `2210` for that purpose.
 *
 * Persistence note: no `Account` Prisma model exists in this codebase
 * (verified via `model Account ` grep over apps/backend/prisma/schema/
 * on 2026-05-16). The seeder therefore exports the constant list only;
 * if/when DBA introduces a dedicated table the `seedChartOfAccounts`
 * helper below will start running its `account.upsert` loop without
 * any caller-side change (the helper detects the model at runtime).
 *
 * @module services/chart-of-accounts-service
 */

'use strict';

// ──────────────────────────────────────────────────────────────────────────
// Account type constants
// ──────────────────────────────────────────────────────────────────────────

const ACCOUNT_TYPE = Object.freeze({
    ASSET: 'ASSET',
    LIABILITY: 'LIABILITY',
    EQUITY: 'EQUITY',
    REVENUE: 'REVENUE',
    EXPENSE: 'EXPENSE',
    MEMO: 'MEMO', // off-books / statistical
});

// Map the 4-digit account-code prefix → account type. Single source of
// truth for trial-balance bucketing (B19-B will read this).
const PREFIX_TO_TYPE = Object.freeze({
    1: ACCOUNT_TYPE.ASSET,
    2: ACCOUNT_TYPE.LIABILITY,
    3: ACCOUNT_TYPE.EQUITY,
    4: ACCOUNT_TYPE.REVENUE,
    5: ACCOUNT_TYPE.EXPENSE,
    9: ACCOUNT_TYPE.MEMO,
});

// Normal balance per account type — TFRS for NPAEs ch.2. Used by
// trial-balance + financial-statements services (B19-B) to decide
// whether to render an account in the Dr or Cr column.
const NORMAL_BALANCE = Object.freeze({
    [ACCOUNT_TYPE.ASSET]: 'DEBIT',
    [ACCOUNT_TYPE.LIABILITY]: 'CREDIT',
    [ACCOUNT_TYPE.EQUITY]: 'CREDIT',
    [ACCOUNT_TYPE.REVENUE]: 'CREDIT',
    [ACCOUNT_TYPE.EXPENSE]: 'DEBIT',
    [ACCOUNT_TYPE.MEMO]: 'CREDIT',
});

// ──────────────────────────────────────────────────────────────────────────
// Canonical CoA — minimum viable set per TFRS for NPAEs
// ──────────────────────────────────────────────────────────────────────────
//
// Each row carries:
//   - code     : 4-digit (optionally suffixed) account number
//   - name     : Thai-language display name (primary)
//   - nameEn   : English mirror (for ops / audit)
//   - type     : ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE | MEMO
//   - vatRelevant : whether the account participates in ภ.พ.30 (VAT report)
//   - description : free-form note for finance staff
//
// Suffix convention: a -PRD or -DTAM suffix scopes the account to a
// specific bank channel without breaking the 4-digit prefix lookup
// (PREFIX_TO_TYPE still works on the first 4 digits). Example:
//   1110     — generic cash (current account)
//   1110-PRD — cash held in the Predictive AI corporate account
//   1110-001 — the code journal-entry-service.ACCOUNTS actually writes today.
//              1110-PRD is where it is meant to end up; the migration has not
//              happened, so calling 1110-001 "legacy" describes an intention,
//              not the ledger. Same for 2131-001 and 4110-001.
//
// No DTAM account lives here (operator 2026-09-29): the company settles with
// DTAM offline and books it in its own accounts, so this chart has neither the
// DTAM payable (2151-001) nor the DTAM-fee cost (5110-001) that the settlement
// entry used to post between 2026-09-05 and 2026-09-29. Removing them from the
// chart also stops a manual journal entry from naming them
// (manual-journal-entry-service refuses codes the chart does not know).

const CHART_OF_ACCOUNTS = Object.freeze([
    // ─── 1xxx Assets ──────────────────────────────────────────────────────
    {
        code: '1110',
        name: 'เงินสด · บัญชีกระแสรายวัน',
        nameEn: 'Cash — Current Account',
        type: ACCOUNT_TYPE.ASSET,
        vatRelevant: false,
        description: 'หลัก ใช้กับรายการที่ไม่ระบุธนาคารชัดเจน',
    },
    {
        code: '1110-PRD',
        name: 'เงินสด · บัญชี Predictive AI',
        nameEn: "Cash — Predictive AI Bank Account",
        type: ACCOUNT_TYPE.ASSET,
        vatRelevant: false,
        description: 'บัญชีธนาคารหลักของแพลตฟอร์ม (PLATFORM bank, VAT-registered entity)',
    },
    {
        // Legacy code emitted by journal-entry-service.ACCOUNTS — kept so
        // historical journal_lines stay queryable via this CoA.
        code: '1110-001',
        name: 'เงินสด/เงินฝากธนาคาร · บัญชีหลัก',
        nameEn: 'Cash / Bank — Main Account',
        type: ACCOUNT_TYPE.ASSET,
        vatRelevant: false,
        description: 'บัญชีที่ระบบเขียนจริงทุกครั้งที่ชำระเงินสำเร็จ '
            + '(1110-PRD คือเลขปลายทางของการจัดหมวดใหม่ ซึ่งยังไม่ได้ย้าย)',
    },
    {
        code: '1130',
        name: 'ลูกหนี้การค้า',
        nameEn: 'Accounts Receivable',
        type: ACCOUNT_TYPE.ASSET,
        vatRelevant: false,
        description: 'For accrual-basis invoicing (future use; cash-basis today)',
    },

    // ─── 2xxx Liabilities ─────────────────────────────────────────────────
    {
        code: '2110',
        name: 'เจ้าหนี้การค้า',
        nameEn: 'Accounts Payable',
        type: ACCOUNT_TYPE.LIABILITY,
        vatRelevant: false,
        description: 'Suppliers / vendors invoiced to the platform',
    },
    {
        code: '2210',
        name: 'ภาษีขายค้างจ่าย · Output VAT 7%',
        nameEn: 'Output VAT Payable (7%)',
        type: ACCOUNT_TYPE.LIABILITY,
        vatRelevant: true,
        description: 'ภ.พ.30 monthly VAT remittance to Revenue Department '
            + '(Revenue Code §86/4)',
    },
    {
        // Legacy alias for the same Output VAT account emitted by
        // journal-entry-service.ACCOUNTS.VAT_PAYABLE_OUTPUT (2131-001).
        code: '2131-001',
        name: 'ภาษีขายตั้งพัก (Output VAT 7%)',
        nameEn: 'Output VAT Payable (7%)',
        type: ACCOUNT_TYPE.LIABILITY,
        vatRelevant: true,
        description: 'บัญชีที่ระบบเขียนจริงทุกครั้งที่ชำระเงินสำเร็จ '
            + '(2210 คือเลขปลายทางของการจัดหมวดใหม่ ซึ่งยังไม่ได้ย้าย · '
            + 'trial-balance bucketer รวม 2210 กับ 2131-001 เป็นบรรทัด VAT เดียวกัน)',
    },
    {
        code: '2310',
        name: 'เจ้าหนี้กรมบัญชีกลาง · Payable to Treasury',
        nameEn: 'Payable to Treasury (Collected on Behalf)',
        type: ACCOUNT_TYPE.LIABILITY,
        vatRelevant: false,
        description: 'Not written by any live flow. This is Treasury '
            + '(กรมบัญชีกลาง), not DTAM. Nothing is owed to Treasury through '
            + 'this platform, and nothing to DTAM either: the company settles '
            + 'with DTAM offline in its own accounts (operator 2026-09-29). Its '
            + 'previous description cited the 2026-05-16 two-channel model, '
            + 'which W14 retired.',
    },

    // ─── 3xxx Equity ──────────────────────────────────────────────────────
    {
        code: '3110',
        name: 'ทุนจดทะเบียน',
        nameEn: 'Registered Capital',
        type: ACCOUNT_TYPE.EQUITY,
        vatRelevant: false,
        description: 'Paid-up share capital per Department of Business '
            + 'Development registration',
    },
    {
        code: '3210',
        name: 'กำไรสะสม',
        nameEn: 'Retained Earnings',
        type: ACCOUNT_TYPE.EQUITY,
        vatRelevant: false,
        description: 'Closes 4xxx revenue + 5xxx expense at year-end '
            + '(TFRS for NPAEs ch.2 §2.4)',
    },

    // ─── 4xxx Revenue ─────────────────────────────────────────────────────
    {
        code: '4110',
        name: 'รายได้ค่าบริการแพลตฟอร์ม',
        nameEn: 'Platform Service Revenue',
        type: ACCOUNT_TYPE.REVENUE,
        vatRelevant: true,
        description: 'Platform fee subtotal (excl. VAT) per application phase '
            + '— TFRS for NPAEs ch.18 §18.4 service-revenue recognition',
    },
    {
        // Written by journal-entry-service.ACCOUNTS.REVENUE_PLATFORM_FEE on
        // every settlement — live, despite the '(legacy)' this row carried in
        // its printed name until 2026-09-05. 4110 is the target number.
        code: '4110-001',
        name: 'รายได้ค่าบริการแพลตฟอร์ม',
        nameEn: 'Platform Service Revenue',
        type: ACCOUNT_TYPE.REVENUE,
        vatRelevant: true,
        description: 'บัญชีที่ระบบเขียนจริงทุกครั้งที่ชำระเงินสำเร็จ '
            + '(4110 คือเลขปลายทางของการจัดหมวดใหม่ ซึ่งยังไม่ได้ย้าย)',
    },
    {
        code: '4120',
        name: 'รายได้ค่าสมัครสมาชิก',
        nameEn: 'Subscription Revenue',
        type: ACCOUNT_TYPE.REVENUE,
        vatRelevant: true,
        description: 'PREMIUM / ENTERPRISE subscription orders — VAT-bearing '
            + 'per Revenue Code §77/1 (service supply)',
    },

    // ─── 5xxx Expenses ────────────────────────────────────────────────────
    {
        code: '5110',
        name: 'ค่าใช้จ่ายในการดำเนินงาน',
        nameEn: 'Operating Expenses',
        type: ACCOUNT_TYPE.EXPENSE,
        vatRelevant: false,
        description: 'Catch-all for OpEx; finance can subdivide later via '
            + '-001 / -002 suffixes (rent, payroll, utilities, …)',
    },

    // ─── 9xxx Memo / off-books ────────────────────────────────────────────
    {
        code: '9110',
        name: 'พักรายการ รายได้แผ่นดิน DTAM',
        nameEn: 'Suspense — DTAM State Revenue (off-books / memo)',
        type: ACCOUNT_TYPE.MEMO,
        vatRelevant: false,
        description: 'STATISTICAL ONLY — not part of the GL. Tracks state '
            + 'fees that flow applicant → กรมบัญชีกลาง (Treasury) directly '
            + 'and therefore never hit the platform\'s books. Used by '
            + 'reporting (B19-B) so the dashboard can render a complete '
            + 'view of money the platform facilitated without booking it. '
            + 'Legal anchor: ป.รัษฎากร ม.77/1 (10), พ.ร.บ.วินัยการเงิน'
            + 'การคลังของรัฐ ม.34.',
    },
]);

// Index by code for O(1) lookup. Frozen so callers can't mutate the
// CoA at runtime.
const ACCOUNT_BY_CODE = Object.freeze(
    CHART_OF_ACCOUNTS.reduce((acc, row) => {
        acc[row.code] = row;
        return acc;
    }, Object.create(null)),
);

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────

/**
 * Return the full chart of accounts (immutable array). Callers must
 * not mutate the result — use the spread operator if a mutable copy is
 * required.
 */
function getChartOfAccounts() {
    return CHART_OF_ACCOUNTS;
}

/**
 * Look up a single account by its canonical code. Returns the account
 * object on hit, `null` on miss.
 *
 * Code normalisation: callers may pass either the 4-digit prefix
 * ("1110") or the suffixed variant ("1110-PRD") — both forms are
 * keyed verbatim, no fuzzy matching, so the trial-balance can
 * distinguish the two channels.
 */
function getAccountByCode(code) {
    if (!code) {
        return null;
    }
    return ACCOUNT_BY_CODE[String(code)] || null;
}

/**
 * Cheap existence check — useful in validation layers where the
 * caller only wants a boolean.
 */
function accountExists(code) {
    return !!getAccountByCode(code);
}

/**
 * Return the account type for a code by reading the 4-digit prefix.
 * Falls back to the explicit `type` field on the account row when the
 * code has a non-standard prefix (defensive — the CoA above never
 * triggers the fallback today).
 */
function getAccountType(code) {
    const row = getAccountByCode(code);
    if (row) {
        return row.type;
    }
    const prefix = Number(String(code || '').charAt(0));
    return PREFIX_TO_TYPE[prefix] || null;
}

/**
 * Return the normal-balance side (DEBIT | CREDIT) for an account.
 * Used by trial-balance + financial-statements services (B19-B).
 */
function getNormalBalance(code) {
    const type = getAccountType(code);
    if (!type) {
        return null;
    }
    return NORMAL_BALANCE[type];
}

/**
 * Seed the chart of accounts into the database. Idempotent — uses
 * upsert keyed on `code` so re-running is safe.
 *
 * Behaviour:
 *   - If a Prisma `Account` model exists, upsert each row.
 *   - If no Prisma `Account` model exists (the case today — verified
 *     2026-05-16), log + return without doing any DB I/O. Callers can
 *     still rely on `getChartOfAccounts()` for the in-memory list.
 *
 * @param {object} [tx]  Optional Prisma client (transactional or top-level).
 *                       Falls back to `services/prisma-database` when
 *                       omitted. Tests pass a mock here.
 */
async function seedChartOfAccounts(tx) {
    let client = tx;
    if (!client) {
        try {
            const mod = require('./prisma-database');
            client = mod && mod.prisma;
        } catch (_e) {
            client = null;
        }
    }
    if (!client || !client.account || typeof client.account.upsert !== 'function') {
        // No Account model defined yet — caller still has the
        // in-memory list via getChartOfAccounts(). Return a structured
        // result so the seed script can log the right message.
        return {
            seeded: 0,
            skipped: CHART_OF_ACCOUNTS.length,
            reason: 'NO_ACCOUNT_MODEL',
            accounts: CHART_OF_ACCOUNTS.map((a) => a.code),
        };
    }
    let count = 0;
    for (const row of CHART_OF_ACCOUNTS) {
        await client.account.upsert({
            where: { code: row.code },
            // Empty update so re-runs never overwrite a row that finance
            // may have edited in production (e.g., renamed an account or
            // adjusted vatRelevant after a regulatory change).
            update: {},
            create: {
                code: row.code,
                name: row.name,
                nameEn: row.nameEn,
                type: row.type,
                vatRelevant: row.vatRelevant,
                description: row.description,
            },
        });
        count++;
    }
    return {
        seeded: count,
        skipped: 0,
        accounts: CHART_OF_ACCOUNTS.map((a) => a.code),
    };
}

module.exports = {
    ACCOUNT_TYPE,
    PREFIX_TO_TYPE,
    NORMAL_BALANCE,
    CHART_OF_ACCOUNTS,
    getChartOfAccounts,
    getAccountByCode,
    accountExists,
    getAccountType,
    getNormalBalance,
    seedChartOfAccounts,
};
