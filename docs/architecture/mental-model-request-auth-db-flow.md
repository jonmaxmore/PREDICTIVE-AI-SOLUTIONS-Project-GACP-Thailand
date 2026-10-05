# Request/Auth/DB Mental Model (Reviewer Reference)

Last updated: 2026-02-22

Purpose: give reviewers and maintainers a stable model for how requests move through the system, how auth decisions are made, and where DB queries are executed.

## 1) Request Flow (Backend)

Primary entrypoint:
- `apps/backend/server.js`

Request pipeline (high level):
1. Request ID middleware (`req.id`)
2. Hardened client IP attachment (`attachClientIp`)
3. Service availability guard
4. Security middleware (`helmet`, `cors`, global rate limit)
5. CSRF guard for cookie-auth state-changing requests
6. Route dispatch at `/api` (`apps/backend/routes/api/index.js`)
7. Controller -> service -> Prisma query
8. Structured success/error response

Core rule:
- Security-sensitive IP usage must go through `apps/backend/utils/client-ip.js` (`getRequestIp`), not raw `req.ip`.

## 2) Authentication Flow

Canonical route split:
- Health auth: `/api/auth/health/*` (`apps/backend/routes/api/auth-health.js`)
- Provider auth: `/api/auth/provider/*` (`apps/backend/routes/api/auth-provider.js`)

Health login (`/api/auth/health/login`) flow:
1. Controller validates credentials
2. Service verifies identity/password
3. Access token + refresh token issued
4. Cookies set (`auth_token`, optional `refresh_token`, `csrf_token`)
5. Audit event writes requester IP and agent

Provider login (`/api/auth/provider/login`) flow:
1. Validate `providerId` format and provider identity constraints
2. Verify password and role/account type
3. Issue provider JWT and set `provider_token` cookie

CSRF boundary:
- If `auth_token` cookie exists on non-safe methods, `x-csrf-token` must match `csrf_token` cookie.

## 3) Database Query Flow

Database access entry:
- `apps/backend/services/prisma-database.js` (Prisma client)

Typical stack:
- Route -> Controller (`apps/backend/controllers/*`) -> Service (`apps/backend/services/*`) -> Prisma model operations

What to check in reviews:
- Query scope: ensure user/role boundaries are included in `where`.
- Identity separation: `healthId` and `providerId` are not mixed.
- Offline sync safety: version/optimistic lock is respected where required.
- Heavy jobs: expensive work should be queued, not block request thread.

## 4) What "Does Not Make Sense" (Fast Detection Checklist)

Reject/flag when any of these appear:
- Route mismatch: provider identity used in health route, or vice versa.
- Dangerous auto-linking path without explicit feature flag.
- Security randomness using `Math.random` for secrets/codes.
- Rate limit/audit using raw `req.ip` directly.
- State-changing cookie-auth route with missing CSRF guard.
- Background-job logic moved into synchronous request path.

## 5) Minimum Review Process (Before Running Fixes)

1. Read target route + controller + service first.
2. Identify identity type, auth boundary, and DB write path.
3. Confirm error mapping and audit metadata behavior.
4. Add/adjust tests for changed behavior.
5. Run preview gates before deploy promotion.

## 6) Source Pointers

- Backend request bootstrap: `apps/backend/server.js`
- API route map: `apps/backend/routes/api/index.js`
- Auth controller: `apps/backend/controllers/auth-controller.js`
- Auth service: `apps/backend/services/prisma-auth-service.js`
- Auth middleware: `apps/backend/middleware/auth-middleware.js`
- Hardened IP utility: `apps/backend/utils/client-ip.js`
- ADRs: `docs/adr/README.md`
