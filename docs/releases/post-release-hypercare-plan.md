# Post-Release Hypercare Plan — 72 Hours

**Release**: Audit Fix Batch 1+2 (FB-01, FB-02, FB-03)  
**Deploy date**: TBD  
**Hypercare window**: T+0 to T+72h  
**On-call**: Lead Dev + DevOps  

---

## Monitoring Dashboard Summary

### Critical Metrics to Watch

| Metric | Source | Normal | Alert Threshold | Escalation |
|--------|--------|--------|----------------|-----------|
| API error rate (5xx) | `logger.error` count | < 0.1% | > 1% for 5 min | Page on-call |
| Auth failure rate | `401/403` responses | < 5% of requests | > 10% for 5 min | Page on-call |
| Payment success rate | `/api/payments/*` 2xx | > 95% | < 90% for 10 min | Page on-call + PO |
| Response latency (p95) | Nginx access log | < 2s | > 5s for 5 min | Investigate |
| Container restarts | `docker inspect` | 0 | ≥ 1 | Investigate |
| DB connection pool | Prisma logs | < 80% pool | > 90% | Add connections |
| Queue failed jobs | Bull queue events | 0 | ≥ 3 in 1 hour | Investigate |
| Disk usage | Host OS | < 80% | > 90% | Clear logs, expand |

### Endpoints to Monitor

| Endpoint | Method | Expected | Check Interval |
|----------|--------|----------|---------------|
| `/api/health` | GET | 200 | Every 1 min |
| `/api/auth/health/login` | POST (synthetic) | 200 | Every 5 min |
| `/api/auth/provider/login` | POST (synthetic) | 200 | Every 5 min |
| `/api/admin/config` (no auth) | GET | 403 | Every 15 min |
| `/api/payments/create` | POST (smoke) | 400 (no body) | Every 15 min |
| `/api/config/document-slots` | GET | 200 | Every 15 min |
| `/api/public/verify/:known-code` | GET | 200 | Every 15 min |

---

## Phase 1: T+0 to T+2h (Critical Stabilization)

### Active Monitoring — Every 10 Minutes

