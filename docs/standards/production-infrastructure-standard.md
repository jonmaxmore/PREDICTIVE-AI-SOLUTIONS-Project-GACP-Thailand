# Production Infrastructure Standard

Last updated: 2026-03-08

## Purpose

This document defines:

- the approved single-host production baseline for this repository
- the enterprise target architecture for business-critical deployments
- the minimum controls required so production infrastructure is validated instead of guessed

## 1. Approved baseline for the current repository

The current approved production baseline is a hardened single-host deployment:

1. DigitalOcean Cloud Firewall (`gacp-production`) sits at the network edge — allows only ports 80, 443 (all sources) and port 2222 (operator IP only). All other inbound is denied.
2. Host nginx owns public `:80/:443` and terminates TLS.
3. Host nginx proxies to Docker nginx on `127.0.0.1:8080`.
4. Docker nginx routes `/` to `frontend:3000` and `/api/*` to `backend:8000`.
5. `frontend`, `backend`, `postgres`, and `redis` remain internal-only.
6. MinIO and monitoring ports are loopback-only where host access is required.

SSH access to the host uses port 2222. This is the only approved remote access method.

This baseline is acceptable when:

- the system runs on one host by design
- brief maintenance windows are tolerated
- a full host failure is not required to fail over automatically
- backups and restore drills are in place

This baseline is not the highest-availability standard.
The current runtime provider is DigitalOcean, but the target architecture is provider-neutral.

## 2. Non-compliant patterns

The following are not allowed in production:

- operating without a cloud-level firewall (DigitalOcean Cloud Firewall is required)
- opening SSH (port 22 or 2222) to all sources — must be restricted to operator IP only
- publishing `frontend:3000` or `backend:8000` directly to the internet
- publishing Postgres or Redis publicly
- bypassing the approved ingress chain for convenience
- relying on undocumented manual host changes as the deployment source of truth
- making release decisions from stale diagrams or scripts

## 3. Enterprise target architecture

For a business-critical system where infrastructure mistakes are unacceptable, the preferred target is:

1. Managed edge:
   managed load balancer plus WAF/CDN at the public boundary
2. Stateless application tier:
   multiple app replicas across at least two failure domains
3. Managed stateful services:
   HA PostgreSQL, HA Redis, and external object storage
4. Declarative operations:
   infrastructure as code, immutable deploys, rollout policy, and rollback automation
5. Verified recovery:
   tested backup, restore, and failover procedures with recorded evidence
6. Centralized observability:
   logs, metrics, traces, alerting, and SLO reporting

## 4. Required controls

Every production path must have these controls:

- topology validation in CI and before deploy
- infrastructure contract validation in CI and before deploy
- environment validation before `docker compose up`
- explicit release records with commit SHA and backup ID
- health checks after deploy
- rollback instructions that match the deployed topology

## 5. Migration path from current state

Phase 1: Harden the current single-host deployment

- keep the two-layer nginx topology accurate in docs and scripts
- block production drift in CI
- keep all non-edge services internal-only

Phase 2: Remove host-level single points of failure

- move public ingress to a managed edge load balancer/WAF
- run multiple application replicas
- move Postgres and Redis to managed HA services

Phase 3: Add proven resilience

- automated rollouts with health-based rollback
- restore drills on a schedule
- failover testing and SLO review

## 6. Canonical references

- `docs/adr/ADR-013-platform-neutral-production-strategy.md`
- `docs/infrastructure-migration-blueprint.md`
- `docs/provider-evaluation-playbook.md`
- `docs/provider-evaluation-scorecard.csv`
- `docker-compose.production.yml`
- `deploy/nginx/gacp-platform.conf`
- `nginx/gacp.production.conf`
- `docs/network-diagram.md`
- `docs/standards/production-operability-standard.md`
- `scripts/ci/check-production-topology.js`
- `infra/README.md`
- `infra/contracts/service-contracts.json`
- `infra/environments/production/current-baseline.json`
- `infra/environments/production/target-platform-neutral.json`
- `infra/providers/provider-map.json`
- `scripts/ci/check-infra-contracts.js`
