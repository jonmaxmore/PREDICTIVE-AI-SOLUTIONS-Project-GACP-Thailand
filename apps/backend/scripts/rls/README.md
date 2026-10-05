# RLS enforcement mechanism — prototype drill (staging-only)

**Status:** PROTOTYPE / mechanism proof. Not wired into the app. Prod enforcement
is **owner + org-#2-gated**.

This directory proves, on **`gacp_staging` only**, that the corrected
**bound-query batch** pattern enforces Postgres Row-Level Security **without
pgbouncer** — the mechanism that ADR-014 Phase E.2 was blocked on.

> ⚠️ **Never run any of this against production (`gacp_db`).** Both the SQL and
> the probe hard-refuse a DB named `gacp_db`. The drill is fully **reversible**
> via the REVERT block at the bottom of `prototype-staging-setup.sql`.

---

## Background (why this exists)

ADR-014 Phase E.1 enabled RLS on ~52 tenant tables in **observe-only** mode: the
per-table policy calls `rls_observe_check(table_name, row_org_id)` whose **live
prod body is `SELECT TRUE`** (migration `20260502060000_rls_quiet_observe_only`)
— it enforces nothing. Two things block real enforcement:

1. The app role `gacp` is **SUPERUSER + BYPASSRLS**, so policies are ignored.
2. Nothing sets the `app.tenant_id` GUC per request, and Prisma's pooled
   auto-commit mode means a naive `SET LOCAL` doesn't reach the query connection
   (see `docs/adr/ADR-014-phase-e2-rls-decision.md`).

The ADR's recommendation was **pgbouncer** (Option B). This drill proves a
**third path that needs no pgbouncer**: a batch-array `$transaction` that pins
`set_config` and the bound query onto one connection in one transaction.

### The corrected pattern

```js
app.$transaction([
  app.$executeRawUnsafe("SELECT set_config('app.tenant_id', $1, true)", orgId),
  app.application.findMany({ select: { id: true, organizationId: true } }),
]);
```

- **Array** form → both statements run on the **same pinned connection** inside
  **one** transaction.
- `set_config(..., true)` = `SET LOCAL` → transaction-scoped, dies at COMMIT, no
  cross-request leak.
- The second element is the **bound query from the extended client**, so PDPA
  decrypt + soft-delete + tenant extensions still apply (not `basePrisma`, not a
  second `$transaction` callback arg).

The naive callback form (`$transaction(async tx => { SET LOCAL ...; return
app.findMany() })`) is **broken** and is included as a negative control (case E).

---

## Files

| File | What it is |
|------|------------|
| `prototype-staging-setup.sql` | Creates least-priv `gacp_app` role, grants DML on all RLS tables, installs the **enforcing** `rls_observe_check` body, FORCEs RLS on `applications`. Has a REVERT block. |
| `prototype-probe.js` | Standalone Node script: connects as `gacp_app`, runs the A–E proof matrix, exits non-zero on any failure. |
| `extension-reference.md` | The corrected `tenant-prisma-extension` form for E.2.2 (reference only — **not wired**). |

---

## How to run the drill on staging

All commands run against **staging** (`gacp_staging`). Use the
`gacp-backend-staging` container or any host with network access to
`gacp-postgres`.

### 1. Apply the setup SQL (as a staging superuser)

Generate a throwaway password and pass it as a psql variable — **never hardcode
a secret** in the file or in git:

```bash
APP_PW="$(openssl rand -hex 24)"

psql "$STAGING_SUPERUSER_DATABASE_URL" \
  -v apppw="$APP_PW" \
  -f apps/backend/scripts/rls/prototype-staging-setup.sql
```

This creates `gacp_app` (NOSUPERUSER NOBYPASSRLS), grants it DML on every
RLS-enabled table, swaps `rls_observe_check` to the enforcing body, and FORCEs
RLS on `applications`. **Keep `$APP_PW`** — the probe needs it.

### 2. Run the probe as `gacp_app`

From inside `gacp-backend-staging` (so `@prisma/client` is generated and on
path):

```bash
docker exec -i gacp-backend-staging sh -lc '
  cd /app/apps/backend &&
  GACP_APP_DATABASE_URL="postgres://gacp_app:'"$APP_PW"'@gacp-postgres:5432/gacp_staging" \
  node scripts/rls/prototype-probe.js
'
```

> If running outside the container, point the host at the postgres host/port that
> reaches `gacp_staging` and ensure `npx prisma generate --schema prisma/schema`
> has been run.

### 3. Read the matrix

The probe prints PASS/FAIL for each case and exits non-zero if any fails:

| Case | Form | Expectation |
|------|------|-------------|
| A | corrected batch, `tenant_id = REAL org` | `rows > 0` **and** every `organizationId === REAL org` |
| B | corrected batch, `tenant_id = random fake uuid` | `0 rows` (isolation) |
| C | **no** `set_config`, plain `findMany` ×5 | `0 rows` (fail-closed; GUC, not a stale pooled value, controls visibility) |
| D | corrected batch, `set_config(app.rls_bypass, on)` | `rows === full count` (escape hatch) |
| E | **broken** callback form (`app.*` read, not `tx.*`) | GUC never reaches the read connection → **not** the enforced A-result (proves the batch form is required) |

### 4. Revert (always, when done)

Run the **REVERT block** at the bottom of `prototype-staging-setup.sql`. It:

1. Restores the permissive `SELECT TRUE` IMMUTABLE body (= live prod shape,
   migration `20260502060000`).
2. `NO FORCE ROW LEVEL SECURITY` on `applications` (back to plain ENABLE).
3. Revokes all grants and `DROP ROLE gacp_app`.

```bash
# copy the commented REVERT block out of the .sql and run it, e.g.:
psql "$STAGING_SUPERUSER_DATABASE_URL" -f /path/to/revert-only.sql
```

After revert, staging is back to the observe-only baseline.

---

## Guarantees / non-goals

- **Staging-only + reversible.** Setup and probe both refuse `gacp_db`. The
  REVERT block returns the function body to the exact live-prod shape.
- **No app code is changed.** The live `tenant-prisma-extension.js` is untouched;
  `extension-reference.md` shows the E.2.2 wiring as reference only.
- **No secrets in git.** The role password is a psql variable / env var supplied
  at run time.
