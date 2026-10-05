# Code Organization + Naming Audit — GACP Platform

- **Reviewer:** Plan agent (read-only)
- **Date:** 2026-04-28
- **Mode:** Read-only research
- **Scope:** Top-level repo, apps/backend, apps/web-app, scripts, docs, packages

## Executive Summary

**Top 3 strengths:**
1. **Backend route taxonomy is clean.** `apps/backend/routes/api/{applications,cultivation,finance,audit,trace,documents,certificates,identity,...}` is domain-driven, thin route files, mostly under 300 LOC each. No leakage to fix here.
2. **Frontend role boundary is real.** `apps/web-app/src/app/{health,provider,admin,(public),(auth)}/` enforces RBAC at the routing level. Each role has its own layout + nav, no role bleed.
3. **Naming convention has a winner already.** Kebab-case dominates (~95% of files), `.test.js/.test.ts` is the chosen test suffix, date-prefixed audit docs follow `YYYY-MM-DD-slug.md`. The convention is set; the work is enforcing it.

**Top 5 gaps:**
1. **Three doc audit homes** — `docs/audit/`, `docs/audits/`, `docs/audit-reports/` all coexist with overlapping content. Reader has no idea which is canonical.
2. **Folder-vs-flat duplicate services** — `services/cache/cache-service.js` (5-line shim) + `services/cache-service.js` (397 LOC), same for `notification/`, `email/`, `qrcode/`, `pdf/`, `payment/`. Half-finished extraction from flat → folder; nobody finished the move.
3. **Wizard double-tree** — `app/health/applications/new/` and `app/health/applications/new-legacy/` both exist; `new/layout.tsx` and `_components/application-step-page.tsx` STILL import from `new-legacy/`. The "legacy" name is misleading — it's load-bearing.
4. **Build artifacts and tmp directories tracked in git** — `apps/web-app/lint.txt`, `lint-report.json`, `lint-web.json`, `tmp-provider-shots/` (18 PNGs), `tmp-provider-shots-auth/` (7 PNGs), `apps/test-reports/` (audit JSONs + PNGs). These are why the repo looks messy — they're literally generator output checked into source.
5. **`apps/backend/scripts/` shadow folder (38 files)** — duplicates the role of `scripts/` at repo root, full of snake_case one-offs (`debug_http_login.js`, `force_certify.js`, `save_qr.js`, `seed_relaxed_validation.js`, `update_yield_data.js`). This is the SINGLE clearest "robot/vibe-coded artifact dump" in the repo.

**Single biggest "human-hostile" pattern:** The combination of (a) **`apps/backend/scripts/` shadow folder full of snake_case throwaway scripts** + (b) **tracked `lint.txt`/`lint-report.json` build artifacts** + (c) **mid-refactor folder-vs-flat service duplication** is what reads as "messy." Pick any of these three at random and a new contributor immediately gets confused. Fix these three patterns and the repo will *feel* dramatically more organized without changing any behavior.

## 1. Top-Level Repo Structure


**What's clean:**
- `infra/`, `deploy/`, `docker/`, `nginx/`, `monitoring/`, `openapi/` — single clear purpose each.
- `packages/validation/` is structurally fine (npm-style workspace package).

**What's messy:**
- **`HANDOFF.md` at root** — transient document; should live in `docs/operations/` or be deleted.
- **6 docker-compose files at root** — acceptable but borderline; consider `docker/compose/` subfolder.
- **`packages/` only has `validation/`** — and `@gacp/validation` is referenced ONLY in 3 manifest files; zero source-code imports outside the package itself. **It's a published-but-unused workspace.**

**Concrete fix:**
- Move `HANDOFF.md` → `docs/operations/handoff-2026-04.md` or delete after handoff is consumed.
- Either wire up `@gacp/validation` (frontend `thai-id-validator.ts` is a perfect candidate) or delete the package.

## 2. Backend Module Structure

**What's clean:**
- `routes/api/` taxonomy: domain-aligned, no role bleed.
- `prisma/schema/` 13-file split — coherent, not over-fragmented.
- `controllers/` exists but is sparse and consistent.
- `middleware/` is a flat list of 16 files, all kebab-case, single-purpose.

**What's messy:**

