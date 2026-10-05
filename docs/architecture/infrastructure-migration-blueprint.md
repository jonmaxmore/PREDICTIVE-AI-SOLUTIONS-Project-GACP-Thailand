# Infrastructure Migration Blueprint

Last updated: 2026-03-08

## Purpose

This document defines how to move from the current single-host DigitalOcean deployment
to a provider-neutral enterprise target without rewriting the application around one vendor.

## 1. Current state

- Runtime provider: DigitalOcean
- Topology: `host nginx -> docker nginx -> frontend/backend`
- State services: Postgres, Redis, MinIO on the same deployment boundary
- Risk profile:
  - single host failure is a full service outage
  - stateful services are not yet managed HA
  - deployment depends on host-level configuration

## 2. Target state

The target is capability-based, not provider-branded:

1. managed public edge
2. stateless app replicas across at least two failure domains
3. managed HA Postgres
4. managed HA Redis
5. external object storage
6. centralized observability
7. IaC-managed infrastructure and deploy path

## 3. Portability boundaries to preserve

These boundaries must remain stable during migration:

- app containers continue to read configuration from environment variables
- nginx routing rules remain canonical for `/`, `/api/*`, and health paths
- application logic does not import provider SDKs directly unless isolated behind adapters
- database remains PostgreSQL-compatible
- cache remains Redis-compatible
- object storage remains S3-compatible or has an adapter boundary

## 4. Migration phases

### Phase 1: Stabilize the current baseline

- keep topology docs and deploy scripts accurate
- keep non-edge services internal-only
- require topology validation before deploy
- define SLO, RTO, and RPO explicitly

### Phase 2: Externalize stateful dependencies

- move database to managed PostgreSQL
- move Redis to managed cache
- move uploads/artifacts to external object storage
- keep application runtime unchanged except configuration

### Phase 3: Separate edge from host

- move public ingress to a managed load balancer or equivalent
- retain nginx behavior either in a managed ingress layer or container ingress layer
- verify health checks and real client IP propagation

### Phase 4: Add failure-domain redundancy

- run multiple backend replicas
- run multiple frontend replicas
- place replicas across at least two failure domains
- verify rolling deploy and rollback behavior

### Phase 5: Full IaC and recovery validation

- define infrastructure in code
- preserve `infra/contracts/service-contracts.json` as the stable application boundary
- keep `infra/environments/production/*.json` aligned with the active and target topologies
- update `infra/providers/provider-map.json` only after decision evidence is approved
- automate deployment
- record restore drill evidence
- run planned failover and rollback tests

## 5. Provider evaluation matrix

Evaluate any candidate provider against these criteria:

| Capability | Required | Notes |
|-----------|----------|-------|
| Managed edge / load balancer | Yes | Must support TLS and health checks |
| WAF / CDN option | Yes | Native or explicit approved external control |
| Multi-zone deployment | Yes | At least two failure domains |
| Managed PostgreSQL HA | Yes | Automatic failover preferred |
| Managed Redis HA | Yes | Automatic failover preferred |
| Object storage | Yes | Prefer S3-compatible access pattern |
| Metrics / logs / alerting | Yes | Centralized, not host-only |
| IaC support | Yes | Terraform/Pulumi or equivalent |
| Rollback support | Yes | Image/deploy rollback must be explicit |
| Cost visibility | Yes | Must support predictable operating model |

## 6. Cutover checklist

Before a provider migration cutover:

- production topology validation still passes for the active environment
- release record includes old and new platform rollback points
- managed database restore has been tested
- DNS TTL reduction plan is approved
- certificate and secret migration plan is approved
- smoke tests are defined for old and new edges
- rollback route to the current environment is time-bounded and tested

## 7. What not to do

- do not migrate edge, compute, database, and storage in one untested step
- do not couple application code to provider-only features without an adapter
- do not claim high availability until failover has been tested
- do not remove the current environment before data consistency and rollback are verified

## 8. Canonical references

- `docs/adr/ADR-013-platform-neutral-production-strategy.md`
- `docs/standards/production-infrastructure-standard.md`
- `docs/standards/production-operability-standard.md`
- `docs/network-diagram.md`
- `docs/provider-evaluation-playbook.md`
- `docs/provider-evaluation-scorecard.csv`
- `docs/provider-decision-record-template.md`
- `docs/provider-evaluation-evidence-2026-03-08.md`
- `infra/README.md`
- `infra/contracts/service-contracts.json`
- `infra/environments/production/current-baseline.json`
- `infra/environments/production/target-platform-neutral.json`
- `infra/providers/provider-map.json`
