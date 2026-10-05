# Vocabulary and Source-of-Truth Map

Phase 1.12 extends the system map with a runtime-first vocabulary inventory.

Scope:
- identify canonical terms already declared by policy or runtime code
- identify competing names that still appear in active paths, payloads, and screens
- point to the file that currently acts as source-of-truth for each concept
- record collisions only; no remediation is proposed here

## Primary source-of-truth files

| Domain | Current source-of-truth file(s) | What it governs |
| --- | --- | --- |
| Identity vocabulary | `docs/terminology-policy.md`, `docs/api-path-identity-policy.md` | canonical identity names, auth namespaces, route language |
| Route naming | `docs/engineering-route-naming.md` | canonical API path style and mount expectations |
| Role normalization | `apps/backend/shared/canonical-rbac.js` | canonical backend roles and legacy aliases |
| Web route gating | `apps/web-app/src/middleware.ts` | web-side role aliasing and route-level access mapping |
| Backend API surface | `apps/backend/routes/api/index.js` | mounted namespaces that are actually live in runtime |
| Provider identity read model | `apps/backend/routes/api/provider/provider-directory-utils.js` | how provider directory records are resolved and labeled |
| Mobile route vocabulary | `apps/mobile-app/lib/core/router/app_router.dart` | mobile route names and actor labels in app shells |

## Collision matrix

| Concept | Canonical term in policy/runtime | Competing terms observed | Canonical source | Evidence of competing terms | Consumer surfaces | Current signal |
| --- | --- | --- | --- | --- | --- | --- |
| Applicant actor | `health`, `healthId`, `/auth/health/*`, `/health/*` | `Applicant`, `INDIVIDUAL_Applicant`, "Applicant-only app" | `docs/terminology-policy.md`, `docs/api-path-identity-policy.md`, `apps/backend/shared/canonical-rbac.js` | `apps/web-app/src/app/provider/dashboard/page.tsx`, `apps/mobile-app/lib/core/router/app_router.dart`, `apps/mobile-app/lib/generated/api/auth_health/doc/AuthenticationApi.md` | backend auth, web provider pages, mobile router, generated mobile docs | policy and backend normalize `Applicant` to `health`, but active UI and generated docs still expose both names |
| Provider actor | `provider`, `providerId`, `/auth/provider/*`, `/provider/*` | `provider`, `DTAM Provider`, `officer` | `docs/terminology-policy.md`, `docs/api-path-identity-policy.md` | `apps/mobile-app/lib/core/router/app_router.dart`, `apps/mobile-app/lib/presentation/navigation/PROVIDER_app_shell.dart`, `apps/backend/routes/api/provider/provider-directory-utils.js` | provider portal, mobile provider shell, provider directory, ops docs | policy is canonical, but runtime presentation still mixes provider and provider language |
| Provider identity record | `User.providerId` | `DTAMPROVIDER`, provider user with `accountType=provider/PROVIDER`, `providerId: null` legacy records | `docs/api-path-identity-policy.md`, `apps/backend/routes/api/provider/provider-directory-utils.js` | `apps/backend/routes/api/provider/provider-directory-utils.js`, `apps/backend/jobs/sla-monitor.js`, `apps/backend/prisma/schema.prisma` | provider directory, provider lookup, SLA background jobs | canonical DB identity is `User.providerId`, but provider read path can still emit legacy `DTAM_PROVIDER` records |
| Applicant profile payload | policy vocabulary implies `health` | `Applicant`, `health`, `applicantName` | `docs/terminology-policy.md` | `apps/web-app/src/app/provider/dashboard/page.tsx`, `apps/web-app/src/app/provider/applications/[id]/page.tsx`, `apps/web-app/src/app/health/applications/preview/page.tsx` | provider dashboard, provider detail, health preview | active payload readers explicitly fall back across `Applicant` and `health`, so payload naming is not singular |
| provider reviewer role | backend canonical role set uses `document_reviewer` and `auditor` | `reviewer`, `reviewer_auditor` | `apps/backend/shared/canonical-rbac.js` | `apps/web-app/src/middleware.ts`, `apps/web-app/src/app/provider/profile/page.tsx`, `apps/web-app/src/app/provider/dashboard/page.tsx`, `apps/backend/services/security-compliance.js` | backend RBAC, web middleware, provider profile UI, permission service | `reviewer_auditor` does not have one cross-layer meaning; backend maps it to `auditor`, web middleware maps it to `document_reviewer` |
| Finance provider role | `account` | `accountant`, `finance` | `apps/backend/shared/canonical-rbac.js` | `apps/web-app/src/middleware.ts`, `apps/web-app/src/app/provider/management/page.tsx`, `apps/web-app/src/app/provider/profile/page.tsx` | RBAC, provider UI, management UI | backend and web both normalize aliases to `account`, but labels in screens still use multiple names |
| Final approval role | `head_auditor` | `approver`, `final_approver` | `apps/backend/shared/canonical-rbac.js` | `apps/web-app/src/app/provider/dashboard/page.tsx` | backend RBAC, provider dashboard | canonical backend name exists; the orphan `pdf/templates/approver/*` directory that used to widen this drift was deleted in PR (chore/delete-dead-pdf-templates) — those templates were never loaded at runtime |
| Farm domain object | backend entity and mounted API use `Farm` and `/api/farms/*` | `establishment`, `/establishments`, "facility", `siteInfo` | `apps/backend/routes/api/index.js`, `apps/backend/prisma/schema.prisma` | `apps/web-app/src/app/health/establishments/new/page.tsx`, `apps/mobile-app/lib/data/repositories/establishment_repository_impl.dart`, `apps/mobile-app/lib/presentation/features/application/services/application_service.dart` | web health, mobile establishment feature, application submission payloads | runtime object is farm-centric, but health/mobile UI still presents it as establishment and maps `establishmentId -> farmId` |
| Application authoring flow | mounted runtime families are `/api/applications/*` and `/api/preview/*` | `wizard`, `application-flow`, `draft-documents`, `prepare` | `apps/backend/routes/api/index.js` | `apps/backend/routes/api/wizard.js`, `apps/web-app/src/app/health/applications/new/hooks/use-wizard-store.ts`, `apps/web-app/src/app/health/applications/new/steps/*`, `docs/deprecation-register.md` | backend draft/preview handlers, web wizard pages, docs | naming in clients still centers on wizard/application-flow, while the mounted API tree centers on applications plus preview |
| Wizard route namespace | no mounted `/api/wizard/*` family in main API tree | `/api/wizard/*` style routes exist in file, draft-doc upload naming survives | `apps/backend/routes/api/index.js` | `apps/backend/routes/api/wizard.js`, `apps/backend/controllers/wizard-controller.js` | backend controller layer, docs, web draft behavior | wizard remains an implementation vocabulary with active controller code but not a mounted canonical namespace |
| Public trust surface | browser trace path `/trace/*`, API trace path `/api/trace/*`, interoperability path `/api/interoperability/v1/*` | `verify`, `trust`, `interoperability`, `certificate verify` | `apps/backend/server.js`, `apps/backend/routes/api/index.js` | `apps/web-app/src/app/trace/*`, `apps/web-app/src/app/verify/*`, `apps/backend/routes/public-trace.js`, `apps/backend/routes/api/interoperability.js` | public web pages, mobile scanners, external trust consumers | trust and trace are both public verification surfaces, but vocabulary is split by use case rather than one public namespace |
| Mobile auth namespace | policy says `/auth/health/*` and `/auth/provider/*` | `/auth-health/login`, "Applicant profile" in generated mobile docs | `docs/terminology-policy.md`, `docs/api-path-identity-policy.md` | `apps/mobile-app/lib/data/repositories/auth_repository_impl.dart`, `apps/mobile-app/lib/generated/api/auth_health/doc/AuthenticationApi.md` | mobile auth repository, generated API client/docs | mobile still contains legacy auth path vocabulary alongside canonical provider auth |
| Mobile app shape | comments say Applicant-only health app | live provider shells and provider routes still exist | `apps/mobile-app/lib/core/router/app_router.dart` | `apps/mobile-app/lib/core/router/app_router.dart`, `apps/mobile-app/lib/presentation/navigation/PROVIDER_app_shell.dart` | mobile routing and navigation | actor vocabulary in mobile is dual-track: Applicant-only comments, but provider route tree remains active |

