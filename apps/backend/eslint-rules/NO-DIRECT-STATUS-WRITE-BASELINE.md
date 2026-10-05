# `gacp/no-direct-application-status-write` baseline — Phase A6 / PR-WF-1

**As of 2026-04-29 (post-v3.5.3):** the rule reports **45 warnings**
across `apps/backend/`. This is the migration backlog.

The rule is registered as `warn` (not `error`) so existing sites don't
break CI. Each flagged site needs to migrate from
```js
await prisma.application.update({
  where: { id },
  data: { status: 'SUBMITTED', ... },
});
```
to
```js
const { writeApplicationStatus } = require('./application-status-writer');
await writeApplicationStatus({
  prisma,
  applicationId: id,
  fromStatus: app.status,
  toStatus: 'SUBMITTED',
  actorId,
  actorRole,
  reason,
  additionalData: { /* other fields */ },
  onAudit,           // optional
});
```

## Why migrate?

The workflow audit's #1 finding (`docs/architecture/2026-04-28-workflow-discipline-review.md`)
was that direct status writes mean:

1. **Workflow legality** is enforced by *convention*, not code. A bug
   that lets DRAFT → CERTIFIED in a single step won't be caught at
   write time.
2. **Audit emission** depends on each caller remembering to call
   `auditLogger.log()`. Easy to miss.
3. **Concurrent writes** can race because there's no row-version
   check.

The canonical `writeApplicationStatus()` solves all three:
- Strict mode (`assertTransition: true`) calls workflow-transition-service
  for legality before writing.
- Audit emission goes through a single chokepoint (`onAudit` callback).
- Single chokepoint also makes it trivial to add row-version checks
  later (`prisma.application.update({ where: { id, _version: V } })`).

## Migration recipe (per site)

1. Read the file containing the warning.
2. Find the `prisma.application.update({ data: { status: X, ... } })` call.
3. Capture the surrounding context: actor, reason, fromStatus.
4. Replace with `writeApplicationStatus({ ... })`.
5. Re-run lint — count drops by 1.
6. Move on to the next site.

A typical site is ~5-10 LOC of mechanical change. The full migration is
~45 sites × ~5 min of focused work each ≈ 4 hours of engineering time
spread across multiple PRs.

## Path to ratchet (PR-WF-2)

When `pnpm --filter backend lint | grep "no-direct-application-status-write" | wc -l`
returns 0 in CI, flip the severity in `apps/backend/eslint.config.js`:

```diff
- 'gacp/no-direct-application-status-write': 'warn',
+ 'gacp/no-direct-application-status-write': 'error',
```

Then any future PR that introduces a direct status write will fail
lint, keeping workflow legality enforced by code (not convention).

## Top 5 cluster files (refresh by running the lint command at the bottom)

The 45 violations cluster in these areas:
1. `apps/backend/services/application-service/*` — wizard + payment finalization
2. `apps/backend/routes/api/provider/handlers/*` — provider workflow handlers
3. `apps/backend/routes/api/applications/*` — application bundles, workflow handlers, CAR
4. `apps/backend/controllers/*-controller.js` — sync + lab webhook + e2e
5. `apps/backend/prisma/seed-*.js` — seed scripts (low priority — these are dev-only)

## Refresh the list

```bash
cd apps/backend
npx eslint . 2>&1 | grep -B1 "gacp/no-direct-application-status-write" | \
  grep -oE 'apps[\\/]backend[\\/][^ ]+' | sort | uniq -c | sort -rn
```
