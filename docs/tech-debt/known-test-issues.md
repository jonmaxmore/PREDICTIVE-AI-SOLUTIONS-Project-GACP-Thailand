# Known Test Issues — post Batch 10 (HEAD: dbe4c68b)

Last QA sweep: 2026-05-16 — batches 9 (92609228) and 10 (dbe4c68b) verified.

Final test results after fix:

| Suite | Total | Passed | Failed | Notes |
|---|---|---|---|---|
| Backend unit (`apps/backend/__tests__/unit/`) | 1196 | 1196 | 0 | clean (99 suites) |
| Backend integration (`apps/backend/__tests__/integration/`) | 109 | 109 | 0 | clean (16 suites) |
| Backend top-level (`apps/backend/__tests__/`, non-nested) | 216 | 173 | 0 (43 intentionally skipped) | clean (11 suites + 1 fully-skipped) |
| Web-app TypeScript compile | n/a | clean exit | 0 | tsc --noEmit, exit 0 |
| Web-app ESLint (health + components) | n/a | 0 errors, 11 warnings | 0 errors | warnings detailed below |
| Web-app Jest | 209 | 209 | 0 | clean (17 suites) |
| Smoke-load critical modules | 7 | 7 | 0 | application-service, signature-service (crypto + media), payment-service-phase-flow, working-days, promptpay-qr, admin-application-service, admin-dashboard-service all `require()` cleanly |

## Regressions fixed this sweep

### 1. `getSecret()` dev fallbacks re-evaluated on every call (REGRESSION from batch 9)

**Symptom**: `apps/backend/__tests__/crypto-service.test.js` — 16 tests failed with `error:1C800064:Provider routines::bad decrypt`.

**Root cause**: Batch 9 (commit `92609228`) replaced the hardcoded `process.env.KEY_PASSPHRASE || 'botanical-audit-framework-2025'` fallback in `apps/backend/services/crypto/signature-service.js` with a call through the new unified secrets layer (`apps/backend/config/secrets.js::getSecret('RSA_PRIVATE_KEY_PASSPHRASE')`). The secrets catalog defines:

```js
RSA_PRIVATE_KEY_PASSPHRASE: {
  devFallback: () => `dev-rsa-passphrase-${process.pid}-${Date.now()}`,
}
```

`getSecret()` invoked the factory afresh on every call. The signature service uses the passphrase twice in sequence: first to encrypt the freshly generated RSA private key (PKCS8 AES-256-CBC), then later to decrypt that same key when signing. With `Date.now()` baked into the fallback, those two passphrases differed → OpenSSL bad-decrypt.

**Fix** (`apps/backend/config/secrets.js`, ~5 lines): added a process-lifetime `Map` cache (`_devFallbackCache`) and memoize the result of `entry.devFallback()` keyed by canonical secret name. Production paths (real env values) unaffected — caching only applies inside the dev/test fallback branch.

**Verification**: `npx jest apps/backend/__tests__/crypto-service.test.js` → 28/28 passing.

## Pre-existing / non-regression items (documented, NOT fixed in this sweep)

### 2. Flaky test — `applications-submit-capability-gate.test.js` (FIXED 2026-05-16, Batch 11)

**Symptom**: When running unit + integration suites together in one Jest invocation, this file sometimes failed 2 of its tests (`VIEWER is blocked with 403 CAPABILITY_DENIED` and `MANAGER is blocked with 403`). Re-running the same combined command (or running the file in isolation) passed 100%. Jest also emitted "A worker process has failed to exit gracefully" at the end of the combined run.

**Root cause**: Two module-level handle leaks kept Jest workers from exiting cleanly:

