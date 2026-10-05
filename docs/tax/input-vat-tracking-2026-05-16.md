# Input VAT (ภาษีซื้อ) Tracking — Iter 26 (2026-05-16)

## Summary

This iteration adds **Input VAT (ภาษีซื้อ)** tracking to the platform so
the monthly **ภ.พ.30** filing can compute the **net VAT payable**:

```
Net VAT payable = Output VAT − Input VAT       (ป.รัษฎากร ม.82/3)
```

Before Iter 26, `vat-report-service.js` only handled the Output side
(VAT charged on PLATFORM service-fee invoices). The Input side was
flagged as TODO and finance staff had to compile purchase invoices
manually before filing on the Revenue Department's e-Filing portal.

Iter 26 introduces:

1. `PurchaseInvoice` Prisma model + migration (additive).
2. `services/purchase-invoice-service.js` — full lifecycle service.
3. `routes/api/finance/purchase-invoices.js` — HTTP API.
4. `generateInputVatReport({ year, month, organizationId })` companion
   method on `vat-report-service.js`.
5. The existing `generateOutputVatReport` return shape now carries
   `inputVat: { tracked: true, ... }` and `totals.netVatPayable` so
   callers compute the remittance in one round-trip.

## Legal basis

| Citation        | Rule                                                         |
| --------------- | ------------------------------------------------------------ |
| ป.รัษฎากร ม.82/3 | VAT-registered buyers may net Input VAT against Output VAT before remitting. |
| ป.รัษฎากร ม.82/4 | Input VAT credit requires the original ใบกำกับภาษีซื้อ on file with seller TIN + invoice number + date + taxable amount + VAT amount; purchase must relate to VAT-able business activities. |
| ป.รัษฎากร ม.83/8 | Monthly e-filing deadline = 15th of the following month. Input VAT lands in the period matching `invoiceDate`, not `receivedDate`. |
| ป.รัษฎากร ม.86/4 | Full tax-invoice field minima — drives the validation rules in `createPurchaseInvoice`. |
| ป.รัษฎากร ม.87/3 | 7-year retention of the supplier's tax invoice. |
| TFRS for NPAEs ch.2 | Separation of duties — reviewer (approver) should differ from submitter where practical. |

Scope: PLATFORM-only. The platform is the VAT-registered buyer.
DTAM-side / state-fee procurement is handled by กรมบัญชีกลาง systems and
does not pass through this table.

## PurchaseInvoice model

| Column            | Type            | Notes |
| ----------------- | --------------- | ----- |
| `id`              | uuid            | PK    |
| `invoiceNumber`   | text            | Supplier's invoice number — unique per supplier (see `@@unique`). |
| `supplierName`    | text            | ม.86/4 mandatory. |
| `supplierTaxId`   | text (13 digits)| ม.86/4 mandatory; service validates length. |
| `supplierAddress` | text?           | Optional. |
| `invoiceDate`     | timestamp       | Drives ภ.พ.30 period (ม.83/8). |
| `receivedDate`    | timestamp       | Defaults to `now()`. Internal — does NOT drive VAT period. |
| `subtotal`        | Decimal(15,2)   | TFRS for NPAEs exact decimal. |
| `vat`             | Decimal(15,2)   | Input VAT we can claim. |
| `totalAmount`     | Decimal(15,2)   | Service asserts `subtotal + vat ≈ totalAmount` (±0.005). |
| `category`        | text            | One of `OFFICE_SUPPLIES`, `PROFESSIONAL_SERVICES`, `UTILITIES`, `OTHER` — drives the chart-of-accounts expense mapping. |
| `description`     | text?           |  |
| `notes`           | text?           |  |
| `attachmentId`    | text?           | FK to attachment row with the PDF/photo. |
| `organizationId`  | text?           | ADR-014 tenancy. |
| `status`          | text            | `PENDING_REVIEW` \| `APPROVED` \| `REJECTED`. |
| `reviewedAt`/`reviewedBy` | timestamp/text | Filled at approve/reject. |
| `rejectionReason` | text?           |  |
| `paidAt`/`paidBy` | timestamp/text? | Settlement marker (separate from VAT-claim event). |
| `journalEntryId`  | text?           | FK to JournalEntry row written at approval. |
| `createdAt`/`createdBy` | timestamp/text |  |
| `isDeleted`       | boolean         | Soft delete (ม.87/3 retention). |

