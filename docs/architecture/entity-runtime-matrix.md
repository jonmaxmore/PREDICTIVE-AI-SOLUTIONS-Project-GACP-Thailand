# ENTITY_RUNTIME_MATRIX

Last updated: 2026-03-06

This document maps core runtime entities to their active writers, readers, actors, public exposure, and async/background touches.
It is descriptive only and should be read together with:

- `docs/canonical-inventory.md`
- `docs/runtime-drift-register.md`
- `docs/flow-runtime-matrix.md`

## Core Workflow Entities

| Entity | Primary writers | Primary readers | Main actors | Public exposure | Async/background touch | Evidence | Related drift IDs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `User` | `auth-health`, `auth-provider`, `provider.js`, `admin/users.js` | auth routes, provider directory, admin user search, profile pages | health applicant, provider provider, admin | indirect only | used by notifications, audits, auth/session flows | `apps/backend/routes/api/auth-health.js`, `apps/backend/routes/api/auth-provider.js`, `apps/backend/routes/api/provider.js`, `apps/backend/routes/api/admin/users.js` | `D-08`, `D-09`, `D-13` |
| `UserConsent` | `consent.js` via consent manager | `consent.js` | health applicant | no | none seen directly | `apps/backend/routes/api/consent.js`, `apps/backend/prisma/schema.prisma` | none primary |
| `Application` | `applications.js`, provider workflow handlers, admin override, payment flows, audits | health app pages, provider review pages, reports, dashboards, SLA jobs | health applicant, provider reviewer, scheduler, auditor, head auditor, admin | no direct public read | touched by SLA cron, webhook/payment flows, reports | `apps/backend/routes/api/applications.js`, `apps/backend/routes/api/provider/handlers/workflow-transitions-handler.js`, `apps/backend/routes/api/admin/applications.js`, `apps/backend/jobs/sla-monitor.js` | `D-03`, `D-05` |
| `ApplicationDraft` | `wizard-controller.js` | `wizard-controller.js` | health applicant | no | none seen in background jobs | `apps/backend/controllers/wizard-controller.js`, `apps/backend/prisma/schema.prisma` | `D-03`, `D-04` |
| `ApplicationComment` | provider workflow transition handler | provider application detail | provider reviewer / provider | no | none seen | `apps/backend/routes/api/provider/handlers/workflow-transitions-handler.js`, `apps/backend/routes/api/provider/applications.js` | `D-04`, `D-05` |
| `Quote` | `quotes.js`, preview financial utils | quote/invoice readers, billing views | health applicant, provider/accounting provider | no | invoice creation path depends on it | `apps/backend/routes/api/quotes.js`, `apps/backend/routes/api/preview-financial-utils.js`, `apps/backend/prisma/schema.prisma` | `D-03` |
| `Invoice` | `quotes.js`, preview financial utils, application phase invoice methods | payments, invoices, provider accounting, PDF worker | health applicant, provider/accounting provider | no | PDF queue reads invoice for invoice/receipt jobs | `apps/backend/routes/api/quotes.js`, `apps/backend/services/invoice-service.js`, `apps/backend/jobs/pdf-processor.js` | `D-03` |
| `PaymentTransaction` | payment phase flow, webhook flow, cron service expiry paths | payment status and reconciliation logic | health applicant, provider/accounting provider, payment callbacks | no | webhook processing, expiration cron, reconciliation flows | `apps/backend/services/payment-service-phase-flow.js`, `apps/backend/services/payment-service-webhook-flow.js`, `apps/backend/services/cron.service.js` | `D-01`, `D-09` |
| `Certificate` | `certificate-service`, interoperability revoke path, some audit outcomes | health certificate pages, provider dashboards, verify/trust APIs, public certificate verification | auditor/head auditor/admin, health applicant, public verifier | yes, via verify/trust APIs and public verify route | certificate expiry cron, PDF queue, certificate generation | `apps/backend/services/certificate-service.js`, `apps/backend/routes/api/certificates.js`, `apps/backend/routes/api/interoperability.js`, `apps/backend/jobs/scheduler.js` | `D-01`, `D-14` |
| `Notification` | notification service, provider admin handlers, scheduler/audits flows | notifications API, bells, health/mobile inbox patterns | system, scheduler, reviewer, auditor, admin | no | certificate expiry cron, SLA monitor, payment/application workflows | `apps/backend/services/notification-service.js`, `apps/backend/routes/api/provider/handlers/admin.js`, `apps/backend/jobs/scheduler.js`, `apps/backend/jobs/sla-monitor.js` | `D-08` |

## Farm, Planting, and Trace Entities