| # | Watch Item | How to Check | Normal | Action if Abnormal |
|---|-----------|-------------|--------|-------------------|
| 1 | **Server up** | `curl /api/health` → 200 | Responds < 1s | Rollback immediately |
| 2 | **Login flows** | Manual: login health, provider, admin | All succeed | Check auth-middleware logs → rollback if systematic |
| 3 | **Auth guard enforcement** | `curl /api/admin/config` (no auth) | 403 | Check `requireAdmin` middleware loaded |
| 4 | **Payment endpoint** | `curl /api/payments/status/:known-id` (auth'd) | 200 | Check payments.js logger output |
| 5 | **Error spike** | `docker compose logs backend \| grep "error" \| wc -l` | < 10 in 10 min | Investigate top error patterns |
| 6 | **DB connection** | Prisma query succeeds | No timeout | Check `DATABASE_URL`, connection pool |
| 7 | **Redis/queue** | Server logs: "✅ SLA Queue Ready" | Present | Check `REDIS_URL`, restart queue |
| 8 | **Migration success** | `npx prisma migrate status` | All applied | Apply missing migration |
| 9 | **Nginx proxy** | `curl -I https://domain` → 200, HSTS header | SSL valid | Check nginx config |
| 10 | **Container health** | `docker ps` → all healthy, restart=0 | No restarts | Check Docker logs for crash loop |

### Logs to Watch

```bash
# Real-time error stream
docker compose logs -f backend 2>&1 | grep -i "error\|fatal\|crash\|ECONNREFUSED"

# Auth failures 
docker compose logs backend | grep -c "403\|401\|Unauthorized\|Forbidden"

# Payment errors
docker compose logs backend | grep "\[Payments\]"

# Migration issues
docker compose logs backend | grep -i "prisma\|migration"
```

### Rollback Criteria (T+0 to T+2h)

| # | Trigger | Threshold | Action | Recovery |
|---|---------|-----------|--------|----------|
| 1 | Health endpoint down | > 2 min | **Immediate rollback** | < 5 min |
| 2 | Login failure rate | > 20% for 5 min | **Immediate rollback** | < 5 min |
| 3 | Payment 500 errors | > 3 in 10 min | **Immediate rollback** | < 10 min |
| 4 | Cross-tenant data visible | Any single incident | **Immediate rollback** + security incident | < 5 min |
| 5 | Container crash loop | > 3 restarts | **Immediate rollback** | < 5 min |
| 6 | DB connection failures | > 5 in 5 min | Investigate → rollback if unresolved in 15 min | < 15 min |

---

## Phase 2: T+2h to T+24h (Active Observation)

### Monitoring — Every 30 Minutes

| # | Watch Item | How to Check | Normal | Action if Abnormal |
|---|-----------|-------------|--------|-------------------|
| 1 | **Error rate trend** | Compare hourly error count | Stable or declining | Investigate top errors |
| 2 | **Auth anomalies** | Count 403s by route | Consistent with pre-deploy | Check if new middleware is over-blocking |
| 3 | **Payment flow E2E** | Check if any real payment has completed | At least 1 success | Investigate payment-service logs |
| 4 | **Webhook processing** | `docker compose logs backend \| grep "\[Webhook\]"` | Success logs, no repeated failures | Check webhook secret config |
| 5 | **Queue job health** | `docker compose logs backend \| grep "\[Queue\]"` | No failed jobs | Check Redis connection, job processor |
| 6 | **Cron execution** | Check if daily SLA check ran (08:00) | "SLA Daily Check" log | Verify `CRON_SECRET` and schedule |
| 7 | **Upload/storage** | Check if any document upload succeeded | Files present in storage | Check MinIO/S3 credentials |
| 8 | **Memory/CPU** | `docker stats` | < 80% | Investigate memory leak |
| 9 | **Disk growth** | `df -h` on host | < 80% | Rotate logs, increase disk |
| 10 | **Certificate/QR** | Check if cert download or QR verify works | Responds correctly | Check trace-qr-security unique constraint |

### Specific Anomalies to Watch

#### Auth/RBAC Anomalies

```bash
# Users getting unexpected 403s (new middleware too strict?)
docker compose logs backend | grep "403" | awk '{print $NF}' | sort | uniq -c | sort -rn | head -10

# Legacy role alias failures
docker compose logs backend | grep "normalizeRole" | grep -i "unknown\|null\|undefined"

# Farm ownership blocks
docker compose logs backend | grep "requireFarmOwnership" | grep -i "denied\|forbidden"
```

#### Payment Failures

```bash
# Payment creation errors
docker compose logs backend | grep "\[Payments\]" | grep -i "error"

# Webhook failures (should be 0 after fix)
docker compose logs backend | grep "\[Webhook\]" | grep -i "error\|fail"

# Duplicate gatewayRef attempts (unique constraint working)
docker compose logs backend | grep -i "unique.*gatewayRef\|duplicate.*gateway"
```

#### Upload/Storage Failures

```bash
# Upload errors
docker compose logs backend | grep -i "upload.*error\|ENOENT\|EACCES\|minio.*error"

# Storage connectivity
docker compose logs backend | grep -i "s3\|minio\|bucket"
```

#### Trace/Verify Public Errors

```bash
# Public verification failures
docker compose logs backend | grep -i "verify.*error\|trace.*error\|qr.*error"

# QR uniqueness violations (should be 0)
docker compose logs backend | grep -i "unique.*qrCode\|duplicate.*publicUrl"
```

### Rollback Criteria (T+2h to T+24h)

| # | Trigger | Threshold | Action |
|---|---------|-----------|--------|
| 1 | Error rate increasing over 4+ hours | Sustained > 2% | Rollback |
| 2 | Any auth bypass confirmed | Single incident | Rollback + security incident |
| 3 | Payment data inconsistency | Single confirmed case | Rollback + data reconciliation |
| 4 | Queue jobs failing repeatedly | > 10 failures, same job type | Disable queue, investigate |

---

## Phase 3: T+24h to T+72h (Passive Monitoring)

### Monitoring — Every 2 Hours (or automated alerts)

| # | Watch Item | How to Check | Normal | Action if Abnormal |
|---|-----------|-------------|--------|-------------------|
| 1 | **Daily error summary** | Count errors per 24h period | < previous day or stable | Create bug ticket if new pattern |
| 2 | **SLA queue ran on schedule** | Log: "daily-sla-check" complete | Ran at 08:00 | Check cron schedule |
| 3 | **DLQ reconciliation** (if enabled) | Log: "daily-webhook-dlq" complete | Ran at 02:00 | Check Redis |
| 4 | **User-reported issues** | Support channel | Zero critical reports | Prioritize and fix |
| 5 | **Full application lifecycle test** | Create app → submit → pay → review → approve | All transitions succeed | Investigate failing step |
| 6 | **Performance baseline** | Compare p95 latency with pre-deploy | Within ±20% | Investigate regression |
| 7 | **DB size growth** | `SELECT pg_database_size('gacp_db')` | Normal growth rate | Investigate anomalous growth |

### 72-Hour Exit Criteria

Hypercare ends when **ALL** of the following are true:

| # | Criterion | Verification |
|---|-----------|-------------|
| 1 | Error rate stable at < 0.5% for 24h | Log analysis |
| 2 | Zero auth/RBAC anomalies for 48h | 403 pattern analysis |
| 3 | Zero payment failures for 48h | Payment service logs |
| 4 | Zero cross-tenant incidents | Farm ownership logs |
| 5 | All cron jobs executed on schedule | SLA + DLQ logs |
| 6 | At least 1 full lifecycle completed | Manual or automated E2E |
| 7 | No user-reported critical issues | Support channel review |
| 8 | Container restart count = 0 for 48h | `docker inspect` |

---

## Escalation Path

```
┌─────────────────────────────────────────────┐
│  Level 1: On-Call Dev (respond < 15 min)    │
│  → Log investigation, quick fixes           │
│  → Can restart containers, clear cache      │
├─────────────────────────────────────────────┤
│  Level 2: Lead Dev (respond < 30 min)       │
│  → Rollback decision authority              │
│  → Code-level debugging                     │
├─────────────────────────────────────────────┤
│  Level 3: DevOps + DBA (respond < 1 hour)   │
│  → Infrastructure changes                   │
│  → Database recovery, migration rollback    │
├─────────────────────────────────────────────┤
│  Level 4: Product Owner (respond < 2 hours) │
│  → Business impact assessment               │
│  → Communication to stakeholders            │
└─────────────────────────────────────────────┘

Escalation triggers:
  L1 → L2: Issue not resolved in 15 min, or rollback needed
  L2 → L3: Infrastructure/DB issue, or rollback executed
  L3 → L4: User-facing impact > 30 min, or data incident
```

---

## Quick Reference: Log Commands

```bash
# === PHASE 1 (T+0 to T+2h) — Run continuously ===
docker compose logs -f backend 2>&1 | grep -E "error|fatal|403|401|500"

# === PHASE 2 (T+2h to T+24h) — Run every 30 min ===
# Error count last hour
docker compose logs --since 1h backend 2>&1 | grep -ci "error"

# Auth failure breakdown
docker compose logs --since 1h backend 2>&1 | grep -E "401|403" | awk -F'"' '{print $2}' | sort | uniq -c | sort -rn

# Payment summary
docker compose logs --since 1h backend 2>&1 | grep "\[Payments\]"

# Queue health
docker compose logs --since 1h backend 2>&1 | grep "\[Queue\]"

# === PHASE 3 (T+24h to T+72h) — Run every 2h ===
# 24h error trend
docker compose logs --since 24h backend 2>&1 | grep -ci "error"

# Container health
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
docker stats --no-stream

# DB size
docker compose exec backend npx prisma db execute --stdin <<< "SELECT pg_database_size('gacp_db');"
```