**Unique constraint** `(supplierTaxId, invoiceNumber)` — a supplier
cannot legally re-issue the same invoice number for a given TIN
(ม.86/4), so this pair is the practical double-claim guard.

Migration: `prisma/migrations/20260518000000_purchase_invoice/migration.sql`
(strictly additive — no DROP/ALTER on existing tables).

## Lifecycle

```
PENDING_REVIEW ──approve──▶ APPROVED ──mark-paid──▶ APPROVED (paidAt set)
       │
       └─reject──▶ REJECTED (terminal — resubmit a new row to retry)
```

- `APPROVED` is terminal for the Input-VAT claim itself.
- `markAsPaid` only stamps the settlement timestamp; status does NOT
  change. This mirrors Thai accounting practice: the **claim** event
  (ภ.พ.30 period) and the **cash settlement** event are recognised
  separately (the claim happens in the ภ.พ.30 period matching
  `invoiceDate`; the cash payment can land in any later period).

## Input VAT journal entry

On `approvePurchaseInvoice` the service atomically:

1. Flips status `PENDING_REVIEW → APPROVED`,
2. Writes a balanced JournalEntry + 3 JournalLine rows,
3. Back-references the row via `purchaseInvoice.journalEntryId`,
4. Audit-logs as `PURCHASE_INVOICE_APPROVED`.

Shape (when `paidAt` is NOT set on the row — purchase on credit):

```
Dr. ภาษีซื้อ — Input VAT 7%      (1310-001)        <vat>
Dr. ค่าใช้จ่าย — by category     (5210/5220/5230/5290-001) <subtotal>
  Cr. เจ้าหนี้การค้า              (2110-001)             <totalAmount>
```

When the row is `markAsPaid` BEFORE approval, the Cr side switches to
Cash:

```
Dr. ภาษีซื้อ — Input VAT 7%      (1310-001)        <vat>
Dr. ค่าใช้จ่าย — by category     (5xxx-001)        <subtotal>
  Cr. เงินสด/เงินฝากธนาคาร        (1110-001)             <totalAmount>
```

Per **ม.83/8** the JournalEntry's `entryDate` is the supplier's
`invoiceDate` (NOT the approval date) so the Input VAT credit lands in
the ภ.พ.30 period matching the supplier's tax invoice.

### Chart of accounts

The following codes are referenced by the service. The canonical chart
lives in `chart-of-accounts-service.js` (read-only for this iteration);
the codes are mirrored as constants in
`services/purchase-invoice-service.js` (`ACCOUNTS`) for self-containment.

| Code      | Name                                  | Iter 26 role |
| --------- | ------------------------------------- | ------------ |
| 1310-001  | ภาษีซื้อ — Input VAT 7%               | NEW          |
| 5210-001  | ค่าใช้จ่าย — วัสดุสำนักงาน               | NEW          |
| 5220-001  | ค่าใช้จ่าย — บริการมืออาชีพ              | NEW          |
| 5230-001  | ค่าใช้จ่าย — สาธารณูปโภค                | NEW          |
| 5290-001  | ค่าใช้จ่าย — อื่นๆ                       | NEW          |
| 1110-001  | เงินสด/เงินฝากธนาคาร — บัญชีหลัก     | existing     |
| 2110-001  | เจ้าหนี้การค้า                          | NEW          |

When `chart-of-accounts-service.js` gains an extension batch, the
codes above should be promoted into that module and re-exported into
`purchase-invoice-service.js`.

## ภ.พ.30 net VAT computation

The vat-report-service now produces a single response carrying BOTH
sides:

