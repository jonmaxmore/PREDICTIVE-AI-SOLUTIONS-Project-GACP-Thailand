# RFC — Phase A6: Workflow discipline (module structure + multi-tenancy maturity)

> **Historical research note (2026-04-28).** This RFC adopts
> architectural discipline from Odoo (LGPL-3.0 open-source ERP) as a
> *reference pattern*. **GACP does not use Odoo as a dependency** —
> Odoo is cited only because its module-boundary, ir.rule, and
> mail.activity patterns are well-documented examples of the
> discipline we want.

**Status:** Draft (design only — not yet implemented)
**Author:** Project team (2026-04-28)
**Reviewer:** project owner
**Depends on:** ADR-014 multi-tenancy (Phases A/B/C/CI already complete)
**Blocks:** onboarding tenant #2; provincial roll-out beyond Bangkok

---

## 1. Why this RFC exists

The user's framing was specific: *"ผมไม่ได้ต้องการให้ระบบเราเป็น ERP
แต่ยกตัวอย่างหรือดำเนินการตามรูปแบบของระบบหรือ workflow หรือ process
ที่ถูกต้อง"* — i.e. **don't BECOME an ERP, but adopt the architectural
discipline that real ERPs (Odoo) have figured out**.

The audit at `docs/architecture/2026-04-28-workflow-discipline-review.md`
benchmarked us against Odoo on five axes:

| Axis | Odoo pattern | Where we are |
|---|---|---|
| Module boundaries | Each module owns its models + routes + tests + i18n | Routes/services/tests are in flat `apps/backend/{routes,services,__tests__}/` regardless of domain |
| Inter-module calls | Strict service-locator (`env['module.model']`) | Direct `require()` cross-domain — billing reaches into application internals |
| Tenant isolation | Multi-company is a foundation, not an afterthought | ADR-014 added it AFTER the schema was tenant-blind; Phase D (NOT NULL) + E (RLS) deferred |
| Audit trail | `mail.thread` + `ir.logging` are uniform across all models | `audit-logger.js` exists but coverage is uneven; per-tenant chain is deferred |
| Workflow engine | Generic state machine (`base_automation`) | Hand-rolled `workflow-transition-service.js` — works but not reused for non-application workflows |

The cost of staying at this level shows up the moment we onboard
**tenant #2**: every cross-cutting concern (billing, audit, doc
templates, certificate numbering) has to be re-traced manually to
make sure it respects the new tenant. Phase A6 is about paying that
debt now, on our own schedule, before the second tenant forces it.

## 2. Non-goals

- **Not a port to Odoo.** We keep Express + Prisma + Next.js
- **Not a rewrite of business logic.** Behavior stays identical;
  this is a structural / contract change
- **Not a full DDD migration.** We adopt the *boundary discipline*
  (modules with explicit imports), not the full ubiquitous-language
  + bounded-context apparatus
- **Not changing the schema partition strategy.** ADR-014's row-level
  `organizationId` is the canonical answer for v3.x

## 3. The five sub-changes

### A6-1. Module boundary contract

Reorganize `apps/backend` so each business module is a sibling
directory with the same internal layout:

```
apps/backend/modules/
├── application/
│   ├── routes.js          (router only — no business logic)
│   ├── service.js         (public surface — what other modules import)
│   ├── internal/          (private — never imported from outside)
│   ├── models/            (Prisma models tagged with this module's domain)
│   ├── __tests__/
│   └── README.md          (one paragraph: what this module owns)
├── billing/
├── audit/
├── certification/
├── tenancy/
├── workflow/
└── public-trace/
```

ESLint rule `gacp/no-cross-module-internal`: any import from
`modules/X/internal/*` outside of `modules/X/` is an error.
Cross-module communication MUST go through
`modules/X/service.js`'s exported surface.

**Migration:** existing files stay in place initially; we add
re-export shims in the new locations:

```js
// modules/billing/service.js
module.exports = require('../../services/fee-service');
```

Then move file by file. The ESLint rule fires on direct imports
into `internal/` paths the moment a file moves — so the boundary
becomes load-bearing as files migrate, not in a big-bang flip.

**Estimated:** 18 modules × ~50 LOC re-export shim = ~900 LOC, plus
~430 LOC for the ESLint rule + tests = **~1 330 LOC**. Matches the
earlier estimate.

### A6-2. Service-locator pattern for cross-module calls

Today: `services/billing/invoice-service.js` does
`const { applicationStateMachine } = require('../workflow/...')`.

Proposed: a thin registry at `modules/index.js`:

```js
const registry = require('./_registry');
registry.register('application', require('./application/service'));
registry.register('billing', require('./billing/service'));
// …

module.exports = registry; // resolves circular requires via lazy lookup
```

Consumers do:
```js
const modules = require('@gacp/modules');
const inv = await modules.get('billing').findInvoiceForApplication(id);
```

Two wins: (a) circular-dependency surfaces error at registration
time, not at first access; (b) **mocking in tests** becomes
`registry.register('billing', mockBilling)` instead of jest module
factories. Drops test boilerplate ~15-20%.

### A6-3. Finish ADR-014 — Phase D (NOT NULL) + Phase E (RLS)

The handoff doc at the path captured in `MEMORY.md` already covers
this; A6 just *commits to the schedule*:

- **D.1 (1 PR, low risk):** mark `organizationId` as `NOT NULL` on
  models that already have backfilled defaults. Migration:
  ```sql
  ALTER TABLE applications ALTER COLUMN organization_id SET NOT NULL;
  -- repeated for ~12 tables
  ```
