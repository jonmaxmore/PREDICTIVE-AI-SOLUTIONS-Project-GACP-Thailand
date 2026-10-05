> ## ⚠️ เอกสารนี้บันทึกโมเดลที่เลิกใช้แล้ว (ปักป้าย 2026-09-05)
>
> เนื้อหาด้านล่างเขียนขึ้นภายใต้โมเดล **two-money-flow / ตัวแทนรับชำระ** ซึ่งถูกยกเลิกโดย
> มติ operator W14 (2026-08-22) และมติ 2026-09-05 · จุดยืนปัจจุบัน: **บริษัทเป็นผู้ออกเอกสารรายเดียว
> เก็บ VAT 7% บนค่าบริการทั้งก้อน ไม่มีส่วนใดยกเว้นภาษี และบริษัทจ่ายกรมฯ ภายหลังในฐานะต้นทุน**
>
> เก็บไว้อ่านเป็นบันทึกประวัติ — **อย่านำตัวเลข ผังบัญชี หรือข้อสรุปทางภาษีในนี้ไปใช้**
> ความจริงปัจจุบันอยู่ที่ `docs/architecture/fee-model-2026-09-05.md`

# B21-B PDF Template Redesign — Sample Layouts (2026-05-16)

FlowAccount-grade redesign of the 7 financial PDF templates. Single-issuer
rule (Batch 17) and Thai legal compliance (Batch 16-17) preserved. Common
layout pattern applied with per-document accent color.

## Design tokens (shared across all 7 templates)

```css
:root {
  /* Per-template accent override — see table below. */
  --accent: <hex>;
  --accent-strong: <hex>;
  --accent-bg: <hex>;
  --accent-border: <hex>;

  /* Neutrals — identical across all 7 templates. */
  --text-primary: #111827;
  --text-secondary: #4B5563;
  --text-muted: #9CA3AF;
  --text-soft: #6B7280;
  --border: #E5E7EB;
  --border-strong: #D1D5DB;
  --surface-alt: #F9FAFB;
}

body {
  font-family: 'Sarabun', 'Noto Sans Thai', Tahoma, sans-serif;
  font-size: 13px;
  color: var(--text-primary);
  padding: 20mm 18mm;
}
```

## Accent color matrix

| Document | Color | Hex | TW | File |
|----------|-------|-----|----|------|
| Invoice / Billing Note | Purple | `#7C3AED` | violet-600 | `invoice.html` |
| Quotation | Orange | `#EA580C` | orange-600 | `quotation.html` |
| Receipt | Green | `#16A34A` | green-600 | `receipt.html` |
| Tax Invoice | Teal | `#0D9488` | teal-600 | `tax-invoice.html` |
| Government Revenue Receipt | Indigo | `#4338CA` | indigo-700 | `government-revenue-receipt.html` |
| Credit Note | Red | `#DC2626` | red-600 | `credit-note.html` |
| Debit Note | Blue | `#2563EB` | blue-600 | `debit-note.html` |

## Common layout pattern (applied to all 7)

```
+--------------------------------------------------+
| [Logo]                              [TRIANGLE/1] |  <- corner accent
| Issuer legal name                                 |
| Tax ID / Address / Phone                          |
|                                                   |
| {{DOC_TITLE_TH}}            +-------------------+ |
| ต้นฉบับ / ORIGINAL          | เลขที่: ...       | |
| DOC_TITLE_EN                | วันที่: ...       | |
|                             | ครบกำหนด: ...    | |
|                             | คำขอ: ...         | |
|                             +-------------------+ |
|                                                   |
| +--- ลูกค้า / Billed To --------------------+    |
| | {{PAYER_NAME}}   {{PAYER_ID}}              |    |
| | {{PAYER_ADDRESS}}                          |    |
| +--------------------------------------------+    |
|                                                   |
| +- # - รายการ - จำนวน - ราคา - มูลค่า ---+        |
| | 1 | ...     |  1   | 5,000 | 5,000     |        |
| +------------------------------------------+      |
|                                                   |
|                  ยอดรวม / Subtotal   5,130.84    |
|                  VAT 7%              359.16      |
|                  ------------------------------- |
|                  รวมทั้งสิ้น          5,490.00    |  <- accent grand
|                                                   |
| (ห้าพันสี่ร้อยเก้าสิบบาทถ้วน)                         |
|                                                   |
| หมายเหตุ / ข้อมูลการชำระเงิน                       |
|                                                   |
|  ---------         ---------                      |
|  ผู้ขาย              ผู้รับ                        |
+---------------------------------------------------+
```

