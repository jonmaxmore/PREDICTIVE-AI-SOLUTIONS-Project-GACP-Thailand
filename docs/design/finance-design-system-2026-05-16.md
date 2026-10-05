> ## ⚠️ เอกสารนี้บันทึกโมเดลที่เลิกใช้แล้ว (ปักป้าย 2026-09-05)
>
> ระบบสีและผังเอกสารด้านล่างเขียนขึ้นภายใต้โมเดล **ผู้ออกเอกสารสองราย** — โดยเฉพาะ
> "Govt revenue receipt (DTAM) · ใบเสร็จเงินรายได้แผ่นดิน" ที่บรรทัด 47 ซึ่งระบุว่าเป็น
> *different legal entity, different revenue rules (VAT-exempt)* · มติ W14 (2026-08-22) ยกเลิกใบนี้
> จุดยืนปัจจุบัน: **บริษัทเป็นผู้ออกเอกสารรายเดียว เก็บ VAT 7% บนค่าบริการทั้งก้อน ไม่มีส่วนใดยกเว้นภาษี**
>
> เก็บไว้อ่านเป็นบันทึกประวัติ — **อย่านำผังเอกสาร ชุดสี หรือข้อสรุปทางภาษีในนี้ไปใช้**
> แบบปัจจุบันอยู่ที่ `docs/design/2026-09-05-finance-documents-design.md`
> · โมเดลค่าธรรมเนียมอยู่ที่ `docs/architecture/fee-model-2026-09-05.md`

# GACP Finance Design System — 2026-05-16

**Owner:** Tanai Digital Platform / Predictive AI Solution Co., Ltd.
**Reference:** FlowAccount.com (Thai SME accounting cloud)
**Scope:** 7 PDF templates under `apps/backend/services/pdf/templates/` + the
finance dashboards under `apps/web-app/src/app/provider/accounting/*` and
`apps/web-app/src/app/health/billing/*`.
**Status:** Specification only — no source files modified. Implementation will
be staged per the roadmap in Section 6.
**Compliance anchor:** ม.86 + ม.86/4 ป.รัษฎากร — *one document, one issuer.*
The color system extends that principle: *one color, one document type.*

---

## 0. Why FlowAccount

FlowAccount is the gold-standard Thai SME accounting cloud. It has solved two
problems we keep colliding with:

1. **Doc-type at a glance** — every FlowAccount document has a single dominant
   accent color (purple = invoice, orange = quote, green = receipt) and a
   triangular corner mark with the page number. Auditors and applicants can
   tell what they are holding from across the room.
2. **Calm density** — the body uses a single body font (Sarabun), light row
   borders only (no full grid), right-aligned muted totals with a single bold
   grand-total line, and an A4 page that breathes. We currently use heavy green
   table headers, double-bordered boxes, full grids, and dashed acceptance
   panels — visually it looks like 2014.

The owner directive: *match FlowAccount's clarity, keep our compliance content.*

---

## 1. Color Tokens — one accent per document type

All colors are also serialised in
`apps/web-app/src/lib/design/finance-tokens.json` for code consumption.

| Doc | Thai name | Accent | Hex | Tailwind | Soft bg | Why |
|---|---|---|---|---|---|---|
| **Invoice / Billing note** | ใบวางบิล/ใบแจ้งหนี้ | **Purple** | `#7E22CE` | `purple-700` | `#FAF5FF` | Direct FlowAccount match — the canonical billing color in Thai SME cloud. |
| **Quotation** | ใบเสนอราคา | **Orange** | `#EA580C` | `orange-600` | `#FFF7ED` | FlowAccount match. Currently we render quotes in `#0369a1` blue — collides with debit-note blue. |
| **Receipt (platform)** | ใบเสร็จรับเงิน | **Green** | `#16A34A` | `green-600` | `#F0FDF4` | FlowAccount match. Existing template already uses `#1a5c38` deep green — recommend lightening to FlowAccount's brighter green to avoid being read as "DTAM/ministry" green. |
| **Tax invoice** | ใบกำกับภาษี | **Teal** | `#0D9488` | `teal-600` | `#F0FDFA` | New color slot. Distinct from receipt-green so VAT-registered invoices are unmistakable from cash receipts. |
| **Credit note** | ใบลดหนี้ | **Red** | `#DC2626` | `red-600` | `#FEF2F2` | Already used in `credit-note.html` (`#b91c1c`) — keep, brighten one shade. |
| **Debit note** | ใบเพิ่มหนี้ | **Blue** | `#2563EB` | `blue-600` | `#EFF6FF` | Already used in `debit-note.html` (`#1d4ed8`) — keep. |
| **Govt revenue receipt (DTAM)** | ใบเสร็จเงินรายได้แผ่นดิน | **Indigo + Gold** | `#3730A3` + `#B45309` | `indigo-800`/`amber-700` | `#EEF2FF` | Government-formal palette. Distinct from PLATFORM green-receipt to signal *different legal entity, different revenue rules (VAT-exempt).* |

