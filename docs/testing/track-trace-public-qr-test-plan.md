# Track & Trace Public QR Test Plan (GACP Cultivation Scope)

This plan validates cultivation -> harvest -> packaging lots -> transport traceability (no downstream product/SKU flow).

## Preconditions

- Docker stack is up and healthy.
- API is reachable at `http://localhost/api`.
- Public trace base URL is configured:
  - Local full stack: `PUBLIC_TRACE_URL=http://localhost/trace`
  - Backend-only CI (no frontend/nginx): `PUBLIC_TRACE_URL=http://localhost:5000/api/trace`
  - Production: `PUBLIC_TRACE_URL=https://<public-domain>/trace`
- Provider/Health seed users are available:
  - Health `healthId`: `1100100100011`
  - Reviewer `providerId`: `1111111111111`
  - Auditor `providerId`: `2222222222222`
  - Scheduler `providerId`: `3333333333333`
  - Account `providerId`: `4444444444444`
  - Admin `providerId`: `9876543210987`

## Commands

```bash
node scripts/test-full-first-cycle-auto-trace-public-qr.js
node scripts/test-subsequent-cycle-manual-trace-public-qr.js
node scripts/test-negative-gates.js
```

Regression gate commands:

```bash
BASE_URL=http://localhost/api node scripts/test-wizard-flow.js
BASE_URL=http://localhost/api node scripts/test-trace-qr-flow.js
BASE_URL=http://localhost/api node scripts/test-provider-regression-flow.js
BASE_URL=http://localhost/api node scripts/test-accounting-receipt-flow.js
```

## Scenario A: First Cycle Auto Trace (after PASS)

Script: `scripts/test-full-first-cycle-auto-trace-public-qr.js`

Validates:

- Health submits application with packaging rows in form data.
- Phase 1 and Phase 2 payment mock success.
- Reviewer approves docs and phase 2 invoice flow.
- Scheduler creates `ONLINE_MEET` schedule.
- Account issues phase 2 receipt.
- Auditor PASS decision triggers auto-trace creation:
  - `1` harvest batch
  - `N` lots (`N == application packaging rows`)
- Lot fields match packaging input (type/units/weights).
- Public trace APIs respond without authentication:
  - `/api/trace/batch/:id`
  - `/api/trace/lot/:id`
- QR URLs resolve publicly with HTTP `200`:
  - `/trace/batch/:id`
  - `/trace/lot/:id`
- Public payload does not expose sensitive identity fields.
- Audit timeline includes:
  - `AUTO_BATCH_CREATED`
  - `AUTO_LOTS_CREATED_FROM_APPLICATION`
  - `QR_GENERATED`

Expected output:

- `PASS`
- Printed JSON includes `applicationId`, `batchId`, `lotCount`, `qrUrls`.

## Scenario B: Subsequent Cycle Manual Trace

Script: `scripts/test-subsequent-cycle-manual-trace-public-qr.js`

Validates:

- Health manually creates harvest batch.
- Health manually creates packaging lots.
- QR URLs are generated and unique per lot.
- Batch payload reflects packaging totals and stays within harvest weight.
- Public trace APIs and public URLs resolve with HTTP `200`.
- Public payload does not expose sensitive identity fields.

Expected output:

- `PASS`
- Printed JSON includes `farmId`, `batchId`, `lotIds`, `lotQrUrls`.

## Negative Gate Suite

Script: `scripts/test-negative-gates.js`

Validates:

- Revision SLA overdue -> `EXPIRED` with forced-overdue trigger in non-production test mode.
- Late health resubmission is blocked after expiry.
- Scheduling validation:
  - `ONLINE_MEET` requires `meetingLink`
  - `ONSITE` requires `mapLink` or `location`
- Phase 2 receipt gate:
  - auditor cannot start inspection before receipt issuance.
- Collision prevention:
  - same auditor overlapping schedule returns `409`.

Expected output:

- `PASS`
- Printed JSON includes all boolean checks under `checks`.

## Rollback Notes (Test Artifacts)

If test data growth is undesirable:

1. Keep service online, no schema rollback needed (no migration in this patch).
2. Soft-delete or cleanup test applications/batches/lots by IDs printed in script output.
3. If emergency rollback is needed, revert the commit containing:
   - `apps/backend/services/traceability-service.js`
   - `apps/backend/routes/api/harvest-batches.js`
   - `apps/backend/services/qrcode/qrcode-service.js`
   - new scripts under `scripts/`.