---

## 1. Invoice / Billing Note (`invoice.html`) — PURPLE

**Path**: `apps/backend/services/pdf/templates/invoice.html`
**Accent**: `--accent: #7C3AED` (violet-600), `--accent-bg: #F5F3FF`

### Before

Hardcoded green ministry-header (`#1a5c38`) with a full-width banner, a
green doc-type badge, a payer box in plain grey, and a green grand-total
row. No corner accent. No FlowAccount-style meta box.

### After (ASCII layout)

```
+------------------------------------------------+
| [Logo] Predictive AI Solution Co., Ltd. [PURPLE
|        Tax ID: 0105568045932             TRI/1]|
|        123 Bangkok / contact line              |
|                                                |
| ใบวางบิล/ใบแจ้งหนี้   +----------------------+ |
|                       | เลขที่    INV-2569-001|
| ต้นฉบับ / ORIGINAL    | วันที่    16 พฤษภาคม |
| INVOICE               | ครบกำหนด 23 พฤษภาคม |
|                       | คำขอ      APP-001    |
|                       +----------------------+ |
|                                                |
| +-- ลูกค้า / Billed To -------------------+    |
| | นาย สมศักดิ์ ใจดี   ID 1101700123456    |    |
| | 99 ถ. สาทร กทม. 10120                     |    |
| +-------------------------------------------+   |
|                                                |
| # | รายการ                | จำนวน | ราคา | รวม |
| 1 | ค่าบริการแพลตฟอร์ม    |   1   | 500  | 500 |
|                                                |
|                ยอดรวม / Subtotal      500.00  |
|                VAT 7%                  35.00  |
|                ============================== |
|                รวมทั้งสิ้น (PURPLE)   535.00  |
|                                                |
| (ห้าร้อยสามสิบห้าบาทถ้วน)                       |
|                                                |
| หมายเหตุ / วิธีชำระเงิน                          |
| โอนเงิน: KBANK 123-4-56789  PromptPay: ...     |
|                                                |
|  ___________       ___________                 |
|  ผู้ขาย / Seller   ผู้รับ / Receiver             |
+------------------------------------------------+
```

### Placeholders preserved

- `{{GARUDA_DATA_URL}}`, `{{ISSUER_NAME_TH}}`, `{{ISSUER_TAX_ID}}`, `{{ISSUER_ADDRESS}}`
- `{{DOC_TYPE_TH}}`, `{{DOC_TYPE_EN}}`, `{{DOC_NUMBER}}`
- `{{ISSUE_DATE}}`, `{{DUE_DATE}}`, `{{APPLICATION_NUMBER}}`
- `{{PAYER_NAME}}`, `{{PAYER_ID}}`, `{{PAYER_ADDRESS}}`
- `{{ITEMS_ROWS}}`, `{{TOTALS_ROWS_HTML}}` (single-issuer-aware)
- `{{TOTAL_AMOUNT_TEXT}}` (Thai script, legal requirement ม.86/4 (5))
- `{{PAYMENT_INFO_HTML}}`, `{{INVOICE_DUE_DAYS}}`
- `{{MINISTRY_CONTACT_LINE}}`

### Token variables

`--accent #7C3AED | --accent-strong #6D28D9 | --accent-bg #F5F3FF | --accent-border #DDD6FE`

---

## 2. Quotation (`quotation.html`) — ORANGE

**Path**: `apps/backend/services/pdf/templates/quotation.html`
**Accent**: `--accent: #EA580C` (orange-600), `--accent-bg: #FFF7ED`

### Before

