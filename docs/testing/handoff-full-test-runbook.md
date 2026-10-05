# Full Test and Handoff Runbook

## Objective

Run a production-style full test pass and produce handoff evidence covering:
- lint
- type check
- e2e
- uat regression
- journey matrix (`best`, `good`, `normal`, `bad`, `chaos`)

## Required Environment Variables

Set these before execution:

```bash
BASE_URL=https://gacpth.com/api
PUBLIC_BASE_URL=https://gacpth.com
HEALTH_ID=1100100100011
HEALTH_PASSWORD=Test@12345
NODE_TLS_REJECT_UNAUTHORIZED=0
```

## One-Command Full Verification

```bash
npm run test:journey:full
```

## Individual Journey Commands

```bash
npm run gate:auth-hardening           # best_case
npm --prefix apps/web-app run test:e2e -- --project=chromium --workers=1
node scripts/run-regression-gate.js   # normal_case
npm run test:journey:bad              # bad_case
npm run test:journey:chaos            # chaos_case
```

## Artifacts for Handoff

Collect and attach:
- `test-reports/full-test/*.json`
- Playwright HTML report if generated (`apps/web-app/playwright-report/`)
- terminal log from full run (`npm run test:journey:full`)

## Release Decision Rule

- `GO`: every category in `test:journey:full` is PASS.
- `NO-GO`: any category fails, or critical security/auth checks fail.

