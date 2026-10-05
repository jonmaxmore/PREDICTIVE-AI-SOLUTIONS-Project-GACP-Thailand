# ภ.พ.30 (Por.Por.30) Monthly VAT Filing — Workflow & Reference

**Batch:** B19-C (Tax/Compliance, 2026-05-16)
**Owner:** ACCOUNT_PLATFORM team (Predictive AI Solution Co., Ltd.)
**Filing entity:** บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด (สำนักงานใหญ่) — TIN `0105568045932`

---

## 1. Why this report exists

Per ป.รัษฎากร (Thai Revenue Code) ม.82, every VAT-registered juristic
person must file the monthly **ภ.พ.30** return reporting:

1. **Output VAT (ภาษีขาย)** — VAT collected from customers on taxable
   sales / services.
2. **Input VAT (ภาษีซื้อ)** — VAT paid to suppliers on business
   purchases (creditable per ม.82/3 when backed by a full tax invoice
   ใบกำกับภาษีซื้อ).
3. **Net VAT payable** = Output VAT − Input VAT.

The platform charges 7% Output VAT on every PLATFORM service-fee
invoice. State fees (collected on behalf of DTAM) are **VAT-exempt**
per ม.77/1 (10) — they are *เงินรายได้แผ่นดิน* and never appear on
this report.

---

## 2. Filing cadence

- **Deadline:** the **15th** of the month *following* the tax period
  (e-filing, ป.รัษฎากร ม.83/8). Paper filing is the 7th, but the
  platform uses e-Filing exclusively.
- **Late penalty:** 2% per month on the underpaid amount + เบี้ยปรับ
  100% of unfiled tax (ม.89/2). Treat the 15th as a hard cutoff.
- **Zero-VAT months:** still file — submission of an empty return is
  mandatory once the entity is VAT-registered (ม.83 vs ม.85).

| Tax period | e-Filing deadline |
|------------|-------------------|
| มกราคม 2026 | 15 กุมภาพันธ์ 2026 |
| พฤษภาคม 2026 | 15 มิถุนายน 2026 |
| ธันวาคม 2026 | 15 มกราคม 2027 |

---

## 3. Workflow

```
   ┌─────────────────────────┐
   │  Day 1-end of month     │  Invoices paid → JournalEntry rows
   │  (operational)          │  ACCOUNT_PLATFORM reviews slip queue
   └───────────┬─────────────┘
               │
               ▼
   ┌─────────────────────────┐
   │  1st of next month      │  Generate JSON preview:
   │  (preparation)          │  GET /api/finance/tax-reports/
   │                         │     output-vat?year=2026&month=5
   │                         │  Verify period-closable:
   │                         │  GET /api/finance/tax-reports/
   │                         │     period-closable?year=2026&month=5
   └───────────┬─────────────┘
               │
               ▼
   ┌─────────────────────────┐
   │  Mid-month (close)      │  - Resolve every pending invoice
   │                         │  - Compile Input VAT manually
   │                         │    (see §7 below)
   │                         │  - Download CSV:
   │                         │    GET .../output-vat?format=csv
   │                         │  - Cross-check totals vs trial balance
   │                         │    (account 2131-001)
   └───────────┬─────────────┘
               │
               ▼
   ┌─────────────────────────┐
   │  By the 15th            │  - Login to RD e-Filing
   │  (file)                 │    (https://efiling.rd.go.th)
   │                         │  - Upload CSV under "รายงานภาษีขาย"
   │                         │  - Enter Input VAT total manually
   │                         │  - File + pay net VAT payable
   │                         │  - Archive submission receipt
   └─────────────────────────┘
```

---

## 4. Endpoints (this batch)

All endpoints are gated to **ACCOUNT_PLATFORM, AUDITOR, ADMIN**.
**ACCOUNT_DTAM is denied** — VAT is platform-side only (state revenue
is VAT-exempt per ม.77/1 (10)).

Every call is `VAT_REPORT_EXPORTED` audit-logged (PAYMENT category,
INFO severity) per Thai e-Transactions Act §31.

### 4.1 `GET /api/finance/tax-reports/output-vat`

| Query param   | Type    | Required | Default | Notes                  |
|---------------|---------|----------|---------|------------------------|
| `year`        | integer | no       | current | 2020 ≤ year ≤ 2030     |
| `month`       | integer | no       | current | 1 ≤ month ≤ 12         |
| `format`      | string  | no       | `json`  | `json` or `csv`        |