Blue (`#0369a1`) doc-type-badge with the green ministry-header above it.
Notice banner in plain blue. Acceptance section dashed in blue. Watermark
"ใบเสนอราคา / QUOTATION".

### After

Single orange accent. Orange corner triangle. Orange grand-total row.
Orange dashed acceptance box. Notice banner in soft orange. Subtitle
"ต้นฉบับ / ORIGINAL" under title. Two-column signature row in the
acceptance section. Side-aware terms note (DTAM: ยกเว้น VAT; PLATFORM:
รวม VAT 7%).

### Placeholders preserved

- `{{ISSUER_NAME_TH}}`, `{{ISSUER_TAX_ID}}`, `{{ISSUER_ADDRESS}}`
- `{{DOC_NUMBER}}`, `{{ISSUE_DATE}}`, `{{VALID_UNTIL}}`, `{{VALIDITY_DAYS}}`
- `{{APPLICATION_NUMBER}}`, `{{PHASE_LABEL}}`
- `{{PAYER_NAME}}`, `{{PAYER_ID}}`, `{{PAYER_ADDRESS}}`
- `{{ITEMS_ROWS}}`, `{{TOTALS_ROWS_HTML}}` (per-side)
- `{{TERMS_VAT_NOTE}}` (side-specific VAT note)
- `{{TOTAL_AMOUNT_TEXT}}`

### Token variables

`--accent #EA580C | --accent-strong #C2410C | --accent-bg #FFF7ED | --accent-border #FED7AA`

---

## 3. Receipt (`receipt.html`) — GREEN

**Path**: `apps/backend/services/pdf/templates/receipt.html`
**Accent**: `--accent: #16A34A` (green-600), `--accent-bg: #F0FDF4`

### Before

Green ministry-header + green doc-type-badge + green "PAID" stamp (green
on green caused the stamp to disappear visually). Payer box in plain grey.

### After (ASCII layout)

```
+------------------------------------------------+
| [Logo] Predictive AI Solution Co., Ltd. [GREEN
|        Tax ID: 0105568045932             TRI/1]|
|        Address line / contact                  |
|                                                |
| ใบเสร็จรับเงิน        +----------------------+ |
| ต้นฉบับ / ORIGINAL    | เลขที่ใบเสร็จ RCP-001|
| RECEIPT               | อ้างอิงใบแจ้งหนี้ ... |
| [ ชำระแล้ว / PAID ]   | วันที่รับชำระ ...     |
|                       | วิธีชำระ ...           |
|                       | คำขอ APP-001          |
|                       +----------------------+ |
|                                                |
| +- ลูกค้า / Received From -----------------+   |
| | ...                                       |   |
| +--------------------------------------------+  |
|                                                |
| Items table (green border under header)        |
|                ยอดรวม          500.00         |
|                VAT 7%           35.00         |
|                =============================  |
|                รวมทั้งสิ้น (GREEN) 535.00     |
|                                                |
| ข้อมูลการรับชำระ (green tinted block)            |
|                                                |
|  ___________       ___________                 |
|  ผู้รับเงิน / Cashier  ผู้ชำระเงิน / Payer      |
+------------------------------------------------+
```

### Placeholders preserved

- `{{ISSUER_NAME_TH}}`, `{{ISSUER_TAX_ID}}`, `{{ISSUER_ADDRESS}}`
- `{{RECEIPT_NUMBER}}`, `{{INVOICE_NUMBER}}`, `{{PAID_DATE}}`
- `{{PAYMENT_METHOD}}`, `{{APPLICATION_NUMBER}}`
- `{{PAYER_NAME}}`, `{{PAYER_ID}}`, `{{PAYER_ADDRESS}}`
- `{{ITEMS_ROWS}}`, `{{TOTALS_ROWS_HTML}}`
- `{{TRANSACTION_REF}}`, `{{RECEIVED_BY}}`
- `{{APPROVER_NAME}}` (B16-D auto-sign)
- `{{TOTAL_AMOUNT_TEXT}}`

### Token variables

`--accent #16A34A | --accent-strong #15803D | --accent-bg #F0FDF4 | --accent-border #BBF7D0`

---

## 4. Tax Invoice (`tax-invoice.html`) — TEAL

