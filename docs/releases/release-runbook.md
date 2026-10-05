# Release Runbook — Audit Fix v1.0

## Current topology note (2026-03-08)

- Treat this runbook as valid only when `node scripts/ci/check-production-topology.js` passes.
- Public ingress is `host nginx -> docker nginx -> frontend/backend`.
- Do not claim blue-green or staging parity unless the corresponding compose/config files exist and are validated.

**Release**: Batch 1+2 (FB-01, FB-02, FB-03)  
**Target**: Current DigitalOcean production baseline (provider-neutral target architecture in planning)  
**Estimated duration**: 45–60 min  
**Maintenance window**: Yes (brief DB migration)

---

## Phase 1: Pre-Deploy Checks

| Step | Owner | Command / Action | Expected Outcome | If Failed |
|------|-------|-----------------|------------------|-----------|
| 1.1 | DevOps | `docker tag gacp-backend:latest gacp-backend:pre-audit-fix` | Image tagged | Cannot proceed — no rollback anchor |
| 1.2 | DevOps | `docker tag gacp-web:latest gacp-web:pre-audit-fix` | Image tagged | Cannot proceed |
| 1.3 | DBA | `pg_dump -Fc gacp_db > backup_$(date +%Y%m%d_%H%M).dump` | Dump file created | Cannot proceed — no data safety net |
| 1.4 | DBA | `pg_restore --list backup_*.dump \| head -5` | Lists tables | Re-run pg_dump, check disk space |
| 1.5 | DBA | `psql $DATABASE_URL < prisma/pre-migration-dedup-check.sql` | All 3 queries return **0 rows** | Fix duplicates before proceeding (see dedup examples in SQL file) |
| 1.6 | DevOps | Check `.env`: `NODE_ENV=production` | Confirmed | Set it — E2E routes are exposed otherwise |
| 1.7 | DevOps | Check `.env`: `CRON_SECRET` is set and ≥16 chars | Confirmed | Add secret — cron routes will reject all calls |
| 1.8 | DevOps | Check `.env`: `LAB_API_KEY` is set | Confirmed | Add key — lab webhook will reject calls |
| 1.9 | DevOps | Check `.env`: `JWT_SECRET` ≥32 chars, not default | Confirmed | Replace — auth is compromised |
| 1.10 | DevOps | Check `.env`: `HEALTH_JWT_SECRET`, `PROVIDER_JWT_SECRET` set | Confirmed | Add — login will fail |
| 1.11 | DevOps | `git pull origin main` (or checkout release branch) | Latest code | Resolve conflicts |
| 1.12 | DevOps | `cd apps/backend && npx prisma validate` | "schema is valid 🚀" | Fix schema errors before proceeding |

**Gate**: ALL steps must pass. Any failure = STOP.

---

## Phase 2: Deployment

| Step | Owner | Command / Action | Expected Outcome | If Failed |
|------|-------|-----------------|------------------|-----------|
| 2.1 | DevOps | `cd apps/backend && npm ci` | Dependencies installed | Check network, registry access |
| 2.2 | DevOps | `npx prisma generate` | Prisma client generated | Run `npx prisma validate` first |
| 2.3 | DBA | `npx prisma migrate deploy` | Migration `20260306200000_add_unique_constraints...` applied | If unique violation: run dedup (step 1.5 was skipped). If other error: `npx prisma migrate resolve --rolled-back 20260306200000_add_unique_constraints_audit_m016_m017` → abort |
| 2.4 | DBA | `npx prisma migrate status` | "All migrations applied" | Investigate pending migrations |
| 2.5 | DevOps | `docker compose build` | Images built | Check Dockerfile, node version |
| 2.6 | DevOps | `docker compose down` | Containers stopped | `docker kill` if graceful fails |
| 2.7 | DevOps | `docker compose up -d` | Containers started, healthy | Check logs immediately: `docker compose logs -f backend` |
| 2.8 | DevOps | Wait 15 seconds, then: `docker ps` | All containers: STATUS=Up, healthy | → Go to Rollback Phase |