Each token has six derivatives in `finance-tokens.json`:
`text`, `titleColor`, `accent`, `accentSoft`, `accentBorder`, `totalsBold`,
`totalsBg`, `tableHeadBg`, `tableHeadFg`. The PDF service can look up the doc
type and inject the corresponding hex into the template's CSS variables.

**Neutrals** (shared across all documents):

| Token | Hex | Tailwind | Use |
|---|---|---|---|
| `ink` | `#111827` | `slate-900` | Primary body text |
| `text` | `#1f2937` | `gray-800` | Section body |
| `textMuted` | `#4b5563` | `gray-600` | Issuer block lines 2–4 |
| `label` | `#6b7280` | `gray-500` | Field labels (lbl) |
| `subtle` | `#9ca3af` | `gray-400` | Footer fine-print |
| `border` | `#e5e7eb` | `gray-200` | Light row dividers |
| `borderStrong` | `#d1d5db` | `gray-300` | Box outlines |
| `surfaceAlt` | `#f9fafb` | `gray-50` | Even-row stripe / payer-box bg |

---

## 2. Typography

| Role | Family | Size | Weight | Notes |
|---|---|---|---|---|
| Display font | **Sarabun** + Noto Sans Thai + Tahoma | — | — | Already loaded across every template. |
| Document title (e.g. `ใบวางบิล/ใบแจ้งหนี้`) | Sarabun | **24–28px** | 800 | Color = `palette.titleColor`. Today we render at 16px in a green pill — too small. |
| Subtitle (`ต้นฉบับ`, `QUOTATION`, etc.) | Sarabun | 12px | 400 | Muted `#6b7280`. |
| H2 / box headings (`ผู้รับบริการ`, `วิธีชำระเงิน`) | Sarabun | 16px | 700 | Color = `palette.text`. |
| Field label (`ชื่อ-นามสกุล`, `ที่อยู่`) | Sarabun | 11px | 700 | UPPERCASE-CASE styling with `letter-spacing: 0.5px`. |
| Body | Sarabun | **13px** | 400 | `line-height: 1.6`. |
| Items-table body | Sarabun | 12.5px | 400 | Tabular nums on monetary cells. |
| Grand-total line | Sarabun | 14px | 800 | Color = `palette.totalsBold`. |
| Amount-in-words | Sarabun | 12px | 400 | Lives in a `surfaceAlt` strip with a 4px `accent` left border. |
| Footer fine-print | Sarabun | 10.5px | 400 | Color = `subtle` `#9ca3af`. |

---

## 3. Layout grid

**Page:** A4 portrait, padding `20mm 18mm` (matches existing
`tax-invoice.html`). Print override: `14mm 12mm`.

**12-column body grid.** Major regions:

