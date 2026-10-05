# Server Hygiene + Ops Audit — GACP Platform

- **Reviewer:** Plan agent (read-only research, repo-only)
- **Date:** 2026-04-28
- **Mode:** Inferred from repository — no SSH access to `root@203.0.113.20`
- **Scope:** docker-compose.production.yml, deploy/backup/maintenance scripts, monitoring stack, runbooks

## Executive Summary

The GACP platform's operational story has a strong **shell** — image-based deploy, Prometheus + Grafana + Loki + Promtail in compose, Alertmanager rule files, scripted certbot fix, scripted PAT rotation, a clean diagnostic runbook — but a fragile **filling**. Three backup scripts target three different directories, with at least one DB-name mismatch that would silently produce empty backups. Docker's default JSON-file driver has no `max-size` cap on any container, so log churn will gradually fill disk on a 4 GB droplet. Alertmanager routing references Slack/PagerDuty env vars that aren't templated in `.env.production.example` and Alertmanager itself isn't in `docker-compose.production.yml` — the alerts fire into nothing.

**Top 3 strengths:**
1. **Image-based deploy** (Level 4) is real and immutable — `image:` not `build:`, with `:sha-<sha>` tags for tagged rollback.
2. **Resource limits** are present on every service in production compose, with audit-driven adjustments (pgAdmin bumped from 128→256 MB after live OOM near-miss).
3. **Read-only diagnostic runbook** at `docs/deployment/production-diagnostic-runbook.md` is high-quality and SSH-paste-runnable.

**Top 5 gaps:**
1. Three backup destinations, no committed cron, one DB-name mismatch — automation status unknowable from repo.
2. No `logging:` driver caps anywhere → JSON-file logs grow unbounded.
3. Alertmanager is configured-but-not-deployed; alerts have no path to a human.
4. No documented secret-rotation procedure beyond the GHCR PAT one-off.
5. No DR runbook — no documented RTO/RPO, no committed full-server-rebuild script, no recorded restore drill.

**Single biggest "this is going to bite us" risk:** **Container log files growing to fill `/var/lib/docker/`**. A 4 GB droplet with default JSON-file driver, no rotation, Promtail tailing every container's logs, and `gacp-cadvisor` + `gacp-node-exporter` chattering at high frequency — first symptom will be `pg_dump` failing on disk-full at 02:00 some Tuesday, then silent loss of audit log entries because Postgres can't fsync.

## 1. Production Docker Compose

| Item | Status | Notes |
|------|--------|-------|
| Image-based deploy | ✅ | `image: ghcr.io/.../gacp-{backend,frontend}:${IMAGE_TAG}` no `build:` blocks |
| Restart policies | ✅ | `restart: always` on every service |
| Healthchecks | ⚠️ Partial | `nginx`, `backend`, `minio`, `postgres`, `loki` have. `frontend`, `redis`, `pgadmin`, `prometheus`, `grafana`, `cadvisor`, `node-exporter`, `promtail` do NOT |
| Container names | ✅ | All `gacp-*` consistent |
| Resource limits | ✅ | Memory + CPU caps on every service |
| Bind mounts | ⚠️ | `cadvisor` mounts `/:/rootfs:ro`; broad but standard |
| **Logging driver** | ❌ | **No `logging:` block on ANY service** — default JSON-file = unbounded growth |
| Public ports | ✅ | All bound to `127.0.0.1` |
| Network isolation | ✅ | Single `gacp-network` bridge |

**Concrete fix:** Add a top-level `x-logging` anchor and apply to every service:

```yaml
x-logging: &default-logging
  driver: json-file
  options:
    max-size: "20m"
    max-file: "5"
    compress: "true"

services:
  nginx:
    logging: *default-logging
  # ...repeat for every service
```

This single change closes the largest disk-fill risk on the server.

## 2. Environment files

- `.env.production` correctly gitignored.
- Server location: `/opt/gacp-platform/.env.production`.
- **Required-vars checklist is canonical** — `scripts/deploy/deploy-production.sh:46-54` enforces it (exit 1 on missing). ✅

