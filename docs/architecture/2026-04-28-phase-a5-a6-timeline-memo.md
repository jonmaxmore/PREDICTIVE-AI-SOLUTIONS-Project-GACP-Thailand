# Phase A5 / A6 timeline & go-no-go memo

**Status:** Recommendation (decision needed from project owner)
**Author:** Project team (2026-04-28)
**Inputs:**
- `2026-04-28-rfc-phase-a5-government-ux.md`
- `2026-04-28-rfc-phase-a6-workflow-discipline.md`
- live user feedback during this session (3 production bugs / UX issues)
- session deliverables completed up to v3.4.2

---

## TL;DR

Recommended sequence — **A5-Step1 first, A6 in parallel after that**:

| Week | What ships | Why this order |
|---|---|---|
| W0 (now) | Hot-fixes done in v3.4.2: canonical phase status, payment waiting banner, rotate-secret SMOKE_URL | Already shipped, no decision needed |
| W1 | **A5-Step1 — `GovLayout` + `Footer` primitive, advisory only (existing pages unchanged)** ✅ in PR #24 (`feat/phase-a5-step1-govlayout`) | Adds the layout contract without breaking anything; lets every following step plug into it |
| W2-W3 | A5-Step9 — refactor `/health/planting/[id]` and 2-3 other dense pages onto `GovLayout` | This is the page the user named today as "งง / ซ้ำซ้อน". Concrete user-visible win in 2 weeks. |
| W2-W4 (parallel) | A6-Step1+2 — module dirs + service registry (advisory ESLint) | Pure indirection, zero runtime risk; lets the file moves start happening per PR |
| W4-W5 | A5-Step5+6 — Sarabun self-host + `/accessibility` page | Removes Google Fonts privacy leak; ministry handover deliverable |
| W5-W6 | A6-Step3 (D.1+D.2) — `organizationId NOT NULL` + drop default-org fallback | Prepare for tenant #2; needs staging burn-in |
| W6-W8 | A6-Step3 (E.1) — RLS policies | Defence-in-depth; coordinated maintenance window |
| W7-W10 | A5-Step3+4 — migrate `provider/*` + marketing routes to GovLayout, ESLint flip to error | Now that the primitive is proven, ratchet to 100% coverage |
| W10-W12 | A6-Step4 — generic `WorkflowMachine` | Lower-priority cleanup; do this when other work is in QA |
| Ongoing | A6-Step5 — `/// @audit` annotation rollout | Adds rows to schema docstrings as new fields land; no big-bang |

Total: **~12 weeks of normal-velocity work**, with user-visible wins at W3 and W5.
A5 takes ~7 weeks of effective time (~830 LOC). A6 takes ~10 weeks of effective time (~2 550 LOC).
They run in parallel because A5 is mostly frontend and A6 is mostly backend.

---

## Why this order — three principles

### 1. Land structural primitives first, migrate consumers after

Both RFCs follow this pattern: A5 ships `GovLayout` first then migrates pages onto it; A6 ships the module-dir contract first then migrates files into it. The first PR in each stream is **pure addition** — zero risk to running code. Only the migration PRs touch existing files.

This is what made v3.4.0's CI preventive-controls work: we shipped the lint-baseline ratchet before driving frontend-lint warnings down. Same playbook here.

### 2. User-visible wins before invisible refactors

The user named planting page UX **today**. If we lead with A6 (modules + RLS), the user sees nothing change for 6+ weeks. Leading with A5 means a concrete "look at the new planting page" within 2-3 weeks.

A6's invisible payoff (multi-tenant safety) only matters once tenant #2 is real. If tenant #2 is months away, A5 has higher near-term value.

### 3. Parallelism comes from independent layers

A5 only touches `apps/web-app/src/app/**` and `tailwind.config.js`. A6 only touches `apps/backend/**` and `apps/backend/prisma/**`. Two engineers (or one engineer alternating focus) can run them concurrently with zero merge conflicts.

The exception is A5-step6 (`/accessibility` route) which needs the ministry contact constants from `shared/ministry-contact.js` — already shipped, so no blocker.

---

## Three go / no-go decisions you need to make

### Decision 1: Is tenant #2 within 4 weeks?

- **Yes** → flip the recommended sequence: do **A6-Step3** first (NOT NULL + RLS), pause A5 until tenant #2 onboards. The cost of late multi-tenancy maturity is much higher than slow UX maturity.
- **No** (recommended default) → run A5/A6 in the order above. Both RFCs proceed in parallel.

### Decision 2: Accessibility statement legal text

A5-Step6 needs the `/accessibility` route to render real legal copy.
Options:
- **(a)** Translate the gov.uk model accessibility statement (CC-BY licence; takes ~4 hours of a Thai legal reviewer)
- **(b)** Wait for DTAM to provide their own template (could take weeks)
- **(c)** Use a placeholder marked clearly as "draft" until (a) or (b) lands

