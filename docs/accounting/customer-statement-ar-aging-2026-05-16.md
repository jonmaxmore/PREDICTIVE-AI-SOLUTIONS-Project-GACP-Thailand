> ## ⚠️ เอกสารนี้บันทึกโมเดลที่เลิกใช้แล้ว (ปักป้าย 2026-09-05)
>
> เนื้อหาด้านล่างเขียนขึ้นภายใต้โมเดล **two-money-flow / ตัวแทนรับชำระ** ซึ่งถูกยกเลิกโดย
> มติ operator W14 (2026-08-22) และมติ 2026-09-05 · จุดยืนปัจจุบัน: **บริษัทเป็นผู้ออกเอกสารรายเดียว
> เก็บ VAT 7% บนค่าบริการทั้งก้อน ไม่มีส่วนใดยกเว้นภาษี และบริษัทจ่ายกรมฯ ภายหลังในฐานะต้นทุน**
>
> เก็บไว้อ่านเป็นบันทึกประวัติ — **อย่านำตัวเลข ผังบัญชี หรือข้อสรุปทางภาษีในนี้ไปใช้**
> ความจริงปัจจุบันอยู่ที่ `docs/architecture/fee-model-2026-09-05.md`

# Customer Statement (สรุปยอดลูกค้า) + AR Aging Report (รายงานลูกหนี้ค้างชำระ)

**Batch:** B20-D · **Date:** 2026-05-16

This batch fills two gaps that the audit identified on the GACP platform:

1. **Customer Statement (สรุปยอดลูกค้า)** — a consolidated billing view per applicant
   that finance staff can pull when resolving a support ticket. Replaces the
   "open three screens and reconcile by eye" workflow.

2. **AR Aging Report (รายงานลูกหนี้ค้างชำระ)** — outstanding-invoices view
   bucketed by `dueDate` age, used by finance to prioritise collection calls.
   The DTAM and PLATFORM teams own different buckets per the B16-C two-money-flow
   model, so the report is split by `bookSide` and the two teams see different
   reports.

Compliance anchors:

- **PDPA ม.6** (data minimisation) — applicant `healthId` is ALWAYS returned masked.
- **PDPA ม.27** (lawful processing) — finance staff supporting a ticket are the
  lawful recipient of customer billing data.
- **PDPA ม.39** (record of disclosure) — every read is `CUSTOMER_REPORT_EXPORTED` audited.
- **Thai e-Transactions Act §31** — payment-record disclosure must be traceable.
- **TFRS for NPAEs ch. 14** (ลูกหนี้การค้า) — AR ageing is the canonical NPAE disclosure
  for trade receivables.
- **ป.รัษฎากร ม.77/1 (10)** — DTAM state-fee revenue is VAT-exempt.
- **ป.รัษฎากร ม.86/4** — PLATFORM service fee subject to VAT 7%.

## Files created

| Path | Purpose |
| --- | --- |
| `apps/backend/services/customer-statement-service.js` | Service — assembles per-applicant consolidated billing view |
| `apps/backend/services/ar-aging-service.js` | Service — buckets PENDING invoices by `asOfDate − dueDate` |
| `apps/backend/routes/api/finance/customer-reports.js` | Provider-facing routes |
| `apps/backend/routes/api/applications/application-listing-handlers.js` (edit) | New applicant-facing endpoint `GET /api/applications/:id/statement` |
| `apps/backend/routes/api/index.js` (edit) | Mount `/api/finance` for the two new endpoints |
| `apps/web-app/src/app/health/billing/page.tsx` + `client-view.tsx` | Applicant-facing billing page (print-friendly) |
| `apps/web-app/src/app/health/more/page.tsx` (edit) | Add nav link "สรุปยอดลูกค้า" |
| `apps/web-app/src/app/provider/accounting/reports/ArAgingReport.tsx` | Provider-facing AR Aging table component |
| `apps/web-app/src/app/provider/accounting/ar-aging/page.tsx` | Standalone AR Aging page (DTAM + PLATFORM) |
| `apps/web-app/src/lib/services/accounting-service.ts` (edit) | Add `getArAging` + `arAgingCsvUrl` |
| `apps/backend/__tests__/unit/customer-statement-service.test.js` | 14 tests |
| `apps/backend/__tests__/unit/ar-aging-service.test.js` | 10 tests |

