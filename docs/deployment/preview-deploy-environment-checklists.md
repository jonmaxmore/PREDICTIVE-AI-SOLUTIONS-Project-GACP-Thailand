# Preview Deploy Environment Checklists

- Status: Active
- Last Updated: 2026-02-22
- Use with:
  - `docs/preview-deploy-runbook.md`
  - `docs/preview-deploy-checklist.md`

## Environment Matrix

| Environment | Primary Purpose | Compose File | Public Entry | Backend Health (internal) |
|---|---|---|---|---|
| QA (preview) | Functional/UAT preview on isolated infra | `docker-compose.qa.yml` | `http://localhost:8080` | `http://localhost:5001/api/health` |
| Local Production-like | Pre-release rehearsal on local machine | `docker-compose.local-prod.yml` | `https://localhost` | `http://localhost:8000/health` (container) |
| Production | Live release | `docker-compose.production.yml` | `https://<domain>` | `http://localhost:8000/health` (container) |

## 1. QA (Preview / UAT) Checklist

Use this when validating feature behavior before production-style deployment.

### Start / Refresh

```bash
docker compose -f docker-compose.qa.yml config
docker compose -f docker-compose.qa.yml up -d
docker compose -f docker-compose.qa.yml ps
```

### Smoke Checks

```bash
curl http://localhost:8080/api/health
curl http://localhost:5001/api/health
curl http://localhost:3001
```

### Logs

```bash
docker compose -f docker-compose.qa.yml logs --tail=200 backend-qa
docker compose -f docker-compose.qa.yml logs --tail=200 frontend-qa
docker compose -f docker-compose.qa.yml logs --tail=200 nginx-qa
```

### Notes

- `docker-compose.qa.yml` contains QA-only credentials and ports. Do not reuse for production.
- QA backend/front-end run in dev-style containers (`npm install`, `npm run dev`); use this for behavior validation, not performance benchmarking.
- Run repo preview gates (`pnpm gate:auth-hardening`, regression gate) on the release SHA before promoting from QA.

## 2. Local Production-like Checklist

Use this for deployment rehearsal that matches production architecture more closely (Nginx + built app containers + TLS).

### Preflight

```bash
docker compose -f docker-compose.local-prod.yml config
```

### Optional: Generate Local Certificates

```bash
docker compose -f docker-compose.local-prod.yml --profile setup up cert-gen
```

### Start / Refresh

```bash
docker compose -f docker-compose.local-prod.yml up -d --build
docker compose -f docker-compose.local-prod.yml ps
```

Optional regression-gate rehearsal support (kept disabled by default):

```bash
# Enables /api/e2e/* routes and time-override behavior used by regression scripts in local-prod rehearsal only
set ENABLE_E2E_ROUTES=true
docker compose -f docker-compose.local-prod.yml up -d backend nginx
```

### Smoke Checks

```bash
docker compose -f docker-compose.local-prod.yml exec backend curl -fsS http://localhost:8000/health
curl -k https://localhost
curl -k https://localhost/api/health
```

### Logs

```bash
docker compose -f docker-compose.local-prod.yml logs --tail=200 backend
docker compose -f docker-compose.local-prod.yml logs --tail=200 frontend
docker compose -f docker-compose.local-prod.yml logs --tail=200 nginx
```

### Local-Prod Backend Build Alignment

- `docker-compose.local-prod.yml` should use monorepo root build context with `apps/backend/Dockerfile` (same pattern as production compose).
- If this file is edited in future, keep compose build context aligned with Dockerfile `COPY` paths (`package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `apps/backend/...`).
- When using an alternate clean checkout/worktree for release rehearsal, avoid running `docker compose up` from two different working directories against the same local-prod stack (fixed `container_name` values can cause recreate/name conflicts). Prefer a single checkout for compose operations, or use `docker exec` for migration/status checks.

## 3. Production Checklist (Live)

Do not use this section as a substitute for the full process.
Use the dedicated day-of-deploy checklist:

- `docs/preview-deploy-checklist.md`

Minimum sequence reminder:

1. Clean workspace on release SHA
2. Run required preview gates on exact SHA
3. Backup DB
4. Review/apply migrations
5. Deploy services with `docker-compose.production.yml`
6. Run smoke tests through Nginx and backend container
7. Record release metadata and rollback SHA

## 4. Promotion Rule (QA -> Production)

Promotion is allowed only when all are true:

- QA/preview validation completed
- preview gates passed on exact release SHA
- schema changes are paired with migrations in same commit
- release checklist fields are filled (backup ID, migration folders, rollback SHA)
- operator confirms no unrelated dirty files on release machine
