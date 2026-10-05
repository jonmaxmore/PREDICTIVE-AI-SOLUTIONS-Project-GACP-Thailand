# Infrastructure Source of Truth

Last updated: 2026-03-08

This directory is the canonical, provider-neutral source of truth for infrastructure planning in this repository.

Current state:

- runtime provider: DigitalOcean
- approved production baseline: `DO Cloud Firewall -> host nginx -> docker nginx -> frontend/backend`
- SSH access: port 2222 (port 22 restricted to operator IP at cloud firewall level)
- cloud firewall: `gacp-production` — allows 80/443 (all), 22/2222 (operator IP only)
- future target: provider-neutral enterprise architecture
- provider decision status: evaluated, not yet selected for the future HA target

## Rules

- Keep application contracts provider-neutral.
- Do not add provider-specific `infra/live/*` implementations until the provider decision is signed off.
- Update the environment manifests and provider map whenever production topology or provider ranking changes.
- Run the infrastructure checks before deploy or merge.

## Commands

```bash
node scripts/ci/check-infra-contracts.js
node scripts/ci/check-production-topology.js
npm run score:provider-evaluation
```

## Directory layout

```text
infra/
  contracts/      provider-neutral service contracts
  environments/   current and target manifests per environment
  live/           provider-specific IaC only after provider selection
  modules/        module boundaries and expected inputs/outputs
  providers/      current provider map and capability aliases
```

## Canonical files

- `infra/contracts/service-contracts.json`
- `infra/environments/production/current-baseline.json`
- `infra/environments/production/target-platform-neutral.json`
- `infra/providers/provider-map.json`
- `docs/deployment/provider-evaluation-scorecard.csv`
- `docs/deployment/provider-evaluation-evidence-2026-03-08.md`
- `docs/standards/production-infrastructure-standard.md`
- `docs/infrastructure-migration-blueprint.md`
