# DEPENDENCY_INTEGRATION_MATRIX

Last updated: 2026-03-06

This document is a Phase 1.9 runtime dependency and integration map derived from the current codebase.
It records active boundaries, adapters, and consumers as they exist now.
It is not a target-state design and does not prescribe remediation.

## Scope

- Ingress and deployment boundary: `docker-compose.production.yml`, `docs/network-diagram.md`
- Backend bootstrap: `apps/backend/server.js`
- Backend API root: `apps/backend/routes/api/index.js`
- Backend infra/services: `apps/backend/services/redis-service.js`, `apps/backend/services/queue-service.js`, `apps/backend/services/storage-service.js`, `apps/backend/shared/metrics.js`
- Backend integrations: `apps/backend/routes/api/webhooks.js`, `apps/backend/routes/api/lab-webhook.routes.js`, `apps/backend/controllers/lab-webhook-controller.js`, `apps/backend/routes/api/interoperability.js`, `apps/backend/services/crypto/signature-service.js`
- Backend background jobs: `apps/backend/jobs/scheduler.js`, `apps/backend/jobs/sla-processor.js`
- Web transport boundary: `apps/web-app/next.config.ts`, `apps/web-app/src/app/api/[...path]/route.ts`
- Mobile transport boundary: `apps/mobile-app/lib/core/config/api_config.dart`, `apps/mobile-app/lib/core/network/dio_client.dart`, `apps/mobile-app/lib/core/services/api_service.dart`

## Dependency classes used in this inventory

- `edge`: public ingress or client-to-runtime boundary
- `stateful`: durable state, cache, or object storage
- `async`: queue, cron, or delayed/background execution
- `external`: third-party or machine-to-machine integration
- `support`: observability, docs, or runtime support surface

## Edge and network boundaries

| Boundary | Class | Primary producer / adapter | Main consumers | Runtime surfaces | Evidence | Initial signals |
| --- | --- | --- | --- | --- | --- | --- |
| Nginx public ingress | edge | Docker/nginx gateway | Browser users, payment callback sender, public verifiers | `/`, `/api/*`, `/api/webhooks/payment` | `docker-compose.production.yml`, `docs/network-diagram.md` | Public entry is centralized at nginx; backend and frontend stay internal-only in compose topology |
| Web generic API proxy | edge | Next route handler | Web health, provider, admin UIs | `apps/web-app/src/app/api/[...path]/route.ts` -> backend `/api/*` | `apps/web-app/src/app/api/[...path]/route.ts` | Auth precedence is mixed: explicit bearer header, then `auth_token`, then `provider_token` |
| Web asset rewrites | edge | Next rewrites | Web UI pages that need backend-served files | `/uploads/*` | `apps/web-app/next.config.ts` | Static asset traffic bypasses the generic proxy path |
| Mobile API client via central config | edge | Flutter `DioClient` + `ApiConfig` | Mobile health workflows | backend `/api/*` with bearer auth | `apps/mobile-app/lib/core/config/api_config.dart`, `apps/mobile-app/lib/core/network/dio_client.dart` | Mobile has one network path using `ApiConfig.baseUrl`, dev/prod switching, and token injection from secure storage |
| Mobile alternate API client | edge | Flutter `ApiService` | Mobile features still using legacy service wrapper | backend paths under hardcoded host | `apps/mobile-app/lib/core/services/api_service.dart` | A second mobile transport source exists with hardcoded `https://api.dtam.go.th` and different token keys/refresh path |
| Offline sync entry | edge | Express sync adapter | Health and provider identities using sync payloads | `POST /api/sync/offline` | `apps/backend/routes/api/sync.js` | Sync auth is identity-type inference over cookie or bearer token, not a single auth middleware path |

## Stateful runtime dependencies

