# Provider Evaluation Playbook

Last updated: 2026-03-08

## Purpose

Use this playbook to evaluate cloud or hosting providers against the production standards in this repository.

This process is intentionally capability-driven:

- do not pick a provider based only on familiarity
- do not assume future portability without evidence
- do not advance to IaC implementation until the scorecard is complete

## Candidate providers

Evaluate at minimum:

- AWS
- GCP
- Azure
- DigitalOcean

Additional candidates may be added if they can satisfy the same scorecard.

## Inputs required

Before scoring, gather:

- target workload shape
- expected traffic growth
- data residency requirements
- monthly budget range
- availability SLO target
- RTO and RPO targets
- team operational familiarity

## Rating scale

Use a `1` to `5` scale for every criterion:

- `1` = inadequate
- `2` = weak / high operational risk
- `3` = acceptable with compensating controls
- `4` = strong fit
- `5` = excellent fit

Any criterion with a score below `min_score` is a blocker for that provider until explicitly waived.

## Scoring workflow

1. Fill `docs/provider-evaluation-scorecard.csv`
2. Run:
   `npm run score:provider-evaluation`
3. Review missing fields and blockers
4. Document final decision in `docs/provider-decision-record-template.md`
5. Update `infra/providers/provider-map.json` to reflect the approved decision status
6. If a provider is selected, create provider-specific IaC only after decision sign-off under `infra/live/<provider>/<environment>/`

## Evidence rules

- use official provider documentation for capability claims
- record architecture assumptions explicitly
- record any required third-party compensating controls
- record rollback implications if migration starts

## Minimum categories

The scorecard must include evidence for:

- edge and ingress
- compute and failure-domain support
- stateful data services
- observability and operations
- security and compliance controls
- delivery and migration fit
- cost and operating model

## Canonical references

- `docs/adr/ADR-013-platform-neutral-production-strategy.md`
- `docs/infrastructure-migration-blueprint.md`
- `docs/standards/production-infrastructure-standard.md`
- `docs/standards/production-operability-standard.md`
- `docs/provider-evaluation-scorecard.csv`
- `docs/provider-decision-record-template.md`
- `docs/provider-evaluation-evidence-2026-03-08.md`
- `infra/README.md`
- `infra/contracts/service-contracts.json`
- `infra/environments/production/current-baseline.json`
- `infra/environments/production/target-platform-neutral.json`
- `infra/providers/provider-map.json`
