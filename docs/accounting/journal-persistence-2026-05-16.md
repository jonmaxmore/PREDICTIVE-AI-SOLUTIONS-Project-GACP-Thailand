> ## ⚠️ เอกสารนี้บันทึกโมเดลที่เลิกใช้แล้ว (ปักป้าย 2026-09-05)
>
> เนื้อหาด้านล่างเขียนขึ้นภายใต้โมเดล **two-money-flow / ตัวแทนรับชำระ** ซึ่งถูกยกเลิกโดย
> มติ operator W14 (2026-08-22) และมติ 2026-09-05 · จุดยืนปัจจุบัน: **บริษัทเป็นผู้ออกเอกสารรายเดียว
> เก็บ VAT 7% บนค่าบริการทั้งก้อน ไม่มีส่วนใดยกเว้นภาษี และบริษัทจ่ายกรมฯ ภายหลังในฐานะต้นทุน**
>
> เก็บไว้อ่านเป็นบันทึกประวัติ — **อย่านำตัวเลข ผังบัญชี หรือข้อสรุปทางภาษีในนี้ไปใช้**
> ความจริงปัจจุบันอยู่ที่ `docs/architecture/fee-model-2026-09-05.md`

# Journal Entry Persistence Wire-In (B19-A)

**Date:** 2026-05-16
**Owner:** Backend / Accounting Engineering
**Batch:** B19-A (companion to B19-B trial-balance, B19-C VAT report, B19-D admin UI)
**Status:** Implementation complete, tests passing. DBA action required to apply migration on staging/production (see "DBA follow-up" below).

---

## Why this exists

Per the `journal-entry-service.js` header, every PAID invoice in the platform's books must produce a balanced double-entry journal record per **TFRS for NPAEs** (Thai Financial Reporting Standards for Non-Publicly Accountable Entities). Before B19-A:

- Batch B16 created the `JournalEntry` / `JournalLine` Prisma models + migration `20260516010000_add_journal_quotation_receipt_seq_bank_accounts`.
- Batch B15-C wired `payment-slip-service.approveSlip` to call `journalEntryService.recordPaymentEntry` inside its `$transaction`.
- But the journal service's persistence path could silently fall back to `[journal-fallback]` log lines if the call was nested inside a `$transaction` because the call ran against the top-level `prisma` client, not the transactional `tx` handle. That meant a paid-invoice update could commit even when the journal-entry insert failed (or vice versa, on a rollback).

B19-A wires the `tx` handle through `recordPaymentEntry` so the insert is atomic with the surrounding `$transaction` block — invoice paid-status + journal entry now commit together or not at all.

## Persistence flow

```
                   payment-slip-service.approveSlip
                                  |
                                  v
              await prisma.$transaction(async (tx) => {
                    1. tx.paymentSlip.update({ status: APPROVED })
                    2. tx.invoice.update({ status: 'paid', paidAt })
                    3. journalEntryService.recordPaymentEntry(
                           invoiceId, totalAmount, undefined,
                           { ..., tx }
                       )
                    4. writeApplicationStatus({ prisma: tx, ... })
              })
                                  |
                                  v
              journal-entry-service.recordPaymentEntry
                                  |
                  STATE invoice?  --YES--> { skipped: true,
                                              reason: 'STATE_FEE_NOT_IN_PLATFORM_BOOKS' }
                                  |
                                  NO
                                  v
              buildPaymentEntryLines() — produces balanced
              Dr Cash / Cr Revenue / Cr Output VAT lines
                                  |
                                  v
              persistEntry({ ..., tx })
                                  |
                                  v
              tx.journalEntry.create({
                  data: { ...entryHeader, lines: { create: [...] } },
                  include: { lines: true },
              })
```

If `tx.journalEntry.create` throws (DB down, FK violation, etc.) the service re-throws inside the `$transaction`, the slip update and invoice update both roll back, and the applicant sees a 5xx error. The fallback log path is preserved for callers that do NOT supply `tx` (cron jobs, manual reconciliation scripts) so a journal-service bug never crashes a non-payment code path.

## Chart of Accounts (CoA)

`services/chart-of-accounts-service.js` exposes the canonical Thai-NPAE chart used by the journal service + trial-balance + VAT report.

### 4-digit prefix → account type

Per Federation of Accounting Professions (สภาวิชาชีพบัญชี) convention:

