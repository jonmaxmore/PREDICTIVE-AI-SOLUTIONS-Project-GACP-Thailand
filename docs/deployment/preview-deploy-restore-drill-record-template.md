# Restore Drill Record Template (Preview / Release-Readiness)

- Status: Active
- Last Updated: 2026-02-22
- Use with:
  - `docs/preview-deploy-runbook.md`
  - `docs/preview-deploy-checklist.md`

## Purpose

Use this template to record a backup/restore drill performed before production deploy sign-off.
This is a rehearsal/audit artifact proving that recovery steps work in practice, not only on paper.

## 1. Drill Metadata

- Drill date/time: `________________`
- Operator: `________________`
- Environment: `local-prod / preview / staging / other: __________`
- Release SHA under validation: `________________`
- Source database/container: `________________`
- Temporary restore database name: `________________`

## 2. Backup Evidence

- Backup method:
  - `pg_dump` / snapshot / other: `________________`
- Backup file path or snapshot ID: `________________`
- Backup file size (if file-based): `________________`
- Backup command used (sanitized): `________________`

## 3. Restore Procedure

- Temp database created successfully: `YES / NO`
- Restore command completed successfully: `YES / NO`
- Restore start time: `________________`
- Restore end time: `________________`
- Total restore duration: `________________`

## 4. Verification Results (Restored DB)

- Public tables count: `________________`
- `_prisma_migrations` count: `________________`
- `users` row count: `________________`
- `applications` row count: `________________`
- Additional checks (optional): `________________`

## 5. Cleanup

- Temp database dropped: `YES / NO`
- Any cleanup warnings (expected/non-blocking): `________________`

## 6. Post-Drill System Health (Source Environment)

- `/health` check result: `PASS / FAIL`
- `/api/health` check result: `PASS / FAIL`
- Container health summary: `PASS / FAIL`

## 7. Outcome

- Drill result: `PASS / FAIL`
- Blocking issues found: `________________`
- Follow-up ticket / ADR / note: `________________`
- Measured RTO during drill: `________________`
- Measured RPO assumption validated: `________________`

## 8. Approval / Sign-off

- Reviewer / approver: `________________`
- Approved for release-readiness progression: `YES / NO`
