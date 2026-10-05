# Production Deployment Checklist — Audit Fix Release

**Release scope**: Batch 1 (FB-01) + Batch 2 (FB-02, FB-03)  
**Date**: 2026-03-06  
**Target**: Current DigitalOcean production server baseline  

## Current topology note (2026-03-08)

- Mandatory preflight: `node scripts/ci/check-production-topology.js`
- Full ingress chain: `DO Cloud Firewall (gacp-production) -> host nginx -> docker nginx -> frontend/backend`
- SSH access uses port 2222 from outside. Port 22 is restricted to operator IP at cloud firewall level.
- Any checklist step assuming direct public Docker ports is non-compliant
- Any deployment without an active cloud-level firewall is non-compliant

### Cloud Firewall verification (required before every deploy)

| Check Item | How to Verify |
| --- | --- |
| Cloud Firewall `gacp-production` is active and applied to Droplet | DigitalOcean dashboard → Networking → Firewalls → gacp-production → Droplets tab |
| Port 80/443 open to all | Inbound rules show HTTP/HTTPS with All IPv4, All IPv6 |
| Port 22/2222 restricted to operator IP only | Inbound rules show SSH/Custom with specific IP only |
| All other ports blocked | No other inbound rules present |

---

## 1. Environment Variables & Config

### 1.1 Core Secrets (REQUIRED)

| Check Item | Owner | When | How to Verify | Impact if Skipped |
|------------|-------|------|---------------|-------------------|
| `JWT_SECRET` ≥ 32 chars, not default | DevOps | Before | `echo $JWT_SECRET \| wc -c` ≥ 32 | Auth bypass, token forgery |
| `HEALTH_JWT_SECRET` set | DevOps | Before | `test -n "$HEALTH_JWT_SECRET"` | Health login broken |
| `PROVIDER_JWT_SECRET` set | DevOps | Before | `test -n "$PROVIDER_JWT_SECRET"` | Provider/provider login broken |
| `DATABASE_URL` points to production DB | DevOps | Before | `psql $DATABASE_URL -c "SELECT 1"` | Total outage |
| `CRON_SECRET` set (**audit-mandated M-014**) | DevOps | Before | `test -n "$CRON_SECRET"` | Cron routes reject all requests |
| `LAB_API_KEY` set (**audit-mandated M-014**) | DevOps | Before | `test -n "$LAB_API_KEY"` | Lab webhook endpoint rejects |
| `PROMPTPAY_WEBHOOK_SECRET` ≥ 32 chars | DevOps | Before | Length check | Payment webhooks unverified |

### 1.2 Government API Keys (REQUIRED)

| Check Item | Owner | When | How to Verify | Impact if Skipped |
|------------|-------|------|---------------|-------------------|
| `DOA_API_URL` + `DOA_CLIENT_ID` + `DOA_CLIENT_SECRET` | DevOps | Before | Env validator passes | DOA integration fails |
| `FDA_API_URL` + `FDA_API_KEY` + `FDA_SECRET_KEY` | DevOps | Before | Env validator passes | FDA integration fails |
| `DGA_API_URL` + `DGA_CERT_ID` + `DGA_PRIVATE_KEY` (≥100 chars) | DevOps | Before | Env validator passes | Digital signing fails |

### 1.3 Application Config (REQUIRED)

| Check Item | Owner | When | How to Verify | Impact if Skipped |
|------------|-------|------|---------------|-------------------|
| `NODE_ENV=production` | DevOps | Before | `echo $NODE_ENV` | E2E routes exposed, debug logging active |
| `FRONTEND_URL` matches production domain | DevOps | Before | Compare with actual URL | CORS failures, wrong email links |
| `FRONTEND_BASE_URL` matches production domain | DevOps | Before | Compare | Wrong redirect URLs |
| `EMAIL_FROM_ADDRESS` valid email | DevOps | Before | Pattern check | Email delivery fails |
| `SMS_SENDER` set | DevOps | Before | `test -n "$SMS_SENDER"` | SMS notifications fail |
| `CORS_ORIGIN` set to production domain (not `*`) | DevOps | Before | `echo $CORS_ORIGIN` | Open CORS in production |

### 1.4 Optional Config