| Prefix | Type      | Normal balance |
|--------|-----------|----------------|
| 1xxx   | Asset     | DEBIT          |
| 2xxx   | Liability | CREDIT         |
| 3xxx   | Equity    | CREDIT         |
| 4xxx   | Revenue   | CREDIT         |
| 5xxx   | Expense   | DEBIT          |
| 9xxx   | Memo / off-books | CREDIT  |

### Seeded accounts

| Code      | Name (Thai)                                  | Name (English)                         | Type      | VAT-relevant |
|-----------|----------------------------------------------|----------------------------------------|-----------|--------------|
| 1110      | เงินสด — บัญชีกระแสรายวัน                    | Cash — Current Account                 | ASSET     | no           |
| 1110-PRD  | เงินสด — บัญชี Predictive AI                | Cash — Predictive AI Bank Account      | ASSET     | no           |
| 1110-001  | เงินสด/เงินฝากธนาคาร — บัญชีหลัก (legacy)   | Cash / Bank — Main (legacy)            | ASSET     | no           |
| 1130      | ลูกหนี้การค้า                                | Accounts Receivable                    | ASSET     | no           |
| 2110      | เจ้าหนี้การค้า                               | Accounts Payable                       | LIABILITY | no           |
| 2210      | ภาษีขายค้างจ่าย — Output VAT 7%             | Output VAT Payable (7%)                | LIABILITY | yes          |
| 2131-001  | ภาษีขายตั้งพัก (Output VAT 7%) (legacy alias)| Output VAT — legacy alias              | LIABILITY | yes          |
| 2310      | เจ้าหนี้กรมบัญชีกลาง                         | Payable to Treasury (legacy / hypo.)   | LIABILITY | no           |
| 2151-001  | เจ้าหนี้ — กรมการแพทย์แผนไทยฯ (legacy)      | Payable to DTAM — legacy               | LIABILITY | no           |
| 3110      | ทุนจดทะเบียน                                  | Registered Capital                     | EQUITY    | no           |
| 3210      | กำไรสะสม                                      | Retained Earnings                      | EQUITY    | no           |
| 4110      | รายได้ค่าบริการแพลตฟอร์ม                     | Platform Service Revenue               | REVENUE   | yes          |
| 4110-001  | รายได้ค่าบริการแพลตฟอร์ม (legacy alias)      | Platform Revenue — legacy              | REVENUE   | yes          |
| 4120      | รายได้ค่าสมัครสมาชิก                          | Subscription Revenue                   | REVENUE   | yes          |
| 5110      | ค่าใช้จ่ายในการดำเนินงาน                      | Operating Expenses                     | EXPENSE   | no           |
| 9110      | พักรายการ — รายได้แผ่นดิน DTAM               | Suspense — DTAM State Revenue (memo)   | MEMO      | no           |

**Legacy aliases.** Codes like `1110-001`, `2131-001`, `4110-001`, `2151-001` are the values journal-entry-service has been writing since B16. They are aliases of the canonical 4-digit codes; the trial-balance bucketer (B19-B) maps both to the same line so historical entries reconcile cleanly.

**Memo account 9110.** Per the corrected two-channel money-flow model (owner-confirmed 2026-05-16), the platform never receives state-fee cash — applicants transfer it directly to กรมบัญชีกลาง (Treasury). 9110 is a *statistical* bucket so reports can display the total volume of state revenue facilitated through the platform without booking a phantom GL entry. Legal anchors: ป.รัษฎากร ม.77/1 (10), พ.ร.บ.วินัยการเงินการคลังของรัฐ ม.34, กฎกระทรวงการคลังเรื่องเงินรายได้แผ่นดิน.

## `tx` wiring contract

```js
// payment-slip-service.approveSlip (excerpt)
await prisma.$transaction(async (tx) => {
    await tx.invoice.update({ where: { id }, data: { status: 'paid', paidAt: now } });
    await journalEntryService.recordPaymentEntry(invoiceId, total, undefined, {
        invoiceNumber, serviceType, paidAt: now, organizationId, createdBy,
        tx,                                  // <-- threaded through, atomicity guaranteed
    });
});
```

Inside `recordPaymentEntry`:

```js
async function persistEntry({ entry, kind, invoiceId, organizationId, createdBy, tx }) {
    const prisma = resolvePrisma(tx);      // prefers tx, falls back to top-level prisma
    // …
    return prisma.journalEntry.create({ … });
}
```

