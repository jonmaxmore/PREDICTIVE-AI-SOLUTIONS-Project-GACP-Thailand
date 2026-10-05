# Module Boundaries

Last updated: 2026-03-08

These are the provider-neutral module boundaries for future IaC work.

## Required modules

- `edge`
  - inputs: public hostname, TLS policy, origin target, health-check policy
  - outputs: public URL, edge health endpoint, client IP forwarding contract
- `app-runtime`
  - inputs: container images, environment variables, replica counts, health checks
  - outputs: internal frontend endpoint, internal backend endpoint, deploy status
- `postgres`
  - inputs: database size class, backup policy, failover policy
  - outputs: connection secret reference, restore anchor metadata
- `redis`
  - inputs: cache tier, failover policy
  - outputs: connection secret reference
- `object-storage`
  - inputs: bucket names, retention policy, access policy
  - outputs: bucket endpoint, credentials secret reference
- `observability`
  - inputs: alert routes, log retention, SLO targets
  - outputs: dashboard URLs, alert policies, metrics workspace identifiers
- `dns`
  - inputs: zone, records, cutover TTL
  - outputs: active record set, rollback record set
- `secrets`
  - inputs: secret names, rotation rules, access policies
  - outputs: runtime secret references

## Guardrails

- Application code must never depend directly on these provider-native resource names.
- Provider-specific implementation lives under `infra/live/` only after the decision record is approved.
- Module outputs must preserve the contracts in `infra/contracts/service-contracts.json`.
