> ## ⚠️ เอกสารนี้บันทึกโมเดลที่เลิกใช้แล้ว (ปักป้าย 2026-09-05)
>
> เนื้อหาด้านล่างเขียนขึ้นภายใต้โมเดล **two-money-flow / ตัวแทนรับชำระ** ซึ่งถูกยกเลิกโดย
> มติ operator W14 (2026-08-22) และมติ 2026-09-05 · จุดยืนปัจจุบัน: **บริษัทเป็นผู้ออกเอกสารรายเดียว
> เก็บ VAT 7% บนค่าบริการทั้งก้อน ไม่มีส่วนใดยกเว้นภาษี และบริษัทจ่ายกรมฯ ภายหลังในฐานะต้นทุน**
>
> เก็บไว้อ่านเป็นบันทึกประวัติ — **อย่านำตัวเลข ผังบัญชี หรือข้อสรุปทางภาษีในนี้ไปใช้**
> ความจริงปัจจุบันอยู่ที่ `docs/architecture/fee-model-2026-09-05.md`

# Single-Issuer Document Samples (2026-05-16)

Owner directive (Thai, verbatim, 2026-05-16):

> "จากตัวใบกำกับภาษีอย่างคือ สองใบรวมกัน แต่ต้องเป็นสองใบ
> หรือเอกสารอื่นๆ ก็ต้องเป็นสองใบ"

Translation: "Tax invoices that combine two into one must instead be
two separate documents. Other documents must also be two."

## Why this fix exists

The pre-fix `tax-invoice.html` rendered a single PDF that contained the
DTAM government fee (เงินรายได้แผ่นดิน, VAT-exempt) AND the platform
service fee + 7% VAT on the same totals table — and then summed them
into one grand total under the platform company's tax ID. That is a
direct violation of:

- **ม.86 ป.รัษฎากร** — ผู้ประกอบการต้องออกใบกำกับภาษีในนามของตน
  (one tax invoice = one VAT-registered seller).