## Sample Customer Statement shape

```json
{
  "applicant": {
    "id": "user-1",
    "name": "สมช***",
    "healthIdMasked": "1234*******23",
    "phoneNumberMasked": "******5678",
    "emailMasked": "s***@example.com"
  },
  "asOfDate": "2026-05-16T00:00:00Z",
  "organizationId": "org-1",
  "summary": {
    "dtamSide":     { "billed": 5000.00, "paid": 5000.00, "outstanding":    0.00, "invoiceCount": 1 },
    "platformSide": { "billed": 5350.00, "paid":    0.00, "outstanding": 5350.00, "invoiceCount": 1 }
  },
  "applications": [
    {
      "id": "app-1",
      "applicationNumber": "GACP-2026-0001",
      "status": "PHASE_1_PAID",
      "createdAt": "2026-05-01T00:00:00Z",
      "phase1Status": "PAID",
      "phase2Status": "PENDING",
      "phase1PaidAt": "2026-05-02T00:00:00Z",
      "phase2PaidAt": null,
      "quotations": [
        { "id": "q1", "quotationNumber": "QT-DTAM-001", "issuerType": "DTAM",
          "status": "ACCEPTED", "totalAmount": 5000.00, "issueDate": "2026-04-30", "validUntil": null },
        { "id": "q2", "quotationNumber": "QT-PRD-001", "issuerType": "PLATFORM",
          "status": "ACCEPTED", "totalAmount": 5350.00, "issueDate": "2026-04-30", "validUntil": null }
      ],
      "invoices": [
        { "id": "inv-1", "invoiceNumber": "INV-DTAM-001", "bookSide": "DTAM",
          "status": "PAID", "isPaid": true, "totalAmount": 5000.00,
          "dueDate": "2026-05-05", "paidAt": "2026-05-02",
          "slip": { "id": "slip-1", "status": "APPROVED", "bankRef": "TXN001" } },
        { "id": "inv-2", "invoiceNumber": "INV-PRD-001", "bookSide": "PLATFORM",
          "status": "pending", "isPaid": false, "totalAmount": 5350.00,
          "dueDate": "2026-05-15", "paidAt": null, "slip": null }
      ],
      "summary": {
        "dtamSide":     { "billed": 5000.00, "paid": 5000.00, "outstanding":    0.00, "invoiceCount": 1 },
        "platformSide": { "billed": 5350.00, "paid":    0.00, "outstanding": 5350.00, "invoiceCount": 1 }
      }
    }
  ]
}
```

## Sample AR Aging table (PLATFORM side, asOfDate = 2026-05-31)

| Bucket | Count | Amount (THB) |
| --- | ---: | ---: |
| ยังไม่ครบกำหนด / NOT_YET_DUE | 12 | 64,200.00 |
| ค้าง 0-30 วัน / 0_30 | 8 | 42,800.00 |
| ค้าง 31-60 วัน / 31_60 | 3 | 16,050.00 |
| ค้าง 61-90 วัน / 61_90 | 1 | 5,350.00 |
| ค้างเกิน 90 วัน / OVER_90 | 2 | 10,700.00 |
| **รวม** | **26** | **139,100.00** |

