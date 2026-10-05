# RUNTIME_DRIFT_REGISTER

Last updated: 2026-03-06 (post-audit-remediation)

This document records runtime drift and contract conflicts observed in the current repo.
It is descriptive only. No remediation is proposed here.

## Scope

- Backend runtime mount tree
- Web runtime route/auth tree
- Mobile runtime route tree
- Prisma schema sources
- Runtime-supporting docs and API docs inside the repo

## Drift Register

| ID | Category | Observed drift | Evidence | Affected surfaces | Initial risk |
| --- | --- | --- | --- | --- | --- |
| D-01 | API documentation drift | `openapi/README.md` describes a `/v1/*` microservices architecture, while the active backend mounts are centered on `/api/*` inside one Express runtime. | `openapi/README.md`, `apps/backend/server.js`, `apps/backend/routes/api/index.js` | Integrators, internal docs, onboarding, test assumptions | High |
| D-02 | Internal docs drift | `docs/active-api-surface.md` lists `POST /api/applications`, but `apps/backend/routes/api/applications.js` exposes `POST /draft`, `POST /submit`, `POST /prepare` and no root `POST /`. The same doc points to `apps/backend/routes/api/admin.js`, but admin runtime is actually in `apps/backend/routes/api/admin/index.js`. | `docs/active-api-surface.md`, `apps/backend/routes/api/applications.js`, `apps/backend/routes/api/admin/index.js` | Engineers, QA, client contract assumptions | High |
| D-03 | Workflow namespace drift | ~~`apps/backend/routes/api/application-flow.js` says new clients should use `/api/application-flow/*`~~ **REMEDIATED**: `application-flow.js` deleted (was dead/unmounted file). `wizard.js` also confirmed unmounted in `index.js`. Live flow goes through `/api/applications/*`, `/api/preview/*`, `/api/payments/*`. | `apps/backend/routes/api/index.js` | Health application flow, client routing, docs | ~~High~~ **Closed** |
| D-04 | Schema source drift | ~~Two Prisma schemas exist in parallel.~~ **REMEDIATED**: `apps/web-app/prisma/schema.prisma` and `apps/web-app/src/lib/prisma.ts` deleted (were unused). Single canonical schema in `apps/backend/prisma/schema.prisma`. | `apps/backend/prisma/schema.prisma` | DB tooling, generated clients | ~~High~~ **Closed** |
| D-05 | Runtime tolerance drift | Provider application detail explicitly catches missing `application_comments` table errors and falls back without comments, which indicates runtime is designed to survive schema mismatch. | `apps/backend/routes/api/provider/applications.js` | Provider application detail, deployment consistency | High |
| D-06 | Role normalization drift | ~~`reviewer_auditor` maps to `document_reviewer` in web middleware, but maps to `auditor` in backend canonical RBAC.~~ **REMEDIATED**: Backend `canonical-rbac.js` corrected: `reviewer_auditor` now maps to `document_reviewer` (matching frontend). | `apps/web-app/src/middleware.ts`, `apps/backend/shared/canonical-rbac.js` | Provider route gating, authorization semantics | ~~High~~ **Closed** |
| D-07 | Admin authorization consistency drift | ~~`/api/admin/*` lacked consistent admin-role check~~ **REMEDIATED**: `requireAdmin` middleware added at namespace level in `admin/index.js`. Additionally `wizard.js /admin/*` routes now have `adminOnly`. All admin routes now consistently enforce admin role. | `apps/backend/routes/api/admin/index.js`, `apps/backend/middleware/require-admin.js`, `apps/backend/routes/api/wizard.js` | Admin APIs | ~~High~~ **Closed** |
| D-08 | Identity model drift | Provider identity is documented and coded as `User.providerId` canonical, but `DTAMPROVIDER` remains in provider directory fallback and SLA monitoring jobs. The runtime therefore uses both the new and legacy provider models. | `apps/backend/routes/api/provider.js`, `apps/backend/routes/api/provider/provider-directory-utils.js`, `apps/backend/jobs/sla-monitor.js`, `apps/backend/prisma/schema.prisma` | Provider directory, background jobs, provider data integrity | High |
| D-09 | Session model drift | **PARTIALLY REMEDIATED**: Debug logging removed from `middleware.ts`. `auth-service.ts` console.log statements converted to dev-only conditional. BFF proxy `[...path]/route.ts` verified as consolidated proxy. Dual-write pattern (localStorage + cookies) still exists for backward compat. | `apps/web-app/src/lib/services/auth-service.ts`, `apps/web-app/src/app/api/[...path]/route.ts`, `apps/web-app/src/middleware.ts` | Provider web UI, auth debugging, session consistency | ~~High~~ **Reduced to Medium** |
| D-10 | Platform intent drift | Mobile router comments describe a Applicant-only app shape, but provider shell routes still exist under `/provider/*`. | `apps/mobile-app/lib/core/router/app_router.dart` | Mobile product boundary, QA scope, route ownership | Medium |
| D-11 | Namespace composition drift | `/api/provider` is a composite namespace made from provider operations and provider directory routes mounted under the same prefix. Dispatch behavior depends on mount order. | `apps/backend/routes/api/index.js`, `apps/backend/routes/api/provider/index.js`, `apps/backend/routes/api/provider.js` | Provider API semantics, route discoverability | Medium |
| D-12 | Namespace policy drift | `plots.js` and `plant-units.js` are mounted at API root rather than under one dedicated namespace. This breaks the otherwise grouped route pattern used elsewhere. | `apps/backend/routes/api/index.js`, `apps/backend/routes/api/plots.js`, `apps/backend/routes/api/plant-units.js` | Route discoverability, surface consistency | Medium |
| D-14 | Public trust surface split | Public verification is split between `/trace/*` and `/api/interoperability/v1/*`. Both are public-facing trust surfaces, but they live in different conceptual API families. | `apps/backend/routes/public-trace.js`, `apps/backend/routes/api/trace.js`, `apps/backend/routes/api/interoperability.js`, `apps/web-app/src/app/trace`, `apps/web-app/src/app/verify` | Public verification, API discoverability, support docs | Medium |

