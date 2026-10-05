/**
 * Tests for chart-of-accounts-service.js (B19-A, 2026-05-16).
 *
 * System deep-dive Tier 14 — verifies the Thai-NPAE CoA layout +
 * helpers used by journal-entry-service, trial-balance-service (B19-B)
 * and vat-report-service (B19-C).
 *
 * Compliance anchors locked here:
 *   - 4-digit prefix → account type (1=ASSET, 2=LIABILITY, 3=EQUITY,
 *     4=REVENUE, 5=EXPENSE, 9=MEMO) per Federation of Accounting
 *     Professions convention.
 *   - Output VAT 7% (2210) sits on a separate LIABILITY account — required
 *     by Revenue Code §86/4 for monthly ภ.พ.30 remittance.
 *   - Platform service revenue (4110) + subscription revenue (4120) are
 *     vatRelevant=true; cash + payable accounts are vatRelevant=false.
 *   - 9110 (DTAM suspense) is a MEMO account — off-books per the
 *     two-channel money-flow model (B16-C).
 */

'use strict';

const {
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
} = require('../../services/chart-of-accounts-service');

describe('[Tier 14 / B19-A] chart-of-accounts-service — public API surface', () => {
    it('exports a non-empty frozen CHART_OF_ACCOUNTS array', () => {
        expect(Array.isArray(CHART_OF_ACCOUNTS)).toBe(true);
        expect(CHART_OF_ACCOUNTS.length).toBeGreaterThanOrEqual(10);
        expect(Object.isFrozen(CHART_OF_ACCOUNTS)).toBe(true);
    });

    it('getChartOfAccounts() returns the same array as the export', () => {
        expect(getChartOfAccounts()).toBe(CHART_OF_ACCOUNTS);
    });

    it('every account row has the required canonical fields', () => {
        for (const row of CHART_OF_ACCOUNTS) {
            expect(typeof row.code).toBe('string');
            expect(typeof row.name).toBe('string');
            expect(typeof row.nameEn).toBe('string');
            expect(typeof row.type).toBe('string');
            expect(typeof row.vatRelevant).toBe('boolean');
            expect(typeof row.description).toBe('string');
        }
    });

    it('every code is unique (no duplicate entries)', () => {
        const codes = CHART_OF_ACCOUNTS.map((a) => a.code);
        expect(new Set(codes).size).toBe(codes.length);
    });
});

describe('[Tier 14 / B19-A] chart-of-accounts — Thai-NPAE prefix convention', () => {
    it('1xxx codes are ASSET accounts', () => {
        const assets = CHART_OF_ACCOUNTS.filter((a) => a.type === ACCOUNT_TYPE.ASSET);
        expect(assets.length).toBeGreaterThanOrEqual(2);
        for (const a of assets) {
            expect(a.code.charAt(0)).toBe('1');
        }
    });

    it('2xxx codes are LIABILITY accounts (incl. Output VAT 2210)', () => {
        const liabilities = CHART_OF_ACCOUNTS.filter((a) => a.type === ACCOUNT_TYPE.LIABILITY);
        expect(liabilities.length).toBeGreaterThanOrEqual(2);
        for (const a of liabilities) {
            expect(a.code.charAt(0)).toBe('2');
        }
        // Output VAT exposure — required by Revenue Code §86/4
        expect(getAccountByCode('2210')).not.toBeNull();
        expect(getAccountByCode('2210').type).toBe(ACCOUNT_TYPE.LIABILITY);
        expect(getAccountByCode('2210').vatRelevant).toBe(true);
    });

    it('3xxx codes are EQUITY accounts', () => {
        expect(getAccountByCode('3110').type).toBe(ACCOUNT_TYPE.EQUITY);
        expect(getAccountByCode('3210').type).toBe(ACCOUNT_TYPE.EQUITY);
    });

    it('4xxx codes are REVENUE accounts (Platform 4110, Subscription 4120)', () => {
        expect(getAccountByCode('4110').type).toBe(ACCOUNT_TYPE.REVENUE);
        expect(getAccountByCode('4120').type).toBe(ACCOUNT_TYPE.REVENUE);
        // Both are VAT-bearing per Revenue Code §77/1.
        expect(getAccountByCode('4110').vatRelevant).toBe(true);
        expect(getAccountByCode('4120').vatRelevant).toBe(true);
    });

    it('5xxx codes are EXPENSE accounts', () => {
        expect(getAccountByCode('5110').type).toBe(ACCOUNT_TYPE.EXPENSE);
    });

    it('9xxx codes are MEMO (off-books) accounts — 9110 DTAM suspense', () => {
        const memo = getAccountByCode('9110');
        expect(memo).not.toBeNull();
        expect(memo.type).toBe(ACCOUNT_TYPE.MEMO);
        // DTAM state-revenue is NOT VAT-relevant — it never hits the platform's books.
        expect(memo.vatRelevant).toBe(false);
    });
});