- **ม.86/4 ป.รัษฎากร** — ใบกำกับภาษีเต็มรูปต้องแสดงผู้ขายเพียงรายเดียว
  (full tax invoice must announce a single seller's supply only).
- **ม.77/1 (10) ป.รัษฎากร** — รายได้แผ่นดินยกเว้น VAT.
- **กฎกระทรวงการคลังเรื่องเงินรายได้แผ่นดิน** — government revenue
  flows directly to the Treasury under DTAM's identity.

## Phase 1 example (single scope)

Numbers from `services/split-payment-calculator.js`
(`calculateSplitPayment(1)`): state = 5,000 / service = 500 / VAT = 35.

### BEFORE (combined — pre-fix)

```
┌──────────────────────────────────────────────────────────────────┐
│ ใบกำกับภาษี / TAX INVOICE                                       │
│ ผู้ออก: บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด                     │
│ Tax ID: 0105568045932                                            │
│                                                                  │
│ Items:                                                           │
│   1. ค่าธรรมเนียมรัฐ ขั้นที่ 1 (ยกเว้น VAT)     5,000.00      │
│   2. ค่าบริการแพลตฟอร์ม ขั้นที่ 1               500.00         │
│                                                                  │
│ Totals:                                                          │
│   ค่าธรรมเนียมรัฐ (VAT Exempt)                  5,000.00       │
│   ค่าบริการแพลตฟอร์ม (Before VAT)                500.00       │
│   ภาษีมูลค่าเพิ่ม 7%                               35.00       │
│   ยอดที่ต้องชำระทั้งสิ้น                        5,535.00      │
│                                                                  │
│ Revenue Split:                                                   │
│   Wallet A — DTAM        5,000.00                                │
│   Wallet B — บริษัท         535.00                                │
└──────────────────────────────────────────────────────────────────┘
```

Problem: the document is issued under the platform's tax ID but
includes 5,000 THB of DTAM's state revenue in the totals AND in the
Wallet A line — effectively a tax invoice that announces two sellers.

### AFTER (two separate documents — fixed)

```
┌──────────────────────────────────────────────────────────────────┐
│ ใบเสร็จเงินรายได้แผ่นดิน / GOVERNMENT REVENUE RECEIPT          │
│ ผู้ออก: กรมการแพทย์แผนไทยและการแพทย์ทางเลือก                │
│ Tax ID: 0994000036540                                            │
│ Bank: ธนาคารกรุงไทย 4750134376                                  │
│                                                                  │
│ Items:                                                           │
│   1. ค่าธรรมเนียมรัฐ ขั้นที่ 1 (ตรวจเอกสาร)     5,000.00      │
│                                                                  │
│ Totals:                                                          │
│   ยอดรวม / Subtotal                            5,000.00         │
│   ยอดที่รับชำระทั้งสิ้น                          5,000.00       │
│                                                                  │
│ หมายเหตุ: รายได้แผ่นดินยกเว้นภาษีมูลค่าเพิ่ม                │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ ใบกำกับภาษี / TAX INVOICE                                       │
│ ผู้ออก: บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด                     │
│ Tax ID: 0105568045932                                            │
│ Bank: PLATFORM_BANK_ACCOUNT (จาก config/invoice-issuers.js)    │
│                                                                  │
│ Items:                                                           │
│   1. ค่าบริการแพลตฟอร์ม ขั้นที่ 1                  500.00       │
│                                                                  │
│ Totals:                                                          │
│   ค่าบริการแพลตฟอร์ม (Before VAT)                500.00         │
│   ภาษีมูลค่าเพิ่ม 7% (VAT)                          35.00      │
│   ยอดที่ต้องชำระทั้งสิ้น                           535.00       │
└──────────────────────────────────────────────────────────────────┘
```

Each document now stands alone with exactly one issuer in the header,
one set of totals matching that issuer's supply, and one bank channel
in the payment-info footer. Two PDFs → two payments → two slips → two
reconciliations.

## Phase 2 example (single scope)

Same shape, different numbers: state = 25,000 / service = 2,500 /
VAT = 175. The DTAM receipt total is 25,000 (no VAT row). The platform
tax invoice total is 2,675 (2,500 + 175).

## What changed in the codebase

### Templates (`apps/backend/services/pdf/templates/`)

| File | Change |
|------|--------|
| `tax-invoice.html` | Removed the ค่าธรรมเนียมรัฐ row + Wallet A/B revenue-split panel. Body shows platform supply only. |
| `government-revenue-receipt.html` | Already DTAM-only — added regression-anchor test. |
| `invoice.html` | Hardcoded "GACP Thai" header replaced with `{{ISSUER_NAME_TH}}` / `{{ISSUER_TAX_ID}}` / `{{ISSUER_ADDRESS}}`. Hardcoded DTAM bank account replaced with `{{PAYMENT_INFO_HTML}}`. Combined totals replaced with `{{TOTALS_ROWS_HTML}}`. |
| `receipt.html` | Same single-issuer treatment as `invoice.html`. |
| `quotation.html` | Header + totals + VAT-note are all issuer-driven via placeholders rendered by the template service. |
| `application-summary.html` | No fee data — untouched. |
| `certificate.html` | Non-financial — untouched. |

### Service (`apps/backend/services/pdf/invoice-template-service.js`)

- New helpers `buildTotalsRowsHtml`, `buildQuotationTotalsRowsHtml`,
  `buildPaymentInfoHtml`, `detectIssuerSide` — exported for tests.
- `generateTaxInvoicePdf` throws `INVALID_ISSUER_SIDE` (with
  `expected: 'PLATFORM'`, `actual: 'DTAM'`) when given a STATE
  serviceType. Tax-invoice body now uses only the platform supply.
- `generateReceiptPdf` and `generateInvoicePdf` route to one issuer
  per render — items + totals + bank info all from the same side.
- `generateQuotationPdf` now requires `issuerSide` parameter
  (DTAM | PLATFORM) — missing or unknown values throw
  `INVALID_ISSUER_SIDE`.
- `GOV_FEE_AMOUNT_TH` / `WALLET_A_AMOUNT` / `WALLET_B_AMOUNT` no
  longer populated on the tax-invoice data payload.

### Tests
- `apps/backend/__tests__/unit/invoice-template-single-issuer.test.js`
  (15 cases — DOM checks + guard tests + helper behavior).

## File boundaries respected

No edits to: Prisma schemas, `services/journal-entry-service.js`,
`services/bank-reconciliation-service.js`,
`services/payment-slip-service.js`,
`services/receipt-numbering-service.js`,
`services/receipt-auto-sign-service.js`,
`services/crypto/signature-service.js`,
`config/invoice-issuers.js`, `shared/canonical-rbac.js`,
`utils/thai-numerals.js`, frontend files.

## Tie-back to owner words

"สองใบรวมกัน" (two combined) → "สองใบ" (two separate). Each financial
document — invoice, tax invoice, receipt, quotation — now renders
exactly one issuer. The state portion lives only on the DTAM
ใบเสร็จเงินรายได้แผ่นดิน; the platform portion lives only on the
Predictive AI ใบกำกับภาษีเต็มรูป.