## Conflict Clusters

### 1. Contract Surface Cluster

- `D-01`, `D-02`, `D-03`, `D-14`
- Main pattern: docs, namespaces, and public/runtime entrypoints do not describe one single contract model.

### 2. Identity and Access Cluster

- `D-06`, `D-07`, `D-08`, `D-09`, `D-13`
- Main pattern: role normalization, identity source, and session transport are not fully canonical across layers.

### 3. Data and Schema Cluster

- `D-04`, `D-05`
- Main pattern: multiple schema sources exist and runtime already contains compatibility behavior for mismatched DB state.

### 4. Platform and Route Shape Cluster

- `D-10`, `D-11`, `D-12`
- Main pattern: route grouping and platform intent are not consistently represented in runtime structure.

## Observed Runtime Signals

- Provider application detail contains an explicit fallback for missing `application_comments`.
- Provider directory contains a feature flag for legacy `DTAMPROVIDER` fallback.
- ~~Web middleware and backend RBAC normalize at least one legacy role differently.~~ **Fixed**: D-06 closed.
- ~~Admin namespace role enforcement is not uniform at the submodule level.~~ **Fixed**: D-07 closed.
- Mobile router comments and mounted paths describe different product boundaries.

## Remediation History

| Date | Items | Action |
|------|-------|--------|
| 2026-03-06 | D-03, D-04, D-06, D-07 | Audit remediation batch: dead files deleted, RBAC aligned, admin auth unified |
| 2026-03-06 | D-09 | Partial: debug logging removed, console.log → dev-only |

## Read Together With

- `docs/system-map.md`
- `docs/canonical-inventory.md`
- `docs/active-api-surface.md`
- `docs/ROLE_NAMESPACE_MAPPING.md`
