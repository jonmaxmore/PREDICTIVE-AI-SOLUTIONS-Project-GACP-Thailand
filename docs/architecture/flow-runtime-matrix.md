# FLOW_RUNTIME_MATRIX

Last updated: 2026-03-06

This document maps major user, provider, admin, public, and system flows to the current runtime.
It is descriptive only and should be read together with:

- `docs/system-map.md`
- `docs/canonical-inventory.md`
- `docs/runtime-drift-register.md`

## User Flows

| Flow ID | Actor and goal | Entry points | Backend namespaces | Core entities | Dependencies and integrations | Consumer app | Related drift IDs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| U-01 | Health applicant signs in, registers, refreshes session, manages profile | Web: `/(auth)/*`, `/auth/health/login`; Mobile: `/login`, `/register*` | `/api/auth/health/*`, `/api/mfa/*` | `User`, `UserConsent` | JWT, cookies, localStorage bridge, Next middleware | Web health, Mobile | `D-09` |
| U-02 | Health applicant drafts a certification application with autosave and draft documents | Web: `/health/applications/new/step/[id]`, `use-auto-save.ts`, `documents-step.tsx` | `/api/applications/draft`, `/api/applications/draft-documents`, `/api/applications/config` | `ApplicationDraft`, draft document metadata, `User` | Storage service, multipart upload, web autosave store, proxy auth | Web health | `D-02`, `D-03`, `D-04` |
| U-03 | Health applicant prepares preview, confirms submission intent, and opens phase 1 payment | Web: `review-step.tsx`, `/health/applications/preview`, `invoice-step.tsx`, `/health/applications/payment` | `/api/applications/prepare`, `/api/preview/applications/:id/preview`, `/api/applications/submit`, `/api/payments/phase1/:applicationId`, `/api/payments/status/:applicationId` | `Application`, `Quote`, `Invoice`, `PaymentTransaction` | Payment service, preview calculators, PDF generation, proxy auth | Web health | `D-03`, `D-09` |
| U-04 | Health applicant manages farm readiness and compliance evidence before planting | Web: `/health/establishments/*`, `/health/site-analysis`, `/health/training`, `/health/documents/*` | `/api/farms/*`, `/api/site-analyses/*`, `/api/training-records/*`, `/api/documents/*`, `/api/water-sources/*`, `/api/seed-sources/*`, `/api/fertilizer-records/*`, `/api/controlled-environments/*` | `Farm`, `SiteAnalysis`, `TrainingRecord`, cultivation support records | Storage service, farm service, upload flows | Web health, Mobile partial parity | `D-12` |
| U-05 | Health applicant creates and operates planting cycles | Web: `/health/planting/new`, `/health/planting/[id]`, `/health/planting/[id]/activities`; Mobile: tracking and QR-oriented surfaces | `/api/planting-cycles/*`, root-mounted `/farms/:farmId/plots`, root-mounted `/plant-units/*` | `PlantingCycle`, `Plot`, `PlantingCyclePlot`, `PlantUnit`, `CultivationLog`, `HarvestBatch`, `Lot`, `TraceQrSecurity` | Planting service, QR generation, integrity checks, draft-document reuse for attachments | Web health, Mobile partial parity | `D-12`, `D-14` |
| U-06 | Health applicant monitors application status, certificates, notifications, and payment progress | Web: `/health/dashboard`, `/health/applications`, `/health/certificates`, `/health/notifications`, `/health/payments`; Mobile: `/dashboard`, `/applications`, `/certificates`, `/payments`, `/application/tracking` | `/api/applications/my`, `/api/applications/:id/status`, `/api/certificates/*`, `/api/notifications/*`, `/api/payments/*` | `Application`, `Certificate`, `Notification`, `PaymentTransaction` | Notification service, dashboard read models, billing reads | Web health, Mobile | `D-09` |

## Provider and provider Flows

