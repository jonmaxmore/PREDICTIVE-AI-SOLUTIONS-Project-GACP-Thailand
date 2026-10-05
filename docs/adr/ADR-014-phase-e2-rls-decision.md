# ADR-014 Phase E.2 — RLS enforcing flip: decision needed

**Status**: OPEN — awaiting team decision
**Date**: 2026-05-03
**Related**: ADR-014-multi-tenancy-foundation.md, migration 20260429100100, 20260430130000, 20260502060000

## Context

Phase E.1 (deployed 2026-04-29 + 2026-04-30 across ~50 tenant tables) installed
permissive Row-Level Security policies that `RETURN TRUE` and `RAISE NOTICE`
when the session's `app.tenant_id` GUC is unset or doesn't match the row's
`organizationId`. The original plan: 7 days of zero notices → flip to
RESTRICTIVE in Phase E.2.

Phase E.1.1 (PR #174, 2026-05-02) silenced the `RAISE NOTICE` because nothing
in the application sets `app.tenant_id` and the noise was drowning out
actionable signals. The RLS infrastructure (ENABLE ROW LEVEL SECURITY +
per-table policies + the `rls_observe_check` function) is **still installed**;
the function body just always returns TRUE.

That means today:
- The DB enforces nothing at the row level — application-layer
  `tenant-prisma-extension` is the only barrier
- Flipping to enforcing requires `app.tenant_id` to actually be set per
  request, which depends on how Postgres connections are managed.

## Why we can't just `set_config('app.tenant_id', ...)` per request

Prisma uses a connection pool (default size 20). The pool hands a connection
to a request, the request runs queries on it, then returns the connection.
There are three ways `app.tenant_id` could be set:

1. **Session-level `SET app.tenant_id = '...'`** — sticks across the whole
   pooled connection. The next request (different tenant) sees the previous
   tenant's value until it overwrites it. Race condition + tenant leak by
   default.

2. **Transaction-local `SET LOCAL app.tenant_id = '...'`** — only valid
   inside a transaction block, dies at COMMIT/ROLLBACK. Prisma's default
   query mode is auto-commit (one query = one implicit transaction), so
   `SET LOCAL` in query A doesn't survive to query B even on the same
   connection within the same request.

3. **Connection pinning** — pin a connection to a request for its full
   lifetime, set the GUC at request entry, release at request exit. Solves
   correctness but hurts pool throughput.

The application-side middleware (`tenant-context-middleware.js`) currently
uses AsyncLocalStorage to carry the tenant id through the request, but it
**does not** call `set_config` — see the migration comment at
`20260502060000_rls_quiet_observe_only/migration.sql:11-17`.

## Three architectural options

### Option A — Wrap every request in a single `prisma.$transaction(...)`

Inside the transaction, run `SET LOCAL app.tenant_id = '<tenant>'` as the
first statement. Every subsequent query on the transaction handle inherits
the GUC.

| Pro | Con |
|---|---|
| Strong correctness — `SET LOCAL` is scoped to the transaction, no leakage | Major refactor: every route handler must be rewritten to receive a `tx` handle instead of the global prisma client |
| Works with the existing default Prisma connection pool | `$transaction` adds latency vs auto-commit, especially for read-heavy endpoints |
| Composes with existing `writeApplicationStatus` (which already accepts a tx handle) | Some integrations (background jobs, webhook handlers) need their own tenant-resolution path |
| Postgres RLS becomes a real second wall, not just a comment | ~50 route files to touch (estimated ~3 weeks of careful migration) |

### Option B — Switch the connection pool to pgbouncer in transaction-mode

pgbouncer in transaction-mode hands out a pooled connection only for the
duration of one transaction; at COMMIT, the connection returns to the pool.
Combined with `SET LOCAL` per request, this gives the same isolation as
Option A without rewriting every handler.

| Pro | Con |
|---|---|
| No application code changes — purely an infra change | Adds an operational dependency (pgbouncer to deploy + monitor) |
| Works with Prisma's existing query patterns | pgbouncer transaction-mode disables Postgres features that span transactions (advisory locks held across statements, prepared-statement cache) — Prisma's prepared-statement caching is one specific footgun |
| Zero throughput hit at runtime if sized correctly | Local development setup gets a new component (developers must run pgbouncer locally OR have NODE_ENV-dependent connection strings) |
| Industry-standard for Postgres + Node tenant isolation | Migration complexity is in ops/devops, not codebase |

### Option C — Pin a connection per request

Keep Prisma's pool, but expose a `withTenantContext(tenantId, fn)` helper
that checks out a connection, runs `SET app.tenant_id = '<tenantId>'`, runs
the request, then releases (`SET app.tenant_id = ''` or DISCARD ALL).

| Pro | Con |
|---|---|
| Application-layer change is minimal — wrap server.js's request handler | Connection pool effectively becomes 1-per-request → pool exhaustion under load (DEFAULT_POOL_SIZE × concurrent-tenants — the multi-tenancy itself amplifies the problem) |
| No new infra | Implementing connection-pinning correctly with Prisma's `$queryRaw` machinery is fragile — Prisma maintainers don't officially support it |
| | Failures here look like silent tenant leaks — the worst kind of bug for a regulator-facing platform |

## Recommendation

**Option B (pgbouncer transaction-mode)** is the right answer for this team.

Reasoning:
1. **Application-layer change is bounded** — the only impact on app code is
   handling Prisma's prepared-statement cache. `prisma.$disconnect()` /
   `?statement_cache_size=0` and the `pgbouncer=true` connection-string flag
   already documented in Prisma docs.
2. **Postgres has been the database forever** — ops familiarity is high.
3. **The DigitalOcean target droplet can host pgbouncer as a sibling
   container** in the existing docker compose stack with minimal
   complication. Memory cost is negligible (~10-20 MB).
4. **It's reversible** — if pgbouncer turns out to break something, switch
   back to direct connections + Phase E.1.1 (silent permissive) and continue
   relying on the application-layer barrier until we pick a different path.

Option A (transaction-per-request) is correct architecture but the migration
cost is roughly 6-10× Option B's setup cost, and the runtime cost
(transaction overhead per read) is real on a regulator platform that has
many list/dashboard reads.

Option C is reject — the connection-pool exhaustion failure mode is
silent and catastrophic.

## Migration plan for Option B

1. **Provision pgbouncer in `docker-compose.production.yml`** (and the QA /
   local-prod compose files). Configure transaction-mode pool, point at
   the existing postgres service.

2. **Update `DATABASE_URL`** to point at pgbouncer instead of postgres
   directly. Add the Prisma-required flags:
   ```
   DATABASE_URL="postgresql://gacp:...@pgbouncer:6432/gacp_db?pgbouncer=true&statement_cache_size=0"
   ```

3. **Verify the local QA dev loop** — run a smoke of the wizard flow,
   confirm prepared-statement-cache disabled doesn't break anything.

4. **Wire `tenant-context-middleware.js` to call `SET LOCAL app.tenant_id`**
   at request entry. The middleware already resolves tenant from the JWT;
   adding the SET LOCAL is a single Prisma `$executeRaw` call inside the
   existing AsyncLocalStorage context.

5. **Flip `rls_observe_check` from permissive (`SELECT TRUE`) to enforcing
   (`SELECT row_org_id = current_setting('app.tenant_id', true)`)** in a
   new migration. Roll out behind a deploy/production gate so any false
   positives surface in QA first. Keep the permissive function as a
   `rls_observe_check_permissive` fallback for a release in case rollback
   is needed.

6. **Monitor for query rejection rate** in Sentry (PR #179 makes this
   visible) — any sudden spike means tenant resolution is broken for some
   path. Roll back to permissive if observed.

## What to do NOW (this session, no infra changes)

This document captures the decision space. The actual flip needs:
- Ops to provision pgbouncer
- A multi-day window for monitoring after the flip
- Coordination with the team in case of rollback

Outside the scope of an autonomous code PR.

## Reversal / rollback plan

If pgbouncer turns out to break something specific:
1. Revert `DATABASE_URL` back to direct postgres
2. Re-run migration `20260502060000_rls_quiet_observe_only` (or repeat the
   `CREATE OR REPLACE` of `rls_observe_check` to return TRUE silently)
3. Wait until pre-conditions are stable, retry

If the RLS check itself starts rejecting legitimate queries:
1. Re-run the silent-permissive function definition
2. RLS policies stay enabled; the function just always passes
3. Investigate which path was missing tenant_id; fix that, then retry the
   enforcing flip

## References

- `apps/backend/prisma/migrations/20260429100100_rls_phase_e1_observe_only/`
- `apps/backend/prisma/migrations/20260430130000_rls_phase_e1_part2/`
- `apps/backend/prisma/migrations/20260502060000_rls_quiet_observe_only/`
- `apps/backend/middleware/tenant-context-middleware.js`
- `apps/backend/services/tenant-prisma-extension.js`
- `docs/adr/ADR-014-multi-tenancy-foundation.md`
- Prisma + pgbouncer notes: https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer
