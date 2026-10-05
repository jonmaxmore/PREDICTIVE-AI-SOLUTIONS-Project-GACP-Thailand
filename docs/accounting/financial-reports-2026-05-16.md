> ## ⚠️ เอกสารนี้บันทึกโมเดลที่เลิกใช้แล้ว (ปักป้าย 2026-09-05)
>
> เนื้อหาด้านล่างเขียนขึ้นภายใต้โมเดล **two-money-flow / ตัวแทนรับชำระ** ซึ่งถูกยกเลิกโดย
> มติ operator W14 (2026-08-22) และมติ 2026-09-05 · จุดยืนปัจจุบัน: **บริษัทเป็นผู้ออกเอกสารรายเดียว
> เก็บ VAT 7% บนค่าบริการทั้งก้อน ไม่มีส่วนใดยกเว้นภาษี และบริษัทจ่ายกรมฯ ภายหลังในฐานะต้นทุน**
>
> เก็บไว้อ่านเป็นบันทึกประวัติ — **อย่านำตัวเลข ผังบัญชี หรือข้อสรุปทางภาษีในนี้ไปใช้**
> ความจริงปัจจุบันอยู่ที่ `docs/architecture/fee-model-2026-09-05.md`

# Financial Reports — TFRS for NPAEs (B19-B, 2026-05-16)

## Overview

This document describes the four core financial statements served from the
GACP platform's double-entry accounting ledger (`JournalEntry` + `JournalLine`,
persisted by B19-A — see `apps/backend/services/journal-entry-service.js`).
All four conform to **TFRS for NPAEs** (Thai Financial Reporting Standards
for Non-Publicly Accountable Entities), the regulatory baseline for our
entity classification under the Federation of Accounting Professions
(สภาวิชาชีพบัญชี) framework.

| Statement | Thai | Service module | Reference |
|-----------|------|----------------|-----------|
| Trial Balance | งบทดลอง | `services/trial-balance-service.js` | TFRS for NPAEs ch. 5 |
| Profit & Loss | งบกำไรขาดทุน | `services/financial-statements-service.js` | TFRS for NPAEs ch. 18 + 19 |
| Balance Sheet | งบแสดงฐานะการเงิน | `services/financial-statements-service.js` | TFRS for NPAEs ch. 6 |
| General Ledger | สมุดบัญชีแยกประเภท | `services/general-ledger-service.js` | TFRS for NPAEs ch. 5 |

All four read strictly from the journal layer. No writes, no joins to
`Invoice` / `PaymentSlip` (those belong to other reports).

## Scope: PLATFORM books only

These reports cover **only** the PLATFORM's commercial books (Predictive
AI Solution Co., Ltd.). DTAM's state-fee ledger is **not** on these
reports because, per the B16-C two-money-flow correction
(owner-confirmed 2026-05-16):

- STATE-fee cash flows applicant → กรมบัญชีกลาง (Treasury) **directly**.
- The platform's bank account never sees state-fee money.
- Booking a journal entry for it would fabricate Dr Cash + a phantom
  PAYABLE liability — both material misstatements under TFRS for NPAEs
  ch. 18 (รายได้).

The aggregator therefore **excludes 9xxx suspense accounts** so any legacy
collection-agent rows do not bleed into the platform's statements. DTAM's
own books live in กรมบัญชีกลาง's systems and are reconciled via the
bank-reconciliation report (`/api/finance/reconciliation?bookSide=DTAM`),
not here.

Legal anchors for the off-book treatment:
- ป.รัษฎากร ม.77/1 (10) — state revenue is VAT-exempt.
- กฎกระทรวงการคลังเรื่องเงินรายได้แผ่นดิน — Treasury cash flow.
- พ.ร.บ.วินัยการเงินการคลังของรัฐ พ.ศ. 2561 ม.34 — state revenue deposited
  with Treasury, not via private agents.

## Chart of accounts (4-digit hierarchy)

Per TFRS for NPAEs ch. 2:

| Range | Type | Natural side |
|-------|------|--------------|
| 1xxx | Asset (สินทรัพย์) | Debit |
| 2xxx | Liability (หนี้สิน) | Credit |
| 3xxx | Equity (ส่วนของเจ้าของ) | Credit |
| 4xxx | Revenue (รายได้) | Credit |
| 5xxx | Expense (ค่าใช้จ่าย) | Debit |
| 9xxx | Suspense / off-book (DTAM state-fee proxy) | — (excluded) |

Active accounts emitted by `journal-entry-service.js`:
- `1110-001` — เงินสด/เงินฝากธนาคาร — บัญชีหลัก
- `2131-001` — ภาษีขายตั้งพัก (Output VAT 7%)
- `2151-001` — เจ้าหนี้ — กรมการแพทย์แผนไทยฯ (LEGACY — see B16-C)
- `4110-001` — รายได้ค่าบริการแพลตฟอร์ม