**Required vars:** `DATABASE_URL`, `REDIS_URL`, `HEALTH_JWT_SECRET`, `PROVIDER_JWT_SECRET`, `ENCRYPTION_KEY`, `QR_SIGNATURE_FALLBACK_SECRET`, `PAYMENT_WEBHOOK_SECRET`

**Gaps:**
- **Not enforced**: 32-char minimum length is documented but the deploy script only checks presence. A 1-char value passes.
- **Secret rotation**: only `scripts/maintenance/fix-ghcr-pat.sh` exists. No equivalent for JWT secrets, ENCRYPTION_KEY, etc.
- File permissions: no documented expectation that `.env.production` should be `chmod 600`. Default Ubuntu umask creates `0644` — readable by anyone with shell access.

**Concrete fixes:**
- Add length check to deploy script: `if [ "$(... | wc -c)" -lt 32 ]; then ...` for secret-class vars.
- Document `chmod 600 /opt/gacp-platform/.env.production` + add to deploy script's pre-flight.
- Create `scripts/maintenance/rotate-secret.sh`.

## 3. Backup retention

**This is the messiest area in the audit. Three backup mechanisms, three destinations.**

| Script | DB name | Backup dir | Retention | Cron? |
|--------|---------|-----------|-----------|-------|
| `scripts/backup/backup-system.sh` | `gacp_db` | `/opt/backups/gacp` | `${BACKUP_RETENTION_DAYS:-30}` days | ❌ Not in repo |
| `scripts/backup/pg-backup.sh` | **`gacp_production`** ⚠️ wrong | `/opt/gacp-platform/backups` | daily 7d / weekly 28d / monthly 180d | Crontab line in comment only |
| `scripts/deploy/deploy-production.sh` (pre-deploy) | `${DB_NAME:-gacp_db}` | `/var/backups/gacp` | None — files accumulate forever | Triggered on every deploy |

**Observations:**
- `pg-backup.sh` default DB name is `gacp_production` but everything else uses `gacp_db`. If this script ran with that default, every backup would error or silently produce empty files.
- `backup-system.sh` references stale paths (`apps/backend/.env.production`, `apps/backend/public/uploads`).
- `deploy-production.sh` pre-deploy backups have **no cleanup policy** — files accumulate forever.

**Concrete fixes:**
1. **Pick one canonical script** (recommend `pg-backup.sh` after fixing DB-name + path defaults). Delete `backup-system.sh`.
2. **Commit the crontab** as `scripts/backup/install-cron.sh` writing to `/etc/cron.d/gacp-backup`.
3. **Add retention to deploy pre-backups** — prune files older than 14 days.
4. **Add offsite copy** via rclone to a DigitalOcean Space.

## 4. Log rotation + log storage

| Source | Destination | Rotation? |
|--------|-------------|-----------|
| Container stdout/stderr | `/var/lib/docker/containers/<id>/<id>-json.log` | ❌ Unbounded |
| Nginx (Docker-internal) | `./logs/nginx/access.log`, `./logs/nginx/error.log` | ❌ No logrotate config in repo |
| Deploy logs | `/var/log/gacp-deploys/<ts>.log` | ❌ No rotation |
| Backup logs | `/var/log/gacp-backup.log` | ❌ No rotation |
| Promtail → Loki | `loki_data` named volume | ✅ Loki has built-in retention, but not configured |

**Loki retention** not configured in production compose (uses image default, retains forever).

**AuditLog `retainUntil`**: field exists in schema but no cron path enforces it.

**Concrete fixes:**
1. The `x-logging` Docker fix from §1 covers container logs.
2. Add `/etc/logrotate.d/gacp-platform`:
   ```
   /opt/gacp-platform/logs/nginx/*.log /var/log/gacp-deploys/*.log {
       daily
       rotate 14
       compress
       missingok
       notifempty
       copytruncate
   }
   ```
3. Configure Loki retention in `monitoring/loki/local-config.yaml`.
4. Wire AuditLog `retainUntil` purge into a worker job.

## 5. Image registry hygiene

After 6 months at ~daily push frequency, GHCR will hold ~180 `sha-*` tags per image (~360 total). GHCR default: **no auto-cleanup**.

