# DTAM Hosting Plan — Production Deployment Roadmap

**Status**: Planning (as of 2026-05-15)
**Owner**: Tech Lead + Infra Team (DevOps, Security, SRE) + DTAM Liaison (TBD)
**Replaces**: Previous DigitalOcean baseline references in deployment docs

## Decision

The GACP platform will be hosted on **DTAM (Department of Thai Traditional and Alternative Medicine) infrastructure**, not on commercial cloud (DigitalOcean / AWS / GCP / Azure).

**Current status**: Server, domain, and credentials **not yet provisioned**. No production environment is currently active.

## Rationale

1. **Data residency** — Thai government certification data should reside on Thai government infrastructure (PDPA + sovereignty requirements)
2. **Cost** — DTAM existing infrastructure capacity preferred over recurring commercial cloud spend
3. **Compliance** — Direct alignment with DTAM SIEM, audit, and access policies
4. **Integration** — Easier connection to other DTAM systems (THAID OAuth, internal directories) if hosted in same network

## What Was Previously Planned (Now Superseded)

Prior documentation referenced:
- A DigitalOcean droplet baseline (gacpth.com domain, IP 203.0.113.20)
- Single-host deployment with Docker Compose
- SSH-based deployment from operator workstations
- Multi-provider evaluation (AWS/GCP/Azure/DigitalOcean) per ADR-013

**These references are removed from active documentation as of 2026-05-15.** They remain in ADR-013 as historical decision context only.

## What's Needed from DTAM (Outstanding Asks)

To unblock production deployment, DTAM must provide:

| Item | Owner | Status |
|------|-------|--------|
| Production server (specs TBD — see "Minimum Server Spec" below) | DTAM IT | ⏳ Pending |
| FQDN (likely `.go.th` government subdomain) | DTAM IT | ⏳ Pending |
| TLS certificate (DTAM-approved CA or government PKI) | DTAM IT | ⏳ Pending |
| SSH credentials + bastion access policy | DTAM IT | ⏳ Pending |
| Secret manager (or DTAM equivalent) for HMAC/JWT/DB secrets | DTAM IT | ⏳ Pending |
| Backup target (DTAM storage / off-site copy) | DTAM IT | ⏳ Pending |
| SIEM endpoint (for audit log streaming) | DTAM SOC | ⏳ Pending |
| Firewall rules (allowed ingress/egress) | DTAM Network | ⏳ Pending |
| Production data residency confirmation | DTAM Legal | ⏳ Pending |

## Minimum Server Spec (Recommendation)

Based on E2E analysis of the application (12-step wizard, PDF generation, MinIO storage, Bull queues, PostgreSQL):

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 4 vCPU | 8 vCPU |
| RAM | 8 GB | 16 GB |
| Disk (SSD) | 100 GB | 250 GB (with backup) |
| Network | 100 Mbps | 1 Gbps |
| OS | Ubuntu 22.04 LTS or Rocky Linux 9 | Same |
| Docker | 24+ | Same |
| Open inbound ports | 22 (SSH from operator), 443 (HTTPS) | Same + 80 (HTTP→HTTPS redirect) |

For high availability (future state), this becomes 2x servers + managed PostgreSQL — out of current scope.

## Architecture (Single-Host Initial)

