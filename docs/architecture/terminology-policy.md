# Terminology Policy (Canonical Identity and Routes)

This policy locks naming across backend, frontend, database, scripts, and documentation.

## 1) Canonical Identity Model

- Health user (applicant/operator):
  - `healthId`
  - auth namespace: `/auth/health/*`
  - UI namespace: `/health/*`
- Provider user (officer/provider):
  - `providerId`
  - auth namespace: `/auth/provider/*`
  - UI namespace: `/provider/*`

## 2) Canonical Runtime Keys

- Health auth cookie: `auth_token`
- Provider auth cookie: `provider_token`
- Refresh cookie: `refresh_token`
- Provider local storage: `provider_user`

## 3) Forbidden New Names (Do Not Add)

- identity fields: `ApplicantId`, `PROVIDERId`
- route namespaces: `/health/*`, `/provider/*`
- auth namespaces: `/auth/health/*`, `/auth/provider/*`, `/auth-health/*`, `/auth-dtam/*`
- runtime session keys: `PROVIDER_token`, `PROVIDER_user`

Legacy strings may exist only in:
- historical migrations
- legacy audit/change history docs (explicitly marked as historical context)

## 4) Mapping Rules

- `ApplicantId` -> `healthId`
- `PROVIDERId` -> `providerId`
- `/health/...` -> `/health/...`
- `/provider/...` -> `/provider/...`
- `/api/auth-health/...` -> `/api/auth/health/...`
- `/api/auth-dtam/...` -> `/api/auth/provider/...`
- `PROVIDER_token` -> `provider_token`
- `PROVIDER_user` -> `provider_user`

## 5) Review Gate (Required in PR Review)

Before merge, run:

```powershell
rg -n "\bApplicantId\b|\bPROVIDERId\b|/health/|/provider/|/api/auth/Applicant|/api/auth/provider|auth-Applicant|auth-dtam|PROVIDER_token|PROVIDER_user" apps docs scripts
```

Expected:
- no runtime hits in active code paths
- docs hits only when intentionally documenting legacy/deprecation context

## 6) API Contract Rule

New APIs must expose canonical names only:
- request/response identity fields: `healthId`, `providerId`
- no dual alias fields in public contracts

Backward compatibility, if required, must be:
- time-boxed
- documented with removal date
- removed after migration window

## 7) Ownership

- Backend owner: enforce identity fields and auth routes
- Frontend owner: enforce UI paths and session key names
- QA owner: enforce grep gate in regression/release checklist
- Docs owner: keep all examples and guides canonical
