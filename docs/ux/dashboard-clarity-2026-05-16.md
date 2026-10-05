# GACP Finance Dashboard — Clarity Audit & FlowAccount Trade-Dress Removal

**Date:** 2026-05-16
**Owner:** Tanai Digital Platform / Predictive AI Solution
**Scope:** `/provider/accounting/*`, `/health/billing/*`, `components/finance/*`
**Driver:** Owner request — "ตรวจสอบการแสดงผล หรือ dashboard ให้เรียบร้อย เข้าใจง่าย"; also remove FlowAccount-imitative trade dress (legal risk).

---

## 1. Executive summary

The B21-C iteration of the finance dashboard reused an identifiable set
of FlowAccount UI patterns — specifically the "ดาวน์โหลด Excel + พิมพ์รายงาน" two-button toolbar, a summary card with org-name top / right-aligned stacked totals, and the FlowAccount teal/amber/rose palette.
These exact-match patterns constitute trade-dress / look-and-feel risk
even though the structural concepts (toolbar, summary, status pill)
are industry-generic.

This pass refactors the three offending components (`PageToolbar`,
`SummaryCard`, `StatusBadge`) into government-context layouts using
the `finance-tokens.json` palette, and applies a clarity punch list
across 9 pages targeting Thai-farmer + finance-staff readability.

`npx tsc --noEmit -p apps/web-app/tsconfig.json` passes with exit 0.

---

## 2. FlowAccount-clone elements identified

| # | Element | Risk level | Location |
|---|---------|------------|----------|
| 1 | "ดาวน์โหลด Excel" outline + "พิมพ์รายงาน" filled — exact 2-button toolbar row | HIGH | Every report page (5 reports + AR aging + accounting page) |
| 2 | SummaryCard: org name muted-gray top / 3-col meta row left / 3 right-aligned stacked totals with teal grand total | HIGH | `components/finance/SummaryCard.tsx`, used by `accounting/page.tsx`, `health/billing/client-view.tsx` |
| 3 | StatusBadge: bg-emerald-100/text-emerald-800/border-emerald-200 — same pastel triad as FlowAccount status pills | MEDIUM | `components/finance/StatusBadge.tsx` |
| 4 | Comment strings: "FlowAccount-style ..." in 7+ files | LOW (semantic) | Component JSDoc and inline comments |
| 5 | `dashboard.toolbar.iconExcel/iconPrint` token names in `finance-tokens.json` | LOW (config only) | `lib/design/finance-tokens.json` (read-only, B22-A) |
| 6 | Generic toolbar/title/actions structure | NONE | Industry-standard; kept |
| 7 | Filter chips with `×` removal | NONE | Generic UX; kept |
| 8 | Table card with hover row + monospace doc numbers | NONE | Generic; kept |

### Refactor decisions

- **#1 (toolbar)** → Replaced with **primary action button + "การจัดการ" dropdown menu** (download/print/refresh appear as menu items with description text). The exact 2-button pattern is eliminated everywhere.
- **#2 (summary card)** → Replaced with a **horizontal metric strip** (big number TOP, small label BELOW; 1/2/3/4 equal columns), org+context pill on a single line above, optional meta footer below. The "right-side stacked totals" pattern is gone.
- **#3 (status badge)** → Re-palette using `finance-tokens.json` `status` block (Thai gov MoPH colors, stronger borders, slightly different background opacity). Added new `verifying` tone for "รอตรวจสลิป" + "รอออกใบเสร็จ" which previously bled into `info` blue.
- **#4 (comments)** → Rewrote JSDoc on the three refactored components to reference "GACP government dashboard" rather than FlowAccount.

---

## 3. Clarity punch list

### Cross-cutting

| Issue | Resolution |
|-------|------------|
| English headers ("Invoice", "Applicant", "Amount", "Status", "Due Date", "Action") on Thai-user dashboards | All translated to Thai ("เลขที่ใบแจ้งหนี้", "ผู้สมัคร", "จำนวนเงิน", "สถานะ", "วันครบกำหนด", "การดำเนินการ") |
| Exception tab also English ("Action", "Severity", "Invoice", "Message", "Created") | Translated to Thai equivalents |
| `Paid: ${date}` mixed English/Thai on invoice row | Changed to `ชำระเมื่อ: ${date}` |
| `(Trial Balance)`, `(Profit and Loss)`, `(Balance Sheet)`, `(General Ledger)` parenthesised English next to Thai title | Moved English name into subtitle (`Trial Balance · ณ วันที่ ...`) so the eyebrow/title are clean Thai |
| "ดาวน์โหลด Excel" but we ship CSV — confusing | Renamed to "ดาวน์โหลด CSV" with description "รายงานในรูปแบบ Excel-compatible" |
| "พิมพ์รายงาน" without context — what gets printed? | Description added: "พิมพ์ในรูปแบบ A4" (or "A4 แนวนอน" for AR aging) |