If the persist call throws AND `tx` was supplied, the error re-throws so the surrounding `$transaction` rolls back. If `tx` was NOT supplied (legacy callers, cron jobs), the error is swallowed and a `[journal-fallback]` log line is written for manual reconciliation.

## Test coverage

| Test file                                                                         | Count   |
|-----------------------------------------------------------------------------------|---------|
| `apps/backend/__tests__/unit/journal-entry-service.test.js`                       | 32 / 32 |
| `apps/backend/__tests__/unit/chart-of-accounts-service.test.js`                   | 35 / 35 |
| `apps/backend/__tests__/unit/payment-slip-service-role-filter.test.js`            | 16 / 16 |
| `apps/backend/__tests__/unit/payment-phase-flow-canonical-totals.test.js`         |  8 /  8 |

New tests anchor:

- Persistence path: `recordPaymentEntry` returns `{ persisted: true, journalEntryId, lines, totalDebit, totalCredit }` when `tx.journalEntry.create` succeeds.
- TFRS for NPAEs invariant: every persisted entry has `totalDebit === totalCredit`.
- Atomicity: when `tx.journalEntry.create` rejects, `recordPaymentEntry` re-throws so the surrounding `$transaction` rolls back.
- Back-compat: when no `tx` is supplied and no real Prisma client exists, the fallback shape `{ persisted: false, fallback: true }` is returned and the journal is preserved in the log stream.
- B16-C skip-path is unchanged: STATE invoices still short-circuit before any DB write, even when `tx` is supplied.

## Files changed

| File                                                                       | Change                                              |
|----------------------------------------------------------------------------|-----------------------------------------------------|
| `apps/backend/services/journal-entry-service.js`                           | Threaded `tx` through `resolvePrisma` → `persistEntry` → `recordPaymentEntry` + `recordRemittanceToDtam`. Re-throws inside tx so $transaction rolls back. Added `taxableAmount` to nested line create. |
| `apps/backend/services/chart-of-accounts-service.js`                       | **New.** Canonical Thai-NPAE CoA + helpers.         |
| `apps/backend/services/payment-slip-service.js`                            | Pass `tx` to `recordPaymentEntry` (single-line wire-in); re-throw on failure so $transaction rolls back. |
| `apps/backend/__tests__/unit/journal-entry-service.test.js`                | 7 new B19-A persistence tests.                      |
| `apps/backend/__tests__/unit/chart-of-accounts-service.test.js`            | **New.** 35 tests covering CoA layout + helpers.    |
| `apps/backend/prisma/seed-chart-of-accounts.js`                            | **New.** Idempotent seeder (no-op until DBA adds Account model). |
| `docs/accounting/journal-persistence-2026-05-16.md`                        | **New.** This document.                             |

## DBA follow-up

The migration that introduces the `JournalEntry` / `JournalLine` tables (`20260516010000_add_journal_quotation_receipt_seq_bank_accounts`) is already in `apps/backend/prisma/migrations/`. DBA must:

1. **Apply migration on staging:** `npx prisma migrate deploy` against the staging DATABASE_URL. Verify `journal_entries` + `journal_lines` tables exist with the canonical shape (Decimal(15,2), CASCADE on the line FK, indexes on entryDate / reference / invoiceId / organizationId).
2. **Apply migration on production:** same command against prod, ideally during a low-traffic window. Existing paid invoices will start producing journal entries from the first slip-approval after the migration; no backfill is required because the service emits one entry per slip approval going forward.
3. **(Optional, future)** Add a Prisma `Account` model + migration so `seedChartOfAccounts` can do real DB upserts. Today the seeder no-ops with the `NO_ACCOUNT_MODEL` reason and exposes the CoA via the in-memory list only. The seeder is forward-compatible — adding the model will make it start writing without any caller-side change.
4. **Monitor `[journal-fallback]` markers in logs.** Any fallback line in production after the migration is applied means a DB write failed — finance must reconcile by hand, and engineering must investigate the root cause (most likely transient connectivity, FK race, or schema drift).

## References

- TFRS for NPAEs ch.2 — Financial Reporting Framework
- TFRS for NPAEs ch.18 — Revenue (รายได้)
- TFRS for NPAEs ch.21 — Income Tax (ภาษีเงินได้)
- Revenue Code §86/4 — ภ.พ.30 monthly VAT remittance
- Revenue Code §77/1 — Definition of taxable supply of services
- Revenue Code §82 — Single canonical VAT-receipt bank account
- กฎกระทรวงการคลังเรื่องเงินรายได้แผ่นดิน — State revenue → Treasury
- พ.ร.บ.วินัยการเงินการคลังของรัฐ พ.ศ.2561 ม.34 — State revenue deposit channels
- ป.รัษฎากร ม.77/1 (10) — State revenue VAT exemption