```
┌─────────────────────────────────────────────────────┐
│  Issuer block (cols 1-6)  │  Title + meta (cols 7-12) │  ← header (top 22 %)
│  GARUDA  Tanai Digital Pltf│  ┌─────────────┐ #ACCENT │
│  Tax-ID / address / phone  │  │  TITLE 24px │  CORNER │
│                            │  └─────────────┘  TRIAN. │
├─────────────────────────────────────────────────────┤
│  Customer / payer box (full width, surfaceAlt bg)    │
├─────────────────────────────────────────────────────┤
│  Items table (full width)                            │
│  ┌── thead: ACCENT bg, white fg ──────────────────┐ │
│  │ # 5% │ Desc 35% │ Qty 10% │ Unit 15% │ Disc 10% │ Total 25% │
│  └────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────┤
│                              Totals block (right) 320px
│                              Subtotal       muted    │
│                              VAT 7%         orange   │
│                              ════════════════════    │
│                              Grand total    ACCENT 14px 800
├─────────────────────────────────────────────────────┤
│  Amount-in-words strip (4px accent left border)      │
├─────────────────────────────────────────────────────┤
│  Notes / payment-info / signature blocks             │
└─────────────────────────────────────────────────────┘
│  Doc-footer (subtle text, doc # + issue date)        │
```

**Items-table columns (default invoice/receipt style):**

| Col | Header | Width | Align |
|---|---|---|---|
| 1 | `#` | 5 % | left |
| 2 | `รายละเอียด` | 35 % | left |
| 3 | `จำนวน` | 10 % | right |
| 4 | `ราคาต่อหน่วย` | 15 % | right |
| 5 | `ส่วนลด` | 10 % | right |
| 6 | `มูลค่า` | 25 % | right |

**Tax-invoice / credit-note / debit-note style** drops `ส่วนลด` in favor of a
`VAT` column (see `itemsTable.columnsTaxInvoiceStyle` in the JSON).

---

## 4. Component patterns

The dashboard / future React component library should expose these primitives
in `apps/web-app/src/components/finance/*`:

### 4.1 `<DocumentHeader>`
Renders issuer (left) + document title + metadata box (right). Accepts
`{ issuerName, taxId, address, phone, docType, docNumber, dates }`. Looks up
color from `finance-tokens.json` by `docType`.

### 4.2 `<CornerAccent>`
The FlowAccount triangular corner with white page number. Absolute-positioned
to the top-right of the document body, behind the title. SVG shape (120×120 px
right triangle). Today none of our templates have this — adding it gives every
doc an unmistakable "FlowAccount feel" in one change.

### 4.3 `<MetadataBox>`
Light pastel rounded box top-right of the title that holds
`เลขที่ / วันที่ / ครบกำหนด / ผู้ขาย`. Background = `palette.accentSoft`,
border = `palette.accentBorder`.

### 4.4 `<PayerBox>`
The customer block. Background `surfaceAlt`, border `borderStrong`,
2-column grid for name/tax-id/address.

### 4.5 `<ItemsTable>`
Header row uses `palette.tableHeadBg/Fg`. Row stripes use `surfaceAlt`. Light
row borders only — drop the full grid currently rendered.

### 4.6 `<TotalsBlock>`
Right-aligned, 320 px wide. Subtotal & VAT rows muted; VAT row keeps the
orange highlight from `tax-invoice.html` (informative — VAT is always the
audit hot-spot). Grand total bold 14 px in `palette.totalsBold` with
double-rule top/bottom in the accent color.

### 4.7 `<AmountInWords>`
Thai-script amount in parens. Lives in a single-line strip with a 4 px left
border in the accent color (already established in existing templates).

### 4.8 `<SignatureFooter>`
Dual signature columns (left = customer accept, right = issuer authorised
officer). Optional centered issuer logo. Replaces our current single right-
aligned signature on `invoice.html` / `receipt.html`.

### 4.9 `<StatusBadge>`
Rounded pill `radii.pill`. Tokens in `status.*`:
`DRAFT / PENDING / AWAITING_PAYMENT / PAID / OVERDUE / CANCELLED / REFUNDED`.
Currently the dashboard uses ad-hoc Tailwind classes.

### 4.10 `<FilterBar>` & `<FilterChip>`
Dropdown + multi-select status + apply button + active-chip row. The active
chips have an `×` removal affordance — match FlowAccount's screenshot 5 exactly.

### 4.11 `<SummaryCard>`
Top-right grand-total card on the dashboard. White surface, 16 px radius,
1 px gray-200 border, 20 px padding, totals right-aligned with the grand
total in `teal-600` 24 px bold.

---

## 5. Dashboard patterns

For `/provider/accounting`, `/provider/accounting/ar-aging`,
`/provider/accounting/reports/*`, and `/health/billing`.

