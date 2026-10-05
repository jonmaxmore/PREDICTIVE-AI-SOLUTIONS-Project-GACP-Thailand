# SYSTEM_MAP (Source of Truth)

Last updated: 2026-02-14

This document defines active production runtime entrypoints for web + backend.
Use this file as the handoff map for new engineers.

## 1) Runtime entrypoints

- Backend API root: `apps/backend/routes/api/index.js`
- Provider canonical API namespace: `apps/backend/routes/api/provider/index.js`
- Web app routes root: `apps/web-app/src/app`
- Middleware/auth gate: `apps/web-app/src/middleware.ts`

## 2) Active web namespaces

- Health: `/health/*`
- Provider: `/provider/*`
- Admin: `/admin/*`
- Auth:
  - `/auth/health/login`
  - `/auth/provider/login`

Compatibility alias:
- `/provider/dashboard/admin` -> redirects to `/admin/dashboard`

## 3) Active API namespaces

- Auth:
  - `/api/auth/health/*`
  - `/api/auth/provider/*`
- Health operations:
  - `/api/applications/*`
  - `/api/payments/*`
  - `/api/preview/*`
  - `/api/invoices/*`
- Provider operations:
  - `/api/provider/*` (canonical)
- Admin operations:
  - `/api/admin/*`
- Observability:
  - `/api/health`
  - `/api/metrics`
  - `/api/version`

## 4) Runtime compatibility flags

- `ENABLE_DTAMPROVIDER_PROVIDER_FALLBACK` (default: `false`)
  - `true` allows provider lookup fallback through legacy `DTAMPROVIDER`

## 5) Structural guards

- Orphan route checker:
- `node scripts/ci/check-orphan-api-routes.js`
- Frontend provider API surface checker:
- `node scripts/ci/check-frontend-provider-api-usage.js`
- ERP regression gate:
  - `node scripts/run-regression-gate.js`

## 6) Non-authoritative docs

- `apps/web-app/docs/archive/*` is historical reference only.
- Use this file and `docs/active-api-surface.md` for current runtime contracts.

## 7) Planting runtime blueprint

- `docs/planting-runtime-blueprint.md` defines the canonical planting architecture,
  sitemap, trace chain, and integrity policy for health/provider/admin/public trace.
- `docs/planting-operation-guide.md` defines role-based operational rules for daily runtime.
- `docs/uat-checklist-planting-runtime.md` defines UAT acceptance criteria and test evidence items.