| Dependency | Class | Primary producer / adapter | Main consumers | Runtime surfaces | Evidence | Initial signals |
| --- | --- | --- | --- | --- | --- | --- |
| PostgreSQL via Prisma | stateful | `prisma-database` | Nearly all backend route families, notifications, certificates, applications, planting, trust registry | `/api/*`, `/health`, background jobs | `apps/backend/server.js`, `apps/backend/routes/api/index.js`, `apps/backend/jobs/scheduler.js` | Backend is the clear source of record, but schema understanding also exists in duplicated web Prisma files documented elsewhere |
| Redis cache layer | stateful | `RedisService` | Backend cache-aside reads, health checks, reports, auth/session helpers | runtime cache, `/health`, queue bootstrap dependency | `apps/backend/services/redis-service.js`, `apps/backend/server.js` | Service degrades gracefully when Redis is unavailable, so cache presence is optional at runtime |
| Redis-backed Bull queues | stateful + async | `queue-service` | SLA monitor, PDF jobs, webhook DLQ | `sla-monitor`, `pdf-generator`, `webhook-dlq` queues | `apps/backend/services/queue-service.js` | Queue bootstrap depends on the same Redis URL but operates as separate Bull connections |
| Object storage via MinIO | stateful | `storage-service` MinIO client | Documents, uploads, certificate/pdf artifacts, signed downloads | upload buffers, presigned URLs, bucket init | `apps/backend/services/storage-service.js`, `docker-compose.production.yml` | Storage provider can run in MinIO mode but silently fall back to local disk when credentials/init fail |
| Local upload filesystem fallback | stateful | `storage-service` + Express static mount | Web and backend document consumers | `/uploads/*` | `apps/backend/server.js`, `apps/backend/services/storage-service.js` | Storage can operate in dual mode: S3-compatible object storage or local flattened files |
| In-memory application metrics store | stateful + support | `shared/metrics` | `/api/metrics`, internal health telemetry | `/api/metrics` | `apps/backend/shared/metrics.js`, `apps/backend/routes/api/index.js` | Metrics persistence is process-local memory rather than external monitoring storage |

## Async and background dependencies

| Dependency | Class | Trigger / source | Main consumers | Runtime surfaces | Evidence | Initial signals |
| --- | --- | --- | --- | --- | --- | --- |
| Hourly and daily cron scheduler | async | `node-cron` job scheduler | SLA monitoring, daily reporting, certificate expiry notification flow | in-process cron jobs | `apps/backend/jobs/scheduler.js`, `apps/backend/server.js` | Cron starts automatically outside test mode and shares the main backend process lifecycle |
| SLA monitor queue | async | Bull recurring job at `0 8 * * *` plus cron-based hourly checks elsewhere | Overdue application detection and alerting | queue worker and SLA email/notification path | `apps/backend/services/queue-service.js`, `apps/backend/jobs/sla-processor.js`, `apps/backend/jobs/scheduler.js` | SLA monitoring exists in both queue and cron forms, so the capability is not attached to one execution path only |
| PDF generator queue | async | Bull worker using child processor | Certificate/application print or PDF generation flows | `pdf-generator` queue | `apps/backend/services/queue-service.js`, `apps/backend/jobs/pdf-processor.js`, `apps/backend/services/pdf/pdf-generator.service.js` | PDF generation is intentionally isolated from the main event loop via worker process plus Puppeteer |
| Webhook DLQ queue | async | Optional recurring Bull job | Payment reconciliation retry path | `webhook-dlq` queue | `apps/backend/services/queue-service.js`, `apps/backend/jobs/webhook-dlq-processor.js` | DLQ depends on env flag and processor presence; it is not always active in runtime |
| Notification database flow | async | Application, payment, audit, and scheduler services | Health applicants, schedulers, reviewers, auditors, admins | `/api/notifications/*` and background notification writes | `apps/backend/services/notification-service.js`, `apps/backend/routes/api/index.js` | Notifications persist in DB first, then email side effects are fire-and-forget |
| Email delivery side effect | async + external | Notification service and SLA jobs | Human recipients via SMTP | application notices, audit schedule, certificate reminders, SLA alerts | `apps/backend/services/email-service.js`, `apps/backend/jobs/sla-processor.js`, `apps/backend/services/notification-service.js` | Email can be real SMTP or mocked/disabled, so runtime behavior depends heavily on env setup |

