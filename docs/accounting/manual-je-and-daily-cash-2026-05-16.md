# Manual Journal Entry Workflow + Daily Cash Report (B20-C, 2026-05-16)

Owner: Finance Ops Engineering
Status: GA, ships with B20-C

This document covers two production accounting capabilities:

1. **Manual Journal Entry workflow** — DRAFT to APPROVED to POSTED, used for
   entries that aren't tied to a slip approval (bank charges, FX gain/loss,
   accrual reversals, manual corrections after approval).
2. **Daily Cash Report (รายงานเงินสดรับประจำวัน)** — morning reconciliation
   roll-up of the prior day's APPROVED slips grouped by bookSide and payment
   method.

---

## 1. Manual Journal Entry workflow

### 1.1 State machine

```
        create                approve              post
   ┌─────────┐  ───────▶ ┌──────────┐ ───────▶ ┌────────┐
   │ DRAFT   │            │ APPROVED │           │ POSTED │
   └────┬────┘            └─────┬────┘           └────────┘
        │ reject                │ reject              │
        ▼                       ▼              (terminal)
   ┌──────────┐            ┌──────────┐
   │ REJECTED │            │ REJECTED │
   └──────────┘            └──────────┘
```

- **DRAFT** — finance staff (ACCOUNT_PLATFORM) creates the row with validated
  lines and a business reason. Lines are JSON inside the row; no journal entry
  is written yet.
- **APPROVED** — an ADMIN reviews and approves. **Separation of duties:** the
  approver MUST NOT be the same user as the creator (TFRS for NPAEs ch.2
  internal controls). Service-layer enforced; route returns 403
  `SELF_APPROVAL_FORBIDDEN`.
- **POSTED** — an ADMIN clicks Post. The service opens a Prisma `$transaction`,
  writes one JournalEntry + N JournalLine rows, stamps the draft with
  `postedJournalEntryId`, and flips status to POSTED. POSTED is terminal —
  TFRS for NPAEs ch.18 forbids editing posted entries; corrections must be
  entered as a separate reversing journal entry.
- **REJECTED** — either DRAFT or APPROVED can be rejected; rejection requires
  a reason (>=10 chars) and is terminal. The row is preserved for the 7-year
  retention window so the audit gap is meaningful (MJE-2026-000005 rejected,
  not missing).

### 1.2 Separation of duties principle

TFRS for NPAEs ch.2 mandates internal-control procedures including the
segregation of incompatible functions. For journal entry workflows this means:

- The staff member who **creates** the entry cannot be the one who
  **approves** it.
- This service enforces the check by comparing `approverId` against
  `draft.createdBy` and throwing `SELF_APPROVAL_FORBIDDEN` if they match.

The control prevents a single dishonest or mistaken actor from inserting
unbalanced or fabricated entries directly into the general ledger. The audit
trail (recorded via `MANUAL_JE_DRAFT_CREATED`, `MANUAL_JE_APPROVED`,
`MANUAL_JE_POSTED`, `MANUAL_JE_REJECTED` audit actions) lets DTAM and external
auditors prove the control held over the period under review.

### 1.3 entryType discriminator

A dedicated `entryType` column on JournalEntry (values `'AUTO'` for slip-driven
entries, `'MANUAL'` for this workflow) is not yet part of the Prisma schema.
Until DBA adds the column, the manual journal entry posted via this workflow
is marked by:

- A `[MANUAL]` prefix on `JournalEntry.description`, e.g.
  `[MANUAL] Bank charge for May`.
- A `kind: 'MANUAL'` metadata flag on each JournalLine.metadata JSON.
- The `draftNumber` + `draftId` back-stamped into each line's metadata.

Trial-balance and financial-statements services (B19-B) read on these flags
when they need to filter manual vs auto entries.

### 1.4 Service surface

`services/manual-journal-entry-service.js` exports:

- `createDraftManualEntry({ description, lines, organizationId, actorId, postingDate, reason })`
- `approveManualEntry(draftId, { approverId })`
- `postManualEntry(draftId, { actorId })`
- `rejectManualEntry(draftId, { reason, rejectorId })`
- `listDrafts({ status, organizationId, limit })`
- `getDraftById(draftId)`
- `validateLines(lines)` — pure helper that returns `{ totalDebit, totalCredit,
  normalizedLines }` or throws `VALIDATION_ERROR` / `UNBALANCED_ENTRY` /
  `UNKNOWN_ACCOUNT_CODE`.

### 1.5 Route surface

`routes/api/finance/manual-journal-entries.js` (mounted at
`/api/finance/manual-journal-entries`):

| Method | Path             | Roles                          | Notes                                |
|--------|------------------|--------------------------------|--------------------------------------|
| POST   | `/`              | ACCOUNT_PLATFORM, ADMIN        | Create DRAFT                         |
| GET    | `/`              | ACCOUNT_PLATFORM, ADMIN, AUDITOR | List drafts (optional status)      |
| GET    | `/:id`           | ACCOUNT_PLATFORM, ADMIN, AUDITOR | Detail                             |
| POST   | `/:id/approve`   | ADMIN only                     | DRAFT to APPROVED (separation enforced) |
| POST   | `/:id/post`      | ADMIN only                     | APPROVED to POSTED                   |
| POST   | `/:id/reject`    | ADMIN only                     | Records reason, terminal             |