### 5.1 Toolbar (top-right)

| Button | Token | Icon |
|---|---|---|
| **ดาวน์โหลด Excel** | secondary | `IconFileSpreadsheet` |
| **พิมพ์รายงาน** | secondary | `IconPrinter` |
| **รีเฟรช** | secondary | `IconRefresh` |
| **แสดงผล** (apply filters) | primary teal | — |

Today `AccountingDashboard` has an export-menu dropdown but no print or
refresh buttons in the FlowAccount toolbar style.

### 5.2 Filter row (above table)
Month / period dropdown · status multi-select chips · apply button. Below it,
a horizontal scrolling row of active filter chips with `×` removal. Chip
tokens in `dashboard.filterChip`.

### 5.3 Summary card (top-right)
4–5 line right-aligned summary:
```
บริษัท ตัวอย่าง จำกัด
ณ วันที่ 16 พฤษภาคม 2569
ช่วงเวลา 1–31 พฤษภาคม 2569
จำนวนทั้งหมด 13 เอกสาร
─────────────────────
ยอดรวมทั้งสิ้น   22,000.00  (teal-600, 24px, 800)
ภาษีมูลค่าเพิ่ม   1,400.00
ยอดรวมก่อนภาษี   20,600.00
```
Currently `revenue-summary-cards.tsx` renders 4 cards side-by-side — we keep
those cards but add this consolidated card to the top-right of the report.

### 5.4 Tab navigation
Underline tabs (no pill background). Active = teal underline + teal fg.
Count badges = neutral gray-100 / gray-700 pills. The existing dashboard
already uses `Tabs` from `@/components/ui/primitives/tabs` — wire the count
badge into the trigger.

### 5.5 Data table

| Pattern | Spec |
|---|---|
| Header row | gray-50 bg, gray-700 fg, 12 px semibold |
| Link cells (เลขที่เอกสาร) | teal-600, underline-on-hover, `IconExternalLink` 14 px |
| Monetary cells | right-aligned, `tabular-nums`, 13 px |
| Status column | sits at the right end of the row |
| Empty state | center, illustration optional, Thai message `ยังไม่มีรายการ` |

### 5.6 Pagination
Bottom-left: `แสดง [20 ▼]` row selector. Bottom-right: subtotal +
VAT mini-totals (so the user can see what the current page sums to).

---

## 6. Implementation roadmap

### Phase 1 — PDF color tokens (1–2 days, contained to 7 HTML files)

For each of `invoice.html`, `quotation.html`, `receipt.html`,
`tax-invoice.html`, `credit-note.html`, `debit-note.html`,
`government-revenue-receipt.html`:

1. Replace the hardcoded hex colors in `<style>` with values from
   `finance-tokens.json` (single sed replacement per template — no logic
   changes).
2. Add a `<svg>` corner-accent SVG (120 × 120 px right triangle) positioned
   `absolute; top: 0; right: 0;` inside `body`. Number inside is the page #
   (defaults to `1`).
3. Promote the document title from a 16 px pill to a 24 px heading +
   subtitle.
4. Drop the green table-header background from non-receipt docs to match
   each doc's accent color (already true for credit/debit notes; needs to
   change for invoice/quotation/receipt/tax-invoice).
5. Soften items-table from full grid → bottom borders only.

**No service code, no Prisma, no placeholder-name changes.** Pre-existing
template variables (`{{DOC_NUMBER}}`, `{{ISSUER_NAME_TH}}`, etc.) keep their
exact spelling.

### Phase 2 — Dashboard component refresh (3–5 days)

1. Build `<FilterBar>`, `<FilterChip>`, `<SummaryCard>`, `<StatusBadge>` in
   `apps/web-app/src/components/finance/`. Existing pages keep working
   because the new components are opt-in.
2. Wire the toolbar (Excel + Print + Refresh) onto:
   - `/provider/accounting/page.tsx`
   - `/provider/accounting/ar-aging/page.tsx`
   - `/provider/accounting/reports/*Statement.tsx`
3. Migrate `revenue-summary-cards.tsx` to feed the new `<SummaryCard>` as
   the top-right consolidated card while keeping the existing 4-card row.
4. Standardise tab + badge pattern across the four dashboard surfaces.

