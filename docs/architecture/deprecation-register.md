# Deprecation Register

This document tracks deprecated and compatibility-only APIs/behaviors.
Release owners must review this register before every production deployment.

## Status Legend

- `active`: still used and supported
- `deprecated`: still available but should not be used for new work
- `compat-only`: temporary fallback, disabled by default
- `removed`: no longer available

## API Deprecations

| Area | Endpoint / Feature | Status | Replacement | Sunset Condition | Owner |
|---|---|---|---|---|---|
| Applications | `POST /api/applications/submit` | `deprecated` | `POST /api/application-flow/prepare` + `POST /api/applications/:id/finalize-submission` | Remove after all clients migrate and UAT passes | Backend |
| Cultivation | `POST /api/planting-cycles/:id/harvest` | `deprecated` | `POST /api/planting-cycles/:id/harvest-batches` | Sends `Sunset: Wed, 31 Dec 2026 23:59:59 GMT` — the date is resolved in `apps/backend/config/api-deprecation-policy.js` (override `PLANTING_HARVEST_LEGACY_SUNSET` for a staging rehearsal) | Backend |

## Verification Checklist

Run before release:

1. `node scripts/ci/check-orphan-api-routes.js`
2. `node scripts/ci/check-frontend-provider-api-usage.js`
3. `node scripts/run-regression-gate.js`
4. `node scripts/ci/production-readiness-check.js`

If any check fails, release is `NO-GO` until resolved.