JSON response shape:
```jsonc
{
  "success": true,
  "data": {
    "period": {
      "year": 2026,
      "month": 5,
      "monthThai": "พฤษภาคม",
      "filingDueDate": "2026-06-15T00:00:00.000Z",
      "windowStart": "2026-05-01T00:00:00.000Z",
      "windowEnd":   "2026-06-01T00:00:00.000Z"
    },
    "seller": {
      "legalNameTH": "บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด (สำนักงานใหญ่)",
      "taxId": "0105568045932",
      "addressLine1": "429/69 หมู่บ้าน พรีเมี่ยมเพลส ...",
      "addressLine2": "กรุงเทพมหานคร 10230",
      "vatRate": 0.07
    },
    "rows": [
      {
        "invoiceDate": "2026-05-12T03:00:00.000Z",
        "invoiceNumber": "INV-2026-05-007",
        "buyerName": "บริษัท สมุนไพรไทย จำกัด",
        "buyerTaxId": "0105540099999",
        "buyerType": "JURISTIC",
        "taxableAmount": 500,
        "vatAmount": 35
      }
    ],
    "totals": { "taxableAmount": 500, "vatAmount": 35, "rowCount": 1 },
    "inputVat": {
      "tracked": false,
      "todo": "Input VAT (ภาษีซื้อ) tracking not yet implemented..."
    }
  }
}
```

### 4.2 `GET /api/finance/tax-reports/period-closable`

Returns whether the month can be safely closed. The period is *not*
closable when pending invoices exist that were issued within the
period — a late payment would land on a closed period and require an
amended return (ภ.พ.30 เพิ่มเติม).

```jsonc
{
  "success": true,
  "data": {
    "year": 2026,
    "month": 5,
    "closable": false,
    "lastPaidInvoiceDate": "2026-05-30T10:00:00.000Z",
    "openInvoices": 3,
    "warnings": [
      "Found 3 pending invoice(s) created in the period. A late payment ..."
    ]
  }
}
```

---

## 5. CSV column mapping → RD e-Filing fields

Per ประกาศกรมสรรพากร ฉบับที่ 200/2562 §3 the Output-VAT CSV template
requires the columns below. Our generated CSV mirrors that exactly:

| # | Our CSV column                          | RD e-Filing field             | Notes |
|---|------------------------------------------|-------------------------------|-------|
| 1 | `ลำดับ`                                  | ลำดับที่                       | 1-based row index |
| 2 | `เลขที่ใบกำกับภาษี`                       | เลขที่ใบกำกับภาษี              | Invoice number (ม.86/4 (5)) |
| 3 | `วันที่ออกใบกำกับ`                        | วัน/เดือน/ปี ที่ออกใบกำกับ       | `YYYY-MM-DD` |
| 4 | `ชื่อผู้ซื้อ`                              | ชื่อผู้ซื้อสินค้า/ผู้รับบริการ    | ม.86/4 (2) |
| 5 | `เลขประจำตัวผู้เสียภาษีผู้ซื้อ`            | เลขประจำตัวผู้เสียภาษีอากรของผู้ซื้อ | 13 digits, or `-` for individuals |
| 6 | `มูลค่าสินค้า/บริการ`                     | มูลค่าสินค้าหรือบริการที่ยังไม่รวมภาษีฯ | ฐานภาษี (ม.79) |
| 7 | `จำนวนภาษี`                              | จำนวนภาษีมูลค่าเพิ่ม           | 7% × ฐานภาษี |

**Encoding contract:**
- **UTF-8 with BOM** — Excel needs the BOM to render Thai correctly
  when the file is opened from Windows Explorer.
- **CRLF (`\r\n`) line endings** — RD e-Filing portal + Excel both
  expect Windows line breaks.
- **Numeric format:** two decimal places, dot decimal separator, no
  thousands separator (e.g. `1535.00`, not `1,535.00`).
- **Footer row:** ลำดับ / invoice-number / invoice-date columns blank;
  buyer-name column holds the literal `รวมทั้งสิ้น`; taxable + VAT
  columns carry the period totals.

### 5.1 Buyer TIN handling (ม.86/4)

| Buyer type             | `buyerTaxId` rendered as                           |
|------------------------|----------------------------------------------------|
| JURISTIC (company)     | 13-digit corporate TIN (e.g. `0105540099999`)      |
| INDIVIDUAL (farmer)    | `-` (dash)                                         |
| COMMUNITY_ENTERPRISE   | `-` (dash) — community registration no., not a VAT TIN |
| Unknown / missing      | `-` (dash)                                         |

Individuals are not VAT-registered, but ม.86/4 still requires the line
to be reported on ภ.พ.30 with the buyer-TIN field as a dash. The RD
e-Filing portal accepts this representation per ฉบับ 200/2562.

