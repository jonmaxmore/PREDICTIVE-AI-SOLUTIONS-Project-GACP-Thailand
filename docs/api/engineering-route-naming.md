# Route Naming Convention (Engineering Policy)

This policy is mandatory for all new API routes in this repository.

## Canonical URL rules

1. Use lowercase segments only.
2. Use kebab-case for multi-word segments (for example `workflow-transitions`).
3. Use resource nouns (prefer plural for collections).
4. Avoid verb-style action endpoints when a resource form is possible.
5. Keep path params semantic and consistent (`:applicationId`, `:providerId`, `:healthId`).

## Provider namespace

- Canonical namespace: `/api/provider/*`
- Auth namespace: `/api/auth/provider/*`

## Deprecation policy

- Default mode: hard cut to canonical path only.
- Avoid runtime fallback aliases for deprecated namespaces.
- Publish migration notes in release docs when breaking route changes occur.

## Examples

- Preferred: `/api/provider/applications/:applicationId/workflow-transitions`

## Enforcement

- Update route tests when introducing new provider endpoints.
- Run `node scripts/ci/check-orphan-api-routes.js` to ensure no unmounted route files remain.
- Register every new canonical endpoint in `docs/active-api-surface.md`.
