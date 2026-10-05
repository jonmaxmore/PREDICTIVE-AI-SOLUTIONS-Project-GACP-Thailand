# ADR-014 Phase 3 — Handoff & Write-Path Audit

- Status: In progress
- Date: 2026-04-27
- Parent: `docs/adr/ADR-014-multi-tenancy-foundation.md`
- Branch: a feature branch

This document hands off the remaining Phase 3 work for ADR-014 multi-tenancy.
It is the sibling document to ADR-014; it does not change any decisions, it
records what is done, what is left, and what to verify before each next
step.

## What landed in commits cb95307…8106cb4 (Phase 1 + 2 + 3a + 3b PRs A/B/C)

| Commit   | Phase | Surface |
|----------|-------|---------|
| cb95307  | 1.1   | `Organization` model + table + seed of `default` org |
| c2015c9  | 1.2   | nullable `organizationId` on 48 tenant-scoped tables |
| df5008c  | 1.3   | backfill — every existing row points at `default` org |
| 62777a6  | 2     | `tenant-context` service + Prisma write-injection extension + middleware |
| 3c54978  | 2     | wired `tenantContextMiddleware` into `authenticate*` middleware so every authenticated request binds tenant scope |
| c70f82e  | 3a    | FK constraints from 48 tables to `organizations(id)` (still NULLABLE) |
| fb88bd5  | 3b-A  | wrapped 10 seed/maintenance scripts in `runWithTenantContext` |
| 3e93ba6  | 3b-B  | wrapped 4 cron jobs (revision-deadline, sla-monitor, sla-processor, scheduler cert-expiry) per-row in `runWithTenantContext`; intentional cross-tenant scans use `withoutTenantScope` |
| e248e8e  | 3b-C  | added Prisma `@relation` declarations on all 48 tenant-scoped models + reverse relation collections on `Organization` — drift warning resolved |
| 8106cb4  | 3b-CI | `scripts/ci/check-tenant-conventions.js` + `npm run check:tenant-conventions` — guardrail for forgotten `withoutTenantScope` on platform-admin and missing tenant scope on jobs |

Result of this state: every authenticated HTTP request carries a tenant
scope; every write through Prisma from inside that request auto-injects
`organizationId`; every existing row has a valid FK to an Organization;
typos and stale ids are rejected at the DB level. After PRs A/B/C/CI
above, every out-of-request write path (scripts, seeds, jobs) also runs
inside an explicit tenant scope, and a CI guardrail prevents new
platform-admin or job code from regressing on this. **Production
behavior is still unchanged** — the column remains nullable, no row has
been denied INSERT, no read has been filtered.

## What remains

### Phase 3b — NOT NULL alteration + Prisma `@relation` declarations

Goal: make `organizationId` mandatory on every tenant-scoped INSERT.

Blocked on: every code path that writes to a tenant-scoped table must
either (a) run inside `runWithTenantContext(...)` so the Prisma extension
auto-injects, or (b) pass an explicit `organizationId` in the create
payload. **Today, 40 source files contain such writes** and at least the
out-of-request paths need to be audited individually before NOT NULL.

The audit list below is the source of truth for that work.

### Phase 3c — Postgres Row-Level Security

Goal: defense-in-depth for read paths. Even if application code skips the
tenant scope on a `findMany`, RLS hides rows from other tenants.

Implementation sketch:

1. Per-tenant policy on each of the 48 tables:
   `USING ("organizationId" = current_setting('app.current_tenant', true)::text)`
2. A Prisma client middleware that issues
   `SET LOCAL app.current_tenant = '<orgId>'` at the top of each
   transaction, derived from the AsyncLocalStorage context.
3. A `BYPASSRLS` role (used by migrations and the `withoutTenantScope`
   escape hatch) that ignores the policies.

Open questions deferred to that commit:

- Connection pool interaction with `SET LOCAL` (Prisma's pgbouncer support
  has known quirks here)
- Whether to enforce `FORCE ROW LEVEL SECURITY` (which applies even to
  table owners) or just the default

## Write-path audit — what to verify before Phase 3b

Three categories of writes against tenant-scoped models. For each,
the question is: *will this code path have a tenant scope bound when it
runs, and if not, what's the fix?*

### Category A — inside an authenticated HTTP request → already covered

If a write happens during request handling AFTER `authenticate*` middleware
ran, `runWithTenantContext` has already bound the scope; the Prisma
extension auto-injects. No change needed. Verification: check that the
route uses one of `authenticateHealth`, `authenticateProvider`,
`authenticateAny`, or `optionalAuth` (modified in commit 3c54978).

