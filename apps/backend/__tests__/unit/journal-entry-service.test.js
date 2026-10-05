/**
 * Tests for journal-entry-service.js.
 *
 * System deep-dive Tier 14 — verifies the double-entry invariant
 * (sum of debits === sum of credits) for every issuer-shape we ship.
 *
 * 2026-05-16 (B16-B): switched to the agent-collection model. The
 * platform is a COLLECTION AGENT for DTAM, not a re-seller — state-fee
 * receipts credit PAYABLE_TO_DTAM (current liability), NEVER a revenue
 * account. See TFRS for NPAEs / TAS 18.8 (agent vs principal).
 *
 * 2026-05-16 (B16-C, two-money-flow correction): owner clarified that
 * the platform NEVER holds the state-fee cash — applicants transfer
 * the state fee directly to กรมบัญชีกลาง (Treasury). recordPaymentEntry
 * now short-circuits STATE invoices with { skipped: true,
 * reason: 'STATE_FEE_NOT_IN_PLATFORM_BOOKS' }. buildPaymentEntryLines
 * (the pure helper) still produces the agent-collection shape for
 * tests of the legacy single-line invoice flow.
 *
 * 2026-09-29 (operator): the company settles with DTAM OFFLINE and books it in
 * its own accounts. This ledger keeps no DTAM payable (2151-001), no DTAM cost
 * (5110-001) and no remittance entry — recordRemittanceToDtam /
 * buildRemittanceEntryLines are gone, and a STATE invoice has no journal shape
 * at all (the builder refuses it too, not only the recorder).
 */

'use strict';

const {
    buildPaymentEntryLines,
    previewPaymentEntry,
    resolveIssuerType,
    recordPaymentEntry,
    ACCOUNTS,
    ISSUER,
} = require('../../services/journal-entry-service');

describe('[Tier 14] journal-entry-service — chart of accounts', () => {
    it('exposes no DTAM account — no payable, no cost (operator 2026-09-29)', () => {
        expect(ACCOUNTS.PAYABLE_TO_DTAM).toBeUndefined();
        expect(ACCOUNTS.COST_DTAM_FEE).toBeUndefined();
        expect(Object.values(ACCOUNTS).map((a) => a.code).sort())
            .toEqual(['1110-001', '2131-001', '4110-001']);
    });

    it('CASH_BANK is asset code 1110-001', () => {
        expect(ACCOUNTS.CASH_BANK.code).toBe('1110-001');
    });

    it('does NOT expose a state-fee revenue account (agent-collection model)', () => {
        // Anti-regression: under the agent model the platform must not
        // recognise DTAM state fees as its own revenue.
        expect(ACCOUNTS.REVENUE_STATE_FEE_DTAM).toBeUndefined();
        expect(ACCOUNTS.DUE_TO_DTAM).toBeUndefined();
    });
});

describe('[Tier 14] journal-entry-service — issuer resolution', () => {
    it('STATE_FEE service types route to DTAM', () => {
        expect(resolveIssuerType('PHASE_1_STATE_FEE')).toBe(ISSUER.DTAM);
        expect(resolveIssuerType('PHASE_2_STATE_FEE')).toBe(ISSUER.DTAM);
        expect(resolveIssuerType('phase_1_state_fee')).toBe(ISSUER.DTAM);
    });

    it('PLATFORM_FEE service types route to PLATFORM', () => {
        expect(resolveIssuerType('PHASE_1_PLATFORM_FEE')).toBe(ISSUER.PLATFORM);
        expect(resolveIssuerType('PHASE_2_PLATFORM_FEE')).toBe(ISSUER.PLATFORM);
    });

    it('SUBSCRIPTION_* service types route to PLATFORM (VAT-bearing)', () => {
        expect(resolveIssuerType('SUBSCRIPTION_PREMIUM_MONTHLY')).toBe(ISSUER.PLATFORM);
        expect(resolveIssuerType('SUBSCRIPTION_ENTERPRISE_YEARLY')).toBe(ISSUER.PLATFORM);
    });

    it('F-CHECKOUT-M2: milestone-dimensioned CERTIFICATION_CHECKOUT_M1/_M2 route to PLATFORM, never DTAM', () => {
        // Report invariant (2026-08-18-invoice-family-M2-collision.md §5.1):
        // the milestone-dimensioned checkout serviceType must NOT contain
        // STATE_FEE, or this substring match flips the issuer to DTAM and
        // the whole revenue journal leg is skipped (journal-entry-service.js:552).
        expect(resolveIssuerType('CERTIFICATION_CHECKOUT_M1')).toBe(ISSUER.PLATFORM);
        expect(resolveIssuerType('CERTIFICATION_CHECKOUT_M2')).toBe(ISSUER.PLATFORM);
        expect(resolveIssuerType('CERTIFICATION_CHECKOUT_M2')).not.toBe(ISSUER.DTAM);
    });
});