## External integrations and public trust surfaces

| Dependency | Class | Primary producer / adapter | Main consumers | Runtime surfaces | Evidence | Initial signals |
| --- | --- | --- | --- | --- | --- | --- |
| Payment gateway webhook sender | external | Payment webhook route + payment service | Billing reconciliation, invoice status, payment audit | `POST /api/webhooks/payment`, `POST /api/webhooks/payment/:provider` | `apps/backend/routes/api/webhooks.js`, `apps/backend/services/payment-webhook-service.js` | Webhook handlers intentionally return HTTP 200 even on processing failure to avoid aggressive retries |
| External lab system callback | external | Lab webhook route/controller | Application lab result ingestion | `POST /api/callbacks/lab-result` | `apps/backend/routes/api/lab-webhook.routes.js`, `apps/backend/controllers/lab-webhook-controller.js` | Callback path is present, but controller comments assume future API-key middleware and specific schema fields |
| SMTP provider / email relay | external | Nodemailer transporter | Notification emails and SLA alerts | SMTP host/port/auth envs | `apps/backend/services/email-service.js` | Email delivery is a true external dependency only when `EMAIL_ENABLED=true`; otherwise it is mocked locally |
| Public signature and trust export | external + support | Interoperability router + signature service | Public verifiers, external trust consumers, admin revocation flow | `/api/interoperability/v1/*` | `apps/backend/routes/api/interoperability.js`, `apps/backend/services/crypto/signature-service.js` | Trust export is public-facing, while signing backend can use local keys or optional AWS KMS |
| Public trace data export | external + support | Trace routes and public trace router | Public QR consumers, mobile scanner, web trace portal | `/trace/*`, `/api/trace/*`, `/api/interoperability/v1/trace/events/*` | `apps/backend/server.js`, `apps/backend/routes/api/index.js`, `apps/backend/routes/api/interoperability.js` | Public trace is split across more than one namespace and more than one consumer surface |

## Support and observability surfaces

| Dependency / surface | Class | Primary producer / adapter | Main consumers | Runtime surfaces | Evidence | Initial signals |
| --- | --- | --- | --- | --- | --- | --- |
| Backend health endpoints | support | Express app and API router | Nginx health checks, ops checks, clients | `/health`, `/api/health` | `apps/backend/server.js`, `docker-compose.production.yml`, `apps/backend/routes/api/index.js` | Health is exposed at both app root and API root for compatibility |
| API metrics endpoint | support | In-memory metrics module | Internal ops, diagnostics | `/api/metrics` | `apps/backend/shared/metrics.js`, `apps/backend/routes/api/index.js` | Metrics are operationally useful but represent one process, not a fleet-wide view |
| Version endpoint | support | API root router | Clients, smoke tests, environment diagnostics | `/api/version` | `apps/backend/routes/api/index.js` | Version contract is lightweight and not obviously bound to release metadata elsewhere |
| Swagger UI | support | `swagger-ui-express` | Developers, testers | `/api-docs` | `apps/backend/server.js`, `apps/backend/config/swagger.js` | Runtime docs exist, but the repo also contains separate OpenAPI/document sets outside this path |

## Coupling signals

- Web transport depends on both cookies and caller-supplied bearer headers inside the same generic proxy boundary.
- Mobile transport is not singular: `ApiConfig` and `DioClient` define one path, while `ApiService` hardcodes a different base URL and token lifecycle.
- Storage runtime is dual-mode by design: MinIO object storage and local filesystem fallback can both become active depending on environment success.
- Payment reconciliation spans HTTP webhook ingress, audit logging, queue/DLQ behavior, invoice state, and notification side effects.
- Trust and public verification depend on two separate public families: trace routes and interoperability routes.
- Background execution is split across in-process cron and Bull queues rather than one scheduler mechanism.

## Read together with

- `docs/canonical-inventory.md`
- `docs/runtime-drift-register.md`
- `docs/flow-runtime-matrix.md`
- `docs/entity-runtime-matrix.md`
