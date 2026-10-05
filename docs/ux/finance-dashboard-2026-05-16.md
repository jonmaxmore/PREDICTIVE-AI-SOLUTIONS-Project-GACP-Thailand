# Finance Dashboard — UX Notes (2026-05-16)

**Status**: Draft — backend (B19-A/B/C) endpoints assumed; frontend
ships against the documented contract.

**Audience**: Platform-side finance staff (`ACCOUNT_PLATFORM`) plus
`ADMIN` / `AUDITOR` for visibility. `ACCOUNT_DTAM` is intentionally
excluded — DTAM's books are kept in กรมบัญชีกลาง's own GFMIS
ecosystem, not here.

**Route**: `/provider/accounting/reports`

## Scope

Five standard accounting reports a Thai SME under TFRS for NPAEs
needs to keep the books clean and pass the annual audit:

| # | Tab (TH)                              | Report                              | Picker            |
|---|---------------------------------------|-------------------------------------|-------------------|
| 1 | งบทดลอง                                | Trial Balance                       | as-of date        |
| 2 | งบกำไรขาดทุน                            | Profit & Loss                       | from / to         |
| 3 | งบดุล                                  | Balance Sheet                       | as-of date        |
| 4 | สมุดบัญชีแยกประเภท                       | General Ledger                      | account + range   |
| 5 | รายงานภาษีขาย (ภ.พ.30)                  | Output VAT (RD monthly return)      | year + month      |

## ASCII layout

### Desktop (>= 768px)

```
+--------------------------------------------------------------------+
|  ACCOUNTING — REPORTS                                              |
|  รายงานบัญชี                          [ <- กลับไปสลิปและใบเสร็จ ]    |
|  รายงานบัญชีมาตรฐานสำหรับเจ้าหน้าที่การเงินฝั่งแพลตฟอร์ม              |
+--------------------------------------------------------------------+
| [งบทดลอง*] [งบกำไรขาดทุน] [งบดุล] [แยกประเภท] [ภ.พ.30]              |
+--------------------------------------------------------------------+
| ณ วันที่ [2026-05-16]    [รีเฟรช] [ดาวน์โหลด CSV] [พิมพ์]            |
+--------------------------------------------------------------------+
| หมวด    รหัส   ชื่อบัญชี                  เดบิต         เครดิต        |
|--------------------------------------------------------------------|
| สินทรัพย์ 1110  เงินสด                  120,000.00          -        |
|         1121  เงินฝาก Wallet B          450,000.00          -        |
| รายได้   4110  รายได้ค่าบริการ                -      1,200,000.00    |
| ...                                                                |
|--------------------------------------------------------------------|
| ยอดรวม                              1,200,000.00    1,200,000.00    |
+--------------------------------------------------------------------+
```

### Mobile (< 768px)

```
+----------------------------+
|  รายงานบัญชี                |
|  [<- กลับไปสลิป]            |
+----------------------------+
| เลือกรายงาน                 |
| [งบทดลอง           v]      |
+----------------------------+
| ณ วันที่                    |
| [2026-05-16]               |
| [รีเฟรช]                    |
| [ดาวน์โหลด CSV]              |
| [พิมพ์]                     |
+----------------------------+
| (table — horizontally       |
|  scrollable, columns        |
|  stay fixed width)          |
+----------------------------+
```

## Report-specific notes

### 1. Trial Balance — `TrialBalanceTable.tsx`

* Rows grouped by category (สินทรัพย์ / หนี้สิน / ส่วนของผู้ถือหุ้น /
  รายได้ / ค่าใช้จ่าย). The "หมวดบัญชี" cell is only filled on the
  first row of each group for readability.
* Footer total — if `debit !== credit` we show a red banner above
  the table: "ยอดเดบิตไม่เท่ากับยอดเครดิต — กรุณาตรวจสอบรายการบัญชี".
* CSV via `format=csv` — browser handles the download via
  `window.location.href`, no JS blob handling.

### 2. P&L — `ProfitAndLossStatement.tsx`

* Two sections (รายได้ green header, ค่าใช้จ่าย rose header) and a
  bold "กำไร(ขาดทุน)สุทธิ" row at the bottom. The net-profit row
  flips to rose-50 background when the value is negative.
* Amounts use `Intl.NumberFormat('th-TH')` with two-decimal
  precision and thousands separators.

### 3. Balance Sheet — `BalanceSheetStatement.tsx`

* Three sections (สินทรัพย์ indigo / หนี้สิน rose / ส่วนของผู้ถือหุ้น
  teal). Final row shows the accounting equation check; if the
  backend reports `isBalanced: false` we surface a red banner.