describe('[Tier 14] buildPaymentEntryLines — double-entry balance', () => {
    it.each([
        ['PHASE_1_STATE_FEE', 5000],
        ['PHASE_2_STATE_FEE', 25000],
    ])('a %s invoice has no journal shape — the builder refuses it (RETIRED_STATE_INVOICE)', (serviceType, amount) => {
        // Was: Dr Cash / Cr PAYABLE_TO_DTAM. That account is gone from this
        // ledger (operator 2026-09-29), and a cash line with nothing against it
        // is not an entry — so the pure builder refuses, like the recorder.
        expect(() => buildPaymentEntryLines({
            invoiceId: 'inv-state',
            invoiceNumber: 'RCP-DTAM-2569-000001',
            serviceType,
            totalAmount: amount,
        })).toThrow(expect.objectContaining({ code: 'RETIRED_STATE_INVOICE', amount }));
    });

    it('Phase 1 PLATFORM fee (535 THB inclusive of 7% VAT) — VAT split, no DTAM line', () => {
        const entry = buildPaymentEntryLines({
            invoiceId: 'inv-2',
            invoiceNumber: 'TAX-PRD-2026-000001',
            serviceType: 'PHASE_1_PLATFORM_FEE',
            totalAmount: 535,
        });
        expect(entry.balanced).toBe(true);
        expect(entry.totalDebit).toBe(535);
        expect(entry.totalCredit).toBe(535);
        expect(entry.lines).toHaveLength(3);
        // Dr Cash 535
        expect(entry.lines[0].debit).toBe(535);
        // Cr Platform Fee ~500, Cr VAT ~35
        const platformLine = entry.lines.find((l) => l.accountCode === ACCOUNTS.REVENUE_PLATFORM_FEE.code);
        const vatLine = entry.lines.find((l) => l.accountCode === ACCOUNTS.VAT_PAYABLE_OUTPUT.code);
        expect(platformLine).toBeDefined();
        expect(vatLine).toBeDefined();
        // Cash / revenue / VAT — nothing else
        expect(entry.lines.map((l) => l.accountCode))
            .toEqual([ACCOUNTS.CASH_BANK.code, ACCOUNTS.REVENUE_PLATFORM_FEE.code, ACCOUNTS.VAT_PAYABLE_OUTPUT.code]);
        // VAT = 535 * 0.07 / 1.07 = 35.0 (rounded)
        expect(vatLine.credit).toBeCloseTo(35, 1);
        expect(platformLine.credit).toBeCloseTo(500, 1);
    });

    it('Phase 2 PLATFORM fee (2,675 THB inclusive of 7% VAT) — balanced', () => {
        const entry = buildPaymentEntryLines({
            invoiceId: 'inv-4',
            invoiceNumber: 'TAX-PRD-2026-000002',
            serviceType: 'PHASE_2_PLATFORM_FEE',
            totalAmount: 2675,
        });
        expect(entry.balanced).toBe(true);
        expect(entry.totalDebit).toBeCloseTo(entry.totalCredit, 2);
        const vatLine = entry.lines.find((l) => l.accountCode === ACCOUNTS.VAT_PAYABLE_OUTPUT.code);
        // VAT = 2675 * 0.07 / 1.07 ≈ 175
        expect(vatLine.credit).toBeCloseTo(175, 1);
    });

    it('explicit components — the whole ค่าบริการ is revenue, VAT is Output VAT, and nothing else', () => {
        const entry = buildPaymentEntryLines({
            invoiceId: 'inv-5',
            invoiceNumber: 'TAX-PRD-2569-000005',
            serviceType: 'CERTIFICATION_CHECKOUT_M1',
            totalAmount: 5885,
            components: { platformFee: 5500, vat: 385 },
        });
        expect(entry.balanced).toBe(true);
        expect(entry.totalDebit).toBe(5885);
        expect(entry.totalCredit).toBe(5885);
        expect(entry.lines).toHaveLength(3);
        expect(entry.lines.find((l) => l.accountCode === ACCOUNTS.REVENUE_PLATFORM_FEE.code).credit).toBe(5500);
        expect(entry.lines.find((l) => l.accountCode === ACCOUNTS.VAT_PAYABLE_OUTPUT.code).credit).toBe(385);
    });

    it('a stray stateFee books nothing — the cash then exceeds revenue + VAT and the entry is unbalanced', () => {
        // Was: Dr Cost-DTAM 5,000 / Cr Payable-DTAM 5,000 in the same entry.
        const entry = buildPaymentEntryLines({
            invoiceId: 'inv-6',
            invoiceNumber: 'TAX-PRD-2569-000006',
            serviceType: 'CERTIFICATION_CHECKOUT_M1',
            totalAmount: 5885,
            components: { stateFee: 5000, platformFee: 500, vat: 385 },
        });
        expect(entry.lines.map((l) => l.accountCode))
            .toEqual([ACCOUNTS.CASH_BANK.code, ACCOUNTS.REVENUE_PLATFORM_FEE.code, ACCOUNTS.VAT_PAYABLE_OUTPUT.code]);
        expect(entry.balanced).toBe(false);
    });
});