Files in this category (verified by inspection — they are reachable only
from authenticated routes):

- `apps/backend/services/application-service/*`
- `apps/backend/services/farm-service.js`
- `apps/backend/services/cultivation-log-service.js`
- `apps/backend/services/harvest-service.js`
- `apps/backend/services/notification-service.js`
- `apps/backend/services/payment-service-phase-flow.js`
- `apps/backend/services/plant-unit-lifecycle-service.js`
- `apps/backend/services/certificate-service.js`
- `apps/backend/services/trace-service/*`
- `apps/backend/services/provider-user-service.js`
- `apps/backend/services/prisma-auth-service.js`
- `apps/backend/routes/api/**/*` (all)
- `apps/backend/middleware/audit-logger.js` (called from middleware that
  runs after auth)

### Category B — outside HTTP context → NEEDS explicit fix (DONE)

Writes from scripts, seeds, jobs, or controllers that may run outside a
request. Each must either be wrapped in `runWithTenantContext({ organizationId: <id> }, () => …)`
or pass an explicit `organizationId` to the create payload.

**Status**: All entries below were addressed in PR A (commit fb88bd5)
with the noted skip rationale. `apps/backend/scripts/force_certify.js`
was added during the audit (missed by this list).

Original list:

```text
apps/backend/scripts/seed-lots-with-qr.js
apps/backend/scripts/seed-professional-account.js
apps/backend/scripts/seed-test-accounts.js
apps/backend/scripts/seed-test-data.js
apps/backend/scripts/seed-test-user.js
apps/backend/scripts/seed_relaxed_validation.js
apps/backend/scripts/update-health1-certified.js
apps/backend/scripts/update_yield_data.js
apps/backend/scripts/verify-e2e.js
apps/backend/prisma/seed-real-fees.js
apps/backend/prisma/seed-gacp.js
apps/backend/controllers/e2e-controller.js  (only loaded when NODE_ENV !== 'production' — keep guarded)
```

Recommended fix pattern for every script in this category:

```js
const { runWithTenantContext } = require('./services/tenant-context');
const { prisma } = require('./services/prisma-database');

async function main() {
  const defaultOrg = await prisma.organization.findUniqueOrThrow({
    where: { slug: 'default' },
  });
  await runWithTenantContext({ organizationId: defaultOrg.id }, async () => {
    // existing seed/script body unchanged
  });
}
```

This keeps the script body untouched while making the Prisma extension
inject `organizationId` automatically.

### Category C — needs case-by-case judgment (DONE)

**Status**: All 4 jobs were wrapped in PR B (commit 3e93ba6). The
embedded certificate-expiry job inside `scheduler.js` was added during
the audit (missed by this list).

Original list:

```text
apps/backend/jobs/revision-deadline-checker.js
apps/backend/jobs/scheduler.js
apps/backend/jobs/sla-monitor.js
apps/backend/jobs/sla-processor.js
apps/backend/__tests__/unit/application-service.test.js  (test code)
```

Jobs typically iterate over data from multiple tenants. After Phase 3b they
must explicitly enter and leave the tenant scope per row. The pattern:

```js
for (const application of pendingApplications) {
  await runWithTenantContext(
    { organizationId: application.organizationId },
    () => processOneApplication(application)
  );
}
```

Test code: most existing tests mock Prisma or work with synthetic data;
they should be safe to leave alone, but verify each one hits a real
Prisma write before NOT NULL lands.

## Suggested PR sequence for Phase 3b/c

To keep blast radius small and reviewable, do not bundle the audit fixes,
NOT NULL, and RLS into one PR. Suggested sequence:

1. ~~**PR A — script audit fixes (Category B)**~~
   **DONE** in commit fb88bd5. 10 scripts wrapped, 2 skipped (no
   tenant-scoped writes). `force_certify.js` was added during the
   audit (missed by the original write-path inventory).

2. ~~**PR B — job audit fixes (Category C)**~~
   **DONE** in commit 3e93ba6. All 4 cron jobs now wrap per-row
   processing in `runWithTenantContext` and use `withoutTenantScope`
   for intentional cross-tenant scans (top-level `findMany`, admin
   user lookups, `generateSLAReport`). The embedded certificate-expiry
   job inside `scheduler.js` was also wrapped — it was missed by the
   original Category C inventory but flagged during the audit.