**Path**: `apps/backend/services/pdf/templates/tax-invoice.html`
**Accent**: `--accent: #0D9488` (teal-600), `--accent-bg: #F0FDFA`

### Before

Green ministry-header + green doc-type-badge + orange "TAX INVOICE / e-Tax"
badge + orange-bordered tax-info-box. Mixed green/orange palette.

### After

Single teal accent. Teal corner triangle. Teal e-Tax badge under the
title. Teal-bordered issuer-detail-box (renamed from `tax-info-box`). Teal
border under the items table header. Teal-bordered approver block. Single
issuer principle hard-coded:
- NO `ค่าธรรมเนียมรัฐ` row in totals
- NO `Wallet A / Wallet B` revenue-split panel
- ONLY platform supply: `ค่าบริการแพลตฟอร์ม` + VAT 7% + total

### Placeholders preserved

- `{{ISSUER_NAME_TH}}`, `{{ISSUER_TAX_ID}}`, `{{ISSUER_BRANCH}}`, `{{ISSUER_ADDRESS}}`
- `{{DOC_NUMBER}}` (ASCII for footer), `{{RECEIPT_NUMBER_TH}}` (Thai-numeral display)
- `{{ISSUE_DATE}}` (ASCII), `{{ISSUE_DATE_TH}}` (Thai display)
- `{{YEAR_BE_TH}}`, `{{APPLICATION_NUMBER}}`
- `{{PAYER_NAME}}`, `{{PAYER_TAX_ID_TH}}` (PDPA-safe), `{{PAYER_ADDRESS}}`
- `{{TAX_ITEMS_ROWS}}`
- `{{SUBTOTAL_TH}}`, `{{VAT_TH}}`, `{{TOTAL_TH}}`
- `{{TOTAL_AMOUNT_TEXT}}` (Thai script, ม.86/4 (5))
- `{{APPROVER_NAME}}`, `{{APPROVER_POSITION}}`, `{{APPROVER_ROLE}}`, `{{APPROVER_SIGNED_AT_TH}}` (B16-D)

### Token variables

`--accent #0D9488 | --accent-strong #0F766E | --accent-bg #F0FDFA | --accent-border #99F6E4`

---

## 5. Government Revenue Receipt (`government-revenue-receipt.html`) — INDIGO

**Path**: `apps/backend/services/pdf/templates/government-revenue-receipt.html`
**Accent**: `--accent: #4338CA` (indigo-700), `--accent-bg: #EEF2FF`

### Before

Same green ministry-header + green badge as platform receipt — visually
indistinguishable from a PLATFORM receipt despite being a DIFFERENT
legal document type (government revenue, VAT-exempt).

### After

Indigo accent throughout. Indigo corner triangle. Doc-subtitle reads
**"แบบ ก.ค.32 / ต้นฉบับ"** to declare the form structure
(กฎกระทรวงการคลังเรื่องเงินรายได้แผ่นดิน). Authoritative tone via the
solid indigo "หน่วยงานผู้รับเงินรายได้แผ่นดิน" box (1.5px border).
VAT-exempt note preserved verbatim below totals.

### Compliance anchors preserved

- NO `ใบกำกับภาษี` badge (forbidden — government revenue is VAT-exempt)
- NO VAT row in totals
- NO `ค่าบริการแพลตฟอร์ม` placeholder
- NO `Wallet A / Wallet B` placeholder
- Footer keeps the VAT-exempt declaration "ไม่อยู่ในระบบภาษีมูลค่าเพิ่ม"

### Placeholders preserved