## Sample outputs — typical month

Scenario: 10 PLATFORM payments of 535 THB each (Phase 1 platform fee 500
+ VAT 7% = 35) over May 2026. No expenses booked. No equity contributions.

### 1. Trial Balance (งบทดลอง) — as of 2026-05-31

```
GET /api/finance/reports/trial-balance?asOfDate=2026-05-31
```

```json
{
  "asOfDate": "2026-05-31T23:59:59.999Z",
  "organizationId": "<org-uuid>",
  "rows": [
    { "accountCode": "1110-001", "accountName": "เงินสด/เงินฝากธนาคาร — บัญชีหลัก",
      "accountType": "ASSET",     "debit": 5350.00, "credit":    0.00, "balance":  5350.00 },
    { "accountCode": "2131-001", "accountName": "ภาษีขายตั้งพัก (Output VAT 7%)",
      "accountType": "LIABILITY", "debit":    0.00, "credit":  350.00, "balance":   350.00 },
    { "accountCode": "4110-001", "accountName": "รายได้ค่าบริการแพลตฟอร์ม",
      "accountType": "REVENUE",   "debit":    0.00, "credit": 5000.00, "balance":  5000.00 }
  ],
  "totalDebit":  5350.00,
  "totalCredit": 5350.00,
  "balanced": true,
  "discrepancy": null,
  "warnings": []
}
```

Compliance: TFRS for NPAEs ch. 5 — `totalDebit === totalCredit` is the
precondition for closing the period. If `balanced: false`, the report
includes a `discrepancy` value and a warning quoting ch. 5.

CSV export (RFC 4180, UTF-8 with BOM for Excel-Windows):

```
Account Code,Account Name,Account Type,Debit,Credit
1110-001,เงินสด/เงินฝากธนาคาร — บัญชีหลัก,ASSET,5350.00,0.00
2131-001,ภาษีขายตั้งพัก (Output VAT 7%),LIABILITY,0.00,350.00
4110-001,รายได้ค่าบริการแพลตฟอร์ม,REVENUE,0.00,5000.00
TOTAL,,,5350.00,5350.00
```

### 2. Profit & Loss (งบกำไรขาดทุน) — May 2026

```
GET /api/finance/reports/profit-and-loss?from=2026-05-01&to=2026-05-31
```

```json
{
  "period": {
    "startDate": "2026-05-01T00:00:00.000Z",
    "endDate":   "2026-05-31T23:59:59.999Z"
  },
  "organizationId": "<org-uuid>",
  "revenue": {
    "lines": [
      { "accountCode": "4110-001", "accountName": "รายได้ค่าบริการแพลตฟอร์ม",
        "amount": 5000.00 }
    ],
    "total": 5000.00
  },
  "expense": {
    "lines": [],
    "total": 0.00
  },
  "netProfit": 5000.00,
  "warnings": []
}
```

Compliance:
- TFRS for NPAEs ch. 18 (รายได้) — revenue recognised at invoice paidAt.
- TFRS for NPAEs ch. 19 (ค่าใช้จ่าย) — expenses recognised at incur date.
- 9xxx suspense rows are NOT revenue per the collection-agent model.

### 3. Balance Sheet (งบแสดงฐานะการเงิน) — as of 2026-05-31

```
GET /api/finance/reports/balance-sheet?asOfDate=2026-05-31
```

```json
{
  "asOfDate": "2026-05-31T23:59:59.999Z",
  "organizationId": "<org-uuid>",
  "assets": {
    "lines": [
      { "accountCode": "1110-001", "accountName": "เงินสด/เงินฝากธนาคาร — บัญชีหลัก",
        "amount": 5350.00 }
    ],
    "total": 5350.00
  },
  "liabilities": {
    "lines": [
      { "accountCode": "2131-001", "accountName": "ภาษีขายตั้งพัก (Output VAT 7%)",
        "amount": 350.00 }
    ],
    "total": 350.00
  },
  "equity": {
    "lines": [],
    "total": 5000.00,
    "retainedEarnings": 5000.00
  },
  "totalLiabilityEquity": 5350.00,
  "balanced": true,
  "discrepancy": null,
  "warnings": []
}
```

Accounting equation (TFRS for NPAEs ch. 6 §6.1, TAS 1 §54):

```
Assets = Liabilities + Equity
 5350  =     350     +  (0 explicit + 5000 RE)
 5350  =          5350                          OK
```

`retainedEarnings` is the running net profit (revenue − expense) up to
`asOfDate`. We surface it separately so the auditor sees the P&L roll-up
explicitly — no year-end closing entry is required to make the BS balance.

