# API Path and Identity Naming Policy

Last updated: 2026-02-14

## Decision
Do not force URL paths to mirror identity field names.

Use this separation:
- Path = domain resource (`/applications`, `/invoices`, `/provider`, `/health`).
- Identity = authorization context from token/claims (`healthId`, `providerId`).

Canonical URL naming standard:
- lowercase path segments
- kebab-case for multi-word segments
- resource nouns (plural collections)
- avoid introducing new action-style verb endpoints

## Why
1. Stable paths reduce client breakage.
2. Identity model evolves independently from route naming.
3. OAuth/OpenID integration (future external government IDP) naturally carries identity in token claims/scopes.

## Rules
1. Never trust request query/body for actor ownership if token already provides identity.
2. Resolve health ownership by `healthId` from token.
3. Resolve provider actions by `providerId` from token.
4. Keep role checks at middleware and service layer.

## Migration Strategy if Path Rename is Required
Current policy:
1. Hard cut to canonical path only.
2. Do not keep long-lived fallback aliases in runtime.
3. Document successor endpoint in release notes and active API surface docs.

Provider identity fallback policy:
1. Canonical provider identity source is `User.providerId`.
2. Legacy `DTAMPROVIDER` resolution is disabled by default.
3. Emergency fallback only: set `ENABLE_DTAMPROVIDER_PROVIDER_FALLBACK=true`.

Canonical runtime map references:
- `docs/system-map.md`
- `docs/active-api-surface.md`

## Acceptance Criteria
- Same token identity returns same data regardless of compatibility alias path (when fallback enabled).
- No cross-tenant leakage when switching between aliases.
- Existing E2E scripts remain green.