### `/provider/accounting` (main dashboard)

| Issue | Resolution |
|-------|------------|
| `SummaryCard` (3 totals) shown directly above a `stats grid` (4 cards) showing the SAME numbers + a 4th — visual duplication, cognitive load | Removed the 4-card stats grid; collapsed all 4 metrics into the SummaryCard strip (rายรับรวม / รอดำเนินการ / เกินกำหนด / รายรับเดือนนี้) with descriptive hint sub-text |
| 4 separate "การดำเนินการ" toolbar buttons (รายงาน + รีเฟรช + ดาวน์โหลด + พิมพ์) crowding the row | Collapsed into 1 primary "รีเฟรชข้อมูล" + dropdown menu for the rest |
| Empty state "ไม่พบข้อมูลใบแจ้งหนี้ / ไม่มีรายการในหมวดหมู่ที่เลือก" — not actionable | Changed to "ยังไม่มีรายการในช่วงนี้ / ลองเปลี่ยนแท็บด้านบนหรือรีเฟรชข้อมูล" |
| Exception empty state ("ไม่มีรายการผิดพลาด") was a single muted line | Now: green check icon + "ไม่มีรายการผิดพลาด / ระบบทำงานปกติ" |
| Slip-phase / subscription-status chip rows printed when the user does Ctrl-P | Added `print:hidden` |

### `/provider/accounting/reports` (5 reports)

| Issue | Resolution |
|-------|------------|
| Each report had the same 3-button toolbar (รีเฟรช ghost + ดาวน์โหลด outline + พิมพ์ primary) — visually identical to FlowAccount | Now: รีเฟรชข้อมูล primary + dropdown menu with CSV + Print |
| Title was "งบทดลอง (Trial Balance)" — bilingual in title field | Title is now Thai-only "งบทดลอง"; the English "Trial Balance" sits in the subtitle alongside the date |
| GL "ยอดยกมา" without explanation — finance newcomers don't know if it's the in-period opening or the absolute opening | Added cursor-help title attribute: "ยอดยกมา (Opening Balance) = ยอดคงเหลือของบัญชีก่อนวันที่เริ่มต้นของช่วงเวลานี้". Same treatment on "ยอดคงเหลือยกไป" |

### `/provider/accounting/ar-aging`