3. ~~**PR C — Prisma `@relation` + reverse relations on Organization**~~
   **DONE** in commit e248e8e. Drift warning resolved. No DB change.

4. **PR D — NOT NULL alteration** (NOT YET LANDED)
   `ALTER TABLE … ALTER COLUMN "organizationId" SET NOT NULL` on each of
   the 48 tables. After this, any unscoped INSERT errors out loudly
   instead of silently landing in the default tenant. **Land this AFTER
   PRs A and B are in production for at least one full release cycle.**
   Use `npm run check:tenant-conventions` and the unit suite as the
   pre-PR gates.

5. **PR E — Postgres RLS** (NOT YET LANDED)
   See implementation sketch above. Independent of NOT NULL but must come
   after Phase 3b is stable so the read filter has organizationId to
   filter on. Open question deferred to that PR: pgbouncer interaction
   with `SET LOCAL app.current_tenant`.

6. **(Out-of-band) per-tenant audit log chain** — see Open risk #2.
   Decoupled from D and E because it requires its own schema migration
   on the `AuditLog.sequenceNumber` unique constraint.

## Verification checklist (re-run between every PR)

```bash
# 1. schema parses
cd apps/backend
DATABASE_URL=postgresql://test:test@localhost:5432/test \
  npx prisma validate --schema prisma/schema

# 2. unit suites pass (no DB needed)
DATABASE_URL=postgresql://test:test@localhost:5432/test \
  node ../../node_modules/jest/bin/jest.js --config jest.config.cjs \
  --testPathPattern '__tests__/(simple|tenant-context|crypto-service|security-nonce|unit/applications-draft|unit/provider-legacy)' \
  --no-coverage

# 3. integrity checks (used by pre-commit)
node scripts/system-integrity-check.js
```

## Open risks

1. ~~**Prisma `prisma migrate dev` drift warning (since c70f82e).**~~
   **RESOLVED** by PR C (commit e248e8e). The Prisma schema now matches
   the SQL FK constraints; `prisma generate` and `prisma migrate dev`
   no longer report drift.

2. **Audit log chain verification is now per-tenant — DEFERRED.**
   `apps/backend/middleware/audit-logger.js` builds the hash chain via
   `getLastHash()` (a global `findFirst orderBy sequenceNumber desc`)
   and verifies it via `verifyChain()` (a global `findMany`). Once the
   tenant write-injection is active (Phase 3b PR A/B), every new
   `auditLog.create` carries an `organizationId`, so the chain is
   *conceptually* per-tenant. However, **`AuditLog.sequenceNumber` is
   still a globally `@unique` column**, which means simply scoping
   `getLastHash()` to the current tenant would produce sequence numbers
   that conflict with rows from other tenants and fail the unique
   constraint.

   The correct fix has two coupled changes: (1) drop the global
   `@unique` on `sequenceNumber` and replace it with
   `@@unique([organizationId, sequenceNumber])`; (2) update
   `getLastHash()` and `verifyChain()` to scope by the current tenant
   (or by an explicit `organizationId` argument for verification). This
   is a load-bearing change to audit infrastructure and ships as its
   own PR, *not* bundled with PR D (NOT NULL) or PR E (RLS).

   Until that PR lands, the audit chain remains globally consistent
   (every new row picks `max(sequenceNumber) + 1` across all tenants)
   and `verifyChain()` returns `verified: true` for healthy chains. No
   code change is required to keep that working. The risk surfaces
   only when (a) we introduce a tenant whose audit volume diverges
   sharply from another's and we want to verify per-tenant integrity,
   or (b) we add an externally-served per-tenant audit export.

3. ~~**Cross-tenant features intentionally need `withoutTenantScope`.**~~
   **PARTIALLY RESOLVED** by `scripts/ci/check-tenant-conventions.js`
   (commit 8106cb4). The check enforces that platform-admin handlers
   import and use `withoutTenantScope`, and that cron jobs import one
   of `runWithTenantContext`/`withoutTenantScope`. It is wired as
   `npm run check:tenant-conventions` and runs in seconds.

   The check is intentionally coarse — it verifies imports and one
   call site, not that every Prisma call is wrapped. A future
   refinement could parse the AST and require each `prisma.X.method`
   call to be inside a wrapping closure, but the marginal benefit
   over code review + the existing runtime guard (the Prisma
   extension throws on cross-tenant writes when scope is bound) is
   small.