**Downtime window**: Steps 2.6–2.8 (approximately 30–60 seconds)

---

## Phase 3: Smoke Tests

| Step | Owner | Command / Action | Expected Outcome | If Failed |
|------|-------|-----------------|------------------|-----------|
| 3.1 | DevOps | `curl -s https://domain/api/health \| jq .` | `{ "status": "ok" }` | → Rollback |
| 3.2 | DevOps | `curl -s -o /dev/null -w "%{http_code}" https://domain/api/admin/config` | `403` (no auth = blocked) | → Rollback — middleware not loaded |
| 3.3 | DevOps | `curl -s -o /dev/null -w "%{http_code}" https://domain/api/config/document-slots` | `200` | → Rollback — config routes broken |
| 3.4 | QA | Login as health user (browser) | Dashboard loads | Check auth-middleware logs |
| 3.5 | QA | Login as provider user (browser) | Provider dashboard loads | Check `PROVIDER_JWT_SECRET` |
| 3.6 | QA | Login as admin user (browser) | Admin dashboard loads | Check user role in DB |
| 3.7 | QA | Navigate to application list (health user) | Shows only own applications | → Rollback — tenant isolation broken |
| 3.8 | DevOps | `docker compose logs backend \| grep -c "error"` | < 10 errors in first 2 min | Investigate top errors |
| 3.9 | DevOps | `docker compose logs backend \| grep "\[Queue\]"` | "✅ SLA Queue Ready" present | Check `REDIS_URL` |
| 3.10 | DBA | `psql $DATABASE_URL -c "\d payment_transactions" \| grep gatewayRef` | Shows `UNIQUE` | Migration not applied — re-run step 2.3 |

**Gate**: Steps 3.1–3.7 must ALL pass. If any fails → Rollback Phase.

---

## Phase 4: Failure Signals & Rollback Triggers

### Automatic Rollback Triggers (no discussion needed)

| Signal | Detection | Threshold |
|--------|-----------|-----------|
| Health endpoint down | `curl /api/health` ≠ 200 | > 1 min |
| Container crash loop | `docker ps` → Restarting | > 2 restarts |
| Cross-tenant data visible | Any user sees other's farm data | **Single incident** |

### Escalation Rollback Triggers (Lead decides)

| Signal | Detection | Threshold |
|--------|-----------|-----------|
| Login failure rate | 401/403 spike in logs | > 20% for 5 min |
| Payment 500 errors | `grep "\[Payments\].*error"` | > 3 in 10 min |
| DB connection failures | `ECONNREFUSED` in logs | > 5 in 5 min |
| Error rate spike | `grep -c "error"` in logs | > 50 in 5 min |

---

## Phase 5: Rollback Steps

> ⏱ Target: Complete rollback in < 5 minutes

| Step | Owner | Command / Action | Expected Outcome | If Failed |
|------|-------|-----------------|------------------|-----------|
| R.1 | Lead | **DECISION**: Announce rollback to team | Team aware | — |
| R.2 | DevOps | `docker compose down` | Containers stopped | `docker kill $(docker ps -q)` |
| R.3 | DevOps | `docker tag gacp-backend:pre-audit-fix gacp-backend:latest` | Previous image restored | If image missing: `git checkout <previous-sha> && docker compose build` |
| R.4 | DevOps | `docker tag gacp-web:pre-audit-fix gacp-web:latest` | Previous frontend restored | Same as R.3 |
| R.5 | DBA | **Only if migration caused issues**: | | |
| | | `psql $DATABASE_URL <<'EOF'` | Indexes dropped | If fails: indexes didn't exist (OK) |
| | | `DROP INDEX IF EXISTS "payment_transactions_gatewayRef_key";` | | |
| | | `DROP INDEX IF EXISTS "trace_qr_security_qrCode_key";` | | |
| | | `DROP INDEX IF EXISTS "trace_qr_security_publicUrl_key";` | | |
| | | `EOF` | | |
| R.6 | DBA | `npx prisma migrate resolve --rolled-back 20260306200000_add_unique_constraints_audit_m016_m017` | Migration marked rolled back | Manual: update `_prisma_migrations` table |
| R.7 | DevOps | `docker compose up -d` | Previous version running | Escalate to L3 |
| R.8 | DevOps | `curl -s https://domain/api/health` | `200 OK` | **Critical**: Server not recovering — L3 escalation |
| R.9 | Lead | Post-mortem ticket created | Documented | — |