### 4. General Ledger — `GeneralLedgerViewer.tsx`

* Account selector populated from `getChartOfAccounts()` — falls
  back to `FALLBACK_CHART_OF_ACCOUNTS` (14 accounts covering Wallet
  A/B, Platform Fee revenue, Subscription revenue, Output VAT, and
  common SME expense codes).
* Each row shows the running balance after that posting; the final
  total row shows "ยอดคงเหลือยกไป".

### 5. Output VAT (ภ.พ.30) — `OutputVatReport.tsx`

* Year + month selectors default to the current month so opening
  the page on the 1st gives you last month's filing data quickly.
* **Compliance callout**: a bright yellow banner sits above the
  table at all times — "ต้องยื่นภายในวันที่ ๑๕ ของเดือนถัดไป"
  (RD compliance reminder for §83 of the Revenue Code).
* Period-closable indicator (✓ ปิดงวดได้ / ⚠ ยังมีรายการค้าง) +
  list of warnings (e.g., "ใบกำกับ INV-2026-05-001 ยังรอใบเสร็จ").

## Role permissions

| Role               | Can access? | Behavior                                                  |
|--------------------|:-----------:|-----------------------------------------------------------|
| `ADMIN`            |     yes     | Full access — sees all five reports.                      |
| `AUDITOR`          |     yes     | Full access — same view as ADMIN, no separate logic.      |
| `ACCOUNT_PLATFORM` |     yes     | Primary user — full access.                               |
| `ACCOUNT` (legacy) |     yes     | Treated as BOTH-side → full access during the migration. |
| `ACCOUNT_DTAM`     |   **no**    | Thai message: "บัญชีฝั่ง DTAM ใช้รายงานของกรมบัญชีกลาง ไม่ใช่หน้านี้" + back-link. |
| anything else      |   **no**    | Generic "ไม่มีสิทธิ์เข้าถึง" panel.                          |

Gating is done on the client via `getAccountSide(user?.role)` from
`@/lib/constants/canonical-roles`. The backend is the final
arbiter — the endpoints under `/api/finance/reports/*` enforce the
same permission server-side.

## Print-friendly notes

* Global `@media print` block in `client-view.tsx`:
  * A4 portrait, 12mm margins.
  * Hides `nav`, `aside`, `header.sticky`, and any element with
    `print:hidden`.
  * Forces black-on-white for tables.
* Each report has a print-only header (`hidden print:block`) that
  shows the report name + selected period so the printout is
  self-describing.
* All toolbars (date pickers, buttons) carry `print:hidden` so the
  printed page only shows the table itself.

## CSV downloads

Implementation uses the backend's `format=csv` query parameter and
`window.location.href` navigation. The browser handles the file
download via the standard `Content-Disposition: attachment`
response header — no JavaScript blob handling. This lets finance
staff save the file directly from the browser's download manager.

URLs constructed by `AccountingService.*CsvUrl(...)` helpers.

## Mobile layout

Breakpoint: Tailwind `md` (768px).

* **Tabs**: collapse to `<select>` with the same five options.
* **Toolbars**: stack vertically (date pickers above buttons).
* **Tables**: parent has `overflow-x-auto`; the table itself does
  not shrink — finance staff get the full column set with side
  scroll rather than truncated columns.
* **Compliance callout** on the VAT report keeps its bold styling
  on mobile (it's the legal reminder we can't lose).

## File map

```
apps/web-app/src/
  app/provider/accounting/reports/
    page.tsx                       (Server Component shell)
    client-view.tsx                (tab nav + role gate + print CSS)
    TrialBalanceTable.tsx
    ProfitAndLossStatement.tsx
    BalanceSheetStatement.tsx
    GeneralLedgerViewer.tsx
    OutputVatReport.tsx
  lib/services/
    accounting-service.ts          (API client + formatters + fallback chart)
  app/provider/accounting/page.tsx (added "รายงานบัญชี ->" link)

docs/ux/
  finance-dashboard-2026-05-16.md  (this file)
```

## Open follow-ups

* Hardcoded fallback chart of accounts in `accounting-service.ts`
  should be removed once `/api/finance/reports/chart-of-accounts`
  is live in production.
* Add jest smoke tests for the role gate + tab collapse once
  `apps/web-app/jest.config.mjs` is wired to the new component
  paths.
* Backend should populate `generatedAt` ISO timestamp on every
  response so the printout footer can record "ออกเอกสาร: …".
