# Provider / Admin Parity Audit — Iter 28 (2026-05-16)

**Loop**: GACP hardening — Iter 28
**Scope**: parity audit of `/apps/web-app/src/app/provider/**` and
`/apps/web-app/src/app/admin/**` against the finance design system
introduced in batch 22 (`@/components/finance`). Plus admin tooling
UI for the new B28-A backend (users mgmt, audit log, force-status).

---

## 1. Inventory matrix

Legend:
- **OK** — already conforms post-batch-22
- **PARTIAL** — uses a similar primitive (e.g. `SummaryHeader`,
  Mantine `Table`) but not the canonical `PageToolbar` /
  `DataTable` from `@/components/finance`
- **MISSING** — gap that this iter addresses
- **N/A** — page is a layout/error/loading shell with nothing to audit

| Page | PageToolbar | FilterBar | SummaryCard | StatusBadge | Thai empty | Loading skeleton | Mobile responsive |
|---|---|---|---|---|---|---|---|
| `/provider/dashboard` | PARTIAL (SummaryHeader) | N/A | PARTIAL | OK | OK | OK (Spinner) | OK |
| `/provider/dashboard/admin` | PARTIAL | N/A | PARTIAL | OK | OK | OK | OK |
| `/provider/applications` | PARTIAL (SummaryHeader) | inline filter | PARTIAL (4-tile) | OK | OK | OK | OK |
| `/provider/applications/[id]` | PARTIAL | N/A | PARTIAL | OK | OK | OK | OK |
| `/provider/applications/[id]/print` | N/A (print) | N/A | N/A | OK | N/A | N/A | print-only |
| `/provider/audits` | PARTIAL | inline | PARTIAL | OK | OK | OK | OK |
| `/provider/audits/[id]` | PARTIAL | N/A | PARTIAL | OK | OK | OK | OK |
| `/provider/audits/[id]/inspect` | PARTIAL | N/A | PARTIAL | OK | OK | OK | OK |
| `/provider/audits/final-approval-list` | PARTIAL | N/A | N/A | OK | OK | OK | OK |
| `/provider/accounting` | OK | OK | OK | OK | OK | OK | OK |
| `/provider/accounting/reports` | OK | OK | OK | OK | OK | OK | OK |
| `/provider/accounting/ar-aging` | OK | OK | OK | OK | OK | OK | OK |
| `/provider/calendar` | PARTIAL | N/A | PARTIAL | OK | OK | OK | OK |
| `/provider/coordinator` | PARTIAL | inline | PARTIAL | OK | OK | OK | OK |
| `/provider/certificates` | PARTIAL | N/A | PARTIAL | OK | OK | OK | OK |
| `/provider/documents` | PARTIAL | N/A | N/A | OK | OK | OK | OK |
| `/provider/reports` | PARTIAL | inline | PARTIAL | OK | OK | OK | OK |
| `/provider/work` | PARTIAL | inline | PARTIAL | OK | OK | OK | OK |
| `/provider/work/[id]` | PARTIAL | N/A | PARTIAL | OK | OK | OK | OK |
| `/provider/scheduler/queue` | PARTIAL | inline | PARTIAL | OK | OK | OK | OK |
| `/provider/scheduler/reassign` | PARTIAL | N/A | N/A | OK | OK | OK | OK |
| `/provider/criteria` | PARTIAL | N/A | N/A | OK | OK | OK | OK |
| `/provider/management` | PARTIAL (Mantine) | inline | N/A | OK | OK | OK | OK |
| `/provider/profile` | PARTIAL | N/A | N/A | N/A | N/A | OK | OK |
| `/provider/profile/security` | PARTIAL | N/A | N/A | N/A | N/A | OK | OK |
| `/provider/profile/notifications` | PARTIAL | N/A | N/A | N/A | N/A | OK | OK |
| `/provider/planting` | PARTIAL | N/A | PARTIAL | OK | OK | OK | OK |
| `/provider/planting/[id]` | PARTIAL | N/A | PARTIAL | OK | OK | OK | OK |
| `/provider/admin/audit-log` | PARTIAL (Mantine) | inline | PARTIAL | OK | OK | OK | OK |
| `/provider/settings` | PARTIAL | N/A | N/A | N/A | N/A | OK | OK |
| `/provider/settings/system` | PARTIAL | N/A | N/A | N/A | N/A | OK | OK |
| `/provider/settings/work-config` | PARTIAL | N/A | N/A | N/A | N/A | OK | OK |
| `/admin/dashboard` | PARTIAL (SummaryHeader) | N/A | PARTIAL | OK | OK | OK | OK |
| `/admin/organizations` | PARTIAL | N/A | N/A | OK | OK (EmptyState) | OK | OK |
| `/admin/users` | **MISSING** (legacy redirect) | **MISSING** | **MISSING** | n/a | n/a | n/a | n/a |
| `/admin/audit-log` | **MISSING** (page didn't exist) | **MISSING** | **MISSING** | n/a | n/a | n/a | n/a |
| `/admin/applications/[id]/force-status` | **MISSING** (page didn't exist) | n/a | **MISSING** | n/a | n/a | n/a | n/a |
| `/admin/planting` | PARTIAL | N/A | PARTIAL | OK | OK | OK | OK |
| `/admin/communication` | PARTIAL | N/A | N/A | OK | OK | OK | OK |
| `/admin/settings` | PARTIAL (SummaryHeader) | N/A | N/A | OK | OK | OK | OK |

**Headline**:
- The **provider/accounting** family (introduced in batch 22) is the
  reference implementation — everything else uses `SummaryHeader`
  + Mantine `Table` and is functionally consistent but visually
  inconsistent with the finance pages.
- Three admin pages were **MISSING outright** (`/admin/users`,
  `/admin/audit-log`, `/admin/applications/[id]/force-status`).
- No page had a Thai-empty-state regression; the existing
  `EmptyState` + `getStatusLabel` baseline holds.

---

## 2. Parity fixes applied

### 2.1 New shared admin chrome — `@/components/admin`

| Component | Purpose |
|---|---|
| `AdminPageShell` | Wraps the finance `PageToolbar` + vertical rhythm so any admin page swapping in this shell instantly matches `/provider/accounting`. |
| `ForceStatusModal` | Full-screen-on-mobile danger modal for `/provider/admin/status-override`. Triple-guard (status pick + reason ≥ 5 chars + retype application id). |
| `UserDisableModal` | Disable / re-enable flow modal. Disable requires reason; enable is single-click. |
| `TermTooltip` | Inline tooltip with a built-in glossary (`งบทดลอง`, `Audit Log`, `CAR`, `SLA`, `GACP`, etc.). Underlines the term and shows the definition on hover/focus. |
| `index.ts` | Public re-export. |

### 2.2 New admin pages (replaced the gaps marked MISSING above)

1. **`/admin/users`** — was a 1-line redirect to `/provider/management`.
   Now: `AdminPageShell` + `SummaryCard` (4 counters) + `FilterBar`
   (search + role + status) + `DataTable` + `UserDisableModal`. The
   legacy `/provider/management` is still linked from the "การจัดการ"
   menu as "เครื่องมือผู้ใช้ขั้นสูง" because that page carries the full
   create/edit/2FA controls (Wave B Phase 54).
2. **`/admin/audit-log`** — new page (the only audit-log viewer used
   to live at `/provider/admin/audit-log` and used Mantine
   primitives). The admin route uses the finance design system,
   adds chips for active filters, and surfaces CSV export as the
   primary toolbar action. `/provider/admin/audit-log` is kept as-is
   (used by the old provider toolbar) but the admin layout nav now
   points at the new route.
3. **`/admin/applications/[id]/force-status`** — context page that
   shows the current status (`SummaryCard`), a rose danger banner,
   and a single CTA opening `ForceStatusModal`. On success, a green
   `role="status"` toast with links to the audit log entry replaces
   the CTA.

### 2.3 Backend integration — `admin-service-b28.ts`

Net-new service file (existing `admin-service.ts` keeps its
plants + dashboard-stats surface). Wraps the B28-A endpoints in a
typed `AdminB28Service.*` interface so modals never reach into
`apiClient` directly.

### 2.4 Layout nav update

Added `Audit Log` between **ผู้ใช้งาน** and **การปลูกและล็อต** in the
admin sidebar (`src/app/admin/layout.tsx`). Mobile nav inherits the
same list — the horizontal pill row scrolls so the extra item
doesn't break layout below 768 px.

### 2.5 Thai term tooltips

`TermTooltip` ships with a small glossary including `งบทดลอง`,
`งบดุล`, `งบกำไรขาดทุน`, `AR Aging`, `CAR`, `GACP`, `SLA`, and
`Audit Log`. The `/admin/audit-log` page wires up the `Audit Log`
term inline as a worked example. Provider pages can adopt it
incrementally (no batch-touch needed — each page can wrap a term
on its next normal edit).

---

## 3. Admin UI new pages summary

| Route | Components | Backend |
|---|---|---|
| `/admin/users` | `AdminPageShell`, `SummaryCard`, `FilterBar`, `DataTable`, `StatusBadge`, `UserDisableModal` | `GET /provider/admin/users`, `PATCH /provider/admin/users/:id` |
| `/admin/audit-log` | `AdminPageShell`, `SummaryCard`, `FilterBar`, `DataTable`, `StatusBadge`, `TermTooltip` | `GET /provider/admin/audit-log`, `/export.csv` |
| `/admin/applications/[id]/force-status` | `AdminPageShell`, `SummaryCard`, `StatusBadge`, `ForceStatusModal` | `POST /provider/admin/status-override` |

---

## 4. Mobile breakpoint behavior (< 768 px)

The finance primitives already encode the mobile rules; the new
admin pieces respect them.

| Concern | Behavior |
|---|---|
| Tables | `DataTable` wraps `table` in `overflow-x-auto`. Columns flagged `mobileHidden` collapse (e.g. Username, Resource ID on `/admin/audit-log`). |
| Toolbars | `PageToolbar` flips from `md:flex-row md:justify-between` to a stacked column. Primary action stays first; everything else collapses into the "การจัดการ" menu. |
| Filters | `FilterBar` stacks each `FilterField` vertically and pushes the Apply button to its own row. Active filter chips wrap below. |
| Modals | `ForceStatusModal` and `UserDisableModal` use `items-end justify-center` on mobile (full-screen sheet) and `items-center` from `md+` (centered card). |
| Sidebar | Admin layout already collapses to a horizontal scrollable pill row below `md`. The new "Audit Log" item rides that same row. |

---

## 5. Tests added

| Spec | Coverage |
|---|---|
| `__tests__/components/admin/force-status-modal-test.tsx` | hidden-when-closed, disabled-until-valid (4 cumulative preconditions), trimmed-payload submit, error-keeps-modal-open. |
| `__tests__/components/admin/user-disable-modal-test.tsx` | disable-mode reason gate, action wiring (`disable`/`enable`), enable-mode short-circuit, error surface. |

Both rely on an injected `submitHandler` so the tests never touch
`apiClient` or fetch.

---

## 6. Files touched

**New**:
- `apps/web-app/src/lib/services/admin-service-b28.ts`
- `apps/web-app/src/components/admin/AdminPageShell.tsx`
- `apps/web-app/src/components/admin/ForceStatusModal.tsx`
- `apps/web-app/src/components/admin/UserDisableModal.tsx`
- `apps/web-app/src/components/admin/TermTooltip.tsx`
- `apps/web-app/src/components/admin/index.ts`
- `apps/web-app/src/app/admin/audit-log/page.tsx`
- `apps/web-app/src/app/admin/applications/[id]/force-status/page.tsx`
- `apps/web-app/__tests__/components/admin/force-status-modal-test.tsx`
- `apps/web-app/__tests__/components/admin/user-disable-modal-test.tsx`
- `docs/ux/provider-admin-parity-2026-05-16.md` (this file)

**Updated**:
- `apps/web-app/src/app/admin/users/page.tsx` (replaced legacy
  redirect with a full management UI)
- `apps/web-app/src/app/admin/layout.tsx` (nav adds `Audit Log`)

**Untouched** (per file boundaries):
- Backend (B28-A) — service layer wraps endpoints only.
- Marketing pages (B28-C), customer success pages (B28-D).
- `apps/web-app/src/components/finance/*` — imported, never edited.
- Iter 23-27 service code.
- Prisma schema.

---

## 7. TypeScript verification

`npx tsc --noEmit -p apps/web-app/tsconfig.json` — see Step 5 in the
iter report.