| Flow ID | Actor and goal | Entry points | Backend namespaces | Core entities | Dependencies and integrations | Consumer app | Related drift IDs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P-01 | Provider reviewer loads assigned application details and records review decision | Web: `/provider/applications`, `/provider/applications/[id]`, `provider-api.ts` | `/api/provider/applications`, `/api/provider/applications/:id`, `/api/provider/applications/:id/workflow-transitions` | `Application`, `ApplicationComment`, workflow history, applicant profile | Provider auth, localStorage bearer usage, workflow transition service | Web provider | `D-05`, `D-06`, `D-09`, `D-11` |
| P-02 | Scheduler sees work queues, schedules audits, and reassigns auditors | Web: `/provider/calendar`, `/provider/scheduler/reassign` | `/api/provider/scheduler/*`, `/api/audits/pending-schedule`, `/api/audits/schedule`, `/api/audits/reassignable`, `/api/audits/:id/reassign` | `Application`, `User`, `Notification` | Notification service, workflow transition service, provider directory lookup | Web provider | `D-06`, `D-08`, `D-11` |
| P-03 | Auditor starts inspection and records audit decision | Web: `/provider/audits`, `/provider/audits/[id]` | `/api/provider/auditor/applications/:id/inspection-starts`, `/api/provider/auditor/applications/:id/audit-decisions`, `/api/audits/:id`, `/api/audits/:id/result` | `Application`, audit checklist payloads, `Notification`, downstream `Certificate` | Provider auth, workflow transitions, certificate service side effects | Web provider | `D-06`, `D-11` |
| P-04 | Head auditor or admin handles final approval queue | API-level provider surface; no clearly dominant web page found in current tree | `/api/provider/head-auditor/final-approval-queue`, `/api/provider/head-auditor/applications/:id/final-approvals` | `Application` | Canonical permission checks, workflow transition service | Web provider / API consumer | `D-06`, `D-11` |
| P-05 | Provider provider monitors planting traceability and integrity | Web: `/provider/planting`, `/provider/planting/[id]`, provider dashboard trace widgets | `/api/provider/planting-cycles/*` | `PlantingCycle`, `PlantUnit`, plot QR read models, activities | Provider auth, planting handlers, trace URLs | Web provider | `D-11`, `D-14` |
| P-06 | Provider provider manages provider directory and provider identities | Web: `/provider/management`, `/provider/profile` | `/api/provider`, `/api/provider/:id`, `/api/auth/provider/me` | `User`, optional `DTAMPROVIDER` fallback | Provider directory utils, `providerId` identity, legacy fallback flag | Web provider | `D-08`, `D-09`, `D-11` |
| P-07 | Provider accounting and certificate operations | Web: `/provider/accounting`, `/provider/receipts`, `/provider/certificates` | `/api/invoices/*`, `/api/accounting/*`, `/api/provider/certificates/*` | `Invoice`, `Quote`, `Certificate`, `PaymentTransaction` | Billing services, PDF generation, provider auth | Web provider | `D-09`, `D-11` |

## Admin Flows

| Flow ID | Actor and goal | Entry points | Backend namespaces | Core entities | Dependencies and integrations | Consumer app | Related drift IDs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A-01 | Admin manages users and Provider roles | Web: `/admin/users` | `/api/admin/users/*` | `User` | Canonical RBAC helpers, bcrypt, audit logging | Web admin | `D-07`, `D-08` |
| A-02 | Admin overrides application status with audit trail | Web: admin application governance surfaces; no single dedicated page dominates current tree | `/api/admin/applications/:id/status` | `Application`, workflow history, admin override metadata | Audit logger, admin role checks | Web admin / API consumer | `D-07` |
| A-03 | Admin maintains system config and plant master data | Web: `/admin/settings`; admin plant/config consumers may also be indirect | `/api/admin/config/*`, `/api/admin/plants/*` | `SystemConfig`, `PlantSpecies`, `PlantingCycle` dependency checks | Prisma admin access | Web admin | `D-07` |
| A-04 | Admin monitors planting integrity in read-only mode | Web: `/admin/planting`, `/admin/planting/[id]` | `/api/admin/planting-cycles/*` | `PlantingCycle`, `PlantUnit`, `TraceQrSecurity` | Planting integrity summaries, admin role gate | Web admin | `D-07`, `D-14` |

