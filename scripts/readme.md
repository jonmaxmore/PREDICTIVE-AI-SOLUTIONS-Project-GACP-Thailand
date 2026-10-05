# Scripts Handbook

This folder contains runtime validation, regression, and operational scripts for the GACP Certification Application.

## Canonical Identity and Route Model

- Health user auth: `/api/auth/health/*`
- Provider auth: `/api/auth/provider/*`
- Canonical provider APIs: `/api/provider/*`
- Legacy provider aliases are disabled by default and can be enabled only for incidents with:
  - `ENABLE_PROVIDER_LEGACY_ALIAS=true`

## Production Gates (Required)

1. Auth hardening + security conventions gate

```bash
npm run gate:auth-hardening
```

Includes:
- `scripts/ci/check-security-conventions.js`
- Auth + ThaID + client IP hardening unit checks
- Web auth API lint checks

2. ERP regression gate

```bash
node scripts/test/run-regression-gate.js
```

Runs required end-to-end API journeys:
- wizard flow
- payment + receipt gate
- provider workflow
- auto-trace first cycle
- manual trace subsequent cycle
- negative gate checks

3. Backend test suite

```bash
pnpm --dir apps/backend run test -- --passWithNoTests --ci --forceExit
```

4. Frontend quality suite

```bash
pnpm --dir apps/web-app run lint
pnpm --dir apps/web-app run build
pnpm --dir apps/web-app run test -- --runInBand --passWithNoTests
```

## UAT Suites

- Membership/OAuth regression UAT:

```bash
node scripts/test/run-regression-gate.js
```

- Auth hardening UAT gate:

```bash
npm run gate:auth-hardening
```

- Full journey matrix (lint + typecheck + best/good/normal/bad/chaos + e2e + uat):

```bash
npm run test:journey:full
```

Credential behavior:
- Without explicit `HEALTH_ID` + `HEALTH_PASSWORD`, credential-required steps (`web_e2e`, `uat_regression_gate`) are skipped.
- With explicit credentials, the suite runs full credentialed UAT.

Journey matrix components:
- `best_case`: `npm run gate:auth-hardening`
- `good_case`: auth readiness + web e2e
- `normal_case`: `node scripts/test/run-regression-gate.js`
- `bad_case`: `node scripts/test/run-member-bad-journey-check.js`
- `chaos_case`: `node scripts/test/run-chaos-journey-check.js`

These suites use canonical helpers from:

- `scripts/test/regression-test-helpers.js`

## Structural Safety Checks (Manual / Review-Driven)

- Enforce prohibited legal/brand term bans in tracked repository files:

```bash
node scripts/ci/check-banned-terms.js
```

Optional staged-files scan during local review:

```bash
node scripts/ci/check-banned-terms.js --staged
```

- Detect orphan API routes (files that are not mounted in runtime):

```bash
node scripts/ci/check-orphan-api-routes.js
```

- Enforce canonical provider API usage in frontend:

```bash
node scripts/ci/check-frontend-provider-api-usage.js
```

- Enforce UTF-8/mojibake safety in source:

```bash
npm run check:encoding
```

Auto-repair mojibake-encoded text in source files:

```bash
npm run fix:encoding
```

## Production Readiness Validation

Cross-platform readiness validation:

```bash
node scripts/ci/production-readiness-check.js
```

Strict production mode (fails when `.env.production` or production TLS files are missing):

```bash
node scripts/ci/production-readiness-check.js --strict
```

Linux/macOS wrapper:

```bash
bash scripts/ci/production-readiness-check.sh
```

Provision local assets needed for strict readiness checks:

```bash
node scripts/deploy/provision-local-production-assets.js
```

This script can create:
- `apps/backend/.env.production` from template/example
- `nginx/ssl/gacp.crt` and `nginx/ssl/gacp.key` from local dev certs

The readiness script checks:
- backend tests
- canonical route structure checks
- core security/deployment file presence
- monitoring config presence
- docs source-of-truth presence

## Compatibility Scripts (Temporary)

These wrappers exist for transition compatibility. Prefer canonical scripts above.

- `scripts/test-provider-flow.js`
- `scripts/test-PROVIDER-cms-flow.js`
- `scripts/test-PROVIDER-regression-flow.js`

## Legacy Root Script Archive

Legacy manual scripts that were previously stored in repository root are now archived in:

- `scripts/legacy/root-manual-flows/`

These are retained for traceability only and are not part of required release gates.

## Environment Variables Used by Scripts

- `API_URL` (default: `http://localhost/api`)
- `WEBAPP_URL` (default: `http://localhost`)
- `HEALTH_ID`, `HEALTH_PASSWORD` (required for credentialed UAT steps; no default credentials are injected by `test:journey:full`)
- `PROVIDER_REVIEWER_ID`, `PROVIDER_SCHEDULER_ID`, `PROVIDER_AUDITOR_ID`, `PROVIDER_ACCOUNT_ID`, `PROVIDER_ADMIN_ID` (optional overrides)
- `ENABLE_PROVIDER_LEGACY_ALIAS` (default: `false`)

## Standard Execution Order Before Release

1. `npm run test:journey:full`
2. `node scripts/ci/production-readiness-check.js`
3. Frontend lint/build/test
4. Backend tests (if not already run in readiness check)

If any required gate fails, release status is `NO-GO` until resolved.