**(a) Folder-vs-flat duplicate services.** Mid-refactor remnants:
- `services/cache/cache-service.js` (5 LOC, shim) ↔ `services/cache-service.js` (397 LOC, real)
- `services/notification/notification-service.js` (13 LOC, shim) ↔ `services/notification-service.js` (278 LOC, real)
- `services/email/email-service.js` (334 LOC) ↔ `services/email-service.js` (313 LOC) — **two different files, both substantial; needs callgraph check**
- `services/payment/index.js` (8 LOC) ↔ `services/payment-service.js` (309 LOC) + 5 more `payment-*.js` siblings
- `services/qrcode/qrcode-service.js` (565 LOC) — no flat sibling; correct.
- `services/pdf/pdf-generator.service.js` — uses dotted naming (`.service.js`), inconsistent with dominant `*-service.js` (42:2 ratio).

**(b) `application-service.js` (66 LOC stub) split into `application-service/` folder of 6 method files.** Pattern is "facade + methods folder" but facade is mostly empty. Either inline back or actually use the facade pattern.

**(c) Three validation homes:**
- `apps/backend/shared/schemas/auth-schemas.js`
- `apps/backend/shared/validators/gacp-business-rules-validator.js`
- `apps/backend/validation/application-schemas.js`
Plus `apps/backend/shared/zod-schemas.js`. Pick one home (`shared/validation/`).

**(d) `apps/backend/scripts/` shadow folder (38 files).** Co-tenants of root `scripts/` directory but full of snake_case throwaways:
- `check_data.js`, `check_db_ipv4.js`, `check_real_status.js`, `check_user_duplicates.js`
- `debug_http_login.js`, `e2e_qc_golden.js`, `fix_status.js`, `force_certify.js`, `force_verify_user.js`
- `migrate_status.js`, `reset_verification.js`, `save_qr.js`, `seed_relaxed_validation.js`, `seed_wizard_steps.js`
- `show_system_status.js`, `update_yield_data.js`

**Worst snake_case offender in a kebab-case repo, AND duplicates `scripts/db/` and `scripts/verify/`. Strong delete candidate.**

**(e) `apps/backend/__tests__/` (24 files) + `apps/backend/tests/property-based.test.js` (1 file).** Two test homes for one app. Move the singleton.

**Concrete fix:**
1. Delete the 5-line and 13-line shim files. Update imports.
2. For `email/` and `payment/`: consolidate to ONE structure (recommend: keep folders, eliminate flat files OR keep flat, eliminate folders — pick uniformly).
3. Rename `pdf-generator.service.js` → `pdf-generator-service.js`.
4. Inline the 6 `application-service/*-methods.js` files into one.
5. Consolidate validation under `apps/backend/shared/validation/`.
6. Triage + delete `apps/backend/scripts/` snake_case dump.
7. Move `apps/backend/tests/property-based.test.js` into `__tests__/`.

## 3. Frontend Organization

**What's clean:**
- App Router role-split (`(auth)`, `(public)`, `health`, `provider`, `admin`).
- `[id]/page.tsx` + `[id]/client-view.tsx` pattern consistent.
- `lib/i18n/dictionaries/` split by `{en,th}` × `{auth,core,provider,wizard}`.
- `lib/dal/` for data-access patterns — clean.

**What's messy:**

**(a) `app/health/applications/new/` vs `new-legacy/` — naming lies.** "new-legacy" implies deprecated, but `new/layout.tsx` line 3 imports `ApplicationFlowLayout from '../new-legacy/layout'`, and `_components/application-step-page.tsx` imports 12 `Step*` components directly from `new-legacy/steps/`. Either (i) finish migration, or (ii) rename to descriptive names.

**(b) `_components/` underscore-prefix folder.** Only `_*` folder in codebase. Inconsistent.

**(c) `src/features/` is mostly empty; real feature code is in `src/components/feature/`.**
- `src/features/audit-system/` → 1 file (README)
- `src/features/permit-form/components/` → 1 component
- `src/features/traceability/` → 1 file (README)
- `src/components/feature/` → 22 real files

**(d) Duplicate auto-save indicator.**
- `apps/web-app/src/components/application-flow/auto-save-indicator.tsx`
- `apps/web-app/src/app/health/applications/new/hooks/auto-save-indicator.tsx`

**(e) Wizard components scattered across THREE homes:**
- `src/components/wizard/`
- `src/components/application-flow/`
- `src/app/health/applications/_components/`