- `{{ISSUER_NAME_TH}}`, `{{ISSUER_TAX_ID}}`, `{{ISSUER_ADDRESS}}`
- `{{RECEIPT_NUMBER}}`, `{{RECEIPT_NUMBER_TH}}`
- `{{INVOICE_NUMBER}}`, `{{ISSUE_DATE}}`, `{{ISSUE_DATE_TH}}`, `{{YEAR_BE_TH}}`
- `{{PAYMENT_METHOD}}`, `{{APPLICATION_NUMBER}}`
- `{{PAYER_NAME}}`, `{{PAYER_ID}}`, `{{PAYER_ADDRESS}}`
- `{{ITEMS_ROWS}}`, `{{SUBTOTAL_TH}}`, `{{TOTAL_TH}}`
- `{{TOTAL_AMOUNT_TEXT}}`, `{{TRANSACTION_REF}}`, `{{RECEIVED_BY}}`
- `{{APPROVER_NAME}}`, `{{APPROVER_POSITION}}`, `{{APPROVER_ROLE}}`, `{{APPROVER_SIGNED_AT_TH}}`

### Token variables

`--accent #4338CA | --accent-strong #3730A3 | --accent-bg #EEF2FF | --accent-border #C7D2FE`

---

## 6. Credit Note (`credit-note.html`) — RED

**Path**: `apps/backend/services/pdf/templates/credit-note.html`
**Accent**: `--accent: #DC2626` (red-600), `--accent-bg: #FEF2F2`

### Before

Red ministry-header (`#b91c1c`) — the previous design was already red,
but mixed with orange "tax-badge" and the amber reason-box. Inconsistent.

### After

Consistent red accent throughout. Red corner triangle. Red "ม.86/10
ป.รัษฎากร" legal badge. Red-bordered reference-box with the **literal**
"ออกอ้างอิงใบกำกับภาษีเลขที่" reference line preserved (required by
ม.86/10). Reason-box kept in amber (distinguished from accent — auditors
expect the reason to stand out). Grand-total row keeps the
`(ลดยอด)` prefix.

### Compliance anchors preserved

- "ออกอ้างอิงใบกำกับภาษีเลขที่ {{ORIGINAL_INVOICE_NUMBER}}" line
- "เหตุที่ออกใบลดหนี้" reason block
- "ใบลดหนี้" + "CREDIT NOTE" + "ม.86/10" badges
- "(ลดยอด)" prefix on grand-total row
- PLATFORM single-issuer (no DTAM identity, no `0994000036540` literal)

### Placeholders preserved

- `{{ISSUER_*}}`, `{{ORIGINAL_INVOICE_NUMBER}}`, `{{ORIGINAL_INVOICE_DATE}}`
- `{{REASON}}`, `{{DOC_NUMBER}}`, `{{RECEIPT_NUMBER_TH}}`, `{{ISSUE_DATE_TH}}`, `{{YEAR_BE_TH}}`
- `{{PAYER_NAME}}`, `{{PAYER_TAX_ID_TH}}`, `{{PAYER_ADDRESS}}`
- `{{TAX_ITEMS_ROWS}}`, `{{SUBTOTAL_TH}}`, `{{VAT_TH}}`, `{{TOTAL_TH}}`
- `{{TOTAL_AMOUNT_TEXT}}`, approver fields

### Token variables

`--accent #DC2626 | --accent-strong #B91C1C | --accent-bg #FEF2F2 | --accent-border #FECACA`

---

## 7. Debit Note (`debit-note.html`) — BLUE

**Path**: `apps/backend/services/pdf/templates/debit-note.html`
**Accent**: `--accent: #2563EB` (blue-600), `--accent-bg: #EFF6FF`

### Before

Blue ministry-header (`#1d4ed8`) but mixed with orange tax-badge and
amber reason-box. Inconsistent like the credit note.

### After

Consistent blue accent. Blue corner triangle. Blue "ม.86/9 ป.รัษฎากร"
legal badge. Same reference-box / reason-box pattern as credit note for
visual parity. Grand-total keeps `(เพิ่มยอด)` prefix.

### Compliance anchors preserved

- "ออกอ้างอิงใบกำกับภาษีเลขที่ {{ORIGINAL_INVOICE_NUMBER}}" line
- "เหตุที่ออกใบเพิ่มหนี้" reason block
- "ใบเพิ่มหนี้" + "DEBIT NOTE" + "ม.86/9" badges
- "(เพิ่มยอด)" prefix on grand-total row
- PLATFORM single-issuer (no DTAM identity)

### Token variables

`--accent #2563EB | --accent-strong #1D4ED8 | --accent-bg #EFF6FF | --accent-border #BFDBFE`

