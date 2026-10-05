# System Cohesion Master Plan — GACP Platform

- **Date:** 2026-04-28
- **Author:** Synthesis of 6 parallel architectural audits
- **Scope:** Cross-domain prioritization + execution sequencing + dependency map
- **Audience:** Operator (@jonmaxmore) — strategic decision document

## Why this document exists

User feedback (translated, paraphrased): *"The system works partially. Workflow is messy. UX isn't government-grade. Document templates are inconsistent. Billing flow is hallucinating. Files/folders look robot-named. Server isn't clean."*

Six audits ran in parallel against the live codebase, each producing a domain-specific markdown report. **This document synthesizes them** into one prioritized execution plan that:

1. Sequences fixes so dependencies don't break each other
2. Surfaces the **P0 production bugs** that must be hot-fixed regardless of strategic decisions
3. Maps the "do this now" vs "do this next quarter" line clearly
4. Names what NOT to do, so engineering effort doesn't fragment

## The 6 audits

| Audit | File | Key insight |
|---|---|---|
| Workflow discipline review | `2026-04-28-workflow-discipline-review.md` | State machine bypassed by 92 sites; multi-tenancy lacks read-side scoping |
| Code organization + naming | `2026-04-28-code-organization-review.md` | `apps/backend/scripts/` snake_case dump + tracked build artifacts = the "messy" feeling |
| Design system + UX | `2026-04-28-design-system-review.md` | No persistent footer + glass-orb splash = doesn't feel like government |
| Document + template | `2026-04-28-document-template-review.md` | **`{{Applicant_NAME}}` typo** breaks every issued cert; capital-P require breaks Linux |
| Billing + payment flow | `2026-04-28-billing-flow-review.md` | "หลอนๆ" root cause: 3 fee models disagree + dual-invoice never reconciled |
| Server hygiene + ops | `2026-04-28-server-hygiene-review.md` | Container logs unbounded; 3 backup paths with DB-name mismatch |

**Net total LOC across all phases:** ~7,500 LOC over 6-12 dev-weeks.

## P0 Hot-fixes (DO IMMEDIATELY — production is broken)

These are concrete, self-contained, **discovered as active bugs** during the audits. They don't depend on any strategic decision. Fix THIS WEEK.

| # | Bug | File | Fix size | Impact |
|---|---|---|---|---|
| **P0-1** | `{{Applicant_NAME}}` placeholder typo on every issued certificate | `apps/backend/services/pdf/templates/certificate.html:339` | 1 line | Every cert prints literal `{{Applicant_NAME}}` instead of the applicant's name |
| **P0-2** | `require('./PdfGenerator.service')` capital-P breaks Linux production | `audit-report-service.js:5`, `car-report-service.js:6` | 2 lines | First audit/CAR PDF request crashes the audit/CAR generator on prod |
| **P0-3** | `REJECTED_LAB` workflow state undefined (PR already pushed: `fix/workflow-rejected-lab-state`) | `workflow-transition-service.js`, `lab-webhook-controller.js` | already done | Apps stuck in undefined state when lab fails |
| **P0-4** | Container logs unbounded — disk-fill bomb | `/etc/docker/daemon.json` (operator action) + `docker-compose.production.yml` (PR) | ~80 LOC | Will fill `/var/lib/docker/` and crash everything at random Tuesday 02:00 |
| **P0-5** | `fee-service.buildPhaseFee` returns `total: stateAmount` — gateway under-charges by 535/2,675 baht per phase | `apps/backend/services/fee-service.js:125` | ~30 LOC | Revenue leak; all paid invoices since this regression are short by VAT+platform |
| **P0-6** | `pricing.js:188` Phase 2 doesn't multiply by areaCount | `apps/backend/routes/api/finance/pricing.js:188` | 1 line | Public pricing API undercharges multi-method applications |
| **P0-7** | `holdInvoice`/`releaseHold` write to nonexistent `Invoice.metadata` column | `invoice-finance-ops.js:43-51, 67-75` | ~50 LOC | Endpoints throw P2009 at runtime |
| **P0-8** | Receipt duplicate "อีเมล" line, no phone | `receipt.html:250`, `gacpthai-document-layout.tsx:55`, `tax-invoice.html`, `quotation.html`, `invoice.html` | ~5 lines + 1 constants file | Receipt looks unprofessional on government tax document |