Per-row columns: `invoiceNumber`, `applicationNumber`, `applicantHealthIdMasked`,
`applicantNameMasked`, `invoiceDate`, `dueDate`, `daysOverdue`, `bucket`, `amount`,
`serviceType`, `slipInReview` (badge when an applicant has uploaded a slip
that is awaiting accountant review — they have wired but we haven't approved yet).

## PDPA masking specification

| Field | Mask rule | Example |
| --- | --- | --- |
| `firstName + lastName` | first 3 chars + `***` | `สมชาย ใจดี` → `สมช***` |
| `phoneNumber` | last 4 digits, leading `*` | `0812345678` → `******5678` |
| `healthId` (Thai 13-digit) | first 4 + 7×`*` + last 2 | `1234567890123` → `1234*******23` |
| `email` | first char + `***` + `@domain` | `alice@gacp.go.th` → `a***@gacp.go.th` |

The full 13-digit `healthId` is NEVER shipped from these services to any consumer.
A unit test asserts the full ID is absent from the JSON payload.

## Role-based viewing matrix

### Customer Statement (`GET /api/finance/customer-statement`)

| Role | `summary.dtamSide` | `summary.platformSide` | Per-application breakdown |
| --- | --- | --- | --- |
| `ACCOUNT_DTAM` | visible | `null` | DTAM only |
| `ACCOUNT_PLATFORM` | `null` | visible | PLATFORM only |
| `ADMIN` | visible | visible | both |
| `AUDITOR` | visible (read-only) | visible (read-only) | both |
| Legacy `ACCOUNT` | visible | visible | both (until migration completes) |

### AR Aging (`GET /api/finance/ar-aging?bookSide=…`)

| Role | Allowed `bookSide` | Notes |
| --- | --- | --- |
| `ACCOUNT_DTAM` | `DTAM` only | `?bookSide=PLATFORM` → `403 FORBIDDEN_BOOK_SIDE` |
| `ACCOUNT_PLATFORM` | `PLATFORM` only | `?bookSide=DTAM` → `403 FORBIDDEN_BOOK_SIDE` |
| `ADMIN` | `DTAM` or `PLATFORM` | toggle in UI |
| `AUDITOR` | `DTAM` or `PLATFORM` | read-only |
| Legacy `ACCOUNT` | both | parity with reconciliation route |

### Applicant-facing (`GET /api/applications/:applicationId/statement`)

| Role | Access |
| --- | --- |
| `HEALTH` | Own application only (ownership enforced via `healthId` join). Sees BOTH sides — applicant pays both DTAM and PLATFORM. |
| All other roles | Use the provider-facing `/api/finance/customer-statement` endpoint instead. |

## Endpoints summary

| Verb | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/finance/customer-statement?applicantHealthId=…&asOfDate=YYYY-MM-DD` | Provider | Consolidated statement; role-filtered |
| GET | `/api/finance/ar-aging?bookSide=DTAM\|PLATFORM&asOfDate=YYYY-MM-DD` | Provider | AR aging JSON |
| GET | `/api/finance/ar-aging?…&format=csv` | Provider | RFC 4180 + UTF-8 BOM + CRLF |
| GET | `/api/applications/:applicationId/statement` | Health (own) | Single-application statement |

Every call is `CUSTOMER_REPORT_EXPORTED` audited (PDPA ม.39 + e-Transactions §31).

## Test results

```
PASS apps/backend/__tests__/unit/customer-statement-service.test.js
PASS apps/backend/__tests__/unit/ar-aging-service.test.js

Test Suites: 2 passed, 2 total
Tests:       24 passed, 24 total
Time:        4.151 s
```

`npx tsc --noEmit -p apps/web-app/tsconfig.json` — 0 errors.

## Files NOT touched (boundary)

Per the batch boundary discipline:

- `apps/backend/services/credit-note-service.js` (B20-A)
- `apps/backend/services/debit-note-service.js` (B20-A)
- `apps/backend/services/manual-journal-entry-service.js` (B20-C)
- `apps/backend/services/daily-cash-report-service.js` (B20-C)
- `apps/backend/services/payment-slip-service.js`
- `apps/backend/services/journal-entry-service.js`
- `apps/backend/services/bank-reconciliation-service.js`
- Prisma schema (B20-A owns)
- `apps/backend/shared/canonical-rbac.js`
- `apps/backend/config/invoice-issuers.js`