---

## Service contract — no new placeholders required

The redesign reuses ALL existing placeholders populated by
`apps/backend/services/pdf/invoice-template-service.js`. No new
substitution keys added — the visual change is pure CSS + HTML
restructure. This keeps `invoice-template-service.js` unchanged for B21-B.

## Tests — all passing

```
PASS apps/backend/__tests__/unit/credit-note-pdf-template.test.js
PASS apps/backend/__tests__/unit/invoice-template-single-issuer.test.js
PASS apps/backend/__tests__/unit/invoice-template-thai-numerals.test.js
PASS apps/backend/__tests__/unit/invoice-template-issuer-wiring.test.js

Test Suites: 4 passed, 4 total
Tests:       49 passed, 49 total
```

Single test helper updated to match the renamed `issuer-detail-box`
wrapper class (was `tax-info-box`); regex falls back to the legacy class
name so spec fixtures keep resolving:

```
apps/backend/__tests__/unit/invoice-template-issuer-wiring.test.js
  function extractIssuerDivStripped() {
    const divMatch = html.match(
      /<div class="(?:issuer-detail-box|tax-info-box)">[\s\S]*?<\/div>\s*<\/div>/,
    );
  }
```

## Compliance preservation matrix

| Rule | Source | Where enforced |
|------|--------|----------------|
| One document = one seller | ม.86 ป.รัษฎากร (B17) | All 7 templates use `{{ISSUER_*}}` from canonical config |
| Full tax invoice = VAT-registered seller only | ม.86/4 ป.รัษฎากร | `tax-invoice.html` has no DTAM row, no Wallet A/B |
| Government revenue VAT-exempt | ม.77/1 (10) + กฎกระทรวงการคลัง | `government-revenue-receipt.html` has no VAT row, has VAT-exempt note |
| Amount in Thai script | ม.86/4 (5) ป.รัษฎากร | `{{TOTAL_AMOUNT_TEXT}}` preserved on all templates |
| Credit-note reference required | ม.86/10 ป.รัษฎากร | "ออกอ้างอิงใบกำกับภาษีเลขที่" preserved |
| Debit-note reference required | ม.86/9 ป.รัษฎากร | "ออกอ้างอิงใบกำกับภาษีเลขที่" preserved |
| Auto-sign approver in pre-image | B16-D ISO 27799 §7.2.3 | `{{APPROVER_*}}` placeholders preserved on all auto-signed templates |
| Thai numerals on visible body | B16-D | `{{*_TH}}` placeholders preserved |
| ASCII grep references in footer | B16-D | ASCII `{{DOC_NUMBER}}` / `{{ISSUE_DATE}}` in footer of each template |

---

## Tier 22 update — trade-dress fix (2026-05-16)

### Owner concern

The B21-B redesign copied FlowAccount.com's visual identity too closely.
Two distinctive elements were the trade-dress risk:

1. **Diagonal coloured corner triangle** (`clip-path: polygon(0 0, 100% 0, 100% 100%)`)
   in the top-right of every page — FlowAccount's signature element.
2. **Centred logo inside the signature block** with two signature lines on
   either side — FlowAccount's distinctive signature pattern.

The pre-B21-B FlowAccount-grade vocabulary in code comments (e.g.
"FlowAccount visual cue") also overstated the intentional similarity.

### Replacement direction (B22-B = Direction 3, typographic chip)

1. **No coloured shape on the page edges.** Page number is plain text
   (`หน้า 1 / 1`) anchored at `top: 12mm; right: 12mm`, in
   `var(--text-soft)` with the page-number digit in `var(--accent-strong)`.
2. **No centred logo in the signature row.** The two signer columns sit
   in a flex container with a wide 60px gap between them — pure whitespace.
3. **Document type rendered as a rounded chip** inline with the Thai
   title. The chip uses the document's `--accent-bg` background,
   `--accent-strong` text, and `--accent-border` border. The chip is a
   pill (`border-radius: 14px`), not a flat rectangle.
