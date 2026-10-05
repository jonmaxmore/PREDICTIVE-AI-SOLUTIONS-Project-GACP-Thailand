# Preview / Production Release Record Draft (`64d87e54`)

- Status: Draft (pre-execution)
- Last Updated: 2026-02-22
- Use with:
  - `docs/preview-deploy-release-record-template.md`
  - `docs/preview-deploy-day-of-deploy-powershell-sequence.md`
  - `docs/preview-deploy-checklist.md`

## Purpose

Pre-filled release record draft for the approved release SHA `64d87e54`.
This captures readiness evidence already validated and leaves deploy-machine execution fields for the operator to complete.

## 1. Release Metadata

- Release window: `________________`
- Operator: `________________`
- Environment: `preview / production / other: __________`
- Deployed SHA: `64d87e54`
- Rollback SHA (candidate): `________________`
- Runtime rehearsal baseline SHA (if reused): `089d22ed`

## 2. Scope / Evidence Reuse Check

- `docs-only diff check` vs runtime baseline performed: `YES`
- Result: `PASS`
- Diff command used:
  - `git diff --name-only 089d22ed..64d87e54`
- Notes:
  - Diff contained `docs/` files only.
  - Runtime rehearsal evidence from `089d22ed` is reusable for `64d87e54` (docs/process-only follow-up).

## 3. Gates (Exact SHA)

- `pnpm gate:auth-hardening`: `PASS` (runtime baseline `089d22ed`, reused via docs-only diff PASS)
- `node scripts/run-regression-gate.js`: `PASS` (runtime baseline `089d22ed`, reused via docs-only diff PASS)
- `node scripts/production-readiness-check.js`: `PASS` (runtime baseline `089d22ed`, reused via docs-only diff PASS)
- Manual terminology check (`node scripts/check-banned-terms.js`): `PASS`

## 4. Backup / Recovery Readiness

- Backup method: `________________`
- Backup file path or snapshot ID: `________________`
- Backup time: `________________`
- Restore drill record reference:
  - `docs/preview-deploy-restore-drill-record-2026-02-22-local-prod-089d22ed.md`

## 5. Database / Migrations

- `prisma migrate status` result: `PENDING OPERATOR EXECUTION`
- Migration folders applied: `________________`
- `prisma migrate deploy` result: `PENDING OPERATOR EXECUTION`
- Destructive migration present: `NO (expected; confirm during migration review)`
- If yes, rollback/restore note: `N/A (update if needed)`

## 6. Deploy Execution

- Compose preflight (`docker compose config` with `.env.production`): `PENDING OPERATOR EXECUTION`
- Infra start (`postgres`, `redis`): `PENDING OPERATOR EXECUTION`
- App deploy (`backend`, `frontend`, `nginx`): `PENDING OPERATOR EXECUTION`
- Container health check (`docker compose ps`): `PENDING OPERATOR EXECUTION`

## 7. Smoke / Manual Verification

- Backend health (`/health`): `PENDING OPERATOR EXECUTION`
- Public API health (`/api/health`): `PENDING OPERATOR EXECUTION`
- Login flow sanity: `PENDING OPERATOR EXECUTION`
- Trace endpoint sanity + rate limiting check: `PENDING OPERATOR EXECUTION`
- Backend log scan (no migration/runtime crash): `PENDING OPERATOR EXECUTION`

## 8. Residual Risks / Deviations

- Residual risks acknowledged this release:
  - backend docs toolchain `swagger-jsdoc -> glob -> minimatch` (accepted residual; see `docs/backlog/backend-dependency-remediation-priority.md`)
  - web app toolchain `@serwist/next -> glob -> minimatch` (accepted residual; see `docs/backlog/webapp-dependency-remediation-priority.md`)
- Deviations from runbook/checklist (if any):
  - `________________`
- Incident notes (if any):
  - `________________`

## 9. Outcome / Sign-off

- Release result: `PENDING OPERATOR EXECUTION`
- Rollback executed: `NO / YES`
- Reviewer / approver: `________________`
- Sign-off time: `________________`