```js
const report = await vatReport.generateOutputVatReport({
  year: 2026, month: 5, organizationId: 'org-1',
});

report.totals.vatAmount        // Output VAT after CN/DN adjustments
report.inputVat.vatAmount      // Input VAT from APPROVED PurchaseInvoice
report.totals.netVatPayable    // = Output − Input  (ม.82/3)
```

For a per-row Input VAT breakdown (e.g. RD e-Filing import for the
Input-side template), call `generateInputVatReport({...})`. It returns
the same `period` / `seller` shell as the Output report, with `rows[]`
containing per-supplier-invoice records (supplier name, TIN, invoice
number, date, taxable amount, VAT amount, category).

### Edge cases

- **Negative net.** If `Input > Output` the result is negative. The RD
  treats this as a refundable balance or a carry-forward credit. The
  service does NOT clamp — finance staff decide whether to file for
  refund or carry forward.
- **Pre-migration runtime.** When the PurchaseInvoice delegate is not
  yet generated (CI bootstrap), `generateOutputVatReport` falls back
  to the legacy `inputVat: { tracked: false, todo: '...' }` shape and
  `totals.netVatPayable = null`. This preserves the contract for
  existing callers / tests.

## Routes

Mounted at `/api/finance/purchase-invoices` (see
`routes/api/index.js`).

| Method | Path             | Roles                            | Action                                    |
| ------ | ---------------- | -------------------------------- | ----------------------------------------- |
| POST   | `/`              | ACCOUNT_PLATFORM, ADMIN          | Create PENDING_REVIEW row                 |
| GET    | `/`              | ACCOUNT_PLATFORM, ADMIN, AUDITOR | List with filters (status, dateRange, …)  |
| GET    | `/:id`           | ACCOUNT_PLATFORM, ADMIN, AUDITOR | Detail                                    |
| POST   | `/:id/approve`   | ACCOUNT_PLATFORM, ADMIN          | PENDING_REVIEW → APPROVED + write JE      |
| POST   | `/:id/reject`    | ACCOUNT_PLATFORM, ADMIN          | PENDING_REVIEW → REJECTED                 |
| POST   | `/:id/mark-paid` | ACCOUNT_PLATFORM, ADMIN          | Stamp paidAt + paidBy on APPROVED row     |

Role + tenant gates are enforced inside the service layer
(`assertWriteAccess` / `assertReadAccess`) so the same checks apply to
CLI / cron callers.

## Tests

- `__tests__/unit/purchase-invoice-service.test.js` — 21 tests covering
  validation (TIN, balance, category, duplicate), state transitions,
  journal-entry shape (paid-vs-unpaid switch on Cr side), period-date
  mapping (invoiceDate → entryDate), RBAC, and listing.
- `__tests__/unit/vat-report-service.test.js` — 8 new tests for the
  Input side: `generateInputVatReport` (empty / aggregated /
  filter-shape / pre-migration fallback) and Output report with Input
  block (`netVatPayable` math, fallback path, helper aggregator).

Total: **45 passing tests** across the two suites.

## Out of scope (deferred to a future iteration)

- **Periodic ภ.พ.30 CSV export with Input side.** The current
  `generateOutputVatReportCSV` only emits the Output template
  (ประกาศกรมสรรพากร ฉบับที่ 200/2562 §3). An Input-VAT CSV writer
  should land alongside in a sibling iteration; the data model is in
  place to support it.
- **Attachment ingest pipeline.** Uploading the supplier's
  ใบกำกับภาษีซื้อ PDF/photo through the attachment-service is a
  separate iteration. The `attachmentId` field is wired through but
  the service currently accepts the FK without enforcing presence (a
  warning could be added in a follow-up).
- **Auto-period-close gating.** The Output report's `checkPeriodClosable`
  helper does not yet consider pending PurchaseInvoice rows. A future
  iteration should extend it so the finance officer sees both
  Output-side AND Input-side open items before closing the period.
