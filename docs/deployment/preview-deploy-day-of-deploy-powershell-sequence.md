# Preview / Production Deploy Command Sequence (PowerShell)

- Status: Active
- Last Updated: 2026-02-22
- Use with:
  - `docs/preview-deploy-runbook.md`
  - `docs/preview-deploy-checklist.md`
  - `docs/preview-deploy-release-record-template.md`
  - `docs/release-readiness-closeout-2026-02-22.md`

## Purpose

Copy/paste-oriented PowerShell sequence for operators on the deploy machine.
This does not replace the checklist. It is an execution aid to reduce command mistakes.

## Current Release Reference (This Cycle)

- Runtime RC validated in rehearsal: `089d22ed`
- Use the latest approved release SHA from:
  - `docs/release-readiness-closeout-2026-02-22.md`
  - release ticket / handoff note (prefer `docs/preview-deploy-release-record-template.md`)
- If the approved SHA is newer than `089d22ed`, confirm it is docs/process-only before reusing runtime validation evidence.

## 0. Set Variables (Edit First)

```powershell
$ReleaseSha  = "<approved_release_sha_for_this_window>"
$RollbackSha = "<previous_good_sha>"
$Domain      = "YOUR_DOMAIN"
$EnvFile     = ".env.production"
$ComposeFile = "docker-compose.production.yml"
```

Example:

```powershell
$ReleaseSha = "<approved_release_sha_for_this_window>"
```

## 0.1 If Reusing Runtime Rehearsal Evidence (Docs-Only Diff Check)

Use this only when the approved release SHA is newer than the runtime baseline `089d22ed`
and you intend to reuse the same runtime gate/rehearsal evidence.

```powershell
$RuntimeBaselineSha = "089d22ed"
git diff --name-only "$RuntimeBaselineSha..$ReleaseSha"
```

Pass criteria:

- output contains only `docs/` files (and other explicitly approved non-runtime artifacts, if any)
- if runtime files appear, rerun runtime gates/rehearsal on `$ReleaseSha`

## 1. Clean Checkout + Scope Freeze

```powershell
git fetch origin
git checkout --detach $ReleaseSha
git status --short
git rev-parse HEAD
git log --oneline -5
```

Pass criteria:

- `git status --short` is empty
- `git rev-parse HEAD` matches `$ReleaseSha`

## 2. Required Gates (Exact SHA)

```powershell
pnpm install
pnpm gate:auth-hardening

$env:BASE_URL = "http://localhost:8080/api"
$env:PUBLIC_BASE_URL = "http://localhost:8080"
node scripts/run-regression-gate.js
Remove-Item Env:BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:PUBLIC_BASE_URL -ErrorAction SilentlyContinue

# If running readiness from host checkout, set DATABASE_URL first
$env:DATABASE_URL = "postgresql://USER:PASS@HOST:5432/DB?schema=public"
node scripts/ci/production-readiness-check.js
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue

# Manual terminology check if scope includes wording/branding-sensitive changes
node scripts/ci/check-banned-terms.js
```

## 3. Compose + Env Preflight

```powershell
docker compose --env-file $EnvFile -f $ComposeFile config
```

## 4. Backup (Required Before Migration)

```powershell
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = Join-Path $env:TEMP "gacp-prod-backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$backupFile = Join-Path $backupDir ("gacp_predeploy_" + $ts + ".sql")

docker compose --env-file $EnvFile -f $ComposeFile exec -T postgres `
  sh -lc 'pg_dump -U "$DB_USER" -d "$DB_NAME"' > $backupFile

Get-Item $backupFile | Select-Object FullName,Length
```

Record the backup file path / snapshot ID in:

- `docs/preview-deploy-checklist.md` section A/J
- release ticket / handoff note (prefer `docs/preview-deploy-release-record-template.md`)

## 5. Migration Review + Apply

```powershell
pnpm --dir apps/backend exec prisma migrate status --schema prisma/schema

docker compose --env-file $EnvFile -f $ComposeFile up -d postgres redis

docker compose --env-file $EnvFile -f $ComposeFile run --rm backend sh -lc `
  "cd /app/apps/backend && pnpm exec prisma migrate deploy --schema prisma/schema"
```

## 6. Start / Refresh App Services

```powershell
docker compose --env-file $EnvFile -f $ComposeFile up -d --build backend frontend nginx
docker compose --env-file $EnvFile -f $ComposeFile ps
```

## 7. Smoke Checks

```powershell
# Backend in container
docker compose --env-file $EnvFile -f $ComposeFile exec backend curl -fsS http://localhost:8000/health

# Public path through nginx/domain
curl.exe -s "https://$Domain/api/health"

# Log tail
docker compose --env-file $EnvFile -f $ComposeFile logs --tail=200 backend
docker compose --env-file $EnvFile -f $ComposeFile logs --tail=200 nginx
```

Manual checks (quick):

- login flow works
- auto-linking is still disabled unless explicitly approved
- trace endpoint responds (and rate limit sanity looks normal)

## 8. Rollback (If Needed)

```powershell
git checkout --detach $RollbackSha
docker compose --env-file $EnvFile -f $ComposeFile up -d --build backend frontend nginx
```

If database state is the issue after migration, restore from the backup/snapshot taken in Step 4.

## 9. Closeout Record (Required)

Record:

- use `docs/preview-deploy-release-record-template.md` (preferred)
- deployed SHA (`$ReleaseSha`)
- rollback SHA (`$RollbackSha`)
- backup file / snapshot ID
- restore drill record reference
- migration folders applied
- gate results
- smoke results
- incidents / deviations (if any)