describe('[Tier 14 / B19-A] chart-of-accounts — required canonical accounts (TFRS for NPAEs)', () => {
    // Minimum CoA per the B19-A spec.
    const REQUIRED_CODES = [
        '1110', '1110-PRD',  // Cash (generic + Predictive AI account)
        '1130',              // AR
        '2110',              // AP
        '2210',              // Output VAT 7%
        '2310',              // Payable to Treasury (legacy)
        '3110', '3210',      // Capital + Retained Earnings
        '4110', '4120',      // Platform Revenue + Subscription Revenue
        '5110',              // OpEx
        '9110',              // DTAM suspense (memo)
    ];

    for (const code of REQUIRED_CODES) {
        it(`includes required account ${code}`, () => {
            expect(accountExists(code)).toBe(true);
        });
    }

    it('legacy codes from journal-entry-service.ACCOUNTS map cleanly into the CoA', () => {
        // These codes are written by the journal-entry-service today; the
        // trial-balance bucketer must be able to look them up.
        expect(accountExists('1110-001')).toBe(true);   // CASH_BANK legacy
        expect(accountExists('2131-001')).toBe(true);   // VAT_PAYABLE_OUTPUT legacy
        // 2151-001 (DTAM payable) is gone — operator 2026-09-29: DTAM is settled
        // offline in the company's own accounts (dtam-accounting-layer-removed.test.js).
        expect(accountExists('2151-001')).toBe(false);
        expect(accountExists('4110-001')).toBe(true);   // REVENUE_PLATFORM_FEE legacy
    });
});

describe('[Tier 14 / B19-A] getAccountByCode + accountExists', () => {
    it('getAccountByCode returns the account row on hit', () => {
        const row = getAccountByCode('4110');
        expect(row).not.toBeNull();
        expect(row.code).toBe('4110');
        expect(row.name).toMatch(/รายได้/);
    });

    it('getAccountByCode returns null on miss', () => {
        expect(getAccountByCode('9999')).toBeNull();
        expect(getAccountByCode('not-a-code')).toBeNull();
    });

    it('getAccountByCode returns null for nullish input', () => {
        expect(getAccountByCode(null)).toBeNull();
        expect(getAccountByCode(undefined)).toBeNull();
        expect(getAccountByCode('')).toBeNull();
    });

    it('accountExists is a boolean mirror of getAccountByCode', () => {
        expect(accountExists('1110')).toBe(true);
        expect(accountExists('9999')).toBe(false);
    });

    it('suffixed codes are distinct lookups (1110 vs 1110-PRD)', () => {
        expect(getAccountByCode('1110').nameEn).toMatch(/Current Account/);
        expect(getAccountByCode('1110-PRD').nameEn).toMatch(/Predictive AI/);
    });
});