| Check Item | Owner | When | How to Verify | Impact if Skipped |
|------------|-------|------|---------------|-------------------|
| `PORT` set (default 3000) | DevOps | Before | Docker port mapping | Uses default port |
| `LOG_LEVEL` set to `info` or `warn` | DevOps | Before | `echo $LOG_LEVEL` | Verbose/missing logs |
| `JWT_EXPIRES_IN` (default `24h`) | DevOps | Before | Check `.env` | Long session lifetime |
| `ENABLE_WEBHOOK_DLQ` (optional `true`) | DevOps | Before | `echo $ENABLE_WEBHOOK_DLQ` | DLQ disabled, no auto-retry |
| `ENCRYPTION_KEY` set for field encryption | DevOps | Before | `test -n "$ENCRYPTION_KEY"` | Falls back to JWT_SECRET |

### 1.5 Automated Validation

| Check Item | Owner | When | How to Verify | Impact if Skipped |
|------------|-------|------|---------------|-------------------|
| Run environment validator | DevOps | Before | `node -e "new (require('./shared/environment-validator'))().validateAndExit()"` | Missing vars discovered at runtime |

---

## 2. Database Backup & Migration

| Check Item | Owner | When | How to Verify | Impact if Skipped |
|------------|-------|------|---------------|-------------------|
| **Full DB backup** | DBA | Before | `pg_dump -Fc gacp_db > backup_20260306.dump` | No rollback if migration fails |
| Verify backup integrity | DBA | Before | `pg_restore --list backup_20260306.dump` | Corrupt backup useless |
| **Run dedup check SQL** | DBA | Before | Execute `prisma/pre-migration-dedup-check.sql` → all 3 queries return 0 rows | Migration fails on unique constraints |
| Fix duplicates if found | DBA | Before | Run dedup DELETE queries from SQL file comments | Migration blocked |
| **Apply migration** | DBA | During | `npx prisma migrate deploy` | Schema mismatch, new constraints missing |
| Verify migration applied | DBA | After | `npx prisma migrate status` → no pending | App uses old schema |
| **Regenerate Prisma client** | DevOps | After | `npx prisma generate` | Runtime type mismatch |
| Spot-check unique constraints | DBA | After | `\d payment_transactions` → check `gatewayRef` unique index | Constraint not enforced |

---

## 3. Redis / Queue Readiness

| Check Item | Owner | When | How to Verify | Impact if Skipped |
|------------|-------|------|---------------|-------------------|
| Redis server running | DevOps | Before | `redis-cli -u $REDIS_URL ping` → `PONG` | Queue init fails (graceful) |
| `REDIS_URL` in `.env` | DevOps | Before | `test -n "$REDIS_URL"` | Falls back to localhost |
| SLA queue processes | DevOps | After | Server log: "✅ SLA Queue Ready" | SLA checks don't run |
| PDF queue processes | DevOps | After | Server log: "✅ PDF Queue Ready" | Certificate PDFs not generated |
| DLQ state documented | DevOps | Before | Decide: `ENABLE_WEBHOOK_DLQ=true` or leave disabled | Webhook failures not retried |
| Bull dashboard (optional) | DevOps | After | If installed: check `/admin/queues` | No queue visibility |

---

## 4. Storage / MinIO Readiness

| Check Item | Owner | When | How to Verify | Impact if Skipped |
|------------|-------|------|---------------|-------------------|
| MinIO/S3 bucket exists | DevOps | Before | `mc ls minio/gacp-uploads` | File uploads fail |
| Upload credentials valid | DevOps | Before | `mc cp test.txt minio/gacp-uploads/test.txt && mc rm minio/gacp-uploads/test.txt` | Upload/download broken |
| `MINIO_ENDPOINT` / `S3_*` env vars set | DevOps | Before | Check `.env` | Falls back to local filesystem |
| Existing uploads accessible | DevOps | After | Download a known file | Historical documents lost |
| Upload dir writable (fallback) | DevOps | Before | `touch uploads/test && rm uploads/test` | Local fallback broken |

---

## 5. Nginx / Routing

> ⚠️ Per project rules: Nginx reverse proxy MUST ALWAYS be in front of Docker containers.