| Issue | Resolution |
|-------|------------|
| Bucket cards used FlowAccount-style stacked layout | Kept the bucket grid (it's a genuine 5-column heatmap, not FlowAccount-specific), but the report's TOOLBAR was refactored alongside the others |
| No eyebrow context on the page header | Added eyebrow "รายงาน AR AGING" |

### `/health/billing` (applicant statement)

| Issue | Resolution |
|-------|------------|
| Title "สรุปยอดลูกค้า" — corporate, doesn't fit farmer applicants viewing their own statement | Renamed "สรุปยอดของฉัน" |
| Per-application header showed `app.status` as raw enum text | Wrapped in `<FlowStatusBadge />` for consistent Thai labels + color |
| Statement summary card had org-on-top + 3 right-stacked totals (FlowAccount pattern) | Refactored to horizontal metric strip; org and `ข้อมูล ณ ${date}` pill share one line at the top |
| Empty per-application "ยังไม่มีรายการสำหรับคำขอนี้" — terse | Expanded to "ยังไม่มีใบแจ้งหนี้ / เมื่อมีการสร้างใบแจ้งหนี้สำหรับคำขอนี้ ระบบจะแสดงรายการที่นี่" with dashed border + icon framing |

---

## 4. Before / after snapshots (text)

### 4.1 Toolbar — accounting page

**Before (FlowAccount clone — 4 buttons in a row):**

```
[ รายงานบัญชี ↗ ]  [ รีเฟรช ↻ ]  [ ดาวน์โหลด Excel ⬇ ]  [ พิมพ์รายงาน 🖨 ]   (← teal filled)
```

**After (gov-context — 1 primary + dropdown):**

```
[ รีเฟรชข้อมูล ↻ ]   [ ▼ การจัดการ ]
                           │
                           ├─ รายงานบัญชี
                           │    งบทดลอง / P&L / งบดุล / ภ.พ.30
                           ├─ ดาวน์โหลดรายการ (CSV)
                           │    รายการใบแจ้งหนี้ทั้งหมดในรูปแบบ Excel
                           └─ พิมพ์หน้านี้
                                พิมพ์มุมมองปัจจุบัน (A4)
```

### 4.2 Summary card — accounting page

**Before (FlowAccount layout — meta left / totals right-stacked):**

```
GACP Accounting
ณ วันที่    ช่วงเวลา      จำนวนทั้งหมด
2026-05-16  งวดปัจจุบัน    42 เอกสาร
                                          │  รายรับรวม      ฿1,234,500.00
                                          │  รอดำเนินการ    ฿122,000.00
                                          │  เกินกำหนด      ฿45,000.00
```

**After (gov-context — horizontal metric strip + meta footer):**

```
ภาพรวมการเงิน GACP                            [ ณ 16 พ.ค. 2569 ]
─────────────────────────────────────────────────────────────
┌────────────────┬────────────────┬────────────────┬────────────────┐
│ ฿1,234,500.00  │ ฿122,000.00    │ ฿45,000.00     │ ฿340,000.00    │
│ รายรับรวม      │ รอดำเนินการ    │ เกินกำหนด      │ รายรับเดือนนี้ │
│ 28 ชำระแล้ว    │ 8 รายการ       │ 3 รายการ       │ งวดปัจจุบัน    │
└────────────────┴────────────────┴────────────────┴────────────────┘
จำนวนเอกสารทั้งหมด: 42 ใบ    สลิปรอตรวจ: 5 ใบ    รายการผิดพลาด: 0 รายการ
```

### 4.3 Status badge — palette shift

**Before (FlowAccount-pastel):** `bg-emerald-100 text-emerald-800 border-emerald-200`
**After (gov MoPH context):** `bg-emerald-50 text-emerald-900 border-emerald-300` — derived from `finance-tokens.json` `status.PAID` HEX values.

Same shift applied to all 9 status tones; new `verifying` tone added (orange) to disambiguate "รอตรวจสลิป" from generic info.

---

## 5. Mobile + print verification

### Mobile (< 768px)

- `PageToolbar`: title stacks on top, primary button + dropdown trigger drop to a row below.
- `SummaryCard`: 4-metric strip becomes 2x2 grid; 3-metric strip becomes 2+1; metric labels keep ≥ 11px so they remain readable.
- `TabNav`: horizontally scrollable strip (existing behavior, retained).
- `accounting/page.tsx` slip-phase / subscription-status chip rows wrap; counts stay in parentheses.
- `reports/client-view.tsx`: tabs already collapse into a `<select>` on mobile (existing behavior, retained).

### Print (`@media print`)

- `PageToolbar`, `FilterBar`, `TabNav` all carry `print:hidden` on their roots.
- Slip-phase / subscription-status chip rows on the accounting page received new `print:hidden` (they had been printing previously).
- ar-aging and reports pages have `@page { size: A4 ... }` rules. AR aging is landscape; reports are portrait.
- Bilingual print headers (hidden in screen view) appear at the top of each report so the printout has a self-contained title block.
- The `health/billing` client view hides `nav, button` on print, keeping the applicant statement clean.

---

## 6. Files touched

| File | Change |
|------|--------|
| `apps/web-app/src/components/finance/PageToolbar.tsx` | Full rewrite — primary + dropdown menu pattern |
| `apps/web-app/src/components/finance/SummaryCard.tsx` | Full rewrite — horizontal metric strip layout |
| `apps/web-app/src/components/finance/StatusBadge.tsx` | Palette swap to gov tokens; added `verifying` tone |
| `apps/web-app/src/app/provider/accounting/page.tsx` | Removed duplicate stats grid; reworked toolbar + summary call; Thai table headers; better empty states; `print:hidden` on chip rows |
| `apps/web-app/src/app/provider/accounting/reports/TrialBalanceTable.tsx` | Toolbar refactor; bilingual title split |
| `apps/web-app/src/app/provider/accounting/reports/ProfitAndLossStatement.tsx` | Toolbar refactor; bilingual title split |
| `apps/web-app/src/app/provider/accounting/reports/BalanceSheetStatement.tsx` | Toolbar refactor; bilingual title split |
| `apps/web-app/src/app/provider/accounting/reports/GeneralLedgerViewer.tsx` | Toolbar refactor; tooltips on Opening/Closing balance |
| `apps/web-app/src/app/provider/accounting/reports/OutputVatReport.tsx` | Toolbar refactor |
| `apps/web-app/src/app/provider/accounting/reports/ArAgingReport.tsx` | Toolbar refactor; eyebrow added |
| `apps/web-app/src/app/health/billing/client-view.tsx` | Title humanized; summary card uses new strip; status badge on application header; better empty state |

`DataTable.tsx`, `FilterBar.tsx`, `TabNav.tsx`, `DocumentLink.tsx` were **not** modified — their patterns are industry-generic and carry no trade-dress risk.

---

## 7. Verification

```bash
$ npx tsc --noEmit -p apps/web-app/tsconfig.json
# exit code 0 — clean
```

No component tests exist yet for the finance/* directory (verified via repository search); the refactored components preserve their public prop API (`PageToolbarProps`, `SummaryCardProps`, `StatusBadgeProps`) so all call sites continue to compile without source changes.
