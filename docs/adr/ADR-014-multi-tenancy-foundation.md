# ADR-014: Multi-Tenancy Foundation — Shared Schema with `organizationId` and Tiered Isolation Path

- Status: Accepted
- Date: 2026-04-27
- Deciders: Platform / Application owners
- Supersedes: None
- Related:
  - `docs/adr/ADR-013-platform-neutral-production-strategy.md`
  - `docs/architecture/canonical-target-model.md`
  - `docs/architecture/identity-model-external-idp-alignment.md`
  - `apps/backend/prisma/schema/auth.prisma`

## Context

The platform today is single-tenant by design. All data (users, applications,
certificates, payments, audit logs) belongs to a single implicit organization.

The business strategy is to evolve the platform from a single GACP certification
service into a **multi-tenant GACP operating system** that can serve multiple
issuer organizations:

- provincial agriculture offices (กรมส่งเสริมการเกษตรรายจังหวัด)
- private certification bodies
- agricultural cooperatives (สหกรณ์)
- foreign GACP/GAP standard bodies (EU-GAP, ASEAN-GAP)

This is the highest-leverage architectural change available right now:

- it unlocks 50–200× the addressable customer base in a single capability
- it is irreversibly expensive to retrofit later — every model gets a new FK
- it is a prerequisite for every future module (workflow engine, public API,
  per-tenant branding, marketplace, billing per tenant)

The decision that must be made before any code changes is the **isolation
strategy**, because it shapes the data model, the security model, the backup
strategy, and the operational cost curve for the next 5+ years.

## Options considered

Three isolation models are conventional in B2B SaaS. Each has different
trade-offs along five axes: implementation cost, isolation strength,
operational cost per tenant, regulatory fit (PDPA / data residency),
and migration cost from current state.

### Option A — Shared schema, `organizationId` column on every tenant-scoped table

All tenants share the same database, the same schema, and the same physical
tables. A new `Organization` entity is introduced, and every tenant-scoped
model gains an `organizationId` foreign key. Tenant scoping is enforced by
application middleware and (defense-in-depth) by Postgres Row-Level Security
policies.

- ✅ Smallest delta from current codebase (~4–6 weeks)
- ✅ Cheapest per tenant (one DB, one connection pool, one backup pipeline)
- ✅ Easiest to do cross-tenant analytics, marketplace, ecosystem features
- ⚠️ Weakest isolation — a missed scope filter leaks data across tenants
- ⚠️ Noisy-neighbor risk on shared resources
- ⚠️ Some regulators require dedicated storage for government data

### Option B — Schema-per-tenant (one Postgres schema per organization)

Single database, but each tenant gets its own Postgres schema (`tenant_acme`,
`tenant_doa_chiangmai`, …). Application sets `search_path` per request.

- ✅ Strong logical isolation; backup/restore per tenant is straightforward
- ✅ Schema migrations remain centralized
- ⚠️ Connection pooling becomes per-schema — operationally awkward
- ⚠️ Prisma does not natively support runtime `search_path` switching well —
  workaround exists but is clunky
- ⚠️ Onboarding cost per tenant is higher (run all migrations on new schema)
- ⚠️ Cross-tenant analytics requires UNION across N schemas

### Option C — Database-per-tenant

Each tenant gets a fully separate database, often on dedicated infrastructure.

- ✅ Strongest possible isolation; trivially passes any data-residency audit
- ✅ Per-tenant scaling and backup
- ❌ Operational cost grows linearly with tenant count
- ❌ Schema migration must run against N databases reliably
- ❌ Cross-tenant features (marketplace, federated reporting) become an
  integration project, not a query
- ❌ Requires per-tenant connection management, secrets, monitoring

## Decision

We adopt **Option A — shared schema with `organizationId`** as the default
tier, with a defined promotion path to **Option C — dedicated database**
for tenants that contractually require it.

This is a tiered isolation model rather than a single choice:

| Tier   | Isolation                              | Tenant fit                                     |
|--------|----------------------------------------|------------------------------------------------|
| Shared | shared schema + `organizationId` + RLS | default for cooperatives, private certifiers   |
| Dedicated | separate database (same app code)   | government tenants with data-residency clauses |

The application layer treats both tiers identically. Promotion from Shared
to Dedicated is a connection-string change plus a one-time data export/import
— it does not require code changes.

We explicitly reject Option B (schema-per-tenant) because:

- Prisma's runtime support for dynamic `search_path` is poor
- the operational complexity is similar to Option C with weaker benefits
- it does not satisfy regulators who require physical separation

## Required application-layer guarantees

The following must be in place before the multi-tenant codebase reaches
production:

1. **Single point of tenant resolution.** A request enters → middleware
   resolves the tenant from JWT claim or subdomain → tenant context is
   bound to the request scope. No code path may read tenant identity
   from any other source.