```
┌─────────────────────────────────────────────────┐
│ DTAM Internet Edge / Firewall                    │
└──────────────────┬──────────────────────────────┘
                   │ 443 only
                   ▼
┌─────────────────────────────────────────────────┐
│ Single DTAM-Hosted Server                        │
│ ┌─────────────────────────────────────────────┐ │
│ │ nginx (TLS termination, reverse proxy)       │ │
│ └──────────┬──────────────────────────────────┘ │
│            │                                     │
│            ├─► Backend (Express, port 8000)      │
│            └─► Frontend (Next.js, port 3000)     │
│                                                  │
│ ┌─────────────────────────────────────────────┐ │
│ │ PostgreSQL 15 (Docker, internal only)        │ │
│ │ Redis 7 (Docker, internal only)              │ │
│ │ MinIO (Docker, internal only)                │ │
│ │ prometheus + grafana (internal monitoring)   │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

## Deployment Workflow (Once Provisioned)

See `.agents/workflows/deploy.md` for the canonical procedure. Uses environment variables (`$DEPLOY_USER`, `$DEPLOY_HOST`, `$DEPLOY_PATH`, `$SSH_KEY`) instead of hardcoded server details.

## Migration Path from "No Production" to "DTAM Production"

### Phase 1: DTAM Provisioning (BLOCKED on DTAM)
- DTAM allocates server + network
- SSH access granted
- TLS cert issued
- Domain DNS configured

### Phase 2: Initial Setup (Infra Team)
- SSH in, install Docker + Docker Compose
- Clone repo to `$DEPLOY_PATH`
- Configure `.env.production` (using DTAM secret manager)
- Bring up containers via `docker-compose.production.yml`
- Apply Prisma migrations

### Phase 3: Validation
- Health endpoint returns 200
- Smoke tests pass against new server
- DTAM Security/SOC approves traffic patterns
- DTAM Legal confirms data residency

### Phase 4: Cutover
- Update DNS to new server
- Customer Success prepares support scripts with new URL
- Marketing announces launch (per `marketing-campaign` workflow)

## Security Requirements (DTAM-Specific)

These should be in place BEFORE production traffic:

- [ ] All secrets in DTAM secret manager (not in `.env.production` file)
  - HMAC_KEY, MASTER_ENCRYPTION_KEY, SESSION_SECRET
  - HEALTH_JWT_SECRET, PROVIDER_JWT_SECRET
  - REDIS_PASSWORD
  - DATABASE_URL (with password)
  - S3_ACCESS_KEY, S3_SECRET_KEY
  - PAYMENT_SECRET_KEY, PAYMENT_WEBHOOK_SECRET
- [ ] All inbound traffic via DTAM firewall (no direct internet access to server SSH)
- [ ] PostgreSQL not exposed externally (Docker internal network only)
- [ ] MinIO not exposed externally (Docker internal network only)
- [ ] TLS 1.2+ only, modern cipher suites
- [ ] HTTPS-only (HSTS), no HTTP fallback for authenticated routes
- [ ] Audit logs streamed to DTAM SIEM (real-time or daily batch)
- [ ] Backup encryption at rest

See `agent-infra-security` skill for the operational hardening checklist.

## What Goes in `.env.production` (Template)

```bash
# Server
PORT=8000
NODE_ENV=production

# Database (use DTAM-provisioned PostgreSQL credentials)
DATABASE_URL=postgresql://<dtam-user>:<from-secret-manager>@<dtam-pg-host>:5432/gacp_production

# Auth secrets (FROM DTAM SECRET MANAGER, never paste here)
HEALTH_JWT_SECRET=<from-dtam-secret-manager>
PROVIDER_JWT_SECRET=<from-dtam-secret-manager>
DTAM_JWT_SECRET=<from-dtam-secret-manager>
SESSION_SECRET=<from-dtam-secret-manager>
HMAC_KEY=<from-dtam-secret-manager>
MASTER_ENCRYPTION_KEY=<from-dtam-secret-manager>

# Cache / Queue
REDIS_URL=redis://:<from-dtam-secret-manager>@redis:6379
REDIS_PASSWORD=<from-dtam-secret-manager>

# Storage (MinIO inside container network)
STORAGE_PROVIDER=minio
S3_ENDPOINT=http://minio:9000
S3_REGION=ap-southeast-1
S3_BUCKET=gacp-uploads
S3_ACCESS_KEY=<from-dtam-secret-manager>
S3_SECRET_KEY=<from-dtam-secret-manager>

# Public URL (set by DTAM after FQDN assigned)
PUBLIC_URL=https://<dtam-fqdn>
CORS_ORIGIN=https://<dtam-fqdn>

# ThaID (Thai government OAuth)
THAID_MOCK=false
THAID_CLIENT_ID=<from-dtam-secret-manager>
THAID_CLIENT_SECRET=<from-dtam-secret-manager>

# Payment (Ksher gateway, if used in production)
KSHER_API_URL=<from-ksher>
KSHER_APP_ID=<from-ksher>
KSHER_PRIVATE_KEY=<from-ksher-via-secret-manager>

# Observability
SENTRY_DSN=<optional, if DTAM permits>
GRAFANA_PASSWORD=<from-dtam-secret-manager>
```

## Related Tech Debt (See `docs/handoffs/_debt-progress.md`)

| # | Debt | Relevance |
|---|------|-----------|
| 6 | HMAC keys in `.env` (not secret manager) | **BLOCKER** — must resolve before DTAM deploy |
| 4 | Deploy automation stub in CI/CD | Should resolve to enable smooth DTAM deploys |
| 3 | 2 wizard implementations | Should resolve before public launch |

## Open Questions for Owner

1. Is there a target launch date driven by DTAM (e.g., budget year)?
2. Will DTAM provide a managed PostgreSQL service or expect Docker-hosted Postgres on the same box?
3. Does DTAM require code review of Dockerfiles + compose files before allowing deployment?
4. What is DTAM's incident response expectation (24/7 on-call vs business hours)?
5. Will DTAM run their own backup, or expect us to push to their backup target?

## See Also

- `.agents/workflows/deploy.md` — DTAM-agnostic deployment template
- `docs/adr/ADR-013-platform-neutral-production-strategy.md` — Historical multi-provider evaluation
- `docs/handoffs/_debt-progress.md` — Live tech debt tracking
- `docker-compose.production.yml` — Container topology
- `apps/backend/.env.example` — Full env var inventory