describe('[Tier 14] recordPaymentEntry — validation', () => {
    it('throws on missing invoiceId', async () => {
        await expect(recordPaymentEntry(null, 100)).rejects.toThrow(/invoiceId is required/);
    });

    it('throws on non-positive amount', async () => {
        await expect(recordPaymentEntry('inv-x', 0)).rejects.toThrow(/positive number/);
        await expect(recordPaymentEntry('inv-x', -100)).rejects.toThrow(/positive number/);
    });

    it('REFUSES a STATE invoice — it used to skip, which loses the money silently', async () => {
        // Was: `expect(result.skipped).toBe(true)`, on the 2026-05-16 premise
        // that state fees flowed applicant → กรมบัญชีกลาง directly and the
        // company never held the cash. W14 ended that premise, and under the
        // live model a skip means cash arrived in the bank with nothing on the
        // books — returned to the caller as a SUCCESS value, so no alert, no
        // reconciliation break, nothing. Split STATE invoicing is retired
        // (operator 2026-09-05); a STATE invoice here is now a defect.
        await expect(recordPaymentEntry('inv-state', 5000, undefined, {
            invoiceNumber: 'RCP-DTAM-2569-000010',
            serviceType: 'PHASE_1_STATE_FEE',
        })).rejects.toMatchObject({
            code: 'RETIRED_STATE_INVOICE',
            invoiceId: 'inv-state',
            serviceType: 'PHASE_1_STATE_FEE',
            amount: 5000,
        });
    });

    it('refuses a phase-2 STATE invoice the same way', async () => {
        await expect(recordPaymentEntry('inv-state-2', 25000, undefined, {
            invoiceNumber: 'RCP-DTAM-2569-000020',
            serviceType: 'PHASE_2_STATE_FEE',
        })).rejects.toMatchObject({ code: 'RETIRED_STATE_INVOICE', amount: 25000 });
    });

    it('[B16-C] records balanced entry for PLATFORM invoices (Phase 1, 535 THB)', async () => {
        // Anti-regression: the PLATFORM path must remain unchanged. The
        // skip only applies to STATE issuers.
        const entry = await recordPaymentEntry('inv-platform', 535, undefined, {
            invoiceNumber: 'TAX-PRD-2026-000010',
            serviceType: 'PHASE_1_PLATFORM_FEE',
        });
        expect(entry.skipped).toBeUndefined();
        expect(entry.balanced).toBe(true);
        expect(entry.totalDebit).toBe(535);
        const vatLine = entry.lines.find((l) => l.accountCode === ACCOUNTS.VAT_PAYABLE_OUTPUT.code);
        const platformLine = entry.lines.find(
            (l) => l.accountCode === ACCOUNTS.REVENUE_PLATFORM_FEE.code,
        );
        expect(vatLine.credit).toBeCloseTo(35, 1);
        expect(platformLine.credit).toBeCloseTo(500, 1);
        expect(entry.lines).toHaveLength(3);
    });

    it('preview is non-throwing and matches recorded shape', () => {
        const preview = previewPaymentEntry({
            invoiceId: 'inv-preview',
            invoiceNumber: 'TAX-PRD-2026-000099',
            serviceType: 'PHASE_2_PLATFORM_FEE',
            totalAmount: 2675,
        });
        expect(preview.balanced).toBe(true);
        expect(preview.lines.length).toBeGreaterThanOrEqual(2);
    });
});