2. **Tenant-scoped query layer.** All Prisma reads/writes on tenant-scoped
   models go through a Prisma client extension that injects
   `organizationId` automatically. Direct `prisma.<model>.findMany()`
   without scoping must be a lint error in tenant-scoped paths.

3. **Postgres Row-Level Security as the second wall.** RLS policies on every
   tenant-scoped table reject queries that do not set `app.current_tenant`.
   This is defense-in-depth against application bugs.

4. **Tenant-aware audit log.** Every entry in `audit_log` must include
   `organizationId`. The cryptographic chain is per-tenant, not global.

5. **Cross-tenant operations are explicit.** Platform-admin paths (super-admin
   listing all tenants, system-wide migrations, billing reconciliation) use
   a documented `WithoutTenantScope` boundary that is logged and tested.

## Models that are tenant-scoped vs global

This list is the source of truth for Phase 1 implementation. It will be
maintained inline with `prisma/schema/*.prisma` as a header comment per file.

**Tenant-scoped (gain `organizationId`):**
- `User`, `UserSession`, `UserMfaSecret`, `UserBackupCode`
- `Application`, `ApplicationStep`, `ApplicationDocument`, `ApplicationRevision`
- `Farm`, `PlantUnit`, `PlantingCycle`, `CultivationLog`
- `Harvest`, `Drying`, `TraceEvent`, `LotLabel`
- `Certificate`, `CertificateRevocation`
- `Invoice`, `Quote`, `PaymentTransaction`, `Receipt`
- `AuditLog`, `AuditChecklist`, `CorrectiveActionRequest`
- `Notification`, `NotificationTemplate`
- `WorkflowDefinition`, `WorkflowInstance` (when introduced)

**Global / platform-level (no `organizationId`):**
- `Organization` (the tenant entity itself)
- `PlatformAdmin` (super-admin role, distinct from tenant-scoped admin)
- `SystemTerminology`, `MasterDataCategory`
- `DocumentTemplate` when marked `scope = 'PLATFORM'` (per-tenant overrides
  live in tenant-scoped `DocumentTemplate` rows)
- `FeatureFlag` (platform-wide flags only — per-tenant flags are scoped)
- Billing-platform tables (subscription plans, the platform's own GL)

## Migration path from current single-tenant state

1. **Schema additions, no behavior change.**
   Add `Organization` model. Add nullable `organizationId` to all
   tenant-scoped models. Deploy. No code reads it yet.

2. **Backfill.**
   Insert one `Organization` row representing the current implicit tenant
   (`name = 'Default Organization'`). Backfill all existing rows with that
   `organizationId`. Verify with row counts.

3. **Make `organizationId` non-null.**
   After backfill verification, alter the columns to `NOT NULL`. Add
   composite indexes `(organizationId, <existing-index-key>)` on hot paths.

4. **Introduce the tenant context layer.**
   Middleware + Prisma extension. Existing single-tenant tests continue
   to pass because the default tenant is still the only one.

5. **Enable Postgres RLS.**
   Add policies. Roll out per-table behind a feature flag so a misconfiguration
   does not take down production.

6. **Onboard the second tenant.**
   This is the milestone that proves the foundation. Until a real second
   tenant is in production, the work is not done.

## Consequences

### Positive

- One architectural change unlocks the entire platform strategy
- Existing canonical-identity model (`canonicalId` FK pattern) composes
  cleanly with `organizationId` — they answer different questions
- PDPA compliance is improved, not worsened (every PII row is now provably
  scoped to one tenant)
- The dedicated-DB tier gives the business a credible answer to government
  procurement questions without forcing every customer to pay for it

### Negative

- All tenant-scoped queries gain a new index dimension; hot paths must be
  re-profiled
- A bug in the tenant scoping layer is a security incident, not just a bug —
  RLS is the mitigation but raises the testing bar
- Cross-tenant reporting (platform-level dashboards) requires explicit
  un-scoping and must be audited as such
- Data export, deletion (PDPA right-to-erasure), and backup tooling all
  gain a `--tenant` dimension and must be re-tested

### Neutral

- The `Dedicated` tier introduces per-tenant connection management when it
  is first used, but not before. The cost is deferred to the first
  customer that requires it.

## Non-goals

This ADR does not:

- choose a workflow engine, plugin API, or billing model — those are
  separate ADRs that depend on this foundation being in place
- decide subdomain vs path-based tenant routing at the edge — that is an
  ingress concern, captured separately
- specify per-tenant theming, locale, or feature-flag mechanics beyond
  noting that they are tenant-scoped
- migrate any existing customer to the Dedicated tier; that is a
  contractual decision per tenant
