# Production Operability Standard

Last updated: 2026-03-08

## Purpose

This document defines the minimum operational evidence required before a production system can be described as reliable.

Infrastructure is not considered production-ready because it can start.
It is production-ready only when service objectives, recovery targets, and release evidence are explicit and repeatedly verified.

## 1. Minimum service objectives

Every production environment must define and review these targets:

- Availability SLO:
  monthly user-facing availability target for `/` and `/api/health`
- Error budget:
  allowed failure budget tied to the SLO
- Recovery Time Objective (RTO):
  maximum tolerated time to restore service after a failure
- Recovery Point Objective (RPO):
  maximum tolerated data loss after a failure

## 2. Required baseline targets for this repository

Until a stricter approved target replaces them, the minimum baseline is:

- Availability SLO: `99.5%` monthly for the public application edge
- RTO: `4 hours` for single-host recovery
- RPO: `24 hours` unless verified backups prove a smaller loss window

These are baseline values for the current single-host topology, not enterprise HA targets.

## 3. Enterprise target values

For business-critical production, the recommended target state is:

- Availability SLO: `99.9%` or better
- RTO: `60 minutes` or better
- RPO: `15 minutes` or better

Reaching this target requires:

- managed edge services
- multiple application replicas across at least two failure domains
- HA database and HA cache
- tested failover and restore procedures

## 4. Release evidence required every time

Before any production deploy, the release record must include:

- deployed commit SHA
- rollback SHA or image reference
- output of `node scripts/ci/check-production-topology.js`
- output of `docker compose --env-file .env.production -f docker-compose.production.yml config`
- backup identifier or file path
- restore drill reference
- smoke check results for `/nginx-health`, `/health`, and `/api/health`

## 5. Alerting minimums

At minimum, alerts must exist for:

- public edge unavailable
- `/api/health` failing
- container restart loops
- database backup failure
- disk pressure on the production host
- certificate expiry window

## 6. Ownership

Production ownership must be explicit:

- Release operator:
  person who executes the deploy
- Approver:
  person who authorizes the deploy window
- On-call owner:
  person responsible for post-deploy incident response

## 7. Canonical references

- `docs/adr/ADR-013-platform-neutral-production-strategy.md`
- `docs/infrastructure-migration-blueprint.md`
- `docs/standards/production-infrastructure-standard.md`
- `docs/preview-deploy-runbook.md`
- `docs/preview-deploy-release-record-template.md`
- `docs/preview-deploy-restore-drill-record-template.md`