### 1.6 Prisma model + migration

- Model: `ManualJournalEntryDraft` in `prisma/schema/billing.prisma`
- Migration: `20260516040000_add_manual_journal_entry_drafts`
- Indexes: status, organizationId, createdBy, postingDate
- Unique: draftNumber

### 1.7 Rollback plan

```sql
DROP TABLE manual_journal_entry_drafts CASCADE;
```

Any POSTED draft will leave its corresponding JournalEntry intact (the back-
pointer is from draft to entry, not the other way), so the GL stays consistent.
APPROVED or DRAFT rows are lost; ops should drain those states before rolling
back.

---

## 2. Daily Cash Report (รายงานเงินสดรับประจำวัน)

### 2.1 What it answers

Every morning the finance team needs to know "what cash did we receive
yesterday" to reconcile against the bank statement before posting the close.
The daily cash report renders that view: per-bank-account totals, per-issuer-
side breakdown (DTAM vs PLATFORM), per-payment-method (BANK_TRANSFER /
PROMPTPAY), and one row per APPROVED slip with reviewer, bankRef, transfer time.

### 2.2 Format

```
asOfDate     : YYYY-MM-DD (default: today, pinned to UTC day)
bookSide     : DTAM | PLATFORM | BOTH
totals
  bySide
    DTAM     : THB amount
    PLATFORM : THB amount
  byMethod
    BANK_TRANSFER : THB amount
    PROMPTPAY     : THB amount
  grand           : THB amount
rows[]
  slipId, invoiceNumber, receiptNumber, applicationNumber,
  applicantName (masked), applicantPhone (masked), applicantHealthId (masked),
  amount, paymentMethod, bookSide, bankRef, transferredAt, reviewedAt,
  reviewer, bankAccount, serviceType
```

### 2.3 PDPA masking

Per พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล (PDPA), the report does not expose full
applicant PII because finance staff don't need it to verify cash totals.

- Name: `"Somchai Nakorn"` to `"Somchai *****"` (firstName + asterisks).
- Phone: `"0812345678"` to `"******5678"` (last 4 digits).
- HealthId: `"1234567890123"` to `"1234*********"` (first 4 chars only).

### 2.4 Bank reconciliation tie-in

The report is the **anchor input** for the daily bank-reconciliation activity:

1. Finance pulls `?asOfDate=YYYY-MM-DD&bookSide=PLATFORM` from
   `/api/finance/daily-cash` first thing in the morning.
2. They open the prior day's bank-statement export.
3. They match each `bankRef` in the report to a credit line on the statement.
   Mismatches are flagged and routed back to the upload / approval team.
4. Once matched, the grand total on the report equals the day's bank credit
   total — close-of-day reconciliation passes.
5. The deeper monthly-close uses `/api/finance/reconciliation` (B15-B) for the
   wider window with hash verification.

### 2.5 Compliance basis

- TFRS for NPAEs ch.2 — daily cash control is mandatory internal-control
  activity under the financial-reporting framework (สภาวิชาชีพบัญชี internal-
  control guidance).
- TAS 1 — chronological audit trail; each row carries reviewer + bankRef.
- ป.รัษฎากร ม.86/4 — sequential invoice/receipt numbering visible in row so
  morning reconciler can spot a gap.
- ป.รัษฎากร ม.87/3 — 7-year retention for tax-bearing documents.
- พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล (PDPA) — masking rules above.
- Thai e-Transactions Act §31 — every report view is audit-logged with
  `DAILY_CASH_REPORT_VIEWED`.

### 2.6 Route + role gating

GET `/api/finance/daily-cash?asOfDate=YYYY-MM-DD&bookSide=DTAM|PLATFORM|BOTH[&format=csv]`

| Role                | DTAM | PLATFORM | BOTH |
|---------------------|------|----------|------|
| ACCOUNT_DTAM        | yes  | no       | no   |
| ACCOUNT_PLATFORM    | no   | yes      | no   |
| ADMIN               | yes  | yes      | yes  |
| AUDITOR             | yes  | yes      | yes  |
| legacy ACCOUNT      | yes  | yes      | yes  |

CSV export emits UTF-8 BOM + Thai column headers + RFC4180 line endings (Excel-
Thai friendly). Summary footer rows render side totals + method totals + grand
total.

---

## 3. References

- TFRS for NPAEs ch.2, 18 — สภาวิชาชีพบัญชี (Federation of Accounting
  Professions)
- TAS 1 — Presentation of Financial Statements
- ป.รัษฎากร ม.86/4 — sequential tax-invoice numbering
- ป.รัษฎากร ม.87/3 — 7-year retention
- พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล (PDPA) — masking obligation
- Thai e-Transactions Act §31 — disclosure traceability
