# N+1 Query Audit — Batches 9–13 Services

**Snapshot date:** 2026-05-16
**Scope:** Services freshly created across Prisma-bypass batches 9–13 (and a handful
from batch 14/15 that were on the same audit pass).

## Methodology

For each service file we scanned for the four canonical N+1 patterns:

- **Pattern A:** `for (const id of ids) { await prisma.X.findUnique(...) }`
- **Pattern B:** `Promise.all([prisma.X.findUnique(a), prisma.X.findUnique(b)])`
  where the two reads target the same model and could collapse to a single
  `findMany({ where: { id: { in: [a, b] } } })`.
- **Pattern C:** `findUnique` followed by a follow-up `findMany` for a relation
  that could have been pulled in via `include`.
- **Pattern D:** `Promise.all(items.map(async (i) => { await prisma.X.findUnique(...) }))`
  inside a list endpoint.

Routes were out of scope by directive (B14-A territory), but where a route call
site clearly indicated a missing batched service helper, we flagged it under
"Recommended service helper" so the route refactor can land cheaply later.

## Findings by service

| Service file | Status | Pattern | Notes |
|---|---|---|---|
| `services/admin-application-service.js` | clean | — | All reads either go through `findMany({ id: { in } })` or are single-row by design. |
| `services/admin-dashboard-service.js` | fixed | D (in caller) | `countAuditorActiveAssignments` was being called per-auditor by `admin-dashboard-handler.js`. Added `countAuditorActiveAssignmentsBulk(orgId, userIds)` that returns `Map<userId, count>` in one round trip. Route refactor to land later (B14-A scope). |
| `services/accounting-service.js` | clean | — | All aggregates batched via `Promise.all([...])` over distinct queries. |
| `services/quote-service.js` | clean | — | List endpoints use a single `findMany` + `count` pair; detail reads use `include`. |
| `services/system-config-service.js` | clean | — | Single-row key/value reads only. |
| `services/farm-audit-checklist-service.js` | clean | — | Pagination uses `findMany` + `count`; relations pulled via `include`. |
| `services/post-audit-task-service.js` | clean | — | All reads single-row or per-application list with `select`. |
| `services/work-config-service.js` | low-prio | A | `bulkImportConfigs` upserts inside `for` loops within a `$transaction`. Acceptable because admin-only, atomic-or-nothing semantics required, and Prisma has no `upsertMany`. See "Documented for follow-up" below. |
| `services/user-group-service.js` | clean | — | Single-row reads + `deleteMany`. |
| `services/work-activity-analytics-service.js` | clean | — | Pre-aggregates via `groupBy`; performer-name resolution already uses `findUsersForPerformerNames(ids)` (batched). |
| `services/application-service/application-applicant-query-methods.js` | clean | — | Readiness snapshot already issues all five reads via `Promise.all`. |
| `services/application-service/application-provider-query-methods.js` | clean | — | Dashboard list methods include `applicant` via `select`. Auditor-name resolution uses `listAuditorsByIds(ids)` (batched). |
| `services/document-service.js` | clean | — | Single-row + paginated reads; `include` used where the route needs the certificate row. |
| `services/identity-service.js` | clean | — | Strictly per-user identity operations; no list endpoints. |
| `services/cultivation-record-service.js` | clean | — | All reads are scoped by cycleId/plotId; ownership probes are single-row. |

## Fixes applied

### `admin-dashboard-service.countAuditorActiveAssignmentsBulk`

**Why:** `admin-dashboard-handler.js` iterates `providerUsers` (auditor list,
typically 5–30 rows in production) and `await`s `countAuditorActiveAssignments(orgId, user.id)`
inside the loop. That is N round-trips for N auditors — Pattern D.

**Change:** Added a sibling helper that pulls the slim `{ id, formData }` slice
for all active-status applications in the tenant (one query), then buckets the
`PROVIDERAssignment.{reviewerId,auditorId}` JSON paths in JS, returning a
`Map<userId, count>`.

**Performance:** N+1 -> 1 query for N auditors.

**Route refactor not done here** (route layer is off-limits per B14-A scope).
The new helper is callable as soon as the route refactor lands.

## Documented for follow-up

### `work-config-service.bulkImportConfigs` (LOW)

Uses `for (const sc of stageConfigs) { await tx.stageActivityConfig.upsert(...) }`
inside a `$transaction`. The number of rows is bounded by what an admin
uploads (typically dozens), and Prisma does not expose `upsertMany`, so the
canonical workaround is either:

1. Switch to `createMany({ skipDuplicates: true })` followed by `updateMany`
   per-row — loses the merged create/update semantics and doubles the call
   count for the update case.
2. Stay with the `for await` loop but acknowledge the N+1 character.

Decision: leave as-is. Admin-only, atomic-or-nothing semantics required, and
the bound is small enough that the round-trip cost is negligible against the
admin-side latency budget. Documented here so future auditors do not flag it
again.

### `admin-dashboard-handler.js` loop call (HIGH, route scope)

```js
for (const user of providerUsers) {
    const activeCount = await adminDashboardService.countAuditorActiveAssignments(orgId, user.id);
    ...
}
```

Should call `countAuditorActiveAssignmentsBulk(orgId, providerUsers.map(u => u.id))`
and read counts from the returned Map. Route file is off-limits in this audit;
follow-up is B14-A territory.

### `scheduler.js` /auditor-workload (HIGH, route scope)

```js
const workload = await Promise.all(
    auditors.map(async (auditor) => {
        const [active, completed] = await Promise.all([
            applicationService.countAuditorActiveAuditAssignments(auditor.id),
            applicationService.countAuditorCompletedAuditsSince(auditor.id, thirtyDaysAgo),
        ]);
        ...
    }),
);
```

2N queries for N auditors. Recommended service helpers (for a future refactor):
`countAuditorActiveAuditAssignmentsBulk(auditorIds)` and
`countAuditorCompletedAuditsSinceBulk(auditorIds, since)` — both can be
implemented with `groupBy({ by: ['assignedAuditorId'], where: { assignedAuditorId: { in } } })`
in a single query each (4 queries -> 2 queries for any N).

### Cross-service note: `prisma.X.count` followed by `prisma.X.findMany`

This is _not_ N+1; it is the canonical Prisma pattern for paginated lists and
is already executed via `Promise.all` in every list service in this audit.
Recording so future auditors don't flag it.