| Entity | Primary writers | Primary readers | Main actors | Public exposure | Async/background touch | Evidence | Related drift IDs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Farm` | `farms.js`, `farm-service.js`, `certificate-service.js` legacy/bootstrap paths | health establishments, reports, planting eligibility, scoring, harvest routes | health applicant, admin/provider readers | indirect via trace and public certificate data | read by reporting/scoring/certificate generation | `apps/backend/routes/api/farms.js`, `apps/backend/services/farm-service.js`, `apps/backend/services/certificate-service.js` | `D-12` |
| `PlantingCycle` | `planting-cycles.js`, `certificate-service.js` bootstrap path | health planting pages, provider planting views, admin planting, trace service, analytics | health applicant, provider provider, admin | indirect through public trace endpoints | read by integrity reports and trace/public verification | `apps/backend/routes/api/planting-cycles.js`, `apps/backend/routes/api/provider/handlers/planting.js`, `apps/backend/routes/api/admin/planting.js`, `apps/backend/services/trace-service/*` | `D-12`, `D-14` |
| `PlantUnit` | plant-unit service, planting cycle unit routes, lifecycle service | health plant detail, provider/admin planting read models, plant trace | health applicant, provider/admin readers | yes, via `/api/trace/plant/:qrCode` and related trace lookups | read by integrity summaries and trace pipelines | `apps/backend/routes/api/plant-units.js`, `apps/backend/services/plant-unit-service/*`, `apps/backend/services/plant-unit-lifecycle-service.js` | `D-12`, `D-14` |
| `CultivationLog` | planting cycle activity routes, cultivation log service | health activity pages, provider planting activity views, scoring logic | health applicant, provider readers | not directly public | used in scoring/analytics read paths | `apps/backend/routes/api/planting-cycles-activity-harvest-routes.js`, `apps/backend/services/cultivation-log-service.js`, `apps/backend/routes/api/provider/handlers/planting.js` | `D-12` |
| `HarvestBatch` | planting harvest routes, harvest-batches routes, certificate/traceability bootstrap | batch routes, provider/admin planting, trace API, lots routes | health applicant, provider/admin readers, public viewers | yes, via `/api/trace/batch/:batchId` and generic QR trace | used by traceability bootstrap and interoperability trace events | `apps/backend/routes/api/planting-cycles-activity-harvest-routes.js`, `apps/backend/routes/api/harvest-batches.js`, `apps/backend/routes/api/trace-batch-lot-routes.js` | `D-14` |
| `Lot` | `lots.js`, traceability bootstrap paths | health tracking lots, public lot trace, provider/admin read models | health applicant, provider/admin readers, public viewers | yes, via `/api/trace/lot/:lotId` and generic QR trace | used by trace event export and QR rendering utilities | `apps/backend/routes/api/lots.js`, `apps/backend/routes/api/trace-batch-lot-routes.js`, `apps/backend/routes/api/helpers/lots-utility-routes.js` | `D-14` |
| `TraceQrSecurity` | QR code service, traceability bootstrap, planting QR generation | trace service, provider planting, admin planting, interoperability trace event helper | system-generated, provider/admin readers, public trace consumers | yes, indirectly via public URLs and QR resolution | scan logging side effects and integrity checks | `apps/backend/services/qrcode/qrcode-service.js`, `apps/backend/services/trace-service/*`, `apps/backend/routes/api/provider/handlers/planting.js`, `apps/backend/routes/api/admin/planting.js` | `D-14` |
| `TraceQrScan` | QR code service scan recording | not a primary UI entity; read indirectly via trace observability | system/public scan events | indirect only | updated on public scan events | `apps/backend/services/qrcode/qrcode-service.js`, `apps/backend/prisma/schema.prisma` | `D-14` |

## Configuration and Reference Entities

| Entity | Primary writers | Primary readers | Main actors | Public exposure | Async/background touch | Evidence | Related drift IDs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `SystemConfig` | `admin/config.js` upsert, pricing/config helpers | pricing routes, working-days service, admin settings | admin | no | used by service-layer calculations | `apps/backend/routes/api/admin/config.js`, `apps/backend/routes/api/pricing.js`, `apps/backend/services/working-days-service.js` | `D-07` |
| `PlantSpecies` | `admin/plants.js` | plant selection, harvest routes, certificate service, cache service | admin writes, health/provider readers | no | used by cache warm/read helpers | `apps/backend/routes/api/admin/plants.js`, `apps/backend/services/certificate-service.js`, `apps/backend/services/cache-service.js` | `D-07` |
| `DTAMPROVIDER` | no clear active write path in current runtime map | provider directory legacy fallback, SLA monitor | legacy provider compatibility, system jobs | no | yes, read by SLA monitor background job | `apps/backend/routes/api/provider/provider-directory-utils.js`, `apps/backend/jobs/sla-monitor.js`, `apps/backend/prisma/schema.prisma` | `D-08` |

## Ownership Signals

- `Application` is the most overloaded entity in the runtime. It is written by applicant flows, provider workflow transitions, admin overrides, payment flows, audit scheduling, and cron logic.
- `ApplicationDraft` has active controller logic in `wizard-controller.js`, but the route family that would expose that flow is not mounted in the main API tree.
- `ApplicationComment` exists in backend schema and provider workflow logic, but provider detail also includes a runtime fallback for environments where the table does not exist.
- `Certificate` is both an internal workflow artifact and a public-trust artifact.
- `TraceQrSecurity` is the bridge entity between internal planting traceability and public QR resolution.
- `DTAMPROVIDER` behaves as a compatibility read model rather than a clearly canonical active entity in the current runtime.

## Practical Reading Order

When analyzing runtime ownership of a bug or contract issue, read in this order:

1. `docs/flow-runtime-matrix.md`
2. `docs/canonical-inventory.md`
3. `docs/entity-runtime-matrix.md`
4. `docs/runtime-drift-register.md`