- **D.2 (1 PR, medium risk):** drop the `default-organization` row
  fallback from `tenant-context.js`. Any caller that didn't set
  `tenantId` now throws — surfaces accidental tenant-blind code.
- **E.1 (1 PR, higher risk):** Postgres Row-Level Security policies
  on `applications`, `invoices`, `farm_audits`, `documents`. Each
  policy: `USING (organization_id = current_setting('app.tenant_id', true))`.
  The Prisma extension at `services/prisma-database.js` already
  sets this session var; RLS adds a defence-in-depth layer.

Three PRs, each individually rollback-able. Total ~600 LOC migration
SQL + tests.

### A6-4. Generic state machine

`workflow-transition-service.js` is hand-rolled for the 18-state
application workflow. We have a parallel ad-hoc workflow for
`farm-audit` (~5 states), and another for `lab-result` (~4 states).
All three have the same shape: `{ from, to, role, condition?, sideEffect? }`
tuples + a permission gate.

Extract a generic `WorkflowMachine` class:

```js
const machine = new WorkflowMachine({
  states: ['DRAFT','SUBMITTED', /* … */ ],
  transitions: [
    { from: 'DRAFT', to: 'SUBMITTED', role: 'HEALTH', condition: hasFee },
    // …
  ],
});
machine.transition(applicationId, 'SUBMITTED', { actor: user });
```

The application/audit/lab modules each instantiate their own machine
with their own transitions table. Loss of customization: zero. Gain:
one place to add features (e.g. transition timeouts, retry policies,
workflow-level audit) and they apply to all three.

### A6-5. Audit trail uniformity

`audit-logger.js` produces hash-chained audit entries for ~70% of
state changes; the other 30% (mostly cron jobs and webhook handlers)
write to logs without an audit row. Make the Prisma extension hook
the `update` and `create` events for any model annotated
`/// @audit` in its Prisma schema:

```prisma
model Application {
  /// @audit
  status ApplicationStatus
  /// @audit
  organizationId String
  // …
}
```

The extension auto-emits an audit entry whenever an annotated field
changes, without the call site having to remember. Brings audit
coverage from ~70% to ~99% (the 1% being raw SQL migrations, which
are intentionally outside the audit chain).

Per-tenant chain (one audit chain per `organizationId` rather than
one global chain) is the natural extension once the annotation
mechanism is in place — but it's deferred, per the master plan, to
when tenant #2 is in flight.

## 4. Migration path (suggested order)

| Step | LOC | Risk | Why this order |
|---|---|---|---|
| A6-1 (module dirs + re-export shims) | ~330 | None — pure indirection | Sets the structure for everything else |
| A6-1 (ESLint rule, advisory) | ~430 | None | Surfaces cross-module imports without breaking builds |
| A6-2 (service registry) | ~150 | Low — only used by tests first | Lets us land tests against the new pattern |
| A6-1 (file migration into modules) | ~570 (mostly moves) | Low | Per-PR per-module, advisory rule catches regressions |
| A6-1 (flip ESLint rule to error) | 0 | None once count = 0 | Same ratchet pattern as v3.4.0 lint baseline |
| A6-3 / D.1 NOT NULL | ~120 | Medium — needs prod backfill verification | Before D.2; depends on all writes being tenant-aware |
| A6-3 / D.2 drop default-org | ~30 | Medium — surfaces bugs | Run in staging for a week first |
| A6-3 / E.1 RLS policies | ~450 | Medium-high | Last in this group; the safety net |
| A6-4 generic state machine | ~280 | Low | Parallel to A6-3, no conflicts |
| A6-5 audit annotation | ~190 | Low | Last; depends on schema being module-organized for the docstring scan |

Total estimated: **~2 550 LOC across ~10 PRs**, spread over 4-6 weeks
of normal-velocity work, scheduled around tenant #2 onboarding.

## 5. Definition of done

- Every backend module has a `service.js` and an `internal/`
  directory; the ESLint cross-module rule is at error severity with
  zero violations in main
- `pnpm jest` runs all tests with no `jest.mock(<absolute path>)`
  (everyone uses the registry)
- Prisma migrate diff against staging shows `organizationId` NOT NULL
  on the 12 in-scope models
- `psql -c "SELECT * FROM pg_policies WHERE schemaname='public'"`
  shows policies on the 4 RLS-covered tables
- `WorkflowMachine` instances exist for application, farm-audit, and
  lab-result; the old hand-rolled methods are deleted (no shims)
- `audit-logger.js` exposes `metrics.coverage()` returning ≥ 0.99
  computed against the `/// @audit` annotation count

## 6. What this RFC does NOT decide

- The full Phase F (per-tenant audit chain) — out of scope; tracked
  in the deferred items in `MEMORY.md`
- API versioning strategy — separate proposal; A6's modules expose
  `service.js` which is internal-facing, not a public API
- Whether to adopt OpenTelemetry across modules — the auditable
  events from §A6-5 cover most of the trace value already
- Tenant-aware caching (Redis namespacing) — natural follow-up,
  best done when we have a real second tenant to see the cache miss
  pattern of

## 7. Open questions for the operator

1. **Tenant #2 timeline.** If it lands within 4 weeks, do A6-3 first
   (the safety-critical multi-tenancy maturity); otherwise A6-1/A6-2
   first (the structural cleanup, lower risk)
2. **Are there other workflows we'd want migrated to the generic
   state machine?** (e.g. certificate revocation, invoice
   dispute) — answer affects whether A6-4 expands beyond 3 cases
3. **RLS rollout window.** RLS policies can lock out queries that
   forget to set `app.tenant_id`. We need a maintenance window for
   E.1 — operator picks