### Phase 3 — Optional polish (later)

- `<DocumentHeader>` / `<ItemsTable>` / `<TotalsBlock>` React components so
  the future "view in browser before download" feature can re-render
  invoices client-side from JSON without a PDF roundtrip.
- e-Tax Invoice e-Signature integration with กรมสรรพากร (RD) — see Section 8
  for why this is out of scope today.
- Empty-state illustrations.

---

## 7. Design tokens JSON

Authoritative source: **`apps/web-app/src/lib/design/finance-tokens.json`**.
The PDF template service (`invoice-template-service.js`) and any future
React finance component should look up `documentTypes[KEY].palette` rather
than hardcoding hex values. The JSON also carries:

- `typography.scale.*` — title / subtitle / body / footer sizes
- `page.margins` — A4 portrait 20 mm / 18 mm
- `itemsTable.columnsInvoiceStyle` + `columnsTaxInvoiceStyle` — column
  widths & alignments
- `status.*` — pill bg/fg/border for the 7 document statuses
- `aging.*` — 5 aging bucket colors for `<ArAgingReport>`
- `dashboard.*` — toolbar / filter chip / summary card / tabs / table tokens

---

## 8. Feasibility verdict — *can we build this?*

| Item | Buildable? | Notes |
|---|---|---|
| Color tokens applied to 7 PDF templates | **Yes** | Pure CSS swap. No service / Prisma changes. |
| Corner-accent triangle on every document | **Yes** | SVG, no font-icon dependency. |
| Document title at 24 px in accent color | **Yes** | Template-only change. |
| FilterBar + FilterChip on dashboard | **Yes** | Standard React; uses existing `@/components/ui/primitives/*`. |
| Toolbar (Excel + Print + Refresh) | **Yes** | Excel and CSV endpoints already exist; print is `window.print()`. |
| Summary card top-right | **Yes** | Existing `RevenueSummaryCards` already fetches the totals. |
| StatusBadge token system | **Yes** | Drop-in replacement for the ad-hoc Tailwind status classes. |
| Tab navigation with count badges | **Yes** | Existing `Tabs` primitive supports children. |
| Pagination + row selector | **Yes** | Existing `Table` primitive needs a `pageSize` prop wired through (small lift). |
| AR-aging coloring | **Yes** | `BUCKET_TONE` already exists in `ArAgingReport.tsx` — re-map to the canonical `aging.*` tokens. |
| **e-Tax Invoice e-Signature → RD** | **No (out of scope)** | FlowAccount has an integration with กรมสรรพากร's e-Tax system. We currently auto-sign with RSA inside the template body but do not transmit to RD. Roadmap item for FY2027. |
| **OCR slip scanning (AutoKey-equivalent)** | **No (out of scope)** | FlowAccount's AutoKey OCR for expense receipts is a separate product surface. We accept slip uploads but do not OCR the bank reference. |
| **Bank reconciliation (กระทบยอดธนาคาร)** | **Partial** | We have manual slip review but no automated bank statement import. |
| **e-commerce + POS connectivity (Shopee/Lazada/TikTok)** | **No** | Not applicable to a certification platform. Explicitly out of scope. |
| **Payroll integration** | **No** | Out of platform scope. |

**Verdict.** Phase 1 (color/title/corner-accent on 7 templates) is a pure
CSS lift — ship in 1–2 days with no risk to the existing template variable
contract. Phase 2 (dashboard) requires React work but every piece lives
inside `apps/web-app/src/components/finance/*` and is opt-in per dashboard
surface. Phase 3 features that depend on external integrations (RD e-Tax,
bank import, OCR) are deferred.

The single biggest visual win, ranked by effort/payoff:

1. **Corner-accent triangle + 24 px accent-colored title on all 7
   templates** — turns the entire document family from "default green LaTeX
   look" to "FlowAccount-equivalent" with one CSS pass.
2. **Toolbar + FilterBar + SummaryCard on `/provider/accounting`** — makes
   the accountant's daily screen feel like FlowAccount's sales summary.
3. **StatusBadge + aging-bucket token system** — fixes a real production
   problem (status colors are inconsistent across pages) while moving us to
   the canonical palette.