4. **Signature block uses whitespace instead of decorative markers** —
   `align-items: stretch` with a wider `gap: 60px` so the two columns
   remain visually balanced without needing a central element.

### New colour palette (B22-A finalising)

If `apps/web-app/src/lib/design/finance-tokens.json` has not been updated
to the B22-A palette by the time the PDF renderer reads it, these values
are embedded directly in the per-template CSS variables. B22-A will
reconcile the JSON tokens in a separate change.

| Document | Accent (var --accent) | Strong | Soft (bg) | Border |
|----------|----------------------|--------|-----------|--------|
| Invoice / Billing Note | Forest green `#15803D` | `#166534` | `#F0FDF4` | `#BBF7D0` |
| Quotation | Warm earth `#B45309` | `#92400E` | `#FFFBEB` | `#FCD34D` |
| Receipt (Platform) | Deep teal `#0F766E` | `#115E59` | `#F0FDFA` | `#99F6E4` |
| Tax Invoice | Slate `#475569` | `#334155` | `#F8FAFC` | `#CBD5E1` |
| Government Revenue Receipt | Royal indigo `#3730A3` + Gold `#B45309` | `#312E81` | `#EEF2FF` | `#C7D2FE` (gold chip border `#FCD34D`) |
| Credit Note | Burgundy `#9F1239` | `#881337` | `#FFF1F2` | `#FECDD3` |
| Debit Note | Navy `#1E3A8A` | `#1E40AF` | `#EFF6FF` | `#C7D2FE` |

The palette is rotated away from FlowAccount's purple / orange / green
hue cluster. The new colours reflect the medicinal-plant + state-authority
context of GACP: forest green for commercial billing, slate for the most
formal commercial tax document, royal indigo for the government revenue
side, and warm earth / burgundy / navy for the remaining commercial types.

### Updated mockups (replacing the corner-triangle illustrations)

#### Receipt (deep teal) — before vs after

**Before (B21-B):**

```
+--------------------------------------------------+
| [Logo]                              ###########  |
| ผู้ออก (Predictive AI...)              ###########  |  <- diagonal
| Tax ID / Address                       ###  green |     triangle
|                                                   |
| ใบเสร็จรับเงิน              +-------------------+ |
| ต้นฉบับ / ORIGINAL          | เลขที่: ...       | |
| RECEIPT                     | วันที่: ...       | |
| [ ชำระแล้ว / PAID ]          +-------------------+ |
|     :                             :               |
|  ---------    [LOGO]    ---------                 |
|  ผู้รับเงิน  ←centred-logo→ ผู้ชำระเงิน              |  <- FlowAccount
+---------------------------------------------------+     signature row
```

**After (B22-B):**

```
+--------------------------------------------------+
| [Logo]                              หน้า 1 / 1   |  <- plain text
| ผู้ออก (Predictive AI...)                            |     no shape
| Tax ID / Address                                  |
|                                                   |
| ใบเสร็จรับเงิน [RECEIPT] ต้นฉบับ +-----------------+|
|                                  | เลขที่: ...    ||
| [ ชำระแล้ว / PAID ]               | วันที่: ...    ||
|                                  +-----------------+|
|     :                             :               |
|  ---------                          ---------     |  <- whitespace
|  ผู้รับเงิน                            ผู้ชำระเงิน   |     gap, no
|  (โดย ระบบ)                          ผู้ชำระ        |     centre logo
+---------------------------------------------------+
```

The chip `[RECEIPT]` is the new typographic element — a deep-teal-toned
pill border, NOT a coloured shape on the page edge.

#### Government Revenue Receipt (royal indigo + gold) — before vs after

**Before (B21-B):**

```
+--------------------------------------------------+
| [Garuda]                            ###########  |
| กรมการแพทย์แผนไทย...                  ###########  |  <- diagonal
| Tax ID / Address                       ## indigo |     triangle
|                                                   |
| ใบเสร็จเงินรายได้แผ่นดิน     +-------------------+ |
| แบบ ก.ค.32 / ต้นฉบับ          | เลขที่ ก.ค.32:    | |
| GOVERNMENT REVENUE RECEIPT  | วันที่: ...       | |
| [ ชำระแล้ว / PAID ]          +-------------------+ |
|     :                             :               |
|  ---------    [LOGO]    ---------                 |
|  ผู้รับเงิน  ←centred-logo→ ผู้ชำระเงิน              |
+---------------------------------------------------+
```

