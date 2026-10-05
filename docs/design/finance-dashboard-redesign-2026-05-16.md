# Finance Dashboard Redesign — FlowAccount-Style (B21-C)

**Tier**: 21 (UI Polish + Compliance)
**Author**: B21-C dashboard engineer
**Date**: 2026-05-16
**Status**: Implementation complete (TypeScript passes `tsc --noEmit`)

This document records the FlowAccount-derived visual redesign of
all finance-team pages in the GACP web application. It accompanies
(but does NOT override) the upstream foundation in
`docs/design/finance-design-system-2026-05-16.md` (B21-A — design
tokens) and the PDF specification in `docs/design/pdf-samples-2026-05-16.md`
(B21-B — Wkhtmltopdf templates).

The owner referenced FlowAccount's "รายงานสรุปยอดขาย" screen as
the gold standard: a sticky title-and-actions toolbar, an inline
filter row with removable chips, a meta-plus-totals summary card,
parenthesized count tabs, rounded-pill status badges, and a clean
row-divider data table.

---

## 1. Pages touched

| # | Route | Component file | Change |
|---|-------|----------------|--------|
| 1 | `/provider/accounting` | `apps/web-app/src/app/provider/accounting/page.tsx` | Replaced `SummaryHeader` with `PageToolbar` + `SummaryCard`. Stat cards downsized to FlowAccount density. `Tabs` primitive swapped for new `TabNav`. Filter chips moved into `FilterBar`. Inline status badges now use shared `StatusBadge`. |
| 2 | `/provider/accounting/reports` | `apps/web-app/src/app/provider/accounting/reports/client-view.tsx` | `SummaryHeader` → `PageToolbar`. Desktop tab strip → `TabNav`. Mobile tab `<select>` retained. |
| 3 | (sub) Trial Balance | `…/reports/TrialBalanceTable.tsx` | Inline toolbar div → `PageToolbar` + `FilterBar`+`FilterField`. CSV → "ดาวน์โหลด Excel". Print → "พิมพ์รายงาน" (primary). |
| 4 | (sub) P&L | `…/reports/ProfitAndLossStatement.tsx` | Same treatment. |
| 5 | (sub) Balance Sheet | `…/reports/BalanceSheetStatement.tsx` | Same treatment. |
| 6 | (sub) General Ledger | `…/reports/GeneralLedgerViewer.tsx` | Same treatment. Account-picker + date range now live inside the FilterBar. |
| 7 | (sub) Output VAT | `…/reports/OutputVatReport.tsx` | Same treatment. |
| 8 | AR Aging | `…/reports/ArAgingReport.tsx` | Toolbar replaced. Bucket cards re-styled as rounded-2xl finance cards. Grand-total panel now uses brand teal accent. Detail table re-styled with FlowAccount-pattern rows + shared `StatusBadge`. |
| 9 | AR Aging page | `/provider/accounting/ar-aging/page.tsx` | Removed `SummaryHeader` wrapper — toolbar now lives inside `ArAgingReport`. Slim back-link header added. |
| 10 | Customer statement | `/health/billing/client-view.tsx` | Header re-built with `PageToolbar` + shared `SummaryCard`. Local `SummaryCard` helper removed. Status pills migrated to shared `StatusBadge`. Application picker chips re-coloured to brand teal. Per-app invoice table re-styled. |

Files explicitly **not** touched (per file-boundary policy):
- `apps/backend/**` (B21-B PDF templates)
- `prisma/schema.prisma`
- `docs/design/finance-design-system-2026-05-16.md` (B21-A)
- `apps/web-app/src/lib/design/finance-tokens.json` (B21-A)

---

## 2. Shared component library

All new components live under
`apps/web-app/src/components/finance/`. They are re-exported via
the barrel `apps/web-app/src/components/finance/index.ts`.

```text
apps/web-app/src/components/finance/
├── DataTable.tsx        # DataTable + TableFooter
├── DocumentLink.tsx     # DocumentLink
├── FilterBar.tsx        # FilterBar + FilterField
├── PageToolbar.tsx      # PageToolbar
├── StatusBadge.tsx      # StatusBadge
├── SummaryCard.tsx      # SummaryCard
├── TabNav.tsx           # TabNav
└── index.ts             # barrel exports
```

### 2.1 `<PageToolbar />`

Sticky-able header card with title + optional eyebrow/subtitle and
a right-aligned row of action buttons. Buttons auto-collapse to
icon-only on mobile.

```tsx
<PageToolbar
  eyebrow="ACCOUNTING — REPORTS"
  title="งบทดลอง (Trial Balance)"
  subtitle={`ณ วันที่ ${asOfDate}`}
  actions={[
    { key: 'refresh', label: 'รีเฟรช', icon: <IconRefresh />, variant: 'ghost', onClick: fetch },
    { key: 'csv',     label: 'ดาวน์โหลด Excel', icon: <IconDownload />, variant: 'outline', onClick: csv },
    { key: 'print',   label: 'พิมพ์รายงาน',     icon: <IconPrinter />,  variant: 'primary', onClick: () => window.print() },
  ]}
/>
```

