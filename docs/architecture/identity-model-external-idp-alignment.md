# Identity Model Alignment (External Government IDP Style)

Last updated: 2026-02-26

## Scope
This document defines identity alignment for GACP Certification Application:
- Health identity uses `healthId` only.
- Provider identity uses `providerId` only.
- Legacy `healthId` / `providerId` business identity fields are removed from active runtime flows.

## Current Implementation Status
### Database and Prisma
- Active schema uses `healthId` and `providerId` on `User`.
- `applications` and `invoices` use `healthId` as owner reference.
- Identity guardrails enforce no dual identity (`healthId` + `providerId`) per account.

### Active Runtime Code
- Backend routes/services/middleware/frontend runtime no longer reference deprecated legacy identity fields.
- JWT and auth flow resolve actor from canonical identity (`healthId` for health, `providerId` for provider).

### Remaining Legacy References
Some old scripts/docs/migrations still contain historical `healthId`/`providerId` tokens.
These are not in active runtime request paths and should be cleaned in a separate low-risk cleanup PR.

## External Government IDP Compatibility Notes
Based on public government identity guidance:
- Government digital identity should be treated as proofing and authentication, not business-domain ownership.
- Provider onboarding and digital-signature workflow should remain claim-driven and auditable.
- Integration readiness should keep identity in claims/payload, not encoded in URL path names.

References:
- https://bdh.moph.go.th/site/guideline_id/

## Recommended Next Steps
1. Keep identity canonical in token claims and DB fields (`healthId`, `providerId`).
2. Avoid embedding identity type in resource URL naming as a hard requirement.
3. Add API versioning for any public contract rename (`/api/v2`) with compatibility alias period.
4. Clean legacy scripts/docs references in a dedicated refactor PR with explicit regression checks.

