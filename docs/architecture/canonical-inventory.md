# CANONICAL_INVENTORY

Last updated: 2026-03-06

This document is a Phase 1.5 runtime inventory derived from the current codebase.
It is not a target-state design. It records what is actually mounted and consumed now.

## Scope

- Backend API root: `apps/backend/routes/api/index.js`
- Web route root: `apps/web-app/src/app`
- Web auth gate: `apps/web-app/src/middleware.ts`
- Mobile route root: `apps/mobile-app/lib/core/router/app_router.dart`
- Primary schema: `apps/backend/prisma/schema.prisma`

## Auth types used in this inventory

- `public`: no authenticated identity required
- `health`: health identity via `auth_token` cookie or authorization header
- `provider`: provider identity via `provider_token` cookie or authorization header
- `provider+admin`: provider identity plus admin role check
- `mixed`: namespace contains more than one auth boundary
- `m2m`: machine-to-machine or callback/webhook style traffic

## Web Namespace Inventory

| Namespace | Source | Auth | Primary actor | Primary backend surface | Primary entities | Consumer app |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | `apps/web-app/src/app/page.tsx` | public | public user | public content, auth entry | none, marketing shell | Web public |
| `/(auth)/*` | `apps/web-app/src/app/(auth)` | public | health applicant | `/api/auth/health/*` | `User` | Web public |
| `/auth/health/*` | `apps/web-app/src/app/auth/health` | public to health session | health applicant | `/api/auth/health/*` | `User` | Web public |
| `/auth/provider/*` | `apps/web-app/src/app/auth/provider` | public to provider session | provider provider | `/api/auth/provider/*` | `User` | Web public |
| `/health/*` | `apps/web-app/src/app/health`, `apps/web-app/src/middleware.ts` | health | health applicant | `/api/applications/*`, `/api/farms/*`, `/api/planting-cycles/*`, `/api/documents/*`, `/api/payments/*` | `Application`, `Farm`, `PlantingCycle`, `Certificate`, `Notification` | Web health |
| `/provider/*` | `apps/web-app/src/app/provider`, `apps/web-app/src/middleware.ts` | provider | provider provider | `/api/provider/*`, `/api/provider`, `/api/certificates/*`, billing/admin adjacencies | `Application`, `User`, `Certificate`, planting read models | Web provider |
| `/admin/*` | `apps/web-app/src/app/admin`, `apps/web-app/src/middleware.ts` | provider+admin | admin provider | `/api/admin/*` | `User`, `SystemConfig`, `PlantSpecies`, `Application`, `PlantingCycle` | Web admin |
| `/trace/*` | `apps/web-app/src/app/trace` | public | public verifier / consumer | `/api/trace/*` | `PlantingCycle`, `PlantUnit`, `HarvestBatch`, `Lot` | Web public |
| `/verify`, `/verify-identity` | `apps/web-app/src/app/verify`, `apps/web-app/src/app/verify-identity` | public | public verifier | `/api/interoperability/v1/*`, `/api/identity/*` | `Certificate`, trust payloads, verification results | Web public |
| `/api/[...path]` | `apps/web-app/src/app/api/[...path]/route.ts` | mixed | all authenticated web users | generic proxy to backend `/api/*` | proxy only | Web BFF |
| `/api/proxy/[...path]` | `apps/web-app/src/app/api/proxy/[...path]/route.ts` | mixed | web clients and internal fetches | proxy to backend with forwarded headers | proxy only | Web BFF |
| `/api/auth/health/[...path]` | `apps/web-app/src/app/api/auth/health/[...path]/route.ts` | public to health session | health applicant | backend health auth endpoints | `User` | Web BFF |
| `/api/auth/provider/[...path]` | `apps/web-app/src/app/api/auth/provider/[...path]/route.ts` | public to provider session | provider provider | backend provider auth endpoints | `User` | Web BFF |

## Mobile Feature Inventory