---

## Reversing Entry Primitive (Iter 24)

**Date:** 2026-05-16
**Owner:** Backend / Accounting Engineering
**Batch:** Iter 24 (hardening loop) — companion to B24-A (period-close schema) and B24-B (period guard).
**Status:** Implementation complete; 18 new unit tests + 32 existing journal-entry-service + 14 credit-note-service tests all green.

### Why this exists

Per **TFRS for NPAEs ch.18** (revenue recognition + audit-trail immutability) and **ป.รัษฎากร ม.86/10** (ใบลดหนี้ — adjustment via downward-correction document referencing the original tax invoice), a posted journal entry is **immutable**. When an entry is wrong or needs to be adjusted (refund, credit note, correction, accrual reversal), the bookkeeper must **post a REVERSING entry** that swaps every debit ↔ credit and references the original. The pair (original + reversal) nets to zero on every account, preserving the chronological audit trail required by ป.รัษฎากร ม.87/3 (7-year retention).

Before Iter 24, only `credit-note-service.postCreditNote` emitted a reversing entry — and it did so inline via `_postReversingJournalEntry` with the GL shape hand-rolled in the credit-note module. There was no canonical primitive in `journal-entry-service`. Iter 24 adds `recordReversingEntry(originalEntryId, options)` as that primitive so any caller (credit notes, refunds, manual JE reversals, cron back-outs) can reverse an existing posted entry through a single helper that:

1. Validates the original exists and is not soft-deleted.
2. Swaps Dr ↔ Cr on every line (preserving accountCode / accountName / issuer / taxableAmount).
3. Persists the reversal atomically with the caller's `$transaction` when a `tx` handle is supplied.
4. Marks the original as reversed via `JournalLine.metadata.reversedByEntryId` on the first line.
5. Emits an `auditLogger.log({ action: 'REVERSING_ENTRY_POSTED' })` event.
6. Is **idempotent** — a second call against the same `originalEntryId` returns `{ skipped: true, reason: 'ALREADY_REVERSED', reversingEntryId }` without minting a duplicate.

### API

```js
const { recordReversingEntry } = require('./services/journal-entry-service');

const result = await recordReversingEntry(originalEntryId, {
    reason: 'Credit note CN-PRD-2026-000001 issued', // required (min 3 chars)
    actorId: 'user-account-platform-7',              // who initiated the reversal
    reversalDate: new Date(),                        // optional — defaults to now()
    tx: prismaTransactionClient,                     // optional — supplied inside $transaction
    partial: false,                                  // optional — when true, use customLines
    customLines: [...],                              // required when partial=true
});

// Success shape:
//   { persisted: true, journalEntryId, reversingEntryId, originalEntryId,
//     reference, description, entryDate, totalDebit, totalCredit, balanced: true, lines }
//
// Already-reversed shape (idempotency):
//   { skipped: true, reason: 'ALREADY_REVERSED',
//     reversingEntryId, originalEntryId }
//
// Fallback shape (no Prisma + no tx):
//   { persisted: false, fallback: true, fallbackReason,
//     reference, description, totalDebit, totalCredit, lines }
```

### Idempotency contract

Calling `recordReversingEntry(sameOriginalEntryId, ...)` twice **must not** produce a duplicate reversal. The helper enforces this via two parallel checks (belt-and-braces against race conditions):

1. **Canonical marker** — the original entry's first `JournalLine.metadata.reversedByEntryId` is set on the first successful reversal. A second call reads this marker and returns `{ skipped: true, reason: 'ALREADY_REVERSED', reversingEntryId }` immediately.
2. **Reference scan** — `JournalEntry.findFirst({ where: { reference: '<original>-REV', isDeleted: false } })` catches the rare case where the marker write rolled back but the reversal committed (e.g., partial-transaction failure between the two writes).

When the helper short-circuits via either path, **no new JournalEntry row is created**.

### Pair invariant: net-to-zero

For every account touched by the original and reversal pair:

```
sum(original.lines[code].debit)  + sum(reversal.lines[code].debit)
=== sum(original.lines[code].credit) + sum(reversal.lines[code].credit)
```