**Gaps:**
- No `permissions: packages: delete` workflow that prunes old `sha-*` tags.
- Server-side: `docker image prune -a` not documented.

**Concrete fixes:**
1. Add `.github/workflows/cleanup-ghcr.yml` (weekly, keep last 30 `sha-*` + all `v*` tags).
2. Add weekly `cron.weekly/docker-prune` on server: `docker image prune -af --filter 'until=336h'`.

## 6. Monitoring + observability

**What's wired:** Prometheus scrapes backend health, nginx, node-exporter, cadvisor, prometheus self. Grafana dashboard provisioned. Loki + Promtail tail Docker logs + syslog/auth.log.

**What's NOT wired:**
- **Alertmanager is in `monitoring/alertmanager/alertmanager.yml` and `monitoring/docker-compose.monitoring.yml` but NOT in `docker-compose.production.yml`** — alertmanager doesn't run in production.
- Alert rules reference `pg_up`, `redis_up` — neither `postgres-exporter` nor `redis-exporter` is in production compose.
- `alertmanager.yml` references `${SMTP_HOST}`, `${SLACK_WEBHOOK_URL}`, `${PAGERDUTY_SERVICE_KEY}` — none in `.env.production.example`.

**Concrete fixes:**
1. Either deploy alertmanager + postgres-exporter + redis-exporter in production compose, or delete `alerts.yml` so it's not aspirational.
2. Add `prometheus/alerts.yml` to mount + `--config.file rule_files`.
3. Add `SLACK_WEBHOOK_URL` to `.env.production.example`.
4. Reduce alert rules to metrics actually emitted.

## 7. SSL + cert auto-renewal

**Status:** ✅ The certbot fix script is well-engineered — switches from standalone to webroot, installs deploy-hook, runs `--dry-run` to verify, idempotent.

**Concerns:**
- ~~Cert is for `152-42-218-251.sslip.io`~~ → resolved 2026-04-29: production traffic flows through **Cloudflare** in front of `gacpth.com`; the sslip.io hostname is only the SAN on the origin droplet's cert, never exposed to end users. Cloudflare's anycast also closes the "DNS failover" gap noted below.
- The Docker-internal nginx mounts `./nginx/ssl:/etc/nginx/ssl:ro` but the Docker nginx config doesn't `listen 443 ssl` anywhere — so SSL files inside container are unused. Dead mount.

**Concrete fix:** ~~Document DNS migration plan~~ → no action needed. Cloudflare handles edge SSL + DDoS + caching; origin droplet only serves the Cloudflare-tunneled traffic. Keep certbot for the origin SAN as defence-in-depth in case Cloudflare ever fails open.

## 8. Operational runbooks

| Runbook | Path | Status |
|---------|------|--------|
| Branch protection | `docs/operations/branch-protection-setup.md` | ✅ |
| Deploy runbook | `docs/operations/deploy-runbook.md` | ✅ |
| Production diagnostic | `docs/deployment/production-diagnostic-runbook.md` | ✅ excellent |
| Staging activation | `docs/operations/staging-activation.md` | ✅ |
| Level 4 activation | `docs/operations/level-4-activation.md` | ✅ |
| Level 5 blue/green | `docs/operations/level-5-bluegreen-activation.md` | ✅ |
| **Secret rotation** | — | ❌ missing |
| **Restore-from-backup** | partial | ⚠️ |
| **Add tenant** | — | ❌ missing |
| **Scale up** | — | ❌ missing |
| **Debug 502** | — | ❌ missing |
| **Debug payment timeout** | — | ❌ missing |
| **Full server rebuild** | — | ❌ missing |
| **DNS failover** | — | ❌ missing |

**Concrete fix:** Create `docs/operations/runbooks/` with one `.md` per common task, all linked from a `docs/operations/runbooks/README.md` index.

## 9. Disk usage management

**Single biggest disk-fill risk:** container logs (covered in §1).