**Total P0:** ~170 LOC across ~10 files. **Effort: 1 day.** **Risk: low** (each is a contained fix on a known bug). Recommend ONE consolidated PR `fix/p0-bugs-from-audit-2026-04-28` rather than 8 micro-PRs.

## Strategic Phase A — Foundations (Do NEXT — ~3-4 weeks)

Phase A items from each audit, deduplicated and sequenced. Each PR can land independently after the prerequisite (if any).

### A1 — Server hygiene operator work (operator only, 2 hours)
1. Run `docs/architecture/2026-04-28-server-hygiene-review.md` §12 audit checklist
2. Apply Phase A operator fixes (log caps, env perms, fail2ban)
3. Confirm backup cron is wired
4. **No code changes**

**Why first:** Reveals current server state. Some Phase A code changes depend on knowing what's running.

### A2 — Repository hygiene (Phase 1 of code-organization audit)
PR `chore/repo-hygiene-baseline`:
- Delete tracked build artifacts (`apps/web-app/lint.txt`, `lint-report.json`, tmp-shots)
- Delete service shims (5/13/8-line files)
- Consolidate doc audit folders (3→1)
- Delete one-off vibe scripts

**LOC:** ~40 deletes, 0 functional change. **Risk: low.** **No prerequisite.**

### A3 — Documentation P0s (Phase A of doc-template audit)
Already covered above as P0-1, P0-2, P0-8. Plus:
- Filename uses cuid not cert number → use `cert.certificateNumber`
- Move audit + CAR storage to MinIO
- Add render-time guard for surviving `{{...}}` placeholders

**LOC:** ~200. **Risk: low.** **No prerequisite.**

### A4 — Billing P0s (Phase A of billing-flow audit)
Already covered above as P0-5, P0-6, P0-7. Plus:
- Unify `resolveHealthId` into single `shared/auth/billing-identity.js`
- Fix `accounting.js` paid-status set

**LOC:** ~150. **Risk: low.** **No prerequisite.**

### A5 — Government-grade UX foundations (Phase A of design-system audit)
PR `feat/government-grade-ux`:
- Render persistent `<GovernmentFooter />` in AppShell + DashboardLayout
- Tone down splash (replace orb mesh with static logo + ministry block)
- Switch header primary line to Thai full name
- Fix WCAG AA contrast on `--secondary` (gold)
- Delete phantom `design-system.ts` palette

**LOC:** ~600. **Risk: medium** (UX polish has subjective review). **No prerequisite.**

### A6 — ERP discipline foundations (Phase A of ERP audit)
This is where ERP-grade discipline lands. **Strategic-decision required.**

| Sub-PR | Effort | Risk | Recommend |
|---|---|---|---|
| PR-WF-1 funnel status updates through canonical writer | ~750 LOC | Med | Required for "ERP-grade" claim |
| PR-MT-1 read-side tenant scoping in Prisma extension | ~150 LOC | Med | Required before tenant #2 ships |
| PR-MT-3 per-tenant audit chain unique constraint | ~80 LOC | High | Required before tenant #2 ships |
| PR-TX-1 atomic cert issuance (transaction-wrap) | ~150 LOC | Med | Required to claim atomic delivery |
| PR-API-1 regenerate OpenAPI from runtime | ~200 LOC | Low | Required if external partners use API |

**LOC:** ~1330. **Risk: medium-high.** **Operator review required before starting** (per ERP audit recommendation).

**Why last in Phase A:** P0s and lower-risk PRs land first. ERP discipline work is biggest blast-radius and benefits from the cleaner foundation.

## Strategic Phase B — Hardening (~2-3 months)

Phase B items, deduplicated:

