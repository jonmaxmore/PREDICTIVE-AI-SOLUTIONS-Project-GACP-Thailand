# Preview / Production Release Record Template

- Status: Active
- Last Updated: 2026-02-22
- Use with:
  - `docs/preview-deploy-runbook.md`
  - `docs/preview-deploy-checklist.md`
  - `docs/preview-deploy-day-of-deploy-powershell-sequence.md`

## Purpose

Standardized release closeout record for deploy-day execution.
Use this in a ticket, handoff note, or deployment log to keep releases reversible and auditable.

## 1. Release Metadata

- Release window: `________________`
- Operator: `________________`
- Environment: `preview / production / other: __________`
- Deployed SHA: `________________`
- Rollback SHA (candidate): `________________`
- Runtime rehearsal baseline SHA (if reused): `________________`
- Availability SLO in scope: `________________`
- RTO target: `________________`
- RPO target: `________________`

## 2. Scope / Evidence Reuse Check

- `docs-only diff check` vs runtime baseline performed: `YES / NO / N/A`
- Result: `PASS / FAIL / N/A`
- Diff command used:
  - `git diff --name-only <runtime_baseline_sha>..<deployed_sha>`
- Notes (if `N/A` or exceptions approved): `________________`

## 3. Gates (Exact SHA)

- `pnpm gate:auth-hardening`: `PASS / FAIL`
- `node scripts/run-regression-gate.js`: `PASS / FAIL`
- `node scripts/ci/production-readiness-check.js`: `PASS / FAIL`
- `node scripts/ci/check-production-topology.js`: `PASS / FAIL`
- Manual terminology check (`node scripts/ci/check-banned-terms.js`): `PASS / FAIL / N/A`

## 4. Backup / Recovery Readiness

- Backup method: `pg_dump / snapshot / other: __________`
- Backup file path or snapshot ID: `________________`
- Backup time: `________________`
- Restore drill record reference: `________________` (or approved `N/A`)

## 5. Database / Migrations

- `prisma migrate status` result: `UP TO DATE / PENDING / FAIL`
- Migration folders applied: `________________`
- `prisma migrate deploy` result: `PASS / FAIL`
- Destructive migration present: `YES / NO`
- If yes, rollback/restore note: `________________`

## 6. Deploy Execution

- Compose preflight (`docker compose config`): `PASS / FAIL`
- Infra start (`postgres`, `redis`): `PASS / FAIL`
- App deploy (`backend`, `frontend`, `nginx`): `PASS / FAIL`
- Container health check (`docker compose ps`): `PASS / FAIL`

## 7. Smoke / Manual Verification

- Edge health (`/nginx-health`): `PASS / FAIL`
- Backend health (`/health`): `PASS / FAIL`
- Public API health (`/api/health`): `PASS / FAIL`
- Login flow sanity: `PASS / FAIL`
- Trace endpoint sanity + rate limiting check: `PASS / FAIL`
- Backend log scan (no migration/runtime crash): `PASS / FAIL`

## 8. Residual Risks / Deviations

- Residual risks acknowledged this release:
  - `________________`
- Deviations from runbook/checklist (if any):
  - `________________`
- Incident notes (if any):
  - `________________`

## 9. Outcome / Sign-off

- Release result: `SUCCESS / ABORTED / ROLLED BACK`
- Rollback executed: `YES / NO`
- Reviewer / approver: `________________`
- Sign-off time: `________________`
