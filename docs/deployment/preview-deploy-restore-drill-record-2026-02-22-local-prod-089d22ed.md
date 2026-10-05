# Restore Drill Record - 2026-02-22 (local-prod / SHA `089d22ed`)

- Status: Completed (PASS)
- Template used: `docs/preview-deploy-restore-drill-record-template.md`
- Phase: `Stabilization / Release-Readiness`

## 1. Drill Metadata

- Drill date/time: `2026-02-22` (local rehearsal)
- Operator: `QA Team`
- Environment: `local-prod`
- Release SHA under validation: `089d22ed`
- Source database/container: `gacp-postgres-local` (`gacp_db`)
- Temporary restore database name: `gacp_restore_drill_20260222_162725`

## 2. Backup Evidence

- Backup method: `pg_dump` via local postgres container
- Backup file path:
  - `C:\Users\usEr\AppData\Local\Temp\gacp-preview-backups\gacp_local_restore_drill_20260222_162725.sql`
- Backup file size: `2,110,978` bytes

## 3. Restore Procedure

- Temp database created successfully: `YES`
- Restore command completed successfully: `YES`
- Cleanup of temp database completed: `YES`

## 4. Verification Results (Restored DB)

- Public tables count: `51`
- `_prisma_migrations` count: `17`
- `applications` row count: `51`
- `users` row count: `15`

## 5. Cleanup Notes

- Initial cleanup-safe command emitted expected notice:
  - `database "...\" does not exist, skipping`
- This occurred during pre-create `DROP DATABASE IF EXISTS` and is non-blocking.

## 6. Post-Drill System Health (Source Environment)

- `http://localhost:8080/health`: `PASS` (`OK`)
- `http://localhost:8080/api/health`: `PASS` (success JSON)
- `docker compose -f docker-compose.local-prod.yml ps`: all services `healthy` / running

## 7. Outcome

- Drill result: `PASS`
- Blocking issues found: `None`
- Release-readiness impact:
  - Confirms backup + restore + verification + cleanup flow is executable in rehearsal, not just documented