## Public and Trust Flows

| Flow ID | Actor and goal | Entry points | Backend namespaces | Core entities | Dependencies and integrations | Consumer app | Related drift IDs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-01 | Public user scans QR and views traceability chain | Web: `/trace`, `/trace/[qr-code]`, `/trace/plot-cycle/[qr-code]`, `/trace/plant/[qr-code]`, `/trace/batch/[qr-code]`, `/trace/lot/[lot-id]`; Mobile QR scanner points to trace result screens | `/trace/*`, `/api/trace/*` | `PlantingCycle`, `PlantUnit`, `HarvestBatch`, `Lot`, `TraceQrScan`, `TraceQrSecurity` | QR service, trace service, public URL generation | Web public, Mobile public/health | `D-14` |
| T-02 | Public user submits consumer feedback from trace context | Web component: `consumer-feedback-form.tsx` | `/api/consumer-feedback` | `ConsumerFeedback` | Public form post, trace context metadata | Web public | `D-14` |
| T-03 | Public verifier checks certificate validity, registry, revocation feed, signature validity, and trace events | Web: `/verify`, `/verify-identity`, `trust-verifier-portal.tsx` | `/api/interoperability/v1/verification`, `/api/interoperability/v1/trust/*`, `/api/interoperability/v1/signatures/verify`, `/api/interoperability/v1/trace/events/*`, `/api/identity/*` | `Certificate`, trust registry records, revocation feed, signature verification payloads, trace events | Crypto/trust services, certificate service, public API | Web public | `D-01`, `D-14` |

## System and Background Flows

| Flow ID | Actor and goal | Entry points | Backend namespaces and jobs | Core entities | Dependencies and integrations | Consumer app | Related drift IDs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S-01 | Payment provider posts webhook and backend reconciles payment state | External callback: `/api/webhooks/payment`, `/api/webhooks/payment/:provider` | Webhook routes plus payment services | `PaymentTransaction`, `Invoice`, payment audit metadata | External payment provider, signature header, payment service, idempotency handling | External system -> Backend | `D-01` |
| S-02 | Backend schedules SLA checks, reports, and certificate expiry notifications | Process start in `server.js`; cron in `jobs/scheduler.js` | `jobs/scheduler.js`, `jobs/sla-monitor.js` | `Application`, `Certificate`, `Notification`, legacy provider records | node-cron, prisma, notification service | Backend internal | `D-08` |
| S-03 | Backend runs queue workers for PDF generation and webhook DLQ | Process start in `server.js`; queue bootstrap in `queue-service.js` | `services/queue-service.js`, `jobs/pdf-processor.js`, `jobs/webhook-dlq-processor.js` | PDF payloads, callback retry state, billing/certificate artifacts | Bull, Redis, Puppeteer/PDF pipeline | Backend internal | `D-08` |
| S-04 | Offline-capable client posts consolidated sync payloads | Mobile/offline client or web client hitting sync endpoint | `/api/sync/offline` | sync payloads, user-scoped changes | JWT decode to choose health/provider auth, offline processing controller | Mobile, Web | `D-09`, `D-10` |

## Coupling Notes

- The health application flow is split across `applications`, `preview`, and `payments`, with additional unmounted `wizard` and `application-flow` files present in the repo.
- Provider provider flows depend on both `/api/provider/*` and `/api/audits/*`, so provider work is not isolated to one namespace family.
- Planting flow depends on root-mounted `plots` and `plant-units` routes in addition to `/api/planting-cycles/*`.
- Public trust behavior is split between `trace` and `interoperability`, which means traceability and certificate trust are separate runtime families.
- Web provider flow commonly bypasses cookie-only BFF usage and reads bearer tokens from localStorage directly.