Props:
- `title` (string, required)
- `subtitle` (string)
- `eyebrow` (string) — small uppercase tracking label above title
- `actions` (PageToolbarAction[])
- `sticky` (bool) — adds `sticky top-0 z-20`
- `className` (string)

### 2.2 `<FilterBar />` + `<FilterField />`

Inline filter row plus optional apply button and chip removal row.

```tsx
<FilterBar
  onApply={fetchData}
  applyLabel="แสดงผล"
  chips={[
    { key: 'status', label: 'สถานะ: รอดำเนินการ', onRemove: clear, tone: 'warning' },
  ]}
>
  <FilterField label="เดือน" htmlFor="vat-month">
    <select id="vat-month" …>…</select>
  </FilterField>
</FilterBar>
```

### 2.3 `<SummaryCard />`

Two-column layout: org/meta on the left, stacked totals on the
right. Grand total renders large in brand teal; subtotals are
small + muted.

```tsx
<SummaryCard
  org="บริษัท ตัวอย่าง จำกัด"
  meta={[
    { label: 'ณ วันที่', value: '16 พ.ค. 69' },
    { label: 'ช่วงเวลา', value: 'พ.ค. 2569' },
    { label: 'จำนวนทั้งหมด', value: '13 เอกสาร' },
  ]}
  totals={[
    { label: 'ยอดรวมทั้งสิ้น', value: '22,000.00', emphasis: 'primary' },
    { label: 'ภาษีมูลค่าเพิ่ม', value: '1,400.00',  emphasis: 'muted' },
    { label: 'ยอดรวมก่อนภาษี', value: '20,600.00', emphasis: 'muted' },
  ]}
/>
```

### 2.4 `<StatusBadge />`

Rounded-pill badge keyed by canonical status string. Mapping baked
in for invoice + subscription statuses; falls back to "draft" tone
for unknowns. Label and tone can be overridden.

```tsx
<StatusBadge status="PENDING" />                  // amber "รอดำเนินการ"
<StatusBadge status="PAID"  />                    // emerald "ชำระแล้ว"
<StatusBadge status="CANCELLED" />                // rose "ยกเลิก"
<StatusBadge status="DRAFT" />                    // gray "ร่าง"
<StatusBadge status="PAID" label="ออกใบเสร็จแล้ว" />
<StatusBadge status="HELD" tone="info" />
```

### 2.5 `<DataTable />` + `<TableFooter />`

Thin presentational table wrapper. Columns declare a `type` (link
/ text / date / money / status / custom) and a `render(row, idx)`
function. Money columns auto-right-align and apply `tabular-nums`.

```tsx
<DataTable
  columns={[
    { key: 'num',  header: 'เลขที่เอกสาร', type: 'link', render: r => <DocumentLink number={r.number} /> },
    { key: 'date', header: 'วันที่',       type: 'date', render: r => fmtDate(r.date) },
    { key: 'amt',  header: 'ยอดรวม',       type: 'money', render: r => fmtBaht(r.amount) },
    { key: 'st',   header: 'สถานะ',        type: 'status', render: r => <StatusBadge status={r.status} /> },
  ]}
  rows={rows}
  getRowKey={r => r.id}
  emptyTitle="ไม่พบข้อมูลที่ค้นหา"
  onRowClick={openDetail}
/>

<TableFooter
  rowCount={20}
  onRowCountChange={setPageSize}
  subtotals={[
    { label: 'ยอดรวมก่อนภาษี', value: '20,000.00' },
    { label: 'ภาษีมูลค่าเพิ่ม', value: '1,400.00' },
  ]}
/>
```

### 2.6 `<DocumentLink />`

Document number with leading icon, rendered as a teal monospaced
link. Accepts `href` or `onClick`. Optional `subLabel` for the
application number underneath.

```tsx
<DocumentLink number="INV-2025-0001" subLabel="GACP-2025-0001" href={`/invoices/${id}`} />
```

### 2.7 `<TabNav />`

Underline-active tab strip with parentheses counts. Horizontally
scrollable on mobile.

```tsx
<TabNav
  tabs={[
    { id: 'sales', label: 'เอกสารขาย', count: 10 },
    { id: 'acct',  label: 'เอกสารบัญชี', count: 3 },
  ]}
  activeId={tab}
  onChange={setTab}
/>
```

---

## 3. Before / after ASCII mockups

### 3.1 Slip queue — `/provider/accounting`

