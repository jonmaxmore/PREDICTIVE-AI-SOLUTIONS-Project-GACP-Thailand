# Production Diagnostic Runbook (read-only)

> **Target host**: `root@203.0.113.10`
> **Project dir**: `/opt/gacp-platform`
> **Mode**: read-only diagnostics — every command in this file is safe to
> run on a live production server without changing state.

This runbook is what an AI agent or on-call engineer should run when
asked "is the system healthy and what is its current state?".

Hard rule: every command listed here:

- prints information only — never writes
- never restarts a container
- never touches the database write path
- never modifies a file
- never opens a port

Anything that mutates state lives in
`scripts/deploy/deploy-production.sh` or its sibling scripts and is NOT
included here.

If a command needs `sudo` to read protected logs, that is fine; the
intent must remain read-only.

---

## 0. Connectivity & host identity

```bash
ssh -o ConnectTimeout=10 -o BatchMode=yes -o StrictHostKeyChecking=no root@203.0.113.10 "whoami; hostname; uptime; uname -srv"
```

Confirm: this is the expected host (one of the production droplets), not
a staging or QA server. The hostname returned should match what
`docs/deployment/platform-urls.md` documents.

---

## 1. Repository state

```bash
ssh root@203.0.113.10 "cd /opt/gacp-platform && pwd && git rev-parse --abbrev-ref HEAD && git log --oneline -10 && echo '---' && git status --short"
```

Expected: branch is `deploy/production`, working tree is clean (no
unstaged edits), HEAD matches a tag in `ghcr.io/jonmaxmore/gacp-backend`.

---

## 2. Container health

```bash
ssh root@203.0.113.10 "cd /opt/gacp-platform && docker compose --env-file .env.production -f docker-compose.production.yml ps"
```

Expected: every service is `running` and `healthy` (where a healthcheck
is defined). Watch for `restarting` or `exited (137)` — the latter is
OOM-killed.

For more detail per service:

```bash
ssh root@203.0.113.10 "docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}'"
```

---

## 3. Recent application logs (no follow)

Backend (last 200 lines):

```bash
ssh root@203.0.113.10 "cd /opt/gacp-platform && docker compose --env-file .env.production -f docker-compose.production.yml logs --no-color --tail=200 backend"
```

Frontend (last 100 lines):

```bash
ssh root@203.0.113.10 "cd /opt/gacp-platform && docker compose --env-file .env.production -f docker-compose.production.yml logs --no-color --tail=100 frontend"
```

Nginx access log spike check:

```bash
ssh root@203.0.113.10 "tail -200 /opt/gacp-platform/logs/nginx/access.log"
```

Nginx error log:

```bash
ssh root@203.0.113.10 "tail -100 /opt/gacp-platform/logs/nginx/error.log"
```

---

## 4. Database state (read-only Postgres queries)

Connection check:

```bash
ssh root@203.0.113.10 "cd /opt/gacp-platform && docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres psql -U gacp -d gacp_db -c '\\conninfo'"
```

Migration ledger:

```bash
ssh root@203.0.113.10 "cd /opt/gacp-platform && docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend npx prisma migrate status"
```

Expected: every migration in `apps/backend/prisma/migrations/` is in the
`Applied` list, no pending or failed migrations.

Row counts (sanity-check tenant scoping is populating data):

```bash
ssh root@203.0.113.10 "cd /opt/gacp-platform && docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres psql -U gacp -d gacp_db -c \"SELECT COUNT(*) AS total, COUNT(\\\"organizationId\\\") AS scoped FROM applications;\""
```

```bash
ssh root@203.0.113.10 "cd /opt/gacp-platform && docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres psql -U gacp -d gacp_db -c \"SELECT COUNT(*) AS total, COUNT(\\\"organizationId\\\") AS scoped FROM users;\""
```

```bash
ssh root@203.0.113.10 "cd /opt/gacp-platform && docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres psql -U gacp -d gacp_db -c \"SELECT COUNT(*) AS total, COUNT(\\\"organizationId\\\") AS scoped FROM certificates;\""
```

For each: `total` should equal `scoped` after the Phase 1.3 backfill.
If `scoped < total` there are rows missing `organizationId` and PR D
(NOT NULL alteration) cannot land yet.

Slow / locked queries snapshot:

```bash
ssh root@203.0.113.10 "cd /opt/gacp-platform && docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres psql -U gacp -d gacp_db -c \"SELECT pid, age(clock_timestamp(), query_start) AS age, state, LEFT(query, 200) FROM pg_stat_activity WHERE state != 'idle' ORDER BY age DESC LIMIT 20;\""
```