## Domain notes

### Identity

- Policy files define the strongest canonical baseline: `health` for applicant identity and `provider` for provider identity.
- Backend RBAC preserves that baseline by aliasing `Applicant` to `health`.
- Active clients still expose legacy naming in labels, payload fallbacks, and generated docs.

### Roles

- Backend canonicalization is centered in `apps/backend/shared/canonical-rbac.js`.
- Web route protection performs its own alias normalization in `apps/web-app/src/middleware.ts`.
- Some aliases converge cleanly (`accountant` -> `account`), while others do not (`reviewer_auditor`).

### Domain objects

- Backend data model and mounted route tree are farm-centric.
- Health web and mobile surfaces continue to present the same object as establishment in route names, repositories, and screen labels.
- Application authoring vocabulary is split between mounted `applications`/`preview` APIs and unmounted `wizard` implementation files.

### Public verification

- Public scan and trust features are not vocabulary-equivalent even when both are verification surfaces.
- `/trace/*` and `/api/trace/*` center on cultivation traceability entities.
- `/verify` and `/api/interoperability/v1/*` center on certificate/trust verification language.

## Source-of-truth status by concept

| Status | Meaning | Concepts currently in this state |
| --- | --- | --- |
| `single canonical source` | one file or policy clearly defines the term and runtime mostly follows it | Finance provider role, final approval role |
| `canonical with active aliases` | canonical term exists, but active runtime still emits legacy aliases | applicant actor, provider actor, farm domain object, mobile auth namespace |
| `split source-of-truth` | more than one active layer defines meaning differently | reviewer role, applicant payload naming, public trust surface |
| `implementation-only vocabulary` | term exists in code but is not the mounted public namespace | wizard route namespace |

## Signals from this inventory

- Identity vocabulary is more stable than payload vocabulary.
- Backend role normalization is more complete than web role normalization.
- Route mounts are a better indicator of canonical API language than controller or hook names.
- Mobile contains the highest concentration of legacy vocabulary alongside canonical paths.
- `farm` versus `establishment` is the strongest business-domain naming collision across web, mobile, and payload mappings.
