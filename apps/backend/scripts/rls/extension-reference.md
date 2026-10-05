# E.2.2 — corrected `tenant-prisma-extension` form (REFERENCE ONLY)

> **NOT WIRED.** This is the shape `tenant-prisma-extension.js` would take to
> push `app.tenant_id` into the DB per scoped operation, so the enforcing
> `rls_observe_check` (proven in `prototype-probe.js`) actually gates reads and
> by-id writes. Wiring this is **org-#2-gated** (needs a second tenant + the
> staging drill green + owner sign-off). Do **not** apply it from this PR.

## The one rule that makes it work

Wrap each scoped verb as a **batch-array `$transaction`** whose first element is
the `SET LOCAL` (`set_config(..., true)`) and whose second element is the
**bound query produced by the extension** — i.e. call the extension's own
`query(args)`, on the **extended** client, inside the array:

```js
return prisma.$transaction([
  prisma.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, ctx.organizationId),
  query(args),               // <-- the BOUND query the extension was handed
]).then(([, result]) => result);
```

Why each word matters:

- **Array (batch) `$transaction`**, not a callback — both elements run on the
  **same pinned connection** in **one** transaction, so the GUC set by element 1
  is live for the read/write in element 2.
- **`set_config(..., true)`** = `SET LOCAL` → transaction-scoped; it dies at
  COMMIT, so the pooled connection carries **no** leftover tenant value into the
  next request (this is what `prototype-probe.js` case C proves).
- **`query(args)`** is the **bound query the extension callback received** — it
  is the EXTENDED client's query, so it still passes through PDPA-decrypt +
  soft-delete + the rest of the extension stack. It is **NOT** `basePrisma`
  (which drops PDPA-decrypt → reads return `enc:v1:` ciphertext + skips
  soft-delete) and **NOT** a second `$transaction` callback `tx` arg (the
  extension callback only takes `args`, so a `tx` handle can't be threaded into
  it — that mismatch is exactly the broken form, probe case E).

## Reference shape (illustrative — do not wire)

```js
const { getTenantContext } = require('./tenant-context');

// Helper: run the bound query with app.tenant_id pinned for this op only.
function withTenantGuc(prismaExtended, organizationId, args, query) {
  return prismaExtended
    .$transaction([
      prismaExtended.$executeRawUnsafe(
        `SELECT set_config('app.tenant_id', $1, true)`,
        organizationId,
      ),
      query(args),
    ])
    .then(([, result]) => result);
}

// Helper: run the bound query with the bypass GUC pinned (escape hatch).
// Mirrors withoutTenantScope(): platform-admin / cron / system reads.
function withBypassGuc(prismaExtended, args, query) {
  return prismaExtended
    .$transaction([
      prismaExtended.$executeRawUnsafe(
        `SELECT set_config('app.rls_bypass', 'on', true)`,
      ),
      query(args),
    ])
    .then(([, result]) => result);
}

const tenantInjectExtension = {
  name: 'tenant-inject',
  query: {
    $allModels: {
      // --- writes already covered by E.1 (organizationId inject) stay as-is ---
      // create / createMany / upsert.create: unchanged.

      // --- E.2.2: hook the by-id verbs RLS must now gate ---
      // findUnique / update / delete / upsert(update branch) target rows by id,
      // so the app layer can't pre-filter them by organizationId — RLS is the
      // wall. Pin the GUC around each so the DB policy can enforce.
      async findUnique({ model, args, query, client }) {
        if (!isTenantScoped(model)) return query(args);
        const ctx = getTenantContext();
        if (!ctx) return withBypassGuc(client, args, query); // withoutTenantScope path
        return withTenantGuc(client, ctx.organizationId, args, query);
      },

      async update({ model, args, query, client }) {
        if (!isTenantScoped(model)) return query(args);
        const ctx = getTenantContext();
        if (!ctx) return withBypassGuc(client, args, query);
        return withTenantGuc(client, ctx.organizationId, args, query);
      },

      async delete({ model, args, query, client }) {
        if (!isTenantScoped(model)) return query(args);
        const ctx = getTenantContext();
        if (!ctx) return withBypassGuc(client, args, query);
        return withTenantGuc(client, ctx.organizationId, args, query);
      },

      async upsert({ model, args, query, client }) {
        // create branch keeps the E.1 organizationId inject; in addition the
        // update branch now needs the GUC so RLS gates the by-`where` match.
        if (!isTenantScoped(model)) return query(args);
        const ctx = getTenantContext();
        if (!ctx) return withBypassGuc(client, args, query);
        args.create = applyToRecord(args.create, ctx.organizationId);
        return withTenantGuc(client, ctx.organizationId, args, query);
      },

      // findMany / findFirst / count / aggregate / groupBy: same treatment —
      // wrap in withTenantGuc / withBypassGuc instead of the current
      // applyReadScopes() app-level where-injection (or keep both as
      // defence-in-depth during cutover). Omitted here for brevity; identical
      // shape to findUnique above.
    },
  },
};
```

## Notes for whoever wires this (org-#2 gate)

- **`client` in the hook** is the extended client (`$allModels` callbacks get a
  `client` field that is the extended instance). Use it for the batch
  `$transaction` so PDPA/soft-delete stay applied. Confirm against the installed
  `@prisma/client` version before relying on it; if `client` isn't available,
  capture the extended `prisma` via closure (it must still be the EXTENDED one,
  never `basePrisma`).
- **`withoutTenantScope` → `app.rls_bypass='on'`.** The enforcing function
  (`prototype-staging-setup.sql`) returns TRUE when `app.rls_bypass='on'`, so the
  existing `withoutTenantScope()` escape hatch (platform-admin, cron, system,
  reconciliation) maps cleanly onto `withBypassGuc`.
- **Already-in-a-transaction call sites.** Some services (e.g.
  `writeApplicationStatus`) already accept/run inside a `tx`. Nesting a batch
  `$transaction` inside an interactive `$transaction` is invalid — for those
  paths the `SET LOCAL` should be issued once at the top of the *existing*
  transaction via `tx.$executeRawUnsafe(...)`, and the inner queries run on that
  same `tx`. The batch form is for the auto-commit (non-tx) call sites.
- **Latency.** Each scoped op becomes a 2-statement transaction. This is the
  cost the ADR flagged for "Option A"; the batch form keeps it to one round-trip
  per op rather than rewriting every handler, but read-heavy dashboards should be
  benchmarked on staging before the prod gate.
- **Keep the E.1 write inject + the flag-gated `applyReadScopes`** during
  cutover as defence-in-depth; remove only after RLS enforcement is proven live
  on staging with 2-org data.

## See also

- `prototype-staging-setup.sql` — installs the enforcing `rls_observe_check` +
  least-priv role used to prove the above.
- `prototype-probe.js` — A–E proof matrix (case E is the broken callback form).
- `docs/adr/ADR-014-phase-e2-rls-decision.md` — original Option A/B/C decision
  space (this batch form is the "Option A without rewriting every handler" path).
- `apps/backend/services/tenant-prisma-extension.js` — the live extension this
  reference would replace.