When the reversal is the auto-swap (default — not `partial`), every account's debit-sum equals its credit-sum across the pair, and each line's `debit + credit` totals across both entries equal `original.line.debit + original.line.credit` × 2. This is the formal accounting expression of the immutability rule: a posted entry cannot be edited, so its only correction is a posted entry that exactly negates it.

The unit-test suite `reversing-entry.test.js` includes a dedicated invariant test that buckets sums by `accountCode` across the pair and asserts the equality on every bucket.

### Reference format

`reversal.reference = '<original.reference>-REV'`. For invoice `TAX-PRD-2026-000100` the reversal is `TAX-PRD-2026-000100-REV`. This is intentional:

- It's grep-able in the audit log.
- It's unique per original (because `original.reference` is already unique for tax-bearing documents per ม.86/4 sequential numbering).
- It pairs with the `findFirst` idempotency check above.
- Multi-reversal scenarios (e.g., second-level partial reversal of a partial reversal) extend the suffix at the caller's discretion — the primitive only handles the first level.

### Partial reversal

When the reversal is not a full swap (e.g., credit-note for 50% of a paid invoice), the caller passes `partial: true` plus a `customLines` array. The primitive then:

- Skips the auto-swap.
- Uses `customLines` verbatim (rounded to 2 dp at the boundary).
- Re-runs the balance check — if `Dr !== Cr` on the supplied lines, the call throws `UNBALANCED_ENTRY` and the surrounding `$transaction` rolls back.

Partial reversals still write the `reversedByEntryId` marker on the original — by current convention a partial reversal **terminates** further auto-reversal attempts. Callers that need to reverse the remaining balance must call `recordReversingEntry` again with a different `reason` and a new partial-reversal `customLines` set against a different originalEntryId (typically the new invoice line that captured the remaining balance), or skip the helper and post a manual entry via `manual-journal-entry-service`.

### Future adoption plan

The primitive is in place but **no existing caller has been refactored to use it yet** — by design. The refactors below land in subsequent batches:

| Service | Current state | Future adoption |
|---|---|---|
| `credit-note-service.postCreditNote` | Posts reversing entry inline via `_postReversingJournalEntry` (fallback log path; the journal-entry shape is hand-rolled from `subtotal` / `vat` / `total`). | Call `recordReversingEntry(originalJournalEntryId, { reason: 'CN-PRD-… issued', actorId, tx })` when the CN reverses the FULL paid amount. For partial CN amounts, call with `partial: true` + `customLines` derived from the CN subtotal/vat split. The credit-note-service already gates which scenarios are eligible (paid PLATFORM invoice; ม.86/10). |
| `refund-service` (Iter 23, B23-A) | Wires applicant refunds; same reversal need. | Call `recordReversingEntry` when issuing a full refund of a PLATFORM invoice. Refunds against STATE invoices route through the กรมบัญชีกลาง refund process and never produce a platform-side journal entry (so no reversal either). |
| `manual-journal-entry-service` (B20-C) | Has an APPROVED → REJECTED state machine; corrections of POSTED manual entries are currently a fresh draft. | Add a "reverse this manual entry" admin action that calls `recordReversingEntry(postedJournalEntryId, { reason, actorId, tx })`. |

Each refactor will be a small, isolated change because the primitive's signature is stable and idempotency means a refactor can be deployed independently of any clean-up of legacy inline reversal code.

### Files

- `apps/backend/services/journal-entry-service.js` — adds `recordReversingEntry`, `buildReversalLines` (pure helper), and internal `persistReversingEntry` / `findExistingReversal` / `markOriginalAsReversed` private functions. Existing `recordPaymentEntry`, `recordRemittanceToDtam`, `buildPaymentEntryLines`, `buildRemittanceEntryLines`, `previewPaymentEntry`, and the chart-of-accounts exports are unchanged.
- `apps/backend/__tests__/unit/reversing-entry.test.js` — 18 unit tests covering auto-swap, validation, idempotency (marker + reference scan), partial reversal, net-to-zero invariant, audit-log emission, and rollback semantics inside `$transaction`.

### References

- TFRS for NPAEs ch.2 — Financial Reporting Framework (atomicity + chronological record)
- TFRS for NPAEs ch.18 — Revenue immutability + reversal-via-new-entry
- ป.รัษฎากร ม.86/10 — ใบลดหนี้ (downward-correction document)
- ป.รัษฎากร ม.86/4 — sequential numbering on tax-bearing documents
- ป.รัษฎากร ม.87/3 — 7-year retention