| From | PR | LOC | Why |
|---|---|---|---|
| ERP | PR-MT-2 ship Phase 3c RLS | ~250 | Defense in depth on top of MT-1 |
| ERP | PR-AL-2 checkpointed audit-chain verification | ~120 | Audit log scales past 10M rows |
| ERP | PR-AL-3 durable fallback for retry-exhausted writes | ~40 | No silent audit-log loss |
| ERP | PR-TX-2 application submission idempotency key | ~60 | Prevent concurrent in-flight apps |
| ERP | PR-CF-1 read `organization.settings` in feeService | ~40 | Per-tenant fee schedules |
| ERP | PR-API-2 wire version middleware OR drop it | ~200 | Stop pretending versioning is wired |
| Code-org | Phase B items (38 backend/scripts triage, wizard new-legacy migration, etc.) | ~50 file moves | Drift cleanup |
| Design | Phase B items (bottom-nav consolidation, color token migration, i18n top 20) | ~600 | Systematization |
| Doc-template | Phase B items (single source of truth for slots, self-host Sarabun, MinIO audit storage) | ~600 | Template convergence |
| Billing | PR-Bil-B (collapse dual-invoice to single-invoice with line items) | ~250 | The actual "หลอนๆ" fix |
| Billing | PR-Bil-B2 (applicant-side receipt download) | ~40 | Missing UX |
| Server | PR-Srv-B1 to B7 (logging caps committed, secret rotation runbook, alertmanager decision, GHCR cleanup) | ~400 | Operational maturity |

**Phase B total:** ~2,850 LOC across ~50 files. **Effort: 2-3 dev-months.**

## Strategic Phase C — Polish (~1-2 quarters, optional)

Phase C items are explicit "deferred" recommendations:

- Per-tenant feature flags
- RBAC matrix runtime verification
- Document versioning + PAdES signing
- Refund/cancel/renewal billing flows
- DR runbooks + offsite backup
- DNS migration sslip.io → gacpth.com
- Frontend Lint cleanup (152 warnings)
- StageRibbon persistent across applicant routes
- Audit-trail viewer page for applicants

**Phase C total:** ~3,000 LOC. **Effort: 2-3 dev-months.** **Defer until Phase A+B complete and a real customer asks.**

## Cross-cutting findings — NOT recommendations

These are "don't do this" findings consistent across multiple audits. Resist the temptation:

- **Don't rewrite anything as a microservice or split into multi-repo.** Single monorepo + single deploy is correct for this scale.
- **Don't migrate to Kubernetes.** Single-droplet Docker Compose is appropriate.
- **Don't introduce a workflow engine (Camunda/Temporal).** In-house state machine in `workflow-transition-service.js` is the right scope.
- **Don't introduce a billing engine (Stripe Tax, Chargebee).** Thai gov VAT model is bespoke; existing Ksher integration is solid.
- **Don't switch UI library again.** shadcn primitives are sufficient.
- **Don't switch PDF library.** Puppeteer + HTML is correct for Thai script.
- **Don't switch monitoring stack.** Prometheus + Grafana + Loki are deployed; wire what exists.
- **Don't add an SRE on-call roster.** Solo-ops at this scale needs a paging path, not a roster.
- **Don't full DDD/hex-arch.** Route + service + Prisma model is sufficient.
- **Don't multi-currency.** THB-only platform.
- **Don't add a customization framework (Odoo-style modules).** Per-tenant fees + checklists in `Organization.settings` is the right scope.
- **Don't pre-build materialized views for reports.** Measure first.

## The single biggest insight across all 6 audits

Every audit independently arrived at variations of the same observation:

> The platform's **bones** are stronger than its **flesh**. Real workflow state machines, real hash-chained audit logs, real multi-tenancy primitives, real HMAC webhook security, real design tokens. But each is **opt-in** — bypassed by ad-hoc shortcuts elsewhere in the codebase. The work isn't to build these systems; it's to **enforce that they're the only path** for things that should go through them.