---

## Phase 6: Post-Deploy Verification (first 30 min)

| Step | Owner | Command / Action | Expected Outcome | If Failed |
|------|-------|-----------------|------------------|-----------|
| 6.1 | QA | Create test application (health user) | Application created, status=DRAFT | Log issue, not rollback-worthy |
| 6.2 | QA | Submit test application | Status → SUBMITTED | Check workflow-transition-service |
| 6.3 | QA | Attempt invalid transition (DRAFT→APPROVED) | Rejected with error | Check status-machine.js loaded |
| 6.4 | QA | Access other user's farm data | 403 Forbidden | → **Rollback** (tenant isolation broken) |
| 6.5 | DevOps | `curl -H "x-cron-secret: $CRON_SECRET" https://domain/api/cron/sla-check` | 200 OK | Check CRON_SECRET match |
| 6.6 | DevOps | `curl -H "x-cron-secret: wrong" https://domain/api/cron/sla-check` | 403 Forbidden | Check cron middleware |
| 6.7 | DevOps | Monitor error logs for 30 min: `docker compose logs -f backend 2>&1 \| grep -i error` | Error rate stable or declining | Investigate spikes, consider rollback if increasing |
| 6.8 | DevOps | `docker stats --no-stream` | CPU < 80%, Memory < 80% | Investigate memory leak |

---

## Phase 7: Hypercare Handoff

| Step | Owner | Command / Action | Expected Outcome | If Failed |
|------|-------|-----------------|------------------|-----------|
| 7.1 | Lead | Confirm all Phase 6 steps passed | All green | Continue monitoring, delay handoff |
| 7.2 | Lead | Send handoff message to on-call team | Team acknowledged | Direct message |
| 7.3 | Lead | Share on-call schedule for next 72h | Schedule confirmed | Assign immediately |
| 7.4 | DevOps | Enable monitoring alerts (UptimeRobot/similar) | Alerts active on `/api/health` | Manual checks every 30 min |
| 7.5 | Lead | Share hypercare plan link with team | [post-release-hypercare-plan.md](file:///C:/Users/charo/GACP-Application/GACP-Certification-Application/docs/post-release-hypercare-plan.md) | — |
| 7.6 | Lead | Set hypercare exit review at T+72h | Calendar invite sent | — |

### Hypercare Schedule

```
T+0  to T+2h  : Lead Dev + DevOps active (check every 10 min)
T+2h to T+24h : On-call Dev active (check every 30 min)  
T+24h to T+72h: On-call Dev passive (check every 2h + alerts)
T+72h         : Exit review — hypercare ends if criteria met
```

### Hypercare Exit Criteria

- [ ] Error rate < 0.5% for 24h
- [ ] Zero auth/RBAC anomalies for 48h
- [ ] Zero payment failures for 48h
- [ ] All cron jobs executed on schedule
- [ ] Container restart count = 0 for 48h
- [ ] No user-reported critical issues

---

## Quick Reference Card

```
╔═══════════════════════════════════════════╗
║  RUNBOOK QUICK REFERENCE                  ║
╠═══════════════════════════════════════════╣
║  Health check:  curl /api/health          ║
║  Auth check:    curl /api/admin/config    ║
║  Logs:          docker compose logs -f    ║
║  Stats:         docker stats --no-stream  ║
║  Migration:     npx prisma migrate status ║
║  Rollback:      → Phase 5 (steps R.1-R.9) ║
║  Escalation:    L1→L2 (15min) → L3 (1h)  ║
║  Hypercare doc: docs/post-release-*.md    ║
╚═══════════════════════════════════════════╝
```