Database size:

```bash
ssh root@203.0.113.10 "cd /opt/gacp-platform && docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres psql -U gacp -d gacp_db -c \"SELECT pg_size_pretty(pg_database_size('gacp_db'));\""
```

---

## 5. Redis state

```bash
ssh root@203.0.113.10 "cd /opt/gacp-platform && docker compose --env-file .env.production -f docker-compose.production.yml exec -T redis redis-cli INFO server | head -20"
```

```bash
ssh root@203.0.113.10 "cd /opt/gacp-platform && docker compose --env-file .env.production -f docker-compose.production.yml exec -T redis redis-cli INFO memory | head -10"
```

Queued background jobs (BullMQ / Bull):

```bash
ssh root@203.0.113.10 "cd /opt/gacp-platform && docker compose --env-file .env.production -f docker-compose.production.yml exec -T redis redis-cli KEYS 'bull:*' | head -20"
```

---

## 6. MinIO / object storage

```bash
ssh root@203.0.113.10 "cd /opt/gacp-platform && docker compose --env-file .env.production -f docker-compose.production.yml exec -T minio mc admin info local 2>/dev/null || docker compose --env-file .env.production -f docker-compose.production.yml ps minio"
```

Check the documents bucket exists and has objects:

```bash
ssh root@203.0.113.10 "cd /opt/gacp-platform && docker compose --env-file .env.production -f docker-compose.production.yml exec -T minio mc ls local/ 2>/dev/null"
```

---

## 7. Disk + memory + load

```bash
ssh root@203.0.113.10 "df -h /var/lib/docker /var/log /var/backups"
```

```bash
ssh root@203.0.113.10 "free -h"
```

```bash
ssh root@203.0.113.10 "top -bn1 | head -15"
```

```bash
ssh root@203.0.113.10 "ls -lhS /var/backups/gacp/ | head -10"
```

---

## 8. SSL / TLS

Cert expiry on the public domain:

```bash
ssh root@203.0.113.10 "echo | openssl s_client -servername 203.0.113.10 -connect 203.0.113.10:443 -showcerts 2>/dev/null | openssl x509 -noout -dates -subject -issuer"
```

If a real domain (e.g. `gacp.go.th`) is wired up, replace
`203.0.113.10` accordingly.

---

## 9. End-to-end smoke (HTTP read-only)

```bash
curl -sf -m 10 https://203.0.113.10/api/health -k | head -c 500
```

```bash
curl -sf -m 10 https://203.0.113.10/api/version -k | head -c 500
```

```bash
curl -sf -m 10 https://203.0.113.10/api/pricing -k | head -c 500
```

This probe used to hit `/api/subscription/plans`. M3 (operator 2026-08-23,
"ไม่มีค่าสมาชิก") deleted that endpoint along with the membership fee it
published, so it now 404s and would read as an outage. `/api/pricing` is the
equivalent public, DB-backed fee surface.

`-k` is acceptable here only because we are diagnosing a self-signed or
behind-the-cdn cert from the same host as the cert. From outside the
network use a real domain and drop `-k`.

---

## 10. Audit log integrity (in-DB)

```bash
ssh root@203.0.113.10 "cd /opt/gacp-platform && docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres psql -U gacp -d gacp_db -c \"SELECT MIN(\\\"sequenceNumber\\\"), MAX(\\\"sequenceNumber\\\"), COUNT(*) FROM audit_logs;\""
```

Expected: count == max - min + 1 (no gaps in the global sequence).

If the per-tenant audit chain follow-up has shipped, change the query
to group by `organizationId`.

---

## 11. Recent deploy log

```bash
ssh root@203.0.113.10 "ls -lht /var/log/gacp-deploys/ | head -5 && echo '---last deploy---' && tail -80 /var/log/gacp-deploys/$(ls -t /var/log/gacp-deploys/ | head -1)"
```

This tells you: when the last deploy was, what tag was pulled, whether
the smoke test passed, and (if it failed) what the rollback commands
were.

---

## What this runbook does NOT cover

- Mutating actions (deploy, migrate, restart, edit, restore-from-backup)
  — those live in `scripts/deploy/` and require explicit human sign-off.
- Live-tailing logs (`-f`) — use a dedicated session for that, not this
  runbook, because it blocks indefinitely.
- Cross-tenant data dumps — those should go through the platform-admin
  routes, not direct DB queries.
- Anything that requires creds beyond what is already on the host.