**After (B22-B):**

```
+--------------------------------------------------+
| [Garuda]                            หน้า 1 / 1   |
| กรมการแพทย์แผนไทย...                                 |
| กระทรวงสาธารณสุข / Address                          |
|                                                   |
| ใบเสร็จเงินรายได้แผ่นดิน                              |
|   [GOVERNMENT REVENUE RECEIPT]  ←chip with        |
|                                  gold border      |
|   แบบ ก.ค.32 / ต้นฉบับ                              |
|                                                   |
| [ ชำระแล้ว / PAID ]                                  |
|     :                             :               |
|  ---------                          ---------     |
|  ผู้รับเงิน (เจ้าหน้าที่)              ผู้ชำระเงิน    |
|                                                   |
|  หมายเหตุ: รายได้แผ่นดินยกเว้น VAT                   |
+---------------------------------------------------+
```

The government receipt chip has a 1.5px GOLD border (`#FCD34D`) atop the
indigo-toned interior — a traditional Thai pairing that signals state
authority without copying any commercial trade dress.

### Removed CSS

```diff
- .corner-accent {
-   position: absolute; top: 0; right: 0;
-   width: 70px; height: 70px;
-   background: var(--accent);
-   clip-path: polygon(0 0, 100% 0, 100% 100%);
-   color: #fff;
-   display: flex; align-items: flex-start; justify-content: flex-end;
-   padding: 10px 14px 0 0;
-   font-weight: 700; font-size: 13px; letter-spacing: 0.5px;
- }
```

### Added CSS (B22-B canonical block)

```css
.page-indicator {
  position: absolute;
  top: 12mm; right: 12mm;
  font-size: 10.5px;
  font-weight: 500;
  color: var(--text-soft);
  letter-spacing: 0.3px;
}
.page-indicator strong {
  color: var(--accent-strong);
  font-weight: 700;
}

.doc-title-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 4px;
}
.doc-title {
  font-size: 26px;
  font-weight: 700;
  color: var(--accent);
  line-height: 1.15;
}
.doc-type-chip {
  display: inline-block;
  padding: 4px 12px;
  background: var(--accent-bg);
  color: var(--accent-strong);
  border: 1px solid var(--accent-border);
  border-radius: 14px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
.doc-subtitle {
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 500;
  letter-spacing: 0.5px;
}
```

### Tests after Tier 22

```
PASS apps/backend/__tests__/unit/invoice-template-thai-numerals.test.js
PASS apps/backend/__tests__/unit/invoice-template-single-issuer.test.js
PASS apps/backend/__tests__/unit/invoice-template-issuer-wiring.test.js
PASS apps/backend/__tests__/unit/credit-note-pdf-template.test.js

Test Suites: 4 passed, 4 total
Tests:       49 passed, 49 total
```

No test files asserted on the removed `.corner-accent` class — the
template tests had focused on Thai legal-text and placeholder coverage,
not on the trade-dress accent. No assertions had to change.

### Preservation matrix (Tier 22)

| Behaviour | Status after Tier 22 |
|-----------|----------------------|
| All `{{...}}` placeholders kept verbatim | preserved |
| Single-issuer rule (tax-invoice has no GOV_FEE row) | preserved |
| Thai numerals (`{{*_TH}}`) on visible body | preserved |
| Approver block (B16-D) | preserved |
| Credit Note "ออกอ้างอิงใบกำกับภาษีเลขที่" reference | preserved |
| Government Revenue Receipt ก.ค.32 structure | preserved |
| Government Revenue Receipt VAT-exempt note | preserved |
| Diagonal corner triangle (`.corner-accent`) | REMOVED — replaced by `.page-indicator` |
| Centred logo in signature block | REMOVED — replaced by 60px whitespace gap |
| B21-A palette (purple / orange / green ...) | REPLACED with B22-A palette (see table above) |