| Source of growth | Bounded? |
|------------------|----------|
| `/var/backups/gacp/gacp-pre-deploy-*.sql.gz` | ❌ |
| `/opt/gacp-platform/backups/{daily,weekly,monthly}/` | ✅ if cron runs |
| `/opt/backups/gacp/` | ⚠️ |
| `/var/lib/docker/containers/*/*-json.log` | ❌ |
| `/opt/gacp-platform/logs/nginx/*.log` | ❌ |
| `/var/log/gacp-deploys/*.log` | ❌ |
| Postgres WAL | ✅ self-managed |
| Loki data volume | ⚠️ default retention |
| Prometheus data volume | ✅ 30d retention |
| Docker image cache | ❌ |

## 10. Security hygiene

| Control | Status |
|---------|--------|
| DigitalOcean Cloud Firewall (80/443/2222) | ✅ documented |
| SSH on port 2222, operator IP only | ✅ documented |
| Fail2Ban config | ⚠️ `scripts/security/fail2ban-jail.local` exists but no installer |
| ufw / iptables persistence | ❌ Not in repo |
| Root login | ⚠️ `root@203.0.113.20` is the deploy user |
| Security headers (HSTS, CSP, X-Frame-Options) | ✅ Both layers |
| ModSecurity WAF | ❌ Not in either nginx config |
| `.env.production` file mode | ❌ Not enforced |
| TLS 1.2+ only | ✅ `ssl_protocols TLSv1.2 TLSv1.3` |
| Rate limiting | ✅ |
| pgAdmin IP allowlist | ✅ |

**Concrete fixes:**
- `scripts/security/install-fail2ban.sh` that copies jail.local + restarts service.
- `scripts/security/install-ufw.sh` mirroring cloud firewall (defense-in-depth).
- Audit step in operator checklist verifies fail2ban actually running.

## 11. Disaster recovery

**Documented:** nothing concrete.

**Inferable from repo:**
- Backups exist but restore is documented only as one-liner in deploy-runbook.md Rollback section.
- `docs/deployment/preview-deploy-restore-drill-record-template.md` exists — implies drill cadence intended but only one record (local).
- No documented RTO/RPO.
- No "rebuild server from scratch" runbook.
- DNS on sslip.io (single point of failure).

**Concrete fixes:**
1. Document RTO/RPO targets. For single-droplet system: RTO ~4 hours, RPO ~24 hours.
2. Create `docs/operations/runbooks/disaster-recovery.md` with full droplet rebuild + restore + DNS update + smoke test.
3. Schedule quarterly restore drill on temporary droplet.
4. Migrate DNS from sslip.io → gacpth.com → Cloudflare/Route53 for failover.

## 12. Operator Audit Checklist

**Copy-paste-runnable on `root@203.0.113.20`. Each block prints diagnostics; nothing mutates state.**

