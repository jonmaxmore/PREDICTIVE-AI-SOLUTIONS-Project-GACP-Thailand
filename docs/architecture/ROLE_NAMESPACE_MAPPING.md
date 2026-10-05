# Role Namespace Mapping

Canonical mapping used by this project:

- `Applicant = health`
- `provider = provider`

API namespace rules:

- Health/Applicant API: `/api/auth/health/*`, `/api/applications/*`
- Provider/provider API: `/api/auth/provider/*`, `/api/provider/*`

Removed namespaces:

- `/api/health/*` is not mounted.
- `/api/provider/*` is not mounted.

Reason:

- Keep one canonical namespace per user group to avoid workflow and permission confusion.
