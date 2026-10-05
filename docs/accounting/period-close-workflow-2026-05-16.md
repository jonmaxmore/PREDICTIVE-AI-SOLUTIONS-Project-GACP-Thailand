# Period Close Workflow

**Iteration 24 — 2026-05-16**

## Scope

Monthly accounting-period close workflow for the GACP platform. Finance staff close a calendar month (e.g., May 2026) at the start of the following month (early June 2026). Once a period is `CLOSED`, no journal entries can be posted with `entryDate` inside that month — preventing back-dating fraud and sealing the ภ.พ.30 / TFRS for NPAEs financial statements for the period.

## Legal basis

- **TFRS for NPAEs ch.5** — year-end close. The monthly close supports the annual aggregate the standard mandates.
- **TFRS for NPAEs ch.2** — internal controls + segregation of duties: the user who closes a period must not be the one who reopens it.
- **ป.รัษฎากร ม.86/4** — VAT period closure aligns with monthly ภ.พ.30 filing window.
- **ป.รัษฎากร ม.87/3** — 7-year retention; period-close rows survive the full audit window.
- **Thai e-Transactions Act §31** — every close + reopen event is audit-logged with hash-chain immutability.

## Workflow

```
            closePeriod (ACCOUNT_PLATFORM | ADMIN)
              + month-fully-elapsed
              + no pending invoices
              + not already CLOSED
                            │
                            ▼
        ┌──────┐         ┌────────┐
        │ OPEN │ ───────▶│ CLOSED │
        └──────┘         └────────┘
                            │
                            │ reopenPeriod (ADMIN only)
                            │   + reason ≥ 10 chars
                            │   + reopener ≠ original closer
                            ▼
                       ┌──────────┐
                       │ REOPENED │
                       └──────────┘
                            │
                            │ closePeriod again
                            ▼
                       ┌────────┐
                       │ CLOSED │
                       └────────┘
```

States:

- **OPEN** — no row exists for `(organizationId, year, month)`. New entries accepted.
- **CLOSED** — `PeriodClose` row with `status='CLOSED'` exists. New entries with `entryDate` inside the period are REJECTED with `PERIOD_CLOSED`. Bypass only via `meta.allowClosedPeriod=true` (ADMIN recovery path, audit-logged).
- **REOPENED** — `status='REOPENED'`. New entries accepted; the period can be re-closed after corrections are posted.

## Lock enforcement

The lock is enforced by `services/journal-entry-period-guard.js`, an interceptor module called from journal-entry-service before any DB insert.

Call sites:

- `services/journal-entry-service.recordPaymentEntry` — after building the entry, before persistence.
- `services/journal-entry-service.recordRemittanceToDtam` — after building the entry, before persistence.
- `services/manual-journal-entry-service.postManualEntry` — after loading the APPROVED draft, before opening the `$transaction`.

Guarantees:

1. Any caller that funnels through these three functions can never write a journal entry to a closed period without explicit ADMIN override.
2. The guard fails OPEN when `period-close-service` is not loadable (CI bootstrap before `prisma generate`). This keeps the lock optional during local development; production deploys ship with the migration applied.
3. The guard reads `entryDate.getUTCFullYear()` + `entryDate.getUTCMonth() + 1` to compute the (year, month) tuple. Period boundaries are anchored in UTC to match `vat-report-service.toMonthBoundaries`.

## Separation of duties matrix

| Action  | Role(s)                            | Self-action forbidden?                                  |
|---------|------------------------------------|--------------------------------------------------------|
| Close   | `ACCOUNT_PLATFORM`, `ADMIN`        | n/a (any closer)                                       |
| Reopen  | `ADMIN`                            | YES — `actorId !== closedBy` enforced at service layer |
| List    | `ACCOUNT_*`, `AUDITOR`, `ADMIN`    | read-only                                              |
| Check   | `ACCOUNT_*`, `AUDITOR`, `ADMIN`    | read-only                                              |
| Bypass  | `ADMIN` only (via API/recovery)    | audit-logged with `allowClosedPeriod=true` flag        |

## API surface

- `POST /api/finance/period-close` — close a period. Body: `{ year, month, notes? }`. Returns `201 { id, year, month, closedAt, status }`. Errors: `400 FUTURE_PERIOD`, `409 PENDING_INVOICES_IN_PERIOD`, `409 ALREADY_CLOSED`, `403 FORBIDDEN`.
- `POST /api/finance/period-close/:id/reopen` — reopen a closed period. Body: `{ reason }`. Errors: `403 SELF_REOPEN_FORBIDDEN`, `403 PERIOD_REOPEN_FORBIDDEN`, `400 VALIDATION_ERROR`, `404 NOT_FOUND`, `409 INVALID_STATE`.
- `GET /api/finance/period-close?fromYear=2026&toYear=2026` — list close records for the tenant.
- `GET /api/finance/period-close/check?year=2026&month=5` — predicate: is this period closed for the current tenant?

## Persistence

Single table `period_closes` (`apps/backend/prisma/schema/billing.prisma` model `PeriodClose`). Compound unique on `(organizationId, year, month)` enforces one row per period per tenant; the service maps a unique-violation surfaced by re-close attempts to `ALREADY_CLOSED`.

Migration: `apps/backend/prisma/migrations/20260517010000_add_period_close/migration.sql`. Strictly additive — `IF NOT EXISTS` on the `CREATE TABLE` / `CREATE INDEX`, no DROP, no cross-table FKs.

## Audit

Every state transition fires an audit-log event via `middleware/audit-logger`:

- `PERIOD_CLOSED` — severity `INFO`. Payload: `{ periodCloseId, year, month, closedAt }`.
- `PERIOD_REOPENED` — severity `WARNING`. Payload: `{ periodCloseId, year, month, originalCloser, reason }`.

The audit row is hash-chained per ISO 27799 + Thai e-Transactions Act §31 so a tampering attempt is detected by the audit-trail integrity check.

## Rollback

```sql
DROP TABLE period_closes CASCADE;
```

After dropping the table the guard fails OPEN (no `periodClose` delegate on the Prisma client) so existing journal-entry write paths continue to work unchanged.

## Cross-iteration coordination

- **B24-A** edits `billing.prisma` Invoice columns — this iteration APPENDS the `PeriodClose` model at end-of-file (different lines, non-conflicting).
- **B24-C** adds `recordReversingEntry` to `journal-entry-service.js` — this iteration adds a `require` near the top of the file plus a 6-line guard call inside `recordPaymentEntry` + a similar block inside `recordRemittanceToDtam`. Both blocks are above where B24-C will add the new method, so the diff is small and easy to rebase.
