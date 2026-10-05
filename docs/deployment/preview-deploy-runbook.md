# Preview-First Deploy Runbook

- Status: Active
- Last Updated: 2026-02-22
- References:
  - `docs/adr/ADR-008-preview-gate-enforcement-before-deploy.md`
  - `docs/adr/ADR-009-executable-security-conventions.md`
  - `docs/adr/ADR-010-commit-scoped-quality-gates-for-schema-and-lint.md`
  - `docs/preview-deploy-environment-checklists.md`
  - `docs/preview-deploy-restore-drill-record-template.md`
  - `docs/preview-deploy-release-record-template.md`
  - `docs/preview-deploy-day-of-deploy-powershell-sequence.md`

## Purpose

This runbook defines the minimum preview process before any production deploy.
It is intentionally conservative:

- read/review code before running
- no deploy from dirty workspace
- no schema change without migration pair
- no scope creep during release window

## 0. Release Scope Freeze

Confirm the deploy is limited to approved commits only.

```bash
git status --short
git log --oneline -10
git rev-parse HEAD
```

Rules:

- `git status` must be clean on the release machine.
- If unrelated changes exist, stop and isolate them first.
- Record the exact commit SHA in the release record (prefer `docs/preview-deploy-release-record-template.md`) before continuing.

## 1. Local / Preview Gate (Required)

Run required gates on the exact commit being promoted:

```bash
pnpm gate:auth-hardening
node scripts/run-regression-gate.js
node scripts/ci/production-readiness-check.js
node scripts/ci/check-production-topology.js
```

Notes:

- `gate:auth-hardening` now includes:
  - Prisma schema/migration consistency check
  - no-new-eslint-warnings check (changed files in `HEAD`)
  - security conventions check
  - targeted auth hardening tests/lint
- If running `node scripts/ci/production-readiness-check.js` on a host checkout (not inside the backend container),
  export a valid `DATABASE_URL` first so backend tests can import the Docker-only Prisma service without failing fast.
- `node scripts/ci/check-production-topology.js` must pass before any production release. It blocks deploys that expose app containers directly or drift from the approved ingress chain.
- If any file under `apps/backend/prisma/schema/` changed, migration files under `apps/backend/prisma/migrations/` must also be in the same commit.
- If the release scope includes wording/branding-sensitive docs, comments, or UI copy, run the manual terminology check:
  - `node scripts/ci/check-banned-terms.js`

Optional strict drift check (CI or release box with shadow DB):

```bash
# Example only; set a real shadow DB URL
set SHADOW_DATABASE_URL=postgresql://USER:PASS@HOST:5432/DB
node scripts/ci/check-prisma-migration-consistency.js
```

## 2. Production Compose Preflight

Validate compose and required environment values before starting containers.

```bash
docker compose --env-file .env.production -f docker-compose.production.yml config
```

Check these values in `.env.production` (or deployment secret store):

- `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- `HEALTH_JWT_SECRET`
- `PROVIDER_JWT_SECRET`
- `NEXT_PUBLIC_API_URL`
- `PUBLIC_WEB_URL`
- `NEXT_PUBLIC_PWA_ENABLED=false` unless TLS/domain trust is confirmed
- proxy trust settings (`TRUST_PRIVATE_PROXY_RANGES`, `TRUSTED_PROXY_IPS`) match infrastructure

TLS/HTTPS readiness before go-live:

- Do not go-live on raw IP only. Use a real domain and DNS A/AAAA records.
- Install a trusted certificate (`nginx/ssl/gacp.crt`, `nginx/ssl/gacp.key`).
- Verify certificate chain and hostname from browser and CLI:
  - `openssl s_client -connect YOUR_DOMAIN:443 -servername YOUR_DOMAIN`
  - `curl -Iv https://YOUR_DOMAIN/api/health`
- Keep `NEXT_PUBLIC_PWA_ENABLED=false` until certificate and hostname trust checks pass.

## 3. Database Backup (Required Before Migration)

Take a DB backup/snapshot before applying migrations.

Examples (choose one approved method):

```bash
docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres \
  pg_dump -U ${DB_USER} -d ${DB_NAME} > backup_predeploy.sql
```

or platform snapshot (managed PostgreSQL / volume snapshot).

Record backup identifier in the release record (prefer `docs/preview-deploy-release-record-template.md`).

For release-readiness rehearsal (before production sign-off), also perform and record a restore drill
using a temporary database or isolated environment:

- use `docs/preview-deploy-restore-drill-record-template.md`
- verify restore + basic data counts + cleanup
- confirm source environment health after the drill

## 4. Migration Plan Check (Required)

Review pending migrations before applying:

```bash
pnpm --dir apps/backend exec prisma migrate status --schema prisma/schema
```

If migrations are pending, review the SQL file(s) in `apps/backend/prisma/migrations/`:

- confirm expected tables/columns/indexes only
- check for destructive ops (`DROP TABLE`, `DROP COLUMN`, data rewrite)
- verify rollback plan if destructive ops exist

## 5. Deploy Sequence (Preview/Production)

Recommended order to reduce startup race conditions:

1. Start infra (`postgres`, `redis`)
2. Apply DB migrations
3. Start app services (`backend`, `frontend`)
4. Start/refresh `nginx`

Example:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d postgres redis

docker compose --env-file .env.production -f docker-compose.production.yml run --rm backend sh -lc \
  "cd /app/apps/backend && pnpm exec prisma migrate deploy --schema prisma/schema"

docker compose --env-file .env.production -f docker-compose.production.yml up -d --build backend frontend nginx
```

## 6. Post-Deploy Verification (Required)

Container health:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200 backend
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200 frontend
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200 nginx
```

Smoke checks:

```bash
# Backend direct (inside network / host mapping as available)
curl http://localhost:8000/health

# Public route through nginx (adjust domain)
curl https://YOUR_DOMAIN/api/health
```

Security sanity checks:

- Public trace API rate limiting is active.
- Client IP extraction behavior still uses hardened path (no reintroduction of direct `req.ip` in runtime code).

## 7. Rollback

Application rollback (same DB schema) can be done by redeploying a previous commit/image:

```bash
git checkout <previous_commit_sha>
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build backend frontend nginx
```

Important:

- If the failed release applied destructive migrations, app rollback alone is not enough.
- Restore database from the backup/snapshot taken in Step 3.
- Attach (or reference) the latest restore drill record during release sign-off.
- For additive-only migrations, app rollback is often possible, but still validate compatibility before proceeding.

## 8. Release Record (Required)

Write a short release record (ticket/comment/handoff note) with:

- prefer `docs/preview-deploy-release-record-template.md`

- commit SHA deployed
- migration folder(s) applied
- backup ID/snapshot ID
- restore drill record reference (or explicit `N/A` with approval)
- gate results (`auth-hardening`, regression, readiness)
- smoke test results
- rollback commit SHA (candidate)

This keeps deploy history reversible and auditable.