| Namespace / feature | Source | Auth | Primary actor | Primary backend surface | Primary entities | Consumer app |
| --- | --- | --- | --- | --- | --- | --- |
| `/login`, `/register*` | `apps/mobile-app/lib/core/router/app_router.dart` | public to session | health applicant | health auth APIs | `User` | Mobile |
| `/dashboard`, `/applications*`, `/establishments*`, `/payments`, `/tracking`, `/certificates`, `/documents`, `/profile` | `apps/mobile-app/lib/core/router/app_router.dart` and `apps/mobile-app/lib/features/*` | health | health applicant | health workflow, farm, payment, trace APIs | `Application`, `Farm`, `PaymentTransaction`, trace entities | Mobile |
| `/provider/*` shell routes | `apps/mobile-app/lib/core/router/app_router.dart` | provider in naming, unclear in current app intent | provider provider legacy shell | provider APIs if still wired | `Application`, provider dashboards | Mobile legacy surface |
| `qr_scanner`, `traceability` features | `apps/mobile-app/lib/features/qr_scanner`, `apps/mobile-app/lib/features/traceability` | mixed public/health | health user or public scan flow | trace endpoints | `PlantUnit`, `HarvestBatch`, `Lot` | Mobile |

## Backend Namespace Inventory

| Namespace | Source | Auth | Primary actor | Primary entities | Consumer app | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/auth/health/*` | `apps/backend/routes/api/auth-health.js` | mixed | health applicant | `User` | Web health, Mobile | login, register, refresh, profile |
| `/api/auth/provider/*` | `apps/backend/routes/api/auth-provider.js` | mixed | provider provider | `User` | Web provider | login, logout, current provider identity |
| `/api/mfa/*` | `apps/backend/routes/api/mfa.js` | mixed | authenticated user | MFA/session artifacts | Web | secondary auth surface |
| `/api/applications/*` | `apps/backend/routes/api/applications.js` | mixed | mostly health applicant | `Application`, `ApplicationDraft`, `ApplicationComment`, `Quote`, `Invoice` | Web health, Mobile, provider edge case | provider can reject via `PATCH /:id/reject` |
| `/api/applications/config/*` | `apps/backend/routes/api/applications-config.js` | public to route, consumed as health flow | health applicant | `WizardStepConfig`, config payloads | Web health | route shape differs from some web usage |
| `/api/applications/car/*` | `apps/backend/routes/api/applications-car.js` | mixed | health and audit-related actors | `Application`, CAR uploads | Web health, Web provider | upload/review sidecar flow |
| `/api/preview/*` | `apps/backend/routes/api/preview.js` | mixed | health applicant | `Application`, preview payload, fee summary | Web health | pre-payment preview surface |
| `/api/payments/*` | `apps/backend/routes/api/payments.js` | mixed | health applicant and provider provider | `PaymentTransaction`, `Invoice`, `Quote` | Web health, Web provider, Mobile | phase 1 is health-auth, phase 2 is provider-auth |
| `/api/quotes/*` | `apps/backend/routes/api/quotes.js` | mixed | health applicant and provider/account roles | `Quote` | Web health, Web provider | billing support surface |
| `/api/invoices/*` | `apps/backend/routes/api/invoices.js` | mixed | health applicant and provider/account roles | `Invoice` | Web health, Web provider | billing support surface |
| `/api/documents/*` | `apps/backend/routes/api/documents.js` | mixed | health applicant and provider reviewers | document metadata, uploads | Web health | depends on storage service |
| `/api/certificates/*` | `apps/backend/routes/api/certificates.js` | mixed | health applicant and Provider roles | `Certificate` | Web health, Web provider | certificate retrieval and management |
| `/api/notifications/*` | `apps/backend/routes/api/notifications.js` | mixed | authenticated user | `Notification` | Web health, Mobile | inbox-style user notifications |
| `/api/consent/*` | `apps/backend/routes/api/consent.js` | mixed | health applicant | `UserConsent` | Web health | consent capture and retrieval |
| `/api/farms/*` | `apps/backend/routes/api/farms.js` | health | health applicant | `Farm` | Web health, Mobile | establishment-style CRUD and farm QR |
| `/api/site-analyses/*` | `apps/backend/routes/api/site-analyses.js` | mixed | health applicant | `SiteAnalysis` | Web health | farm readiness inputs |
| `/api/training-records/*` | `apps/backend/routes/api/training-records.js` | mixed | health applicant | `TrainingRecord` | Web health | compliance/training evidence |
| `/api/water-sources/*` | `apps/backend/routes/api/water-sources.js` | mixed | health applicant | `WaterSource` | Web health | cultivation support record |
| `/api/seed-sources/*` | `apps/backend/routes/api/seed-sources.js` | mixed | health applicant | `SeedSource` | Web health | cultivation support record |
| `/api/fertilizer-records/*` | `apps/backend/routes/api/fertilizer-records.js` | mixed | health applicant | `FertilizerRecord` | Web health | cultivation support record |
| `/api/controlled-environments/*` | `apps/backend/routes/api/controlled-environments.js` | mixed | health applicant | `ControlledEnvironment` | Web health | cultivation support record |
| `/api/planting-cycles/*` | `apps/backend/routes/api/planting-cycles.js` plus helper modules | health | health applicant | `PlantingCycle`, `Plot`, `PlantingCyclePlot`, `PlantUnit`, `HarvestBatch`, `CultivationLog` | Web health, Mobile | includes integrity, plant-unit, plot-QR, activity, harvest flows |
| `/api/cultivation-logs/*` | `apps/backend/routes/api/cultivation-logs.js` | mixed | health applicant | `CultivationLog` | Web health | activity history surface |
| `/api/lots/*` | `apps/backend/routes/api/lots.js` | mixed | health applicant and provider readers | `Lot` | Web health, Web provider | post-harvest trace surface |
| `/api/trace/*` | `apps/backend/routes/api/trace.js` | mixed | public first, health for some subpaths | `PlantingCycle`, `PlantUnit`, `HarvestBatch`, `Lot`, `TraceQrSecurity`, `TraceQrScan` | Web public, Mobile, internal views | public QR trace API |
| `/trace/*` | `apps/backend/routes/public-trace.js` | public | public verifier | redirect only | Web public | redirect layer into `/api/trace/*` |
| `/api/provider/*` operations | `apps/backend/routes/api/provider/index.js` and `apps/backend/routes/api/provider/*` | provider | provider provider | `Application`, `Certificate`, planting read models, schedule/timeline data | Web provider | canonical provider operations surface |
| `/api/provider` directory | `apps/backend/routes/api/provider.js` | provider | admin and scheduler-style provider | `User`, optional `DTAMPROVIDER` fallback | Web provider | directory CRUD merges User with optional legacy provider fallback |
| `/api/admin/*` | `apps/backend/routes/api/admin/index.js` and submodules | provider+admin | admin provider | `User`, `SystemConfig`, `PlantSpecies`, `Application`, `PlantingCycle` | Web admin | admin namespace behind provider identity |
| `/api/dashboard/*` | `apps/backend/routes/api/dashboard.js` | mixed | health applicant | dashboard aggregations | Web health | summary/read model surface |
| `/api/master-data/*` | `apps/backend/routes/api/master-data.js` | mixed | health applicant and admin tooling | reference data | Web health, Web admin | lookup/config read models |
| `/api/cultivation-config/*` | `apps/backend/routes/api/journey.js` | mixed | health applicant | config payloads | Web health | master-data adjacent |
| `/api/standards/*` | `apps/backend/routes/api/standards.js` | mixed | health applicant and admin | `CertificationStandard`, `StandardRequirement` | Web health, Web admin | standards reference data |
| `/api/criteria/*` | `apps/backend/routes/api/criteria.js` | mixed | health applicant and provider/admin readers | `SupplementaryCriterion` | Web provider, Web admin, Web health | compliance criteria surface |
| `/api/plants/*` | `apps/backend/routes/api/plants.js` | mixed | health applicant and admin | `PlantSpecies` | Web health, Web admin | plant master/reference surface |
| `/api/interoperability/v1/*` | `apps/backend/routes/api/interoperability.js` | mixed | public verifier, admin for revoke | `Certificate`, trust registry, revocations, trace events | Web public, system integrators | public trust and verification API family |
| `/api/identity/*` | `apps/backend/routes/api/identity.js` | mixed | public or health applicant | identity verification payloads | Web public | eKYC adjacent surface |
| `/api/webhooks/*` | `apps/backend/routes/api/webhooks.js` | m2m | payment providers | payment webhook payloads, audit records | External systems | payment callbacks |
| `/api/callbacks/*` | `apps/backend/routes/api/lab-webhook.routes.js` | m2m | lab systems | lab result payloads | External systems | lab callback surface |
| `/api/sync/*` | `apps/backend/routes/api/sync.js` | mixed | offline-capable client | sync payloads | Mobile, Web | offline synchronization entry |
| `/api/consumer-feedback/*` | `apps/backend/routes/api/consumer-feedback.js` | public | end consumer | `ConsumerFeedback` | Web public | QR-driven feedback capture |
| `/api/post-audit/*` | `apps/backend/routes/api/post-audit.js` | mixed | provider and audited applicant | `PostAuditTask` | Web provider, Web health | post-audit management |
| `/api/revision-deadline/*` | `apps/backend/routes/api/revision-deadline.js` | mixed | provider provider and applicant | `RevisionDeadline` | Web provider, Web health | revision timer tracking |
| `/api/farm-audits/*` | `apps/backend/routes/api/farm-audit.js` | mixed | auditor/provider provider | farm audit data, photo/GPS evidence | Web provider | audit evidence surface |
| `/api/fraud-detection/*` | `apps/backend/routes/api/fraud-detection.js` | mixed | Provider roles | anomaly outputs, duplicate checks | Web provider, Web admin | AI/rule-assisted review surface |
| `/api/analytics/*` | `apps/backend/routes/api/analytics.js` | mixed | provider/admin provider | analytics read models | Web provider, Web admin | trends, heat maps, predictive outputs |
| `/api/labs/*` | `apps/backend/routes/api/lab-integration.js` | mixed | Provider roles | lab import, CoA, sync records | Web provider, Web admin | lab integration management |
| `/api/health`, `/api/metrics`, `/api/version` | `apps/backend/routes/api/index.js` | public | ops, monitoring, clients | runtime metadata | Monitoring, internal tooling | observability and version endpoints |
| root-mounted plot and plant-unit routes | `apps/backend/routes/api/plots.js`, `apps/backend/routes/api/plant-units.js` | mixed | health applicant and provider readers | `Plot`, `PlantUnit` | Web health | mounted at API root rather than dedicated namespace |

## Provider Operations Breakdown

| Namespace | Source | Auth | Primary actor | Primary entities | Consumer app |
| --- | --- | --- | --- | --- | --- |
| `/api/provider/reviewer/*` | `apps/backend/routes/api/provider/reviewer.js` | provider | document reviewer | review queues, applications | Web provider |
| `/api/provider/scheduler/*` | `apps/backend/routes/api/provider/scheduler.js` | provider | scheduler | auditor roster, audit schedules | Web provider |
| `/api/provider/auditor/*` | `apps/backend/routes/api/provider/auditor.js` | provider | auditor | inspection starts, audit decisions | Web provider |
| `/api/provider/head-auditor/*` | `apps/backend/routes/api/provider/head-auditor.js` | provider | head auditor, admin | final approval queue, application transition | Web provider |
| `/api/provider/applications/*` | `apps/backend/routes/api/provider/applications.js` | provider | provider provider | `Application`, comments, workflow timelines | Web provider |
| `/api/provider/certificates/*` | `apps/backend/routes/api/provider/certificates.js` | provider | provider provider, admin | `Certificate` | Web provider |
| `/api/provider/analytics/*` | `apps/backend/routes/api/provider/analytics.js` | provider | admin-oriented provider provider | analytics read models | Web provider |
| `/api/provider/planting-cycles/*` | `apps/backend/routes/api/provider/planting.js` | provider | provider provider | `PlantingCycle`, plot QR, activities | Web provider |
| `/api/provider/admin/*` | `apps/backend/routes/api/provider/handlers/admin.js` via route registry | provider | admin provider | reminder runs, batch actions | Web provider |

## Admin Namespace Breakdown

| Namespace | Source | Auth | Primary actor | Primary entities | Consumer app |
| --- | --- | --- | --- | --- | --- |
| `/api/admin/users/*` | `apps/backend/routes/api/admin/users.js` | provider+admin | admin | `User` | Web admin |
| `/api/admin/applications/*` | `apps/backend/routes/api/admin/applications.js` | provider+admin | admin | `Application` | Web admin |
| `/api/admin/config/*` | `apps/backend/routes/api/admin/config.js` | provider at mount, no extra role check in file | admin in intent | `SystemConfig` | Web admin |
| `/api/admin/plants/*` | `apps/backend/routes/api/admin/plants.js` | provider at mount, no extra role check in file | admin in intent | `PlantSpecies` | Web admin |
| `/api/admin/planting-cycles/*` | `apps/backend/routes/api/admin/planting.js` | provider+admin | admin | `PlantingCycle`, `TraceQrSecurity`, `PlantUnit` | Web admin |

## Runtime Support Inventory

| Surface | Source | Primary role | Dependencies | Consumer |
| --- | --- | --- | --- | --- |
| Request pipeline | `apps/backend/server.js` | API gateway inside backend | helmet, cors, rate limits, cookies, CSRF, logger | All backend traffic |
| Database access | `apps/backend/services/prisma-database.js` | data access backbone | Prisma, PostgreSQL | Backend |
| Cache and transient state | `apps/backend/services/redis-service.js` | cache/queue connectivity | ioredis, Redis | Backend |
| Object storage | `apps/backend/services/storage-service.js` | document/file persistence | MinIO or local filesystem fallback | Backend |
| Queue worker | `apps/backend/services/queue-service.js`, `apps/backend/jobs/pdf-processor.js`, `apps/backend/jobs/webhook-dlq-processor.js` | async jobs | Bull, Redis, PDF generation, webhook retry | Backend |
| Cron scheduler | `apps/backend/jobs/scheduler.js` | scheduled ops | node-cron, prisma, notifications | Backend |
| Web auth state bridge | `apps/web-app/src/lib/services/auth-service.ts` | browser-to-server auth continuity | cookies, localStorage, proxy routes | Web |
| Edge access control | `apps/web-app/src/middleware.ts` | route gating | cookie decoding, role rules | Web |

## Cross-cutting Runtime Notes

- `/api/provider` is a composite namespace. `apps/backend/routes/api/index.js` mounts provider operations first and provider directory routes second under the same prefix.
- Provider directory flows use `User.providerId` as canonical identity, with optional `DTAMPROVIDER` read compatibility in `apps/backend/routes/api/provider/provider-directory-utils.js`.
- Web provider and admin paths are enforced first in `apps/web-app/src/middleware.ts`, then again in backend route handlers.
- The mobile router still contains `/provider/*` shell routes even though comments describe a Applicant-first app shape.
- `apps/backend/prisma/schema.prisma` and `apps/web-app/prisma/schema.prisma` are not identical and should not be treated as a single canonical schema source.
- `openapi/README.md` documents a `/v1/*` microservices model, while runtime production mounts are centered on `/api/*`.