| Check Item | Owner | When | How to Verify | Impact if Skipped |
|------------|-------|------|---------------|-------------------|
| **Nginx installed and running** | DevOps | Before | `systemctl status nginx` → active | Direct backend exposure |
| Nginx config points to backend container | DevOps | Before | `nginx -t` → syntax ok + verify `proxy_pass` | 502 Bad Gateway |
| SSL certificate valid | DevOps | Before | `curl -I https://domain` → 200 + valid cert | MITM, browser warnings |
| HTTPS redirect configured | DevOps | Before | `curl -I http://domain` → 301 to https | Unencrypted traffic |
| WebSocket proxy (if needed) | DevOps | Before | Check `Upgrade` headers in nginx config | Real-time features broken |
| `/api/*` routes to backend | DevOps | After | `curl https://domain/api/health` → 200 | API unreachable |
| `/uploads/*` rewrite works | DevOps | After | `curl https://domain/uploads/test-file` | Uploaded files inaccessible |
| Rate limiting active | DevOps | Before | Check `limit_req_zone` in nginx config | DDoS vulnerability |
| HSTS header present | DevOps | After | `curl -I https://domain` → `Strict-Transport-Security` | Downgrade attack risk |
| Request body size limit | DevOps | Before | Check `client_max_body_size` in nginx | Large upload rejection |

---

## 6. Health Checks

| Check Item | Owner | When | How to Verify | Impact if Skipped |
|------------|-------|------|---------------|-------------------|
| Backend health endpoint | DevOps | After | `curl /api/health` → `200 { status: "ok" }` | Monitoring blind |
| Docker healthcheck defined | DevOps | Before | Check `HEALTHCHECK` in Dockerfile or compose | No auto-restart |
| Container restart policy | DevOps | Before | `docker inspect --format='{{.HostConfig.RestartPolicy.Name}}'` → `unless-stopped` | No auto-recovery |
| Frontend build succeeds | DevOps | During | `npm run build` in web-app | Frontend 500 |
| Frontend pages load | QA | After | Navigate to `/`, `/login`, `/provider/login` | User-facing outage |

---

## 7. Cron / Scheduled Jobs

| Check Item | Owner | When | How to Verify | Impact if Skipped |
|------------|-------|------|---------------|-------------------|
| `CRON_SECRET` matches scheduled caller | DevOps | Before | Compare with external cron service config | Cron calls rejected 403 |
| SLA check cron (daily 08:00) | DevOps | After | Server log: "[Queue] SLA Daily Check Scheduled" | SLA breaches undetected |
| DLQ reconciliation (daily 02:00) | DevOps | After | Server log (if DLQ enabled): DLQ schedule message | Failed webhooks not retried |
| External cron caller configured | DevOps | Before | Check cron service (e.g., cron-job.org) with correct `x-cron-secret` header | No external triggers |

---

## 8. Webhook Endpoints

| Check Item | Owner | When | How to Verify | Impact if Skipped |
|------------|-------|------|---------------|-------------------|
| Payment webhook URL registered with gateway | DevOps | Before | Check gateway dashboard → callback URL = `https://domain/api/webhooks/payment` | Payment status not updated |
| Webhook returns proper error codes | QA | After | Send invalid payload → expect 4xx (not 200) | Silent data loss |
| `PAYMENT_WEBHOOK_SECRET` matches gateway config | DevOps | Before | Compare with gateway settings | Webhook signature verification fails |
| Lab webhook URL registered | DevOps | Before | Check lab system config → callback = `https://domain/api/callbacks/lab-result` | Lab results not received |
| `LAB_API_KEY` shared with lab partner | DevOps | Before | Confirm with lab integration team | Lab calls rejected 401 |

---

## 9. Monitoring / Logging / Alerts

| Check Item | Owner | When | How to Verify | Impact if Skipped |
|------------|-------|------|---------------|-------------------|
| Structured logging active | DevOps | After | Check log output format → JSON with timestamps | Can't parse logs |
| Log rotation configured | DevOps | Before | Check Docker log driver or logrotate config | Disk fills up |
| Error rate alerting | DevOps | Before | Configure alert on `logger.error` rate > threshold | Silent failures |
| Uptime monitoring | DevOps | After | Configure external monitor (e.g., UptimeRobot) on `/api/health` | Downtime undetected |
| Docker container logs accessible | DevOps | After | `docker compose logs --tail=50 backend` | Debugging blind |
| `LOG_LEVEL=info` (not debug) | DevOps | Before | Check `.env` | Excessive log volume |
| APM/tracing (optional) | DevOps | After | If configured: check traces appearing | No performance insight |

