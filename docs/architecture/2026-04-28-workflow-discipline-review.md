# Workflow Discipline & Multi-Tenancy Architectural Review — GACP Certification Platform

> **Historical research note (2026-04-28).** This document
> benchmarks GACP's workflow / multi-tenancy / audit-log discipline
> against Odoo (LGPL-3.0 open-source ERP) as a *reference pattern*.
> **GACP does not use Odoo as a dependency** — the references are
> research-only, kept as an audit trail. The user's framing
> (quoted in the companion RFC) was specific: don't BECOME an ERP,
> but adopt the architectural discipline that mature systems have
> figured out.

- **Reviewer:** Project team
- **Date:** 2026-04-28
- **Reference pattern source:** Odoo (open-source) — for benchmarking only
- **Mode:** Read-only research; zero code changes

> This document is a strategic planning artefact, not a punch list. Every claim cites a file/line. Every recommendation lists its real cost (LOC, dependencies, risk). Where GACP makes a deliberate choice that differs from Odoo and the choice is appropriate, the document defends the choice — not all of Odoo is right for this domain.

## Executive Summary

GACP v3.3.0 is **substantially closer to ERP-grade than the typical mid-stage SaaS**, with three load-bearing pieces of infrastructure that most "Odoo competitors" lack at this stage:

1. A hash-chained immutable audit log with chain-verification routine.
2. An explicit, exhaustively-mapped 18-state workflow machine with role-gated transitions.
3. A multi-tenancy foundation (ADR-014) with tenant-scoped writes, FK constraints, CI guardrails, and a documented promotion path to dedicated-DB tier.

### Top 3 strengths

1. **Workflow state machine** (`apps/backend/services/workflow-transition-service.js`) — Odoo doesn't do this much better. Frozen `WORKFLOW_STATES`, explicit `ALLOWED_TRANSITIONS`, role-gated `ROLE_TRANSITIONS`, mandatory-comment targets, force-only-by-admin escape, and a transition-event builder. Best file in the repo.
2. **Audit log hash chain** (`apps/backend/middleware/audit-logger.js`) — SHA-256 `previousHash`/`currentHash` with deterministic payload, sequence number, retry-on-conflict, and a `verifyChain()` that recomputes hashes. Stronger than Odoo's `mail.thread`.
3. **Tenant write injection** (`apps/backend/services/tenant-prisma-extension.js` + `tenant-context.js`) — AsyncLocalStorage-based, with cross-tenant write detection that throws, and an explicit `withoutTenantScope` escape hatch.

### Top 5 gaps