1. `apps/backend/middleware/rate-limiter.js` line 24 — an unconditional `setInterval(...)` to GC the in-memory rate-limit Map. Three integration tests already mocked the module specifically to dodge this (see `provider-cms-workflow.test.js`, `provider-admin-planting-integrity.test.js`, `provider-legacy-alias-flag.test.js`), confirming the leak was known but not fixed at source.
2. `apps/backend/config/redis.js` — created a real `ioredis` client at module load via `new Redis(REDIS_URL, { lazyConnect: false })`. In test env this opened a TCP socket to `redis://127.0.0.1:6379`, with retry handlers that kept the worker alive.

When the leaked workers were force-killed mid-flight, occasional supertest requests to `/api/applications/submit` had stale module state and returned non-403 responses, surfacing as the two flaky failures in `applications-submit-capability-gate.test.js`.

**Fix** (`apps/backend/middleware/rate-limiter.js` and `apps/backend/config/redis.js`, ~10 lines each):

- `rate-limiter.js`: extracted the cleanup body into a named `cleanupMemoryStore()`. The `setInterval` is now only armed when `process.env.NODE_ENV !== 'test'` and is `.unref()`-ed so it never blocks a clean shutdown. Exported `cleanupMemoryStore` and `stopCleanupInterval` for tests that exercise the GC path directly.
- `redis.js`: wrapped the `new Redis(...)` block in `if (process.env.NODE_ENV !== 'test')`. Tests get `module.exports === null`, which the consumers (rate-limiter, cache-service) already handle via `if (redis && redis.status === 'ready')` guards. Production paths are unchanged.

**Verification**:
- `npx jest apps/backend/__tests__/unit/applications-submit-capability-gate.test.js --detectOpenHandles --no-coverage` — 5/5 passing, no open-handle report.
- `npx jest apps/backend/__tests__/unit --no-coverage` — 1209/1209 passing, no "worker failed to exit" warning.
- `npx jest apps/backend/__tests__/unit apps/backend/__tests__/integration --no-coverage` — 119/119 suites, 1344/1344 tests, no leak warning.

### Lint warnings (11 total, 0 errors) in `apps/web-app/src/{app/health,components}`

All non-blocking — eslint exits 0 cleanly because they're warnings, not errors. Detail:

- `apps/web-app/src/app/health/payments/slip-upload-modal.tsx:269` — `<img>` for the PromptPay QR data URL. **Intentional**: the QR is generated as a `data:image/png;base64,...` string by `apps/backend/utils/promptpay-qr.js` + frontend mirror; `next/image` would not optimize a data URL and adds overhead. Leaving as `<img>` is the correct call.
- 10× `tailwindcss/classnames-order` warnings across `submit-step.tsx`, `payments/client-view.tsx`, `reports/report-modal.tsx`, `components/ui/alert.tsx`, `components/ui/icon-buttons.tsx`. Cosmetic (cls ordering); auto-fixable with `npx eslint --fix`. Not addressed in this sweep because the lint config tolerates warnings.

### Test environment notes

- `[baseline-browser-mapping]` deprecation noise on every Jest run — package is >2 months old. Bump in a chore PR.
- All Prisma-dependent tests use the in-process Prisma mock from `apps/backend/__tests__/setup.js` — no live Postgres/Redis required for unit + integration suites.
- `crypto-service.test.js` writes throwaway keys to `apps/backend/__test_keys__/` and cleans up via `afterAll`. With the secrets-fallback fix, this is now reliable across full-suite runs.

## Touched files this sweep

- `apps/backend/config/secrets.js` — added `_devFallbackCache` Map, memoize dev fallback in `getSecret()`.
- `apps/backend/middleware/rate-limiter.js` — guard module-level `setInterval` behind `NODE_ENV !== 'test'`; export `cleanupMemoryStore` and `stopCleanupInterval`; `.unref()` the timer.
- `apps/backend/config/redis.js` — guard module-load `new Redis(...)` behind `NODE_ENV !== 'test'`. Tests now see `module.exports === null` (existing consumers already handle this branch).
- `docs/tech-debt/known-test-issues.md` — this file (updated).

No production routes, no production service code, no test code modified.