**(f) `lib/` partial submoduling.** ~12 standalone files at `lib/` root mixed with submodules.

**(g) Tracked tmp directories:**
- `apps/web-app/tmp-provider-shots/` (18 PNGs, tracked)
- `apps/web-app/tmp-provider-shots-auth/` (7 PNGs, tracked)
- `apps/web-app/lint.txt` (177 lines, embedded Windows paths)
- `apps/web-app/lint-report.json`, `lint-web.json`
- `apps/test-reports/` (3 audit JSONs + 3 PNGs)
- `scripts/test/tmp-query.sql`

ALL tracked. Move to `.gitignore`-protected `.tmp/` paths or delete.

## 4. File Naming Patterns

**Status:** A convention exists; drift is small but visible.

**Worst offenders:**
1. `apps/backend/scripts/{check_data,debug_http_login,fix_status,force_certify,force_verify_user,migrate_status,reset_verification,save_qr,seed_relaxed_validation,seed_wizard_steps,show_system_status,update_yield_data,e2e_qc_golden,...}.js` — **16 snake_case files** in kebab-case codebase.
2. `apps/mobile-app/update_imports.ps1`, `apps/mobile-app/qa_strategy_plan.md`.
3. `apps/backend/services/calendar/crop-calendar.service.js`, `apps/backend/services/pdf/pdf-generator.service.js` — dotted `.service.js` (42:2 ratio).
4. `apps/web-app/lint.txt` — build-artifact file.
5. `scripts/refactor-health-vibe.js` — vibes-coded refactor + hardcoded path `c:/Users/charo/GACP-Certification-Application-1/`. Sibling: `scripts/refactor-use-client.js`. Both stale.
6. `scripts/fix-applications-schema.sql`, `fix-canonical-dupes.sql`, `fix-column-rename.sql`, `fix-enterprise.sql` — incident SQL at scripts/ root.
7. `scripts/test_login.sh`, `scripts/start_services.bat` — snake_case at scripts root.
8. `apps/web-app/src/app/health/applications/[id]/car/` — three-letter ambiguous folder.
9. `apps/backend/services/PAYMENT_SERVICES_README.md` — SHOUTING_CASE outlier.
10. **No `AGENT-XXXXX`, `output_2026`, `temp_*`, `draft_*`, or person-name files found** in repo-tracked code. The naming-discipline sweep done in PR #2 was effective.

**Concrete fix:**
- Rename or delete the 16 snake_case files.
- Rename `*.service.js` → `*-service.js`.
- Rename `PAYMENT_SERVICES_README.md` → `readme.md`.
- Delete `scripts/refactor-health-vibe.js`, `scripts/refactor-use-client.js`.
- Rename `[id]/car/` → `[id]/corrective-action-report/` OR add README.

## 5. Stale / Orphaned Files

**High confidence — safe deletion candidates:**

| Path | Reason |
|---|---|
| `apps/web-app/lint.txt` | Build artifact; embedded Windows user paths |
| `apps/web-app/lint-report.json` | Same |
| `apps/web-app/lint-web.json` | Same |
| `apps/web-app/tmp-provider-shots/` (18 PNGs) | Playwright dump |
| `apps/web-app/tmp-provider-shots-auth/` (7 PNGs) | Same |
| `apps/test-reports/` (6 files) | Audit run output |
| `scripts/test/tmp-query.sql` | `tmp-` prefix |
| `scripts/refactor-health-vibe.js` | Hardcoded path |
| `scripts/refactor-use-client.js` | One-off codemod |
| `scripts/test-template/run-all-agents.js` | Sibling to `scripts/test/run-all-agents.js` |
| `apps/backend/services/cache/cache-service.js` | 5-line shim |
| `apps/backend/services/notification/notification-service.js` | 13-line shim |
| `apps/backend/services/payment/index.js` | 8-line shim |
| `apps/backend/services/PAYMENT_SERVICES_README.md` | SHOUTING_CASE |
| `apps/backend/prisma/dev.db-journal` | SQLite journal — never commit |
| `apps/web-app/src/features/audit-system/readme.md` | Empty placeholder |
| `apps/web-app/src/features/traceability/readme.md` | Empty placeholder |

**Medium confidence — needs callgraph trace:**