describe('[Tier 14 / B19-A] recordPaymentEntry — persistence path', () => {
    // B19-A wired the journal-entry-service to write to the DB via a
    // caller-supplied transaction (tx) handle. The tests below mock the
    // tx.journalEntry.create call and verify that:
    //   1. The persisted shape is returned with { persisted: true, journalEntryId, ... }
    //   2. The data passed to create is the balanced entry (Dr === Cr)
    //   3. The TX handle takes precedence over the default prisma client
    //   4. On a DB error inside a tx the call rethrows (so $transaction rolls back)
    //   5. Without tx + without a real prisma client the legacy fallback shape
    //      is still returned (`persisted: false, fallback: true`) — back-compat

    function makeTxMock() {
        const created = {
            id: 'je-mock-uuid-001',
            entryDate: new Date('2026-05-16T00:00:00Z'),
            reference: 'TAX-PRD-2026-000100',
            invoiceId: 'inv-platform-tx',
            totalDebit: 535,
            totalCredit: 535,
            lines: [], // populated below if needed
        };
        const tx = {
            journalEntry: {
                create: jest.fn().mockImplementation(async ({ data }) => ({
                    ...created,
                    description: data.description,
                    reference: data.reference,
                    totalDebit: data.totalDebit,
                    totalCredit: data.totalCredit,
                    lines: data.lines.create.map((l, i) => ({ id: `jl-${i}`, ...l })),
                })),
            },
        };
        return { tx, created };
    }

    it('returns { persisted: true, journalEntryId } when tx.journalEntry.create succeeds', async () => {
        const { tx } = makeTxMock();
        const result = await recordPaymentEntry('inv-platform-tx', 535, undefined, {
            invoiceNumber: 'TAX-PRD-2026-000100',
            serviceType: 'PHASE_1_PLATFORM_FEE',
            tx,
        });
        expect(result.persisted).toBe(true);
        expect(result.journalEntryId).toBe('je-mock-uuid-001');
        expect(tx.journalEntry.create).toHaveBeenCalledTimes(1);
    });

    it('passes a BALANCED entry to tx.journalEntry.create (Dr === Cr, TFRS-NPAEs invariant)', async () => {
        const { tx } = makeTxMock();
        await recordPaymentEntry('inv-platform-tx', 535, undefined, {
            invoiceNumber: 'TAX-PRD-2026-000100',
            serviceType: 'PHASE_1_PLATFORM_FEE',
            tx,
        });
        const [callArg] = tx.journalEntry.create.mock.calls[0];
        expect(callArg.data.totalDebit).toBeCloseTo(535, 2);
        expect(callArg.data.totalCredit).toBeCloseTo(535, 2);
        // Crucial accounting invariant — Dr must EQUAL Cr for every entry.
        expect(Number(callArg.data.totalDebit)).toBeCloseTo(Number(callArg.data.totalCredit), 2);
        // Nested-create for the lines: one cash debit + one revenue credit + one VAT credit
        const lines = callArg.data.lines.create;
        expect(lines).toHaveLength(3);
        const debitSum = lines.reduce((s, l) => s + Number(l.debit), 0);
        const creditSum = lines.reduce((s, l) => s + Number(l.credit), 0);
        expect(debitSum).toBeCloseTo(creditSum, 2);
    });

    it('uses tx.journalEntry.create — NOT the default prisma client — when tx is supplied', async () => {
        const { tx } = makeTxMock();
        // Confirm the mock was called against tx, not against a top-level prisma.
        await recordPaymentEntry('inv-platform-tx', 535, undefined, {
            invoiceNumber: 'TAX-PRD-2026-000100',
            serviceType: 'PHASE_1_PLATFORM_FEE',
            tx,
        });
        expect(tx.journalEntry.create).toHaveBeenCalled();
        // The data shape matches what persistEntry composes — sanity check
        const [callArg] = tx.journalEntry.create.mock.calls[0];
        expect(callArg).toHaveProperty('data');
        expect(callArg).toHaveProperty('include.lines', true);
    });

    it('rethrows when the persist call fails INSIDE a tx (caller must roll back)', async () => {
        const tx = {
            journalEntry: {
                create: jest.fn().mockRejectedValue(new Error('db-connection-lost')),
            },
        };
        await expect(
            recordPaymentEntry('inv-platform-tx', 535, undefined, {
                invoiceNumber: 'TAX-PRD-2026-000100',
                serviceType: 'PHASE_1_PLATFORM_FEE',
                tx,
            }),
        ).rejects.toThrow(/db-connection-lost/);
    });

    it('returns { persisted: false, fallback: true } when prisma is stubbed and no tx is supplied (back-compat)', async () => {
        // No tx, no real Prisma client in test env → fallback path.
        // This locks the legacy behaviour: existing callers that don't
        // pass tx still get a usable result (entry shape + balanced flag).
        const result = await recordPaymentEntry('inv-platform-fallback', 535, undefined, {
            invoiceNumber: 'TAX-PRD-2026-000200',
            serviceType: 'PHASE_1_PLATFORM_FEE',
        });
        expect(result.skipped).toBeUndefined();
        expect(result.balanced).toBe(true);
        expect(result.persisted).toBe(false);
        expect(result.fallback).toBe(true);
        expect(result.totalDebit).toBe(535);
        expect(result.totalCredit).toBe(535);
    });

    it('persists subscription payment via tx with balanced lines', async () => {
        // Subscription orders are pure platform revenue with VAT — same
        // shape as PLATFORM_FEE, different reference.
        const { tx } = makeTxMock();
        const result = await recordPaymentEntry('inv-sub-tx', 535, undefined, {
            invoiceNumber: 'TAX-PRD-2026-SUB-001',
            serviceType: 'SUBSCRIPTION_PREMIUM_MONTHLY',
            tx,
        });
        expect(result.persisted).toBe(true);
        const [callArg] = tx.journalEntry.create.mock.calls[0];
        expect(Number(callArg.data.totalDebit)).toBeCloseTo(
            Number(callArg.data.totalCredit), 2,
        );
    });

    it('[Task 3 carry-forward] forwards meta.sourceType/sourceId onto journalEntry.create (settlement provenance)', async () => {
        // checkout-settlement-service's FOR-UPDATE idempotency relies on a
        // partial unique index over (sourceId) WHERE sourceType =
        // 'CHECKOUT_SETTLEMENT' — this only guards concurrent settles if
        // recordPaymentEntry actually threads the two fields through to
        // the Prisma create call.
        const { tx } = makeTxMock();
        await recordPaymentEntry('inv-platform-tx', 535, undefined, {
            invoiceNumber: 'TAX-PRD-2026-000100',
            serviceType: 'PHASE_1_PLATFORM_FEE',
            sourceType: 'CHECKOUT_SETTLEMENT',
            sourceId: 'co-1',
            tx,
        });
        const [callArg] = tx.journalEntry.create.mock.calls[0];
        expect(callArg.data.sourceType).toBe('CHECKOUT_SETTLEMENT');
        expect(callArg.data.sourceId).toBe('co-1');
    });

    it('a STATE invoice inside a transaction refuses BEFORE any write', async () => {
        // The refusal, like the skip it replaced, fires ahead of persistence —
        // but it now throws INTO the caller's transaction, so a settlement that
        // somehow reached this with a retired invoice rolls back whole instead of
        // committing business rows beside a missing journal entry.
        const { tx } = makeTxMock();
        await expect(recordPaymentEntry('inv-state-tx', 5000, undefined, {
            invoiceNumber: 'RCP-DTAM-2569-TX-001',
            serviceType: 'PHASE_1_STATE_FEE',
            tx,
        })).rejects.toMatchObject({ code: 'RETIRED_STATE_INVOICE' });
        expect(tx.journalEntry.create).not.toHaveBeenCalled();
    });
});