Examples:
- ERP review: state machine exists, 92 sites bypass it
- Multi-tenancy: write injection exists, read scoping doesn't
- Design tokens: HSL spine exists, 170 hardcoded colors bypass it
- i18n dictionary: complete and parallel, 2,700 raw Thai literals bypass it
- Document templates: Puppeteer engine exists, audit reports use inline strings
- Billing: 3 sources of truth for fees, all "real," none canonical

**Phase A is the enforcement work.** Lock the foundations down so future development can't drift from them.

## Recommended execution order

```
Week 1:
  ├── P0 hot-fixes (1 day)
  ├── A1 Server hygiene operator work (2 hours)
  └── A2 Repository hygiene (1-2 days)

Week 2:
  ├── A3 Documentation P0s
  ├── A4 Billing P0s
  └── A5 Government-grade UX foundations [requires UX/product review]

Week 3-4:
  └── A6 ERP discipline foundations [requires operator strategic review]

Months 2-3:
  └── Phase B items (parallelizable across 2-3 engineers)

Months 4-6:
  └── Phase C polish + deferred items (only as customer feedback warrants)
```

## Decision points for the operator

This is where YOU need to decide before the next sprint planning:

### 1. Phase A6 (ERP discipline) — green-light or defer?

**Cost:** ~1330 LOC, ~3-4 dev-weeks, medium-high risk.
**Benefit:** "ERP-grade by enforcement" claim becomes defensible. Tenant #2 onboarding becomes safe.
**Risk if skipped:** Tenant #2 onboarding hits cross-tenant data leak.
**Recommend:** Green-light if you anticipate adding a second tenant within 6 months. Defer otherwise.

### 2. Phase A5 (Government UX) — internal product review required

**Cost:** ~600 LOC, medium UX-subjective risk.
**Benefit:** First impression reads as government, not SaaS startup.
**Recommend:** Get one product/UX stakeholder review of the proposed `<GovernmentFooter />` content + tone-down-splash mockup before greenlighting.

### 3. Billing model overhaul (Phase B PR-Bil-B) — required to fix "หลอนๆ"

**Cost:** ~250 LOC including migration.
**Benefit:** "Phase 1 paid but platform fee pending" contradiction goes away. Single invoice per phase, three line items.
**Risk:** Migration on existing invoice data needs care.
**Recommend:** Yes, but only after Phase A4 (billing P0s) ships. Otherwise the migration target is itself buggy.

### 4. Server hygiene Phase A — operator-only, no decision needed

**Cost:** 2 hours operator time on the droplet.
**Benefit:** Closes the disk-fill risk + tightens secret file perms + activates fail2ban.
**Recommend:** Run §12 checklist this week regardless of any other decisions.

## What this synthesis is NOT

- Not an implementation guide. Each audit doc has the per-domain implementation detail.
- Not a complete bug list. Audits surfaced ~50 specific issues; only the most cross-cutting are summarized here.
- Not a project plan. Sequencing is recommendation; final plan depends on engineering capacity.
- Not a re-architecture. The recommendation across all audits is **enforce what exists, don't replace it.**

## Cross-references

- Original workflow-discipline architectural review: `docs/architecture/2026-04-28-workflow-discipline-review.md`
- Code organization audit: `docs/architecture/2026-04-28-code-organization-review.md`
- Design system + UX audit: `docs/architecture/2026-04-28-design-system-review.md`
- Document + template audit: `docs/architecture/2026-04-28-document-template-review.md`
- Billing + payment flow audit: `docs/architecture/2026-04-28-billing-flow-review.md`
- Server hygiene + ops audit: `docs/architecture/2026-04-28-server-hygiene-review.md`
- ADR-008 preview gate enforcement: `docs/adr/ADR-008-preview-gate-enforcement-before-deploy.md`
- ADR-014 multi-tenancy phase 3 handoff: `docs/adr/ADR-014-phase-3-handoff.md`
- v3.3.0 production deploy log: `/var/log/gacp-deploys/20260428-044619.log` (on production)
- Branch protection setup: `docs/operations/branch-protection-setup.md`