### 4. General Ledger (สมุดบัญชีแยกประเภท) — 4110-001, May 2026

```
GET /api/finance/reports/general-ledger?accountCode=4110-001&from=2026-05-01&to=2026-05-31
```

```json
{
  "accountCode": "4110-001",
  "accountName": "รายได้ค่าบริการแพลตฟอร์ม",
  "openingBalance": 0,
  "lines": [
    { "entryDate": "2026-05-02T10:23:01.000Z", "reference": "RCP-PRD-2026-000001",
      "description": "Payment received for invoice RCP-PRD-2026-000001",
      "invoiceId": "...", "debit": 0, "credit": 500, "runningBalance": 500, "issuer": "PLATFORM" },
    { "entryDate": "2026-05-05T14:11:48.000Z", "reference": "RCP-PRD-2026-000002",
      "description": "Payment received for invoice RCP-PRD-2026-000002",
      "invoiceId": "...", "debit": 0, "credit": 500, "runningBalance": 1000, "issuer": "PLATFORM" },
    "...8 more lines...",
    { "entryDate": "2026-05-31T16:02:55.000Z", "reference": "RCP-PRD-2026-000010",
      "description": "Payment received for invoice RCP-PRD-2026-000010",
      "invoiceId": "...", "debit": 0, "credit": 500, "runningBalance": 5000, "issuer": "PLATFORM" }
  ],
  "closingBalance": 5000,
  "totalDebit": 0,
  "totalCredit": 5000,
  "pagination": { "limit": 500, "offset": 0, "returned": 10, "hasMore": false, "totalRows": 10 }
}
```

Running balance is computed in JavaScript using the account's natural
sign (credit-natural for 4xxx → balance += credit − debit per line).
Auditors verify closure: `openingBalance + totalCredit − totalDebit ===
closingBalance` (after sign adjustment), i.e., 0 + 5000 − 0 = 5000.

## Why DTAM 9xxx suspense is OFF these reports

Owner clarification (verbatim, 2026-05-16):

> "DTAM ในฐานะหน่วยงาน — ไม่ใช่ผู้รับเงินจริง แต่เป็นกรมบัญชีกลาง"
> "ส่วนบริษัท platform ก็เก็บแค่ค่า fee platform เท่านั้น"

Translation: DTAM the department is NOT the actual money receiver;
กรมบัญชีกลาง (Treasury) is. The platform company collects ONLY the
platform fee. Therefore:

- The platform's books MUST NOT carry a state-fee revenue line (would
  inflate gross sales).
- The platform's books MUST NOT carry a state-fee payable to DTAM
  (Treasury is not a creditor of the platform — it collects directly).
- The state-fee receipt for the applicant is generated by
  `services/journal-entry-service.js` with `{ skipped: true,
  reason: 'STATE_FEE_NOT_IN_PLATFORM_BOOKS' }`, and the
  Government Revenue Receipt PDF (ใบเสร็จเงินรายได้แผ่นดิน) is rendered
  in DTAM's name — but no journal entry lands on the platform's books.

Reports in this module enforce that invariant by **excluding 9xxx
suspense rows** at the `aggregateLines()` boundary
(`apps/backend/services/trial-balance-service.js`). All four downstream
reports inherit the exclusion.

## Authorisation matrix

| Role | TB | P&L | BS | GL |
|------|----|-----|----|----|
| `ADMIN` | yes | yes | yes | yes |
| `ACCOUNT_PLATFORM` | yes | yes | yes | yes |
| `ACCOUNT_DTAM` | **no** | **no** | **no** | **no** |
| `ACCOUNT` (legacy) | yes | yes | yes | yes |
| `AUDITOR` | yes | yes | yes | yes |
| all others | no | no | no | no |

`ACCOUNT_DTAM` is denied because the reports cover PLATFORM books only;
DTAM staff use the bank-reconciliation endpoint
(`/api/finance/reconciliation?bookSide=DTAM`) and กรมบัญชีกลาง's own
ledger to reconcile the state-fee channel.

## Audit trail

Every request is logged with:

```
category: PAYMENT
action:   FINANCE_REPORT_EXPORTED
metadata: { reportType, asOfDate / from / to / accountCode, balanced, totals }
```

Required by Thai e-Transactions Act §31 (disclosure of financial records
must be traceable to the recipient) and ISO 27799 §7.10.4 (audit-log
failure is itself a security event).

## Tests

- `apps/backend/__tests__/unit/trial-balance-service.test.js` — 18 tests
- `apps/backend/__tests__/unit/financial-statements-service.test.js` — 11 tests
- `apps/backend/__tests__/unit/general-ledger-service.test.js` — 8 tests

All 37 tests pass. Anchor test
(`payment-phase-flow-canonical-totals.test.js`) also passes — no
regression to the upstream payment-phase-flow.