1. **State machine is bypassed by ~92 `prisma.application.update` call sites.** The lab webhook (`apps/backend/controllers/lab-webhook-controller.js:40`) writes `status = 'APPROVED'` directly without `buildTransitionUpdate`. Any model with a status column should write through one canonical path; today the SM is opt-in.
2. **Read-side tenant scoping does not exist.** The Prisma extension only injects on `create`/`createMany`/`upsert.create` (lines 132–162). RLS is Phase 3c and unshipped. Today, any `findMany` without an explicit `organizationId` filter returns rows across tenants — a security incident waiting for tenant #2 to onboard.
3. **Audit chain is globally sequenced but conceptually per-tenant** (ADR-014 Phase 3 handoff §Open risk #2). `AuditLog.sequenceNumber` has a global `@unique`. Once tenant #2 ships, per-tenant chain verification is impossible without a coupled migration.
4. **Cert issuance is not transactionally atomic.** `certificate-service.js:187-470` creates the cert, then `createInitialAssets` does cycle, batch, QR — separate awaits. A crash mid-flight leaves the cert with no batch/QR.
5. **OpenAPI specs are stale.** `openapi/application-service.yaml:15-29` documents a 14-state workflow with names like `INSPECTION_SCHEDULED`, `CERTIFICATE_ISSUED` that no longer match the runtime 18-state machine.

### The single biggest "Odoo would do this differently" insight

Odoo's central design principle is that **every status change goes through `model.write({state: 'X'})`** and the model's `_write()` override is the only place state mutates. GACP has built the equivalent (`workflow-transition-service.js`) but not enforced it — 92 `prisma.application.update` sites can still bypass it. Odoo enforces this through ORM plumbing; GACP needs either a schema-level trigger, a Prisma extension that gates `update` on tenant-scoped tables with status fields, or a lint rule. **Without enforcement, the state machine is documentation, not a guarantee.** That gap is what separates "we have an ERP-grade workflow" from "Odoo-level."

---

## 1. Workflow / State-Machine Integrity

### What GACP has

The state machine in `apps/backend/services/workflow-transition-service.js` is genuinely strong:

- **18 frozen canonical states** (lines 12–31) plus terminals: `REJECTED`, `EXPIRED`, `CANCEL_EXPIRED`.
- **Bidirectional alias maps** (`STATE_INPUT_ALIASES`, `LEGACY_STATUS_BY_STATE`, `STATE_BY_LEGACY_STATUS`) handling legacy/canonical/lowercase variants — essential for a system that's been refactored.
- **Explicit `ALLOWED_TRANSITIONS`** (lines 151–171) — pure data, no logic. Odoo-equivalent would be `state` field with selection + `_check_state_transition` decorator.
- **Role-gated transitions** (`ROLE_TRANSITIONS` lines 179–204) keyed by `FROM->TO`, evaluated against `CANONICAL_ROLES`. Health user can only do `DRAFT->SUBMITTED`, `REVISION_REQUESTED->ASSIGNED_FOR_REVIEW`, `CAR_PENDING->CAR_REVIEWING`. Tight.
- **Force flag for admins only** (line 331).
- **Mandatory comment targets** (`REQUIRES_COMMENT_TARGETS` line 207) for `REVISION_REQUESTED`, `CAR_PENDING`, `REJECTED`.
- **Editable-status set** (`EDITABLE_STATUSES` line 214) — single source of truth for "can the applicant still edit this".
- **Transition event builder** writes a structured `workflowHistory` JSON entry per transition with `actorId`, `actorRole`, `reasonCode`, `metadata`, timestamp, action name.

### What Odoo does

In Odoo, `purchase.order.action_confirm()` is a method on the model. It checks `self.state == 'draft'` (else raise `UserError`), checks `self.env.user.has_group(...)`, writes `state='purchase'`, posts to chatter (`mail.thread.message_post`), triggers automated actions. **Critically, every state mutation goes through these named action methods, not through `write({'state': ...})` from a controller.**

### Gap

`buildTransitionUpdate()` is the equivalent of Odoo's action methods, used correctly by 20 files. However, **`prisma.application.update` is called from 43 files (~92 occurrences)**. Bypass cases:

- `apps/backend/controllers/lab-webhook-controller.js:40` — `status: resultStatus === 'PASS' ? 'APPROVED' : 'REJECTED_LAB'`. No `buildTransitionUpdate`, no role check, no workflow-history append. Note also `REJECTED_LAB` is **not** in `WORKFLOW_STATES` — active bug.
- `apps/backend/routes/api/audit/audits.js:478-485` — direct status flip with `formData` write, not through `buildTransitionUpdate`. The handler does this even though L466-475 explicitly explains why a transactional flow is needed.
- `apps/backend/services/payment-service-phase-flow.js:108-145` — uses raw `status: 'PAYMENT_PHASE_1'` in transactions, with hand-built workflow events. `PAYMENT_PHASE_1` is in legacy header comment of `application.prisma:27` but not in `WORKFLOW_STATES`.
- `apps/backend/scripts/force_certify.js`, `apps/backend/prisma/seed-approve.js` — force overrides for ops/seed, intentionally bypassing the SM.

### Idempotency / atomicity

- `buildTransitionUpdate()` does not write — it returns an update payload. The actual `prisma.application.update(...)` is the caller's responsibility, and most caller sites do not wrap the update + side-effects (notifications, cert generation) in `prisma.$transaction`.
- The SM throws on `fromState === nextState` (line 322), which is the correct idempotency stance — but only if the caller goes through it.

### Concrete next step

**PR-WF-1 — funnel all status updates through one canonical writer.** Create `apps/backend/services/application-status-writer.js` exposing `writeStatus({ application, toState, actorId, actorRole, reasonCode, comment, metadata, force, sideEffects })`. It should:

1. Call `buildTransitionUpdate` to get the payload.
2. Run `prisma.$transaction([ application.update, auditLog.create, ...sideEffects ])`.
3. Log the transition as an audit-log row (currently happens in route handler, separately).
4. Forbid direct `prisma.application.update({ data: { status } })` in tenant-scoped routes via a custom ESLint rule (~80 LOC).

**Effort**: ~600 LOC migration across 43 files, plus ~150 LOC for the writer + lint rule.
**Risk**: medium — touching every state-mutation site is high blast radius; do behind a feature flag + observable diff in workflow-history shape.
**Dependency**: none.

---

## 2. Multi-Tenancy + Data Isolation (ADR-014)

### What GACP has

This is the second-strongest area. Per `docs/adr/ADR-014-multi-tenancy-foundation.md` and the Phase 3 handoff:

- `Organization` model with isolation tier, slug routing key, settings JSON, retention/legalHold (`prisma/schema/tenancy.prisma:22-144`).
- `organizationId` nullable column on **48 tenant-scoped models** with FK constraint to `organizations(id)` (commit c70f82e).
- AsyncLocalStorage-based `tenant-context.js` with `runWithTenantContext`, `requireTenantContext`, `withoutTenantScope`.
- Prisma extension (`tenant-prisma-extension.js:129-165`) auto-injects `organizationId` on `create`/`createMany`/`upsert.create` for tenant-scoped models, and **throws `CROSS_TENANT_WRITE` if caller-supplied id mismatches** (lines 117-126).
- Auth middleware wraps every authenticated request in `runWithTenantContext` (commit 3c54978, `tenant-context-middleware.js`).
- **CI guardrail** (`scripts/ci/check-tenant-conventions.js`) — platform-admin handlers must import/use `withoutTenantScope`; cron jobs must import one of the wrappers.
- 4 cron jobs and 10 seed scripts wrapped per-row (PR A/B).

### What Odoo does

Odoo's `multi_company` mode adds `company_id` to every transactional record. Record rules (`ir.rule`) enforce read filters at ORM level: `[('company_id', 'in', company_ids)]`. Users see only their company's records by default; super-user bypass is explicit. Cross-tenant analytics requires explicit `with_context(allowed_company_ids=...)`.

### Gap

Three real gaps, two documented in the handoff and one missed:

**Gap 1 — Read-side scoping is absent.** `tenant-prisma-extension.js:18-24` explicitly defers read scoping to RLS, which is Phase 3c (PR E, unshipped). Today: `prisma.application.findMany({})` from a tenant-scoped handler returns rows across all tenants. The single tenant in production hides this. The audit handler at `audits.js:443-451` correctly does manual `findFirst({ where: { id, organizationId: orgId } })` — but this is hand-written, not enforced.

**Gap 2 — `organizationId` is still nullable** (Phase 3b PR D unshipped). A bug that drops the tenant context will silently INSERT rows with `organizationId = NULL`, into a void.

**Gap 3 — Audit log chain is globally sequenced** (ADR-014 Phase 3 handoff §Open risk #2). `AuditLog.sequenceNumber` is `@unique` globally (`prisma/schema/audit.prisma:9`). When tenant #2 onboards, every cross-tenant write contends on `getLastHash()` (line 99), and per-tenant chain verification is impossible without dropping the global unique and replacing with `@@unique([organizationId, sequenceNumber])`.

**Gap 4 (missed by handoff) — The Prisma extension's read defense is RLS, which is gated on a Postgres `SET LOCAL` issued from a Prisma middleware that does not yet exist.** Until that PR ships, you have no read isolation at all — only hand-written scoping.

### Concrete next step

- **PR-MT-1 — add read-side scoping** to `tenant-prisma-extension.js`. Hook `findMany`, `findFirst`, `findUnique`, `count`, `aggregate`, `groupBy`. If model is tenant-scoped and tenant context is bound, inject `where.organizationId = ctx.organizationId` (compose with caller-provided `where`). ~150 LOC. **Risk:** medium — false positives where caller wants explicit cross-tenant access (must use `withoutTenantScope`). Pre-flight: run the test suite under the new extension; expect to find ~10-20 places that need `withoutTenantScope`.
- **PR-MT-2 — ship Phase 3c RLS** as already designed. ~50 LOC migration per tenant-scoped table + 1 Prisma middleware that runs `SET LOCAL app.current_tenant`. **Open question on pgbouncer compatibility is real** (handoff §Phase 3c) — needs a test against the actual pool.
- **PR-MT-3 — fix the audit chain unique constraint** before tenant #2. Drop `@unique` on `sequenceNumber`, add `@@unique([organizationId, sequenceNumber])`, scope `getLastHash()` to current tenant. ~80 LOC + a migration.

**Effort total**: ~280 LOC.
**Risk**: medium-high (audit chain migration is load-bearing).
**Dependency**: must come before tenant #2 ships.

---

## 3. Audit Trail / Event Sourcing

### What GACP has

This is genuinely better than most ERP audit logs:

- `AuditLog` schema (`prisma/schema/audit.prisma:3-55`) — categories, severity, actor identity, actor type (`USER|PROVIDER|SERVICE|SYSTEM`), resource type/id, IP/UA, JSON metadata, result, error fields, `previousHash`/`currentHash`/`hashAlgorithm`.
- Hash chain with deterministic payload (`audit-logger.js:65-85`) — JSON.stringify with stable property order. `verifyChain()` recomputes from row contents (lines 254-325) and reports `LINK_MISMATCH` vs `HASH_MISMATCH` separately.
- Retry-on-conflict for `sequenceNumber` collisions (lines 109-116, 195-197).
- 21 distinct call sites for `auditLogger.log` covering MFA, login, payment, audit decisions, cert revocation, scheduler/reviewer actions, admin actions.

### What Odoo does

Odoo's `mail.thread` mixin auto-logs CRUD on inheriting models with structured tracked-fields and posts to chatter. The OCA `auditlog` module records every Odoo-level write to a separate table. Neither hash-chains.

### Gap

- **Chain is global, not per-tenant** — same as MT gap 3.
- **Chain verification is O(n)** — `verifyChain()` reads the entire log into memory and walks it. For a 5-year retention horizon, this is unworkable past ~10M rows. ADR-012 explicitly defers this. Solution: checkpoint hashes at fixed sequence intervals.
- **No log retention/archive policy code path**. Schema has `retainUntil` on most tenant-scoped tables but `AuditLog` itself has none. PDPA 5-year retention is mentioned in `audit-trail.js:6` as documentation but not enforced.
- **Fallback path silently drops on retry exhaustion** (`audit-logger.js:200-208`). The console.error fallback means high-contention audit volumes can lose entries. ADR-012 accepts this as a trade-off for the current phase; for ERP-grade, this needs a durable failure queue.

### Concrete next step

- **PR-AL-1 — Per-tenant chain.** Already detailed in MT-3 above. ~80 LOC.
- **PR-AL-2 — Checkpointed verification.** Add a `audit_log_checkpoints` table that snapshots `(sequenceNumber, currentHash)` every 10K entries. `verifyChain(start, end)` then verifies a window between checkpoints, not the whole log. ~120 LOC. **Risk**: low.
- **PR-AL-3 — Durable fallback for retry-exhausted writes.** Replace `console.error('[AUDIT_FALLBACK]', ...)` with insert into an `audit_log_dead_letter` table or BullMQ queue. ~40 LOC. **Risk**: low.

**Effort total**: ~240 LOC.

---

## 4. Transactional Integrity (Payment, Cert Issuance)

### What GACP has

- **Payment phase creation IS atomic** — `payment-service-phase-flow.js:108-146` (Phase 1) and `:244-280` (Phase 2) both wrap the application status update + paymentTransaction create in `prisma.$transaction([...])`.
- **Webhook idempotency is real** — `payment-service-webhook-flow.js:88-101` checks `transaction.status === 'SUCCESS' && status === 'SUCCESS'` and short-circuits with `idempotent: true` (audit-logged).
- **Webhook signature verification is real** — `payment-service.js:50-131` supports Stripe-style `t=...,v1=...` with replay protection (5-minute window) and HMAC-SHA256, plus generic `sha256=` form. Constant-time compare via `crypto.timingSafeEqual`.
- **Amount tampering guard** — `payment-service-webhook-flow.js:103-130` verifies claimed amount matches transaction amount.
- **Lab webhook also HMAC-signed** as of PR-1.4 (`lab-webhook-routes.js:21-62`) — `LAB_WEBHOOK_SECRET` + a fallback static API key (defense in depth).
- **Cert issuance is gated on audit pass record** — `certificate-service.js:108-124` requires either `Application.auditResult='PASS'` OR `formData.auditResult='PASS' + auditedAt`. PR-1.3.
- **Cert number is randomized** to prevent enumeration (lines 154-172).

### What Odoo does

`account.move.post()` is wrapped in a transaction. Idempotency on payment is enforced via `account.payment.state` (draft → posted → reconciled) with state-machine guards. Receipts are PDFs hashed and stored.

### Gap

**Cert issuance is NOT transactionally atomic.** `certificate-service.js:187-470`:

- L187-221: `prisma.certificate.create` (one transaction)
- L240-356: `resolveFarmForCertificate` → `prisma.farm.create` or `update` (separate)
- L358-394: `ensurePlotsForFarm` → multiple `prisma.plot.create` (separate)
- L399-470: `createInitialAssets` → `plantingCycle.create`, `harvestBatch.create`, QR generation, batch update (all separate)

If the process crashes between L221 and L470, you get a certificate with no batch — exactly the inconsistency PR-1.3 partially addressed at the audit-result level. The L228-235 try/catch swallows errors from `createInitialAssets` "to not fail the cert generation" — meaning the cert is issued and the trace assets silently fail.

Compare also: `apps/backend/routes/api/audit/audits.js:478-485` flips status before triggering cert gen. The comment at L466-475 says "status flip + cert generation must succeed together or roll back together" — but the code doesn't actually wrap them in a `$transaction`. It does a manual rollback in catch — that's "compensating action," not atomicity.

### Concrete next step

- **PR-TX-1 — wrap cert issuance in `prisma.$transaction(async (tx) => { ... })`** with the farm, plots, cycle, batch all participating. The QR generation may need to remain outside (external service or queue) — emit a queued job at the end of the transaction so QR happens after commit. ~150 LOC refactor of `certificate-service.js`.
- **PR-TX-2 — concurrent application creation guard.** `application-submission-methods.js:13` has no check for "already in-flight application by same applicant." `Application.idempotencyKey @unique` exists in schema (line 85) but is not always populated. Make submission require an idempotency key from the wizard (UUID generated client-side). ~60 LOC.

**Effort total**: ~210 LOC.
**Risk**: medium — cert generation has lots of "best-effort" branches today; making it atomic might surface latent failures that are currently silently swallowed.

---

## 5. Customization / Configuration Layer

### What GACP has

- `Organization.settings: Json @default("{}")` (`tenancy.prisma:60`) — declared as the per-tenant config bag, **but the codebase has zero reads of `organization.settings`** (Grep confirmed). Dead field as of 2026-04-28.
- `SystemConfig` (`system.prisma:41-51`) — global key/value table.
- `WizardStepConfig` (`system.prisma:57-93`) — dynamic wizard step toggles, plant-group filtering, validation rules JSON. This is genuinely impressive — Odoo would call this `studio` territory.
- `entitlements-service.js` — feature catalog with tier gating (FREE/PREMIUM/ENTERPRISE), `BILLING_FREE_TIER_FOR_ALL` env override.
- 14 files reference `ENABLE_*` / `FEATURE_*` env vars — env-driven feature flags only, no DB-backed flags per tenant.
- `feeService` computes phase 1/2 amounts, but the formula is hardcoded in code, not in config.

### What Odoo does

- `ir.config_parameter` — global key/value (`SystemConfig`-equivalent).
- View inheritance — XML `<xpath>` declarations override layouts per company.
- Module manifest + `_inherit` model extension — install/uninstall extends data model and UI.
- Per-company fee rules via `account.tax`, `product.pricelist`, etc. — declarative rule tables.

### Gap

- **`Organization.settings` is unused.** Defined in schema, intended per ADR-014 to hold "branding, feature flags, workflow overrides," but no read site exists. Fine if multi-tenant rollout hasn't reached customization phase, but should be documented or removed.
- **Fees are not per-tenant.** `feeService.calculateApplicationFees` returns the same `phase1.total` and `phase2.total` regardless of tenant. For private certifier vs. government office vs. foreign standard body, the fee schedule should differ.
- **No declarative workflow customization per tenant.** A government tenant might require an additional review step. Today this requires code change + redeploy.
- **Feature flags are env-only.** Toggling a feature for one tenant requires server restart. `ENABLE_*` is binary, global.

### What is appropriate to defer

A full Odoo-style module/manifest system is overkill for a single-country single-standard cert platform. The first real need is **per-tenant fee schedule** and **per-tenant audit checklist templates** (`AuditChecklist` is already a model). Both can be done as data-table-driven without a customization framework.

### Concrete next step

- **PR-CF-1 — Read `organization.settings` in `feeService`** for fee overrides. ~40 LOC + 1 unit test. **Effort**: small. **Risk**: low.
- **PR-CF-2 — Persist feature flags in `Organization.settings.featureFlags`**, exposed via `entitlements-service` per-tenant. ~100 LOC. Replaces 14 env reads with one tenant-aware service. **Risk**: low.
- **PR-CF-3 — DEFER full customization layer.** Until the second tenant has a concrete request that env+settings can't satisfy, do not build a manifest system. The cost (1000+ LOC + maintenance burden) is not justified.

**Effort total**: ~140 LOC.

---

## 6. Reporting / BI

### What GACP has

- `controllers/report-controller.js` — two endpoints: `summary` and `kpi`.
- 30 files mention `report|dashboard|stats` in routes — handlers spread across `provider/handlers/*-dashboard-handler.js` and `system/dashboard.js`, `system/analytics.js`.
- `documents/reports.js`, `documents/report-submissions.js` for compliance report submissions.
- `services/financial-export-service.js` (exists, did not deep-read).

### What Odoo does

- `report.qweb` — XML/HTML PDF templates with Python data preparers.
- `xlsxwriter` integration for Excel exports.
- Materialized views for heavy reports + scheduled refresh.
- Dashboards via `web_dashboard` module — drag-and-drop pivot/graph views.

### Gap

- **All counts are computed on every request** — `report-controller.js:34-64` runs 5 separate `prisma.application.count` queries on every `GET /api/provider/reports/summary` hit. On a single tenant with thousands of applications, fine; at 50K+ applications across multiple tenants, this is a sequential-scan tax. **No materialized views, no summary tables.**
- **Reports do NOT scope by tenant** (`report-controller.js:34-39`) — `prisma.application.count({ where: { createdAt, isDeleted } })` has no `organizationId` filter. Once tenant #2 onboards, the summary endpoint shows numbers across all tenants. (Same gap as §2 read scoping; reports are a particularly visible casualty.)
- **No export formats** — JSON only. No PDF or Excel from these endpoints (PDF cert generation exists separately).
- **Revenue calc loads all transactions into memory** (lines 69-79) — `findMany({...}).reduce`. Should be `aggregate({ _sum: { amount: true } })`. ~5 LOC fix, but indicative.

### Concrete next step

- **PR-BI-1 — tenant-scope reports.** Add `organizationId` filter to all `prisma.*.count/findMany` in `report-controller.js`. Trivially fixed by §2 read-scoping. ~20 LOC if done independently.
- **PR-BI-2 — switch revenue from findMany+reduce to aggregate.** ~10 LOC.
- **PR-BI-3 — DEFER materialized views** until report query latency becomes a real problem. Add a metric on report endpoints first; do MV only if p95 > 500ms.
- **PR-BI-4 — DEFER PDF/Excel export** until a customer asks.

**Effort total**: ~30 LOC short-term, deferred work flagged.

---

## 7. API / Integration Surface

### What GACP has

- Active endpoint list at `docs/api/active-api-surface.md` (90 lines, last updated 2026-02-15) — explicit "canonical for new integrations" stance.
- `openapi/*.yaml` — 8 service specs, 4525 total lines.
- API versioning middleware (`middleware/api-version.js`) — supports URL-prefix `/api/v1/...` AND `X-API-Version` header. Currently only v1. `requireVersion()` and `deprecateEndpoint()` helpers exist but are not used in any route I sampled.
- JWT bearer auth + role-based middleware (`authenticateHealth`, `authenticateProvider`, `authenticateAny`).
- HMAC-signed webhooks (lab + payment).
- API key auth for partner integrations.
- CI guard `scripts/ci/check-orphan-api-routes.js` for keeping the route table clean.

### What Odoo does

- `/jsonrpc` and `/xmlrpc/2/object/execute_kw` — single stable RPC endpoint for every model and method. Versioning per-method via signature.
- Webhooks via OCA addons.
- REST API as a community addon (not core).

### Gap

- **OpenAPI specs are stale.** `openapi/application-service.yaml:15-29` documents a 14-state workflow with names `INSPECTION_SCHEDULED`, `CERTIFICATE_ISSUED`, `PAYMENT_VERIFIED`, `PHASE2_PAYMENT_PENDING` — none of these are in the runtime `WORKFLOW_STATES` (which has `AUDIT_CONFIRMED`, `CERTIFIED`, `DOC_FEE_PAID`, `PENDING_AUDIT_FEE` instead). External integrators reading these specs write code against a workflow that does not exist.
- **API versioning middleware is wired but unused.** `requireVersion('1')` is not called from any router. The middleware sets `X-API-Version` and `X-API-Supported-Versions` headers but no endpoint enforces a version.
- **No `/api/v1/...` prefix.** All current routes are `/api/...` (no version segment). The middleware regex `/^\/api\/v(\d+)\//` matches a URL pattern that does not exist in production. So the middleware just sets `req.apiVersion = '1'` always.
- **RBAC matrix is documented in `docs/architecture/canonical-permission-matrix.md`** but not verified against the runtime middleware.

### What is excellent

- **Webhook security is best-in-class for the domain** — HMAC + replay window + amount-tampering guard + audit-logged failure modes. Better than most fintechs at this stage.
- **API versioning was designed up front**, even if unused. The hooks are there for v2 when needed.
- **OpenAPI specs exist at all** — many ERP-aspirant systems don't have any.

### Concrete next step

- **PR-API-1 — regenerate OpenAPI from runtime.** Either (a) auto-generate from JSDoc/route handlers using `swagger-jsdoc` (which the openapi-tools.json hints at), or (b) hand-update `application-service.yaml` to match `WORKFLOW_STATES`. Recommend (a) — drift will recur otherwise. ~200 LOC of swagger-jsdoc annotations + 1 build script. **Risk**: low.
- **PR-API-2 — actually use the version middleware.** Either prefix all routes with `/api/v1/...` (mass file rename, ~50 files touched, mostly safe) OR drop the middleware and document that we'll add versioning at v2. Pick one and commit. ~20 LOC + docs OR ~200 LOC of route re-mounts. **Risk**: low.
- **PR-API-3 — verify RBAC matrix against runtime.** Write a test that builds the matrix from `ROLE_TRANSITIONS` + `authenticateProvider` middleware whitelists and diffs against `canonical-permission-matrix.md`. ~80 LOC.

**Effort total**: ~300 LOC + 1 build pipeline change.

---

## Prioritized Roadmap

### Phase A — Must do (blocks "ERP-grade" claim)

| # | PR | Effort (LOC) | Risk | Why it blocks |
|---|----|----|------|--------------|
| 1 | **PR-WF-1** funnel status updates through canonical writer | ~750 | Med | State machine without enforcement is documentation. 92 bypass sites = no real guarantee. |
| 2 | **PR-MT-1** read-side tenant scoping in Prisma extension | ~150 | Med | Tenant #2 onboarding triggers an immediate cross-tenant data leak. |
| 3 | **PR-MT-3** per-tenant audit chain unique constraint | ~80 | High | Required before tenant #2; load-bearing migration on audit infra. |
| 4 | **PR-TX-1** atomic cert issuance | ~150 | Med | Cert + farm + plot + cycle + batch must commit as one unit. |
| 5 | **PR-API-1** regenerate OpenAPI from runtime | ~200 | Low | Public spec must match reality before external partners use it. |

**Phase A total**: ~1330 LOC. Estimate 3-4 dev-weeks with review.

### Phase B — Should do (hardens the claim)

| # | PR | Effort (LOC) | Risk |
|---|----|----|------|
| 6 | **PR-MT-2** ship Phase 3c RLS | ~250 | Med-High |
| 7 | **PR-AL-2** checkpointed audit-chain verification | ~120 | Low |
| 8 | **PR-AL-3** durable fallback for retry-exhausted audit writes | ~40 | Low |
| 9 | **PR-TX-2** application submission idempotency key from wizard | ~60 | Low |
| 10 | **PR-CF-1** read `organization.settings` in feeService | ~40 | Low |
| 11 | **PR-API-2** wire version middleware OR drop it | ~200 | Low |
| 12 | **PR-BI-1** tenant-scope reports (subsumed by MT-1 if done together) | ~20 | Low |

**Phase B total**: ~730 LOC. Estimate 2 dev-weeks.

### Phase C — Nice to have (polish)

| # | PR | Effort (LOC) | Risk |
|---|----|----|------|
| 13 | **PR-CF-2** per-tenant feature flags in `Organization.settings` | ~100 | Low |
| 14 | **PR-API-3** runtime RBAC matrix verification | ~80 | Low |
| 15 | **PR-BI-2** revenue with `aggregate` not `findMany+reduce` | ~10 | Low |
| 16 | Phase 3b PR D — `organizationId NOT NULL` (already planned in handoff) | ~50 (migration) | Med |

**Phase C total**: ~240 LOC.

### Explicit non-recommendations

- **Don't build a module/manifest customization layer** until a real second tenant blocks on it. The cost (~1000+ LOC + ongoing maintenance) is not justified for a single-country, single-standard cert system.
- **Don't add multi-currency.** Irrelevant for THB-only platform.
- **Don't pre-build materialized views for reports.** Measure first; today's data volume doesn't warrant it.
- **Don't migrate to Camunda/Temporal.** Your in-house state machine in `workflow-transition-service.js` is exactly the right scope for this domain.

---

## Total LOC estimate

- Phase A: ~1330 LOC
- Phase B: ~730 LOC
- Phase C: ~240 LOC
- **Grand total: ~2300 LOC over ~6-8 dev-weeks** (one engineer at full focus, faster with two).

This converts "ERP-grade by ambition" to "ERP-grade by enforcement."

---

## Surprises during the audit

- The **state machine quality is genuinely high** — frozen state set, role-keyed transitions, mandatory-comment targets, force-only-by-admin. Comparable to or better than what Odoo gives you out of the box.
- The **audit log hash-chain is real** — SHA-256, deterministic payload, recompute-and-verify routine. Most "audit logs" in similar codebases are append-only Postgres tables with no integrity proofs at all.
- The **tenant-injection extension throws on cross-tenant write attempts** — stronger stance than "filter and hope" and shows real architectural maturity.
- Conversely: the **lab webhook (`lab-webhook-controller.js:40`) writes `status='REJECTED_LAB'`** as an auto-transition state, but `REJECTED_LAB` is not in `WORKFLOW_STATES`. Active bug — any application that fails a lab test gets stuck in a state that doesn't exist in the SM, with no defined transitions out. **Worth a separate spawned task.**

---

## Recommendation: operator review before Phase A starts

**YES** — operator review required before any Phase A work begins. Two reasons:

1. **PR-MT-3 (audit chain unique constraint migration)** is load-bearing on existing audit data and timing must coordinate with Phase 3b PR D — the operator should sequence these consciously, not let agents grab them in arbitrary order.
2. **PR-WF-1 (funnel 92 status-update sites through one writer)** is high blast radius and a single bad merge could regress half the workflow — needs a tactical plan (feature flag, observable rollout) before the first commit.
