# Preview Deploy Execution Checklist (Day-of-Deploy)

- Status: Active
- Last Updated: 2026-02-22
- Use with: `docs/preview-deploy-runbook.md`
- Environment variants: `docs/preview-deploy-environment-checklists.md`
- PowerShell command aid: `docs/preview-deploy-day-of-deploy-powershell-sequence.md`
- Release record template: `docs/preview-deploy-release-record-template.md`

## A. Fill Release Metadata (Before Running Anything)

- Release SHA: `________________`
- Previous rollback SHA: `________________`
- Operator: `________________`
- Time window: `________________`
- Backup ID / Snapshot ID: `________________`
- Restore drill record reference: `________________`
- Migration folders expected: `________________`

## B. Workspace Must Be Clean

```bash
git checkout <release_sha>
git status --short
git rev-parse HEAD
```

Pass criteria:

- `git status --short` is empty
- `git rev-parse HEAD` matches release SHA

## C. Required Preview Gates (Run on Exact SHA)

```bash
pnpm gate:auth-hardening
node scripts/run-regression-gate.js
node scripts/ci/production-readiness-check.js
```

If readiness is run from a host checkout (not inside backend container), set `DATABASE_URL` first:

```bash
# Example only; use the correct DB URL for the target environment
set DATABASE_URL=postgresql://USER:PASS@HOST:5432/DB?schema=public
```

Record results:

- `auth-hardening`: PASS / FAIL
- `regression-gate`: PASS / FAIL
- `readiness-check`: PASS / FAIL
- `manual terminology check` (if scope includes wording/branding-sensitive changes): PASS / N/A / FAIL
- `docs-only diff check` vs runtime baseline `089d22ed` (only if reusing rehearsal evidence on newer docs/process SHA): PASS / N/A / FAIL

## D. Compose + Env Preflight

```bash
docker compose --env-file .env.production -f docker-compose.production.yml config
```

Confirm these values are set in deployment environment / `.env.production`:

- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `HEALTH_JWT_SECRET`
- `PROVIDER_JWT_SECRET`
- `NEXT_PUBLIC_API_URL`
- `PUBLIC_WEB_URL`


## E. Database Backup (Required)

```bash
docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres \
  pg_dump -U ${DB_USER} -d ${DB_NAME} > backup_predeploy.sql
```

If using managed DB snapshot instead, record snapshot ID in section A.

Release-readiness sign-off requirement (before production):

- latest restore drill record exists (or approved `N/A`) using `docs/preview-deploy-restore-drill-record-template.md`

## F. Migration Review + Apply

Status check:

```bash
pnpm --dir apps/backend exec prisma migrate status --schema prisma/schema
```

Apply migrations:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d postgres redis

docker compose --env-file .env.production -f docker-compose.production.yml run --rm backend sh -lc \
  "cd /app/apps/backend && pnpm exec prisma migrate deploy --schema prisma/schema"
```

## G. Start App Services

```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build backend frontend nginx
docker compose --env-file .env.production -f docker-compose.production.yml ps
```

Pass criteria:

- `backend` healthy
- `frontend` running
- `nginx` healthy
- `postgres` healthy
- `redis` running

## H. Smoke Tests (Required)

Backend health:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml exec backend curl -fsS http://localhost:8000/health
```

Public path through nginx (replace domain):

```bash
curl https://YOUR_DOMAIN/api/health
```

Quick log scan:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200 backend
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200 nginx
```

Manual verification checklist:

- login flow works (provider or health portal)
- trace endpoint responds and is rate-limited (basic sanity)
- no migration/runtime errors in backend logs

## I. Rollback (If Needed)

```bash
git checkout <rollback_sha>
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build backend frontend nginx
```

If the issue is database-related after migration, restore DB from backup/snapshot.

## J. Release Record (Closeout)

Capture and store:

- prefer `docs/preview-deploy-release-record-template.md`
- deployed SHA
- rollback SHA
- backup ID / snapshot ID
- restore drill record reference (or approved `N/A`)
- migrations applied
- gate results
- smoke test results
- incident notes (if any)