| Path | Reason |
|---|---|
| `apps/backend/scripts/{16 files}` | Verify each is dated + obsolete |
| `apps/web-app/src/app/health/applications/new-legacy/` | Currently still imported; finish migration FIRST |
| `apps/backend/services/email/email-service.js` ↔ `services/email-service.js` | TWO substantial files |
| `packages/validation/` | Zero source-code consumers |
| `apps/mobile-app/` | Active or dormant? |

## 6. Cross-Cutting Concerns

- `apps/backend/shared/` exists and well-used, but has overlapping subfolders (`schemas/`, `validators/`, plus sibling `apps/backend/validation/`).
- `packages/validation/` workspace package has zero source consumers despite being declared as dependency. Either wire up or remove.
- No shared types package between FE + BE. Backend has `apps/backend/shared/types.ts`; frontend has `apps/web-app/src/types/database*.ts` — duplicated by hand.
- `openapi/*.yaml` is source of truth for public API; frontend `lib/api/api-client.ts` is hand-written, not generated. `scripts/tools/generate-api-clients.{ps1,sh}` exists but isn't wired into CI.
- i18n: top-level dicts + per-feature splits coexisting; unclear which wins on conflict.

**Concrete fix:**
1. Wire `packages/validation/` into Thai-ID validator on both sides; OR delete the package.
2. Generate frontend API client from `openapi/*.yaml`; add CI gate.
3. Consolidate i18n: pick one structure.
4. Add `packages/types/` with Prisma-derived types.

## Prioritized Roadmap

### Phase A — Must-do (structural integrity, ~1 day, low risk)

A1. **Delete tracked build artifacts** + add to `.gitignore`. ~40 files/dirs.
A2. **Resolve service folder-vs-flat duplication** — delete 3 shims; consolidate `email/` and `payment/`.
A3. **Consolidate doc audit folders** to one canonical (`docs/audit/`).
A4. **Delete one-off vibe scripts** (`refactor-health-vibe.js`, `refactor-use-client.js`, `test-template/`).

### Phase B — Should-do (clarity + maintenance, ~3 days)

B1. **Resolve `new-legacy/` ambiguity.** Largest single change; ~30 file moves + import updates.
B2. **Clean `apps/backend/scripts/`.** Each of 38 files needs verdict; result: empty + deleted.
B3. **Backend test consolidation.** Move `apps/backend/tests/property-based.test.js` → `__tests__/`.
B4. **Frontend wizard consolidation.** Move all `wizard-*` and `application-flow/*` into `components/wizard/`.
B5. **Backend validation consolidation** under `apps/backend/shared/validation/`.
B6. **`application-service/` un-split.** Inline 6 method files back into 1.

### Phase C — Polish (~2 days)

C1. Re-cluster `apps/web-app/src/lib/` root files into existing submodules.
C2. Decide `packages/validation/` — wire up or remove.
C3. Move `HANDOFF.md` to `docs/operations/`.
C5. Rename `[id]/car/` → descriptive name.
C6. Rename `PAYMENT_SERVICES_README.md`.
C7. Decide `apps/mobile-app/` fate.

## Explicit Non-Recommendations

- **Don't go full DDD/hex-arch.** Route + service + prisma model is sufficient.
- **Don't rename to camelCase or PascalCase wholesale.** Kebab-case is the convention.
- **Don't restructure `prisma/schema/` 13-file split.** Correctly partitioned.
- **Don't restructure `routes/api/` taxonomy.** Cleanest part of backend.
- **Don't introduce a "core" vs "feature" mega-categorization in `lib/`.**
- **Don't add controllers between every route and service.**
- **Don't rename `(auth)` and `(public)` route groups.** Next.js convention.

## Total LOC / file moves estimate

| Phase | Deletes | Moves | Renames | Risk |
|---|---|---|---|---|
| Phase A | ~40 files / 8 dirs | 2 | 2 | Low — all artifacts/shims |
| Phase B | ~25 files (after triage) | ~50 | 0 | Medium — touches imports |
| Phase C | 0–5 | ~15 | 3 | Low |
| **Total** | **~70 deletes / 8+ dirs** | **~67 moves** | **5 renames** | — |

LOC churn: deletions mostly low-LOC artifact files + shims. The `apps/backend/scripts/` cleanup may delete 1–2K LOC of legacy debug scripts. The `new-legacy/` migration is the largest LOC-touching change — possibly +3K LOC moved and -3K deleted, net neutral but high import-update cost.
