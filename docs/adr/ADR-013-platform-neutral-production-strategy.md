# ADR-013: Platform-Neutral Production Strategy with DigitalOcean as Current Baseline

- Status: Accepted
- Date: 2026-03-08
- Deciders: Platform / Release / Application owners
- Supersedes: None
- Related:
  - `docs/standards/production-infrastructure-standard.md`
  - `docs/standards/production-operability-standard.md`
  - `docs/network-diagram.md`
  - `docs/infrastructure-migration-blueprint.md`
  - `docs/provider-evaluation-playbook.md`

## Context

The current production environment runs on a single DigitalOcean host with:

- host nginx at the public edge
- Docker nginx as the internal router
- frontend, backend, Postgres, Redis, and MinIO on the same deployment boundary

This is an acceptable hardened baseline for the current phase, but it is not the preferred long-term topology for a business-critical system.

At the same time, the team does not want to lock future architecture to a single cloud vendor.

## Decision

We will treat DigitalOcean as the **current runtime provider**, but not as the **long-term architecture boundary**.

The architecture standard is now split into two layers:

1. **Current baseline**
   single-host DigitalOcean deployment that must remain internally consistent, validated, and auditable
2. **Future target**
   provider-neutral architecture requirements based on capabilities, not brand names

## Required provider-neutral capabilities

Any future target platform must support the following capabilities before migration approval:

- managed public ingress or equivalent edge control
- WAF/CDN support or an explicit compensating control
- multi-instance application deployment across at least two failure domains
- managed PostgreSQL high availability
- managed Redis high availability
- external object storage
- centralized logs, metrics, and alerting
- infrastructure as code
- controlled rollout and rollback path

Provider comparison must be recorded through the provider evaluation pack:

- `docs/provider-evaluation-playbook.md`
- `docs/provider-evaluation-scorecard.csv`
- `docs/provider-decision-record-template.md`

## Consequences

### Positive

- production docs no longer imply DigitalOcean is the only acceptable future
- migration planning can be evaluated on objective capability gaps
- release and reliability standards remain valid during and after provider migration

### Negative

- some provider-specific optimizations may be delayed until a platform decision is explicit
- single-host constraints remain until the target platform migration is funded and executed

## Non-goals

This ADR does not choose the next provider.

This ADR also does not claim the current DigitalOcean deployment is highly available.
It defines the policy that the future state must be portable by architecture and validated by capability.
