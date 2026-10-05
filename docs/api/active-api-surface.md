# ACTIVE_API_SURFACE

Last updated: 2026-02-15

Only endpoints in this document are canonical for new integrations.

## Auth

- `POST /api/auth/health/login`
- `POST /api/auth/provider/login`

## Provider (canonical)

- `GET /api/provider/reviewer/dashboard`
- `GET /api/provider/scheduler/dashboard`
- `GET /api/provider/scheduler/auditors`
- `GET /api/provider/scheduler/audits/schedules`
- `POST /api/provider/scheduler/audits/schedules`
- `GET /api/provider/auditor/dashboard`
- `POST /api/provider/auditor/applications/:id/inspection-starts`
- `POST /api/provider/auditor/applications/:id/audit-decisions`
- `GET /api/provider/applications/queue`
- `POST /api/provider/applications/:id/assign`
- `POST /api/provider/applications/:id/workflow-transitions`
- `POST /api/provider/applications/:id/revision-expirations`
- `GET /api/provider/applications/:id/audit-timelines`
- `POST /api/provider/admin/revision-reminder-runs`
- `POST /api/provider/admin/batch-actions`
- `GET /api/provider/certificates/dashboard`
- `POST /api/provider/certificates/bulk-notify`
- `GET /api/provider/analytics/performance`
- `GET /api/provider/planting-cycles`
- `GET /api/provider/planting-cycles/:id`
- `GET /api/provider/planting-cycles/:id/activities`
- `GET /api/provider/planting-cycles/:id/plot-qrs`
- `GET /api/provider` (provider directory list)
- `POST /api/provider` (create provider account)
- `GET /api/provider/:providerId`
- `PUT /api/provider/:providerId`
- `DELETE /api/provider/:providerId`

## Health runtime

- `GET /api/applications`
- `POST /api/applications`
- `POST /api/applications/draft`
- `GET /api/applications/draft`
- `GET /api/preview/applications/:id/preview`
- `POST /api/payments/phase1/:applicationId`
- `POST /api/payments/phase2/:applicationId`
- `GET /api/invoices`
- `GET /api/planting-cycles/my`
- `GET /api/planting-cycles/capacity/summary`
- `POST /api/planting-cycles`
- `GET /api/planting-cycles/:id`
- `PATCH /api/planting-cycles/:id`
- `POST /api/planting-cycles/:id/plant-units/generate`
- `POST /api/planting-cycles/:id/plant-units/confirm`
- `POST /api/planting-cycles/:id/plot-qrs/generate`
- `GET /api/planting-cycles/:id/plot-qrs`
- `POST /api/planting-cycles/:id/activities`
- `GET /api/planting-cycles/:id/activities`
- `POST /api/planting-cycles/:id/harvest-batches`

## Trace runtime

- `GET /api/trace/plot-cycle/:qrCode`
- `GET /api/trace/batch/:batchId`
- `GET /api/trace/lot/:lotId`
- `GET /api/trace/verify/:entityType/:entityId`

## Admin runtime

- `GET /api/admin/*` (see `apps/backend/routes/api/admin.js`)
- `POST /api/admin/*` (see `apps/backend/routes/api/admin.js`)
- `GET /api/admin/planting-cycles`
- `GET /api/admin/planting-cycles/:id`
- `GET /api/admin/planting-cycles/:id/plot-qrs`

## Observability/runtime metadata

- `GET /api/health`
- `GET /api/metrics`
- `GET /api/version`

## Validation guards

- `node scripts/ci/check-orphan-api-routes.js`
- `node scripts/ci/check-frontend-provider-api-usage.js`