```bash
# ============================================================
# GACP SERVER HYGIENE AUDIT — 2026-04-28
# ============================================================

# ── A. HOST + IDENTITY ──────────────────────────────────────
hostname; uptime; uname -srv
# Expected: production hostname; uptime > 0; recent kernel.

df -h /var /opt /var/lib/docker /var/log /var/backups
# Expected: every mount > 30% free.
# Bad: /var/lib/docker > 80% full → log explosion likely.

free -h
# Expected: available > 500 MB on a 4 GB droplet.

top -bn1 | head -5

# ── B. CONTAINER STATE ──────────────────────────────────────
cd /opt/gacp-platform && docker compose --env-file .env.production -f docker-compose.production.yml ps
# Expected: every service "running", services with healthchecks "healthy".

docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}'
# Bad: any container > 90% mem → tune limits or fix leak.

# ★ MOST ACTIONABLE — container log file sizes (UNBOUNDED RISK)
du -sh /var/lib/docker/containers/*/ | sort -h | tail -10
# Bad: any > 1 GB → this is the disk-fill bomb. Truncate with:
#   truncate -s 0 /var/lib/docker/containers/<id>/<id>-json.log
# Then add x-logging caps to docker-compose.production.yml.

du -sh /var/lib/docker/* 2>/dev/null | sort -h

# ── C. IMAGE REGISTRY HYGIENE ───────────────────────────────
docker images | wc -l
# Bad: > 100 → docker prune needed.

docker images -f "dangling=true" | wc -l
# Bad: > 10 → run: docker image prune -f

docker images --format 'table {{.Repository}}:{{.Tag}}\t{{.CreatedSince}}\t{{.Size}}' | head -20

# ── D. BACKUPS ──────────────────────────────────────────────
ls -lht /var/backups/gacp/ | head -10
# Expected: most recent file dated within last week.

ls -lhR /opt/gacp-platform/backups/ 2>/dev/null | head -30
# Expected: daily/, weekly/, monthly/ subdirs with recent .sql.gz.

ls -lh /opt/backups/gacp/ 2>/dev/null | head -10

LATEST=$(ls -t /var/backups/gacp/*.sql.gz 2>/dev/null | head -1)
[ -n "$LATEST" ] && gunzip -t "$LATEST" && echo "OK: $LATEST" || echo "BAD"

crontab -l 2>/dev/null; ls /etc/cron.d/ /etc/cron.daily/ /etc/cron.weekly/ 2>/dev/null
# Expected: a gacp-backup or pg-backup entry running at 02:00 daily.

# ── E. LOGS ──────────────────────────────────────────────────
ls -lh /opt/gacp-platform/logs/nginx/
# Bad: > 500 MB → no rotation.

ls -lht /var/log/gacp-deploys/ | head -5; du -sh /var/log/gacp-deploys/

du -sh /var/log/syslog* /var/log/auth.log* 2>/dev/null

docker info 2>/dev/null | grep -E 'Logging Driver|Cgroup'
# Plan: switch to json-file with max-size:20m,max-file:5.

# ── F. SSL / CERT ───────────────────────────────────────────
echo | openssl s_client -servername 152-42-218-251.sslip.io -connect localhost:443 2>/dev/null | openssl x509 -noout -dates
# Expected: notAfter in the future.

certbot renew --dry-run 2>&1 | tail -5
# Expected: "all simulated renewals succeeded".

systemctl list-timers | grep -i certbot
# Expected: certbot.timer ACTIVE.

ls -la /opt/gacp-platform/nginx/ssl/gacp.{crt,key}
# Expected: symlinks → /etc/letsencrypt/live/...

# ── G. SECURITY POSTURE ─────────────────────────────────────
ss -tlnp | grep -v 127.0.0.1 | grep -v '::1'
# Expected: only :80, :443, :2222.

ufw status verbose 2>/dev/null || echo "UFW not installed"

fail2ban-client status 2>/dev/null | head -10 || echo "Fail2Ban not installed"

grep -E '^(PermitRootLogin|PasswordAuthentication|Port)' /etc/ssh/sshd_config
# Expected: Port 2222, prohibit-password, PasswordAuthentication no.

ls -l /opt/gacp-platform/.env.production
# Expected: -rw------- (mode 600).

who; last -n 5

# ── H. APPLICATION HEALTH ───────────────────────────────────
curl -sf -m 5 -k https://localhost/api/health && echo OK || echo FAILED

docker compose --env-file .env.production -f docker-compose.production.yml exec -T postgres psql -U gacp -d gacp_db -c "SELECT pg_size_pretty(pg_database_size('gacp_db'));"

docker compose --env-file .env.production -f docker-compose.production.yml exec -T backend npx prisma migrate status | tail -10
# Expected: all migrations applied, no pending.

docker compose --env-file .env.production -f docker-compose.production.yml exec -T redis redis-cli -a "${REDIS_PASSWORD}" INFO memory | grep used_memory_human

docker compose --env-file .env.production -f docker-compose.production.yml exec -T minio mc du local/ 2>/dev/null

# ── I. MONITORING STACK ─────────────────────────────────────
curl -s http://localhost:9090/api/v1/targets | grep -oE '"health":"(up|down)"' | sort | uniq -c

curl -sf http://localhost:3200/api/health && echo OK || echo FAILED

curl -sf http://localhost:3100/ready && echo OK || echo FAILED

docker ps --filter name=alertmanager
# Expected: empty (alertmanager not in production compose).

# ── J. DEPLOY HISTORY ───────────────────────────────────────
LATEST_DEPLOY=$(ls -t /var/log/gacp-deploys/ 2>/dev/null | head -1)
echo "Latest: $LATEST_DEPLOY"
tail -30 "/var/log/gacp-deploys/$LATEST_DEPLOY"

cd /opt/gacp-platform && git status -s && git log --oneline -5
# Expected: clean working tree, on deploy/production branch.

docker inspect gacp-backend --format '{{.Config.Image}} ({{.Image}})'
docker inspect gacp-frontend --format '{{.Config.Image}} ({{.Image}})'
```