---

## 6. Data sources & filter

The Output-VAT report is built from the **double-entry journal** the
platform writes when each PLATFORM invoice transitions to `paid`.
Source files:

| File | Role |
|------|------|
| `apps/backend/services/journal-entry-service.js` | Writes the Cr Output VAT line (`ACCOUNTS.VAT_PAYABLE_OUTPUT`, account `2131-001`) on every PLATFORM payment. |
| `apps/backend/services/vat-report-service.js` | Reads `JournalLine` where `accountCode ∈ OUTPUT_VAT_ACCOUNT_CODES` and groups by month. |
| `apps/backend/config/invoice-issuers.js` | Source of the seller (`PLATFORM_ISSUER`) header on each report. |

**Account-code filter:** `accountCode ∈ { '2131-001', '2210', '2210-001' }`.
The canonical code is `2131-001`; the two legacy codes are retained so
historical entries from pre-B16 chart revisions still surface — ป.รัษฎากร
requires us to report ALL output VAT in the period regardless of when
the row was created.

**Period filter:** `entryDate ∈ [first-day-of-month, first-day-of-next-month)`
in UTC. Anchored on `JournalEntry.entryDate` (the accounting date,
typically `invoice.paidAt`), not `createdAt` (which is the row-insert
moment and can drift across midnight).

**Soft-delete filter:** `isDeleted = false`. Reversing entries are
preferred over edits (see B16 schema comment); the report excludes
zero / negative-credit rows so a reversing pair nets correctly.

---

## 7. TODO — Input VAT (ภาษีซื้อ) tracking

**Status:** not implemented in B19-C. **Flagged on every report**
(`report.inputVat = { tracked: false, todo: '...' }`).

### Why deferred

Input VAT requires a **purchase-invoice model** the platform does not
yet have. Per ม.82/3, a creditable Input VAT entry must reference a
`ใบกำกับภาษีซื้อ` — the original full tax invoice issued by the
supplier (e.g. AWS, Google Workspace, office-supplies vendor). Building
this responsibly means:

1. A `PurchaseInvoice` Prisma model with the seven ม.86/4 fields.
2. An upload UI for ACCOUNT_PLATFORM to attach the supplier's PDF.
3. A journal-entry path that posts `Dr. Input VAT (account 1211 or
   similar)` / `Cr. AP — supplier` on registration of the invoice.
4. A monthly `generateInputVatReport()` mirror function reading those
   journal lines.

### Interim workaround for the finance officer

Until the purchase-invoice module ships:

1. Compile all supplier `ใบกำกับภาษีซื้อ` for the period manually
   (e.g. AWS monthly invoice PDF + Google Workspace + any other
   VAT-registered suppliers).
2. Sum the VAT portion → that is the period's Input VAT.
3. Enter the Input VAT total **manually** on the RD e-Filing screen
   (the platform's CSV upload covers Output VAT only).
4. Keep the supplier invoices on file for 5 years (ม.87/3 retention).

### Tracking issue

A separate batch (proposed B20) will add the purchase-invoice model
and wire the Input VAT side of this report. Until then, the
`inputVat.tracked === false` flag in the JSON response is the canary
that prevents finance from filing blind.

---

## 8. References

| Anchor | Source |
|--------|--------|
| Filing cadence (e-filing 15th) | ป.รัษฎากร ม.83/8 |
| Paper filing cadence (7th)      | ป.รัษฎากร ม.83 |
| Full tax-invoice requirements   | ป.รัษฎากร ม.86/4 |
| VAT base (taxable amount)       | ป.รัษฎากร ม.79 |
| Input VAT creditability         | ป.รัษฎากร ม.82/3 |
| State-revenue VAT exemption     | ป.รัษฎากร ม.77/1 (10) |
| 7-year document retention       | ป.รัษฎากร ม.87/3 |
| CSV column spec (e-Filing)      | ประกาศกรมสรรพากร ฉบับที่ 200/2562 |
| Audit-trail mandate (export log)| พ.ร.บ.ว่าด้วยธุรกรรมทางอิเล็กทรอนิกส์ พ.ศ.2544 ม.31 |
| Revenue recognition basis       | TFRS for NPAEs ch. 18 (รายได้) |
| Two-money-flow model rationale  | `apps/backend/services/journal-entry-service.js` header §"Two-channel money flow" |

---

## 9. Change log

| Date       | Batch | Summary |
|------------|-------|---------|
| 2026-05-16 | B19-C | Initial Output-VAT report + CSV export + period-closable check. Input VAT flagged as TODO. |
