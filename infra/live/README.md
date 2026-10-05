# Live Infrastructure Implementations

Last updated: 2026-03-08

This directory stays empty until the future target provider is formally selected.

When a provider decision is approved:

1. update `docs/provider-decision-record-template.md`
2. update `infra/providers/provider-map.json`
3. add provider-specific IaC under `infra/live/<provider>/<environment>/`
4. keep the provider-neutral contracts and environment manifests unchanged unless the architecture itself changes