describe('[Tier 14 / B19-A] getAccountType + getNormalBalance', () => {
    it('getAccountType reads the type from the row when known', () => {
        expect(getAccountType('4110')).toBe(ACCOUNT_TYPE.REVENUE);
        expect(getAccountType('1110')).toBe(ACCOUNT_TYPE.ASSET);
    });

    it('getAccountType falls back to the 4-digit prefix when code is unknown', () => {
        expect(getAccountType('4999')).toBe(ACCOUNT_TYPE.REVENUE);
        expect(getAccountType('5999')).toBe(ACCOUNT_TYPE.EXPENSE);
    });

    it('PREFIX_TO_TYPE covers 1, 2, 3, 4, 5, 9', () => {
        expect(PREFIX_TO_TYPE[1]).toBe(ACCOUNT_TYPE.ASSET);
        expect(PREFIX_TO_TYPE[2]).toBe(ACCOUNT_TYPE.LIABILITY);
        expect(PREFIX_TO_TYPE[3]).toBe(ACCOUNT_TYPE.EQUITY);
        expect(PREFIX_TO_TYPE[4]).toBe(ACCOUNT_TYPE.REVENUE);
        expect(PREFIX_TO_TYPE[5]).toBe(ACCOUNT_TYPE.EXPENSE);
        expect(PREFIX_TO_TYPE[9]).toBe(ACCOUNT_TYPE.MEMO);
    });

    it('NORMAL_BALANCE follows accounting convention (Asset/Expense=DEBIT, others=CREDIT)', () => {
        expect(NORMAL_BALANCE[ACCOUNT_TYPE.ASSET]).toBe('DEBIT');
        expect(NORMAL_BALANCE[ACCOUNT_TYPE.EXPENSE]).toBe('DEBIT');
        expect(NORMAL_BALANCE[ACCOUNT_TYPE.LIABILITY]).toBe('CREDIT');
        expect(NORMAL_BALANCE[ACCOUNT_TYPE.EQUITY]).toBe('CREDIT');
        expect(NORMAL_BALANCE[ACCOUNT_TYPE.REVENUE]).toBe('CREDIT');
    });

    it('getNormalBalance routes via the type for any account', () => {
        expect(getNormalBalance('1110')).toBe('DEBIT');     // asset
        expect(getNormalBalance('2210')).toBe('CREDIT');    // liability (Output VAT)
        expect(getNormalBalance('4110')).toBe('CREDIT');    // revenue
        expect(getNormalBalance('5110')).toBe('DEBIT');     // expense
    });
});

describe('[Tier 14 / B19-A] seedChartOfAccounts — idempotent seeding', () => {
    it('without a Prisma Account model → returns { seeded: 0, skipped: N, reason: NO_ACCOUNT_MODEL }', async () => {
        // Pass an empty stub — no `.account` delegate, so seeder no-ops.
        const result = await seedChartOfAccounts({});
        expect(result.seeded).toBe(0);
        expect(result.skipped).toBe(CHART_OF_ACCOUNTS.length);
        expect(result.reason).toBe('NO_ACCOUNT_MODEL');
        expect(Array.isArray(result.accounts)).toBe(true);
    });

    it('with a Prisma Account.upsert mock → upserts every row exactly once', async () => {
        const upsert = jest.fn().mockResolvedValue({});
        const tx = { account: { upsert } };
        const result = await seedChartOfAccounts(tx);
        expect(result.seeded).toBe(CHART_OF_ACCOUNTS.length);
        expect(result.skipped).toBe(0);
        expect(upsert).toHaveBeenCalledTimes(CHART_OF_ACCOUNTS.length);
        // First call's payload is shaped correctly (code/name/type)
        const [firstCall] = upsert.mock.calls[0];
        expect(firstCall).toHaveProperty('where.code');
        expect(firstCall).toHaveProperty('create.code');
        expect(firstCall).toHaveProperty('create.name');
        expect(firstCall).toHaveProperty('create.type');
        // Empty update — never overwrites a live row.
        expect(firstCall.update).toEqual({});
    });
});