---

## 10. Rollback Preparation

| Check Item | Owner | When | How to Verify | Impact if Skipped |
|------------|-------|------|---------------|-------------------|
| **Previous Docker image tagged** | DevOps | Before | `docker tag gacp-backend:latest gacp-backend:pre-audit-fix` | No image to rollback to |
| **Previous frontend build archived** | DevOps | Before | Copy current `.next` or build output | Frontend rollback impossible |
| **DB backup verified** (item 2.1) | DBA | Before | Already verified above | Data loss on rollback |
| Migration rollback SQL prepared | DBA | Before | Drop unique indexes: `DROP INDEX IF EXISTS "payment_transactions_gatewayRef_key"` etc. | Can't reverse schema |
| Rollback procedure documented | DevOps | Before | Team knows the steps (see Go/No-Go doc Section E) | Panic during incident |
| Rollback triggers defined | Lead | Before | Team knows when to trigger (see Go/No-Go doc Section E) | Delayed response |

### Quick Rollback Commands

```bash
# 1. Stop current deployment
docker compose down

# 2. Restore previous image
docker tag gacp-backend:pre-audit-fix gacp-backend:latest
docker compose up -d

# 3. If migration must be reversed (only if unique constraints cause issues)
psql $DATABASE_URL <<EOF
DROP INDEX IF EXISTS "payment_transactions_gatewayRef_key";
DROP INDEX IF EXISTS "trace_qr_security_qrCode_key";
DROP INDEX IF EXISTS "trace_qr_security_publicUrl_key";
EOF

# 4. Mark migration as rolled back
npx prisma migrate resolve --rolled-back 20260306200000_add_unique_constraints_audit_m016_m017

# 5. Verify
curl https://your-domain/api/health
```

---

## Deployment Execution Order

```
┌─ PHASE 0: PREPARATION ──────────────────────────┐
│  ☐ 1.5  Run environment validator                │
│  ☐ 2.1  Full DB backup                           │
│  ☐ 2.2  Verify backup integrity                  │
│  ☐ 2.3  Run dedup check SQL                      │
│  ☐ 10.1 Tag previous Docker image                │
│  ☐ 10.2 Archive previous frontend build          │
├─ PHASE 1: INFRASTRUCTURE ────────────────────────┤
│  ☐ 3.1  Verify Redis running                     │
│  ☐ 4.1  Verify storage bucket exists              │
│  ☐ 5.1  Verify Nginx running + config             │
│  ☐ 5.2  Verify SSL certificate                    │
├─ PHASE 2: DATABASE ─────────────────────────────┤
│  ☐ 2.4  Fix duplicates if found                  │
│  ☐ 2.5  Apply migration (prisma migrate deploy)   │
│  ☐ 2.6  Verify migration status                   │
│  ☐ 2.7  Regenerate Prisma client                  │
├─ PHASE 3: APPLICATION ──────────────────────────┤
│  ☐ Docker build + push                            │
│  ☐ docker compose up -d                           │
│  ☐ 6.1  Health check → 200                        │
│  ☐ 6.4  Frontend build succeeds                   │
│  ☐ 6.5  Frontend pages load                       │
├─ PHASE 4: VERIFICATION (first 30 min) ──────────┤
│  ☐ Login as health user → OK                      │
│  ☐ Login as provider user → OK                    │
│  ☐ Login as admin → OK                            │
│  ☐ curl /api/admin/config without auth → 403      │
│  ☐ Create test application → OK                   │
│  ☐ 7.1-7.4  Cron + webhook checks                │
│  ☐ 9.1  Structured logs appearing                 │
│  ☐ Monitor error rate for 30 minutes              │
└──────────────────────────────────────────────────┘
```

---

## Sign-Off

| Role | Name | Status | Date |
|------|------|--------|------|
| DevOps | | ☐ Approved | |
| DBA | | ☐ Approved | |
| QA | | ☐ Approved | |
| Lead Developer | | ☐ Approved | |
| Product Owner | | ☐ Approved | |