**Total commands**: ~35. Run order: A → B → C → D → E → F → G → H → I → J. Stop and triage at first BAD finding.

## Prioritized Roadmap

### Phase A — Operator runs on the server THIS WEEK (no repo changes needed)

1. Run §12 audit checklist, fix anything RED.
2. **Truncate any container log file > 1 GB**: `find /var/lib/docker/containers/ -name '*-json.log' -size +1G -exec truncate -s 0 {} \;`
3. **Add Docker daemon log caps** at `/etc/docker/daemon.json`:
   ```json
   {"log-driver": "json-file", "log-opts": {"max-size": "20m", "max-file": "5", "compress": "true"}}
   ```
   `systemctl restart docker` (will recreate containers).
4. `chmod 600 /opt/gacp-platform/.env.production`
5. Install logrotate config from §4.
6. Install fail2ban: `apt install fail2ban && cp jail.local /etc/fail2ban/jail.local && systemctl restart fail2ban`
7. Verify backup cron: `cat /etc/cron.d/gacp-backup` — if missing, install per §3.

### Phase B — Configuration improvements committed to repo

1. **PR-1**: Add `x-logging` block to `docker-compose.production.yml`. ~80 LOC.
2. **PR-2**: Fix `pg-backup.sh` DB-name; add `install-cron.sh`; delete `backup-system.sh`. ~50 LOC.
3. **PR-3**: Add `scripts/maintenance/rotate-secret.sh` + runbook. ~150 LOC.
4. **PR-4**: 32-char min-length + file-perm check in `deploy-production.sh`. ~25 LOC.
5. **PR-5**: Either deploy alertmanager + exporters OR delete aspirational config.
6. **PR-6**: `.github/workflows/cleanup-ghcr.yml`. ~40 LOC.
7. **PR-7**: Logrotate file + installer. ~30 LOC.

### Phase C — Disaster prep + capacity planning

1. **PR-8**: RTO/RPO doc + `runbooks/disaster-recovery.md`.
2. **PR-9**: Migrate DNS sslip.io → gacpth.com.
3. **PR-10**: Quarterly restore-drill cron + record template.
4. **PR-11**: Offsite backup to DigitalOcean Space via rclone.
5. **PR-12**: Common-task runbook index + missing runbooks (debug-502, debug-payment-timeout, add-tenant, scale-up).

## Explicit non-recommendations

- **NOT recommending Kubernetes / k3s / Nomad migration.** Single-droplet Docker Compose is appropriate for this scale.
- **NOT recommending Datadog / New Relic / Honeycomb.** Prometheus + Grafana + Loki + Promtail already deployed. Effort goes into wiring the existing stack.
- **NOT recommending an SRE on-call rotation.** Solo-ops at this scale needs a *paging path that works* (Slack webhook → operator's phone), not a roster.
- **NOT recommending HA Postgres / Redis** at this stage.
- **NOT recommending a service mesh / Linkerd / Istio.** One backend container, one frontend container.
- **NOT recommending the `pgadmin` container be removed.** IP allowlist + container-only routing is acceptable.

## Total LOC + files-touched estimate (repo-side changes)

| Phase | PRs | Files touched | Net LOC | Effort |
|-------|-----|---------------|---------|--------|
| Phase B | 7 | ~12 files | ~400 LOC | ~1.5 days |
| Phase C | 5 | ~10 files | ~600 LOC | ~3 days incl. DNS migration |
| **Total** | **12 PRs** | **~22 files** | **~1000 LOC** | **~4-5 days** |

Phase A (server-side hot fixes) is operator-time on the droplet, ~2 hours.