**Recommended:** ship (c) the placeholder when the route lands at W5, replace with (a) once translated. Matches "ship v1, ratchet" pattern.

### Decision 3: Maintenance window for RLS rollout

A6-Step3 / E.1 requires a maintenance window because RLS policies, once enabled, can lock out queries that forget to set `app.tenant_id`. Options:
- **(a)** Sunday 02:00-04:00 ICT — same window as the daily backup; minimal user impact
- **(b)** Coordinated with tenant #2 onboarding, since that's when multi-tenant surfaces first
- **(c)** "Soft" rollout — enable policies in `RESTRICTIVE` ALLOW-mode for 1 week (logs every query that would fail), then flip to enforce

**Recommended:** (c) → (a). The soft-rollout week catches every offending query without breaking anything; the window flip after that is a 30-second `ALTER POLICY`.

---

## Cross-cuts I'm watching for

- **Frontend lint baseline**: A5's `no-raw-color` rule should ratchet *alongside* the existing `frontend-lint-baseline.json` from PR #21, not replace it. The CI machinery already exists.
- **Schema migration discipline**: A6-Step3 adds 3 migrations. The drift gate from PR #11 will catch any schema-file vs. migration-folder drift before merge. No regression to that workflow.
- **Audit log retention**: A6-Step5 increases audit-row volume by ~5x once `/// @audit` annotation reaches the ~70-field target. Need to verify Postgres disk projection — likely fine on the current 116 GB volume but worth a back-of-envelope.
- **CI build minutes**: A5 adds Lighthouse runs to CI for the 3 core routes. ~3 min added per PR. Acceptable; no opt-in needed.

---

## What I would NOT do right now

- **Don't combine A5 and A6 into one epic PR.** They're independent; combining doubles the review surface and the conflict risk.
- **Don't start with A6-Step4 (generic WorkflowMachine).** It's the lowest-value, highest-rewrite step in either RFC. Do it last when other work is queued.
- **Don't introduce shadcn/ui in A5.** Tempting because it would replace half of `GovLayout`, but it adds a new dependency surface during a stability-focused period. Re-evaluate after A5 ships.
- **Don't skip the soft-rollout for RLS.** Hard-enforcing policies day-1 has cost a similar Thai gov-tech project a 6-hour outage in 2024 (cited internally). The soft week is cheap insurance.

---

## Operator decisions log

| # | Decision | Status |
|---|---|---|
| (ก) | Tenant #2 onboarding within 4 weeks? | ⏳ pending |
| (ข) | Accessibility statement source — translate gov.uk / wait DTAM / placeholder | ✅ resolved 2026-04-28 — option (c) placeholder shipped in v3.5.0 |
| (ค) | RLS rollout window | ⏳ pending — recommended: (c) soft-rollout 1-week observe |
| (ง) | Engineer for parallel A6 work | ⏳ pending |
| (จ) | Billing dual-invoice consolidation timing | ⏳ pending — needs low-load window |
| (ฉ) | DNS sslip.io → gacpth.com cutover | ✅ resolved 2026-04-29 — already on **Cloudflare** in front of gacpth.com; no sslip migration needed. The 2026-04-28 server-hygiene audit's DNS-failover concern is closed by the Cloudflare anycast layer. |
| (ช) | Alertmanager + exporters: deploy or delete aspirational config | ⏳ pending |

---

## What we'll know in 2 weeks (early signals)

If A5-Step1 ships clean and A5-Step9 starts with the planting page:
- ✅ user feedback re-confirms "หน้านี้ดูสะอาดแล้ว"
- ✅ Lighthouse score on the migrated page ≥ 95
- ✅ no regressions on routes still using the old layout

If those signals hit, we accelerate the rest of A5 (cut the W7-W10 window to W6-W8). If they don't, we pause A5 and investigate before migrating more pages.

A6 has no public-visible signals at W2-W4 — internal: `pnpm jest` passes, ESLint cross-module rule fires < 5 times after the first migration PR, no cross-domain `require()` introduced in any merged PR. Same go/no-go gate at W4 before committing to the NOT NULL migration.

---

## Operator action items right now

You don't need to do anything mechanical — A5/A6 are PRs that I (or another engineer) submit and you review.

What you DO need to provide:
1. **Decision 1** — tenant #2 timeline (one sentence)
2. **Decision 2** — accessibility-statement source preference (a/b/c)
3. **Decision 3** — RLS rollout window preference (a/b/c)
4. **Optional**: name an engineer who'll take A6 in parallel with my A5 work, OR confirm I should sequence them serially (longer overall but lower coordination overhead)

Once those four are answered, the next 12 weeks have a clear plan and don't need another decision-memo until A5 ships.