**Before**:
```
+----------------------------------------------+
| SummaryHeader (gradient eyebrow + emojis)    |
|   metric chips:  💰 22,000  ⏳ 1,400  ⚠️ 100  |
+----------------------------------------------+
| [stat] [stat] [stat] [stat]   (4-col)        |
+----------------------------------------------+
| <Tabs primitive — 5 tabs in a grid />        |
+----------------------------------------------+
```
**After (FlowAccount)**:
```
+----------------------------------------------+
| ACCOUNTING — PLATFORM                        |
| บัญชี Platform — ใบกำกับภาษีเต็มรูปแบบ          |
|                          [Excel ⬇] [Print 🖨] |
+----------------------------------------------+
| บัญชี Platform                                |
| ณ วันที่ 16 พ.ค. 69 │ งวด │ 13 เอกสาร     |
|                  ยอดรวมทั้งสิ้น 22,000.00    |
|                  ภาษีมูลค่าเพิ่ม      1,400.00 |
|                  ยอดรวมก่อนภาษี  20,600.00   |
+----------------------------------------------+
| [stat] [stat] [stat] [stat]   (compact)      |
+----------------------------------------------+
| สลิป(10) │ รอยืนยัน(2) │ ใบเสร็จ(0) │ Subs(1) |
+----------------------------------------------+
| chip: สถานะ: รอดำเนินการ ×                   |
+----------------------------------------------+
```

### 3.2 Reports — `/provider/accounting/reports`

**Before**:
```
+---- SummaryHeader (gradient) ---+
| Tabs (5 inline buttons)         |
+---------------------------------+
| Report toolbar (inline date + buttons)  |
+---------------------------------+
```
**After**:
```
+ PageToolbar [กลับ ←]            +
+ TabNav  งบทดลอง │ P&L │ BS │ GL │ VAT +
+ Report toolbar (PageToolbar)    +
+ FilterBar [วันที่] [แสดงผล]      +
```

### 3.3 Customer statement — `/health/billing`

**Before**: Inline `<h1>`, local SummaryCard helpers, custom
status badge map.

**After**:
```
+ PageToolbar  สรุปยอดลูกค้า  [Print]      +
+ SummaryCard org + meta + totals          +
+ Application chips (teal active)          +
+ 2 SideSummaryCard (DTAM / PLATFORM)      +
+ Per-app invoice tables w/ StatusBadge    +
```

### 3.4 AR aging — `/provider/accounting/ar-aging`

**Before**: SummaryHeader + 5 bucket cards (small) + emerald-2 grand-total panel + sky bucket pills.

**After**: PageToolbar + FilterBar + **5 rounded-2xl bucket cards** as summary buckets + teal-accent grand total card + tightly-styled detail table using shared `StatusBadge` for the "สลิปรอตรวจ" pill.

---

## 4. Color usage matrix (matches FlowAccount palette)

| Token | Tailwind class | Use |
|-------|----------------|-----|
| Brand primary | `teal-600` / `teal-700` | Primary CTA, grand-total figure, doc-link, active tab underline |
| Pending | `amber-100` / `amber-800` | StatusBadge pending (รอดำเนินการ / รอชำระเงิน) |
| Paid | `emerald-100` / `emerald-800` | StatusBadge paid / receipt / active |
| Cancelled | `rose-100` / `rose-800` | StatusBadge cancelled / rejected |
| Overdue | `red-100` / `red-800` | StatusBadge overdue, AR over-90-day bucket |
| Draft | `slate-100` / `slate-700` | StatusBadge draft, neutral chips, headers |
| Info | `sky-100` / `sky-800` | StatusBadge slip-in-review, info chips |
| Subscription | `violet-100` / `violet-800` | StatusBadge subscription phase |
| Held | `orange-100` / `orange-800` | StatusBadge held (ถูกระงับ) |

`PageToolbar` action variants:
| Variant | Use |
|---------|-----|
| `primary` | Print / submit ("พิมพ์รายงาน") — solid teal |
| `outline` | Export Excel, secondary CTAs |
| `ghost` | Refresh / non-destructive utilities |
| `destructive` | (reserved for delete flows) |

---

## 5. Mobile responsive behaviour

| Breakpoint | Element | Behaviour |
|------------|---------|-----------|
| `md` (≥ 768px) | `PageToolbar` | Title left, action button row right with full labels |
| `< md` | `PageToolbar` | Stacks vertically; action labels hide, icons remain (with `aria-label` for SR) |
| `md` | `FilterBar` | Inline row, apply button right-aligned |
| `< md` | `FilterBar` | Vertical stack; chips still wrap |
| `md` | `SummaryCard` | Two columns, totals right-aligned with vertical divider |
| `< md` | `SummaryCard` | Stacks meta then totals, totals border-top |
| All | `TabNav` | Horizontally scrollable strip so long Thai labels survive |
| All | `DataTable` | Horizontal scroll on overflow; columns can opt-in `mobileHidden: true` |

`@media print` rules in the existing pages still hide `print:hidden`-marked toolbar/filter/tab chrome so reports render clean on A4.

---

## 6. Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit -p apps/web-app/tsconfig.json` | PASS (exit 0) |
| Smoke test — `StatusBadge` mapping + tone override | `__tests__/components/finance/status-badge-test.tsx` |
| Smoke test — `DataTable` rendering + click + empty | `__tests__/components/finance/data-table-test.tsx` |
| Visual integration | Confirmed via rendered JSX in each page; design matches owner's FlowAccount reference screenshot |

The redesign keeps all data-fetching, role-gating, and business
logic on the host pages — the new components are presentational
only, so the change set is reviewable as pure UI without backend
or auth regression risk.
