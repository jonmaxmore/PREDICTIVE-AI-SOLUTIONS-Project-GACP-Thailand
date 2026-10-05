> **SUPERSEDED (2026-08-19) — §2's ThaID login row and all of §4.3 were never built.**
> This document assumed a dedicated OIDC-style backend redirect target,
> `GET /api/auth/thaid/callback?code=...`, that would set `auth_token` directly
> and normalize a `thaid_response.role` field on the token. Neither exists.
> What actually shipped is the generic IdP flow, one pair of routes shared by
> every provider: `POST /api/auth/idp/:provider/authorize-url` +
> `POST /api/auth/idp/:provider/callback` (`apps/backend/routes/api/auth/auth-idp.js`),
> fronted by the Next.js page `apps/web-app/src/app/auth/callback/[provider]/page.tsx`
> (route `/auth/callback/thaid`), which POSTs `{code, state}` to the backend
> callback and handles the JSON response (success / `mfaRequired` / catalog
> error) client-side — there is no backend-issued redirect and no
> `GET .../callback` route. ThaID never returns a `role` field at all; the
> resolved role comes from `thaid-identity-service.js`'s own citizen-only
> linking/auto-provision policy, not from normalizing an IdP-supplied string.
> The rest of this document (canonical roles §4.1-4.2, permissions, non-ThaID
> login/refresh/logout, redirect allowlist) is still current — only the ThaID
> route shape in §2's login table and all of §4.3 are stale. Current design
> record: design note 2026-08-19-thaid-sandbox-readiness-design.
> The body below is left unmodified for history.

# Canonical Auth, Session, and RBAC Contract

- Status: Proposed canonical contract (T-001 deliverable)
- Last Updated: 2026-05-04
- Owners: Security / Architecture review (proposers); Backend, Frontend, Database, QA (reviewers)
- Supersedes / consolidates:
  - `docs/architecture/auth-role-boundary-matrix.md` (current-state inventory; descriptive)
  - `docs/architecture/canonical-permission-matrix.md` (permission table)
  - `docs/architecture/rbac-and-task-ownership.md` (per-role workflow ownership)
  - `docs/api/api-path-identity-policy.md` (path / identity rule)
  - `apps/backend/shared/canonical-rbac.js` (code source-of-truth for roles, aliases, permissions, role-groups)
- Related ADRs: ADR-009 (executable security conventions), ADR-014 (multi-tenancy foundation)

## Purpose

Freeze a single, signed-off contract for **how identity, sessions, redirects, and roles flow through the platform** — so future fixes don't recreate session/RBAC drift after every patch.

This document is **prescriptive**. Anything that contradicts it is a bug.

## Audience

Engineers touching auth middleware, route mounting, frontend layout / middleware / session reads, or BFF proxy behavior.

---

## 1. Canonical session artifacts

The platform uses **two cookie-based sessions** + **one short-lived MFA challenge token**. Everything else is legacy or auxiliary.

| Artifact | Type | Lifetime | Set by | Read by | Audience |
|---|---|---|---|---|---|
| `auth_token` | httpOnly cookie | access TTL (15 min) | backend `auth-health` controllers + Next session-cookie route | web middleware, generic API proxy, backend `authenticateHealth` | health users |
| `provider_token` | httpOnly cookie | access TTL (15 min) | backend `auth-provider` route + Next session-cookie route | web middleware, generic API proxy, backend `authenticateProvider` | provider users (admin, scheduler, document_reviewer, auditor, account) |
| `refresh_token` | httpOnly cookie | refresh TTL (7 days) | backend health auth handlers; **provider refresh path is canonical or removed (T-002)** | backend refresh/logout handlers | both |
| `csrf_token` | non-httpOnly cookie + `x-csrf-token` request header | same as auth | backend health auth handlers | backend Express CSRF check | health (today); provider CSRF is added or its absence justified (T-002) |
| `mfa_session` | signed JWT (purpose=`mfa_challenge`) | 5 min | backend on first-factor success | backend `/api/mfa/verify` | provider + public |

### Deprecated and prohibited (Phase 1 inventory)

The following artifacts SHALL NOT be added to new code; existing usages are scheduled for removal:

- `localStorage["accessToken"]`, `localStorage["refreshToken"]`, `localStorage["user"]`
- `localStorage["provider_token"]`, `localStorage["provider_user"]`
- Any plaintext bearer token persisted in the browser

The web auth service (`apps/web-app/src/lib/services/auth-service.ts`) is the only file allowed to touch these keys, and only for read-fallback during the migration window. Direct page-level reads are an audit finding.

### Mobile artifacts

The Flutter app currently uses two parallel token storage names (`auth_token` vs `jwt_token` + `refresh_token`) under different code paths. The canonical mobile contract picks **one** — `auth_token` (access) + `refresh_token` (refresh). The duplicate `ApiService` path is converged or removed (mobile workstream).

---

## 2. Login, refresh, logout

### Login (canonical)

| Caller | Endpoint | Body | Server actions on success |
|---|---|---|---|
| Health portal | `POST /api/auth/health/login` | `{ healthId, password }` | sets `auth_token` + `refresh_token` + `csrf_token` httpOnly cookies; returns `{ success: true, user, csrfToken }` |
| Provider portal | `POST /api/auth/provider/login` | `{ providerId, password }` | sets `provider_token` httpOnly cookie; returns `{ success: true, user }` (CSRF parity is T-002) |
| ThaID OIDC | `GET /api/auth/thaid/callback?code=...` | n/a (OIDC) | sets `auth_token` + writes role to canonical (`health` for citizens — see §4.3); never emits a non-canonical role value |

### Refresh

- Health: `POST /api/auth/health/refresh` reads `refresh_token` cookie, rotates `auth_token`. CSRF guard required.
- Provider: T-002 picks one of (a) implement canonical refresh, (b) remove the broken refresh client. **Until then, no production caller should depend on provider refresh.**

### Logout

- Both: `POST /api/auth/{health,provider}/logout` clears all session cookies + revokes refresh-token rows for the user (DB sweep).
- Web auth-service `logout()` ALSO clears the deprecated localStorage keys (one-line cleanup that prevents zombie sessions on the same device).

---

## 3. Redirect rules

### Allowlist behavior

`?redirect=` query parameters on auth pages are honored only if the value matches:

```
^/(health|provider|admin)(/[^?#]*)?$
```

Any value outside the allowlist redirects to the role's default landing:

| Role | Default landing |
|---|---|
| `health` | `/health/dashboard` |
| `admin` | `/admin/dashboard` |
| `auditor`, `scheduler`, `document_reviewer`, `account` | `/provider/dashboard` |
| anonymous | `/` |

**Open redirect = security finding.** Both the health and provider login pages, the ThaID callback, and the logout flow MUST enforce this allowlist on the server side. Client-side defenses are not sufficient.

### Canonical login routes

`/login` is **not** a canonical entry point. The canonical entry routes are:

- `/auth/health-login` (Thai citizen / applicant)
- `/auth/provider-login` (gov officer)
- `/auth/thaid/callback` (ThaID OIDC return)

Any code that redirects to bare `/login` is a bug.

---

## 4. Canonical role dictionary

### 4.1 Roles

| Canonical name (lowercase) | Constant | Audience | Notes |
|---|---|---|---|
| `admin` | `CANONICAL_ROLES.ADMIN` | Provider | Privileged config + override actions |
| `scheduler` | `CANONICAL_ROLES.SCHEDULER` | Provider | Assigns reviewers + audit dates |
| `document_reviewer` | `CANONICAL_ROLES.DOCUMENT_REVIEWER` | Provider | Reviews application documents |
| `auditor` | `CANONICAL_ROLES.AUDITOR` | Provider | Conducts inspection; consolidated successor of `head_auditor`, `final_approver`, `approver` |
| `account` | `CANONICAL_ROLES.ACCOUNT` | Provider | Finance + invoice surface |
| `health` | `CANONICAL_ROLES.HEALTH` | Citizen / Applicant | Submits applications |
| `system` | `CANONICAL_ROLES.SYSTEM` | Non-human | Webhooks + cron; no permissions in `ROLE_PERMISSIONS`; only allowed in explicit `ROLE_TRANSITIONS` entries |

### 4.2 Aliases (read-only, for legacy data)

These aliases are accepted by `normalizeRole()` for backward compatibility with old DB rows and ThaID return values. **No new code may emit them.**

| Alias | Resolves to |
|---|---|
| `super_admin` | `admin` |
| `reviewer`, `reviewer_auditor`, `document_reviewer` | `document_reviewer` |
| `head_auditor`, `inspector`, `audit`, `approver`, `final_approver` | `auditor` |
| `accountant`, `finance` | `account` |
| `Applicant` (proper case) | `health` |
| `webhook`, `cron` | `system` |

### 4.3 ThaID role normalization

ThaID's OIDC token does not carry a canonical GACP role. The callback handler MUST normalize as follows:

```
thaid_response.role === "Applicant"  → canonical "health"
thaid_response.role === undefined    → canonical "health"   (default for citizen IDP)
thaid_response.role === <other>      → reject; log; do not issue auth_token
```

Emitting `Applicant` (proper case) into the User row was a pre-canonical bug. Backfill is a database-track task; new writes use lowercase canonical only.

### 4.4 Role groups (defined in `canonical-rbac.js`)

| Group | Members | Use |
|---|---|---|
| `ALL_PROVIDER` | admin, document_reviewer, auditor, scheduler, account | Any authenticated provider page |
| `FULL_STAFF` | (alias used in routes; same set as ALL_PROVIDER) | Analytics / dashboard read access |
| `ADMIN_ONLY` | admin | `/api/admin/*` mutations |
| `REVIEWERS` | admin, document_reviewer, auditor | Document review actions |
| `AUDIT_STAFF` | admin, document_reviewer, auditor, scheduler | Audit lifecycle reads |
| `FINANCE` | admin, account | Invoice + payment-slip mutations |

Aliases listed in §4.2 are also accepted in role-group checks during the deprecation window.

---

## 5. Route protection matrix

### 5.1 Web routes (Next middleware)

| Path prefix | Auth required | Role rule | Canonical artifact | On failure |
|---|---|---|---|---|
| `/` | none | n/a | n/a | render |
| `/auth/*` (login, register, ThaID return, etc.) | none | n/a | n/a | render |
| `/health/*` | yes | role = `health` | `auth_token` cookie present + role canonical | redirect to `/auth/health-login?redirect=<sanitized>` |
| `/provider/*` | yes | role ∈ `ALL_PROVIDER` | `provider_token` cookie | redirect to `/auth/provider-login?redirect=<sanitized>` |
| `/admin/*` | yes | role = `admin` | `provider_token` cookie + role canonical | redirect to `/auth/provider-login?redirect=<sanitized>` |
| `/verify/*`, `/trace/*` | none (public traceability) | n/a | n/a | render |

The middleware **MUST** read role from the cookie's verified JWT claim, not from `localStorage`. Page-level `localStorage` re-checks for visibility are anti-patterns and surface as audit findings.

### 5.2 Backend route families (Express middleware)

| Mount point | Auth middleware | Role gate (canonical permissions or groups) |
|---|---|---|
| `/api/auth/health/*` | (none — entry) | n/a |
| `/api/auth/provider/*` | (none — entry) | n/a |
| `/api/applications/*` | `authenticateHealth` (health-side) / `authenticateProvider` (provider-side) | per-handler permission check |
| `/api/payments/*` | `authenticateAny` | per-handler |
| `/api/certificates/*` | `authenticateAny` | per-handler; **certificate download is gated to owner OR `ALL_PROVIDER`** (T-002 closes the looser path) |
| `/api/identity/*` | `authenticateProvider` | `ADMIN_ONLY` (per-handler reaffirmation; identity review is admin-only) |
| `/api/criteria/*` | `authenticateProvider` | mutations require `ADMIN_ONLY`; reads allow `ALL_PROVIDER` |
| `/api/audits/*` | `authenticateProvider` | `AUDIT_STAFF`; reassignment requires `ADMIN_ONLY` |
| `/api/admin/*` | `authenticateProvider` + `requireAdmin` | hard `ADMIN_ONLY` at every level (no per-submodule looseness) |
| `/api/provider/*` | `authenticateProvider` | per-handler |
| `/api/analytics/*` | `authenticateAny` | `FULL_STAFF` for cross-tenant aggregation; per-tenant reads honor org context |
| `/api/sync/*` | callback signature verification (no user session) | n/a (system actor only) |
| `/api/cron/*` | `CRON_SECRET` header | n/a |
| `/api/webhooks/*` | callback signature verification | n/a |
| `/api/trace/*`, `/api/lots/*`, `/api/verify/*` | none (public) | n/a |
| `/api/mfa/verify` | signed `mfa_session` JWT (NOT plaintext userId — see PR #2.13) | n/a |

**Anti-patterns the contract bans:**

- Mounting any privileged route family without `authenticateProvider` and a canonical role/permission check.
- Trusting `req.body.userId` / `req.query.userId` for actor identity when a token claim already says who the actor is.
- Letting `/api/admin/*` submodules omit `requireAdmin` on the assumption the parent mount applies it. Each submodule re-applies.
- Returning role-laden user data on a public endpoint.

### 5.3 BFF proxy (`/api/[...path]`)

The Next BFF proxy at `apps/web-app/src/app/api/[...path]/route.ts` forwards both health and provider identities. Canonical rules:

- Auth precedence: explicit `Authorization: Bearer …` request header > `auth_token` cookie > `provider_token` cookie. Once a precedence is picked for a request, the others are dropped before forwarding.
- Headers passed through: `Authorization`, `Cookie` (rewritten to drop dropped artifacts), `Content-Type`, `Accept`, `Accept-Language`, `x-csrf-token`, `x-request-id`, `x-correlation-id`.
- Cookies passed back: `Set-Cookie` from backend is forwarded verbatim. Web frontend MUST NOT add additional cookies.
- Query strings preserved verbatim (no rewriting; T-004 hardens this).
- Body: streamed for binary; JSON-parsed only when proxy needs to modify.
- Response: file downloads preserve `Content-Disposition`; `Content-Type` is forwarded.
- The `/api/proxy/*` namespace is documented as deprecated; its consumers are inventoried (V-001) and removed.

---

## 6. Definition of Done for T-001

This contract is signed off when:

1. ✅ Canonical session artifacts named (§1)
2. ✅ Login / refresh / logout flow described (§2)
3. ✅ Redirect allowlist rule defined (§3)
4. ✅ Role dictionary + alias map + ThaID normalization frozen (§4)
5. ✅ Backend route mount → role gate matrix populated (§5)
6. ✅ Deprecated artifacts explicitly listed (§1 deprecated table)
7. ⏳ Sign-off recorded by Backend, Frontend, Security/Architecture, Database, QA reviewers (PR review)

Once §7 lands, downstream tasks T-002 (backend guard tightening), T-003 (frontend route + nav alignment), T-004 (BFF normalization), and T-005 (workflow status) execute against this contract.

## Out of scope for this document

- **Implementation diff** — this is the contract; how to migrate each existing site to comply is T-002/T-003/T-004 territory.
- **Audit-log policy** — owned by ADR-012 + the audit-integrity-hardening backlog.
- **Tenancy / org-id resolution mechanics** — owned by ADR-014 (multi-tenancy foundation).
- **Workflow state dictionary** — owned by T-005, separate canonical doc to be produced.

## Validation checklist for reviewers

- [ ] Each `/api/*` route family in `apps/backend/routes/api/index.js` is mapped in §5.2
- [ ] Each web route prefix in `apps/web-app/src/middleware.ts` is mapped in §5.1
- [ ] Every role used in any backend `requireRole` / `requireCanonicalPermission` call appears in §4.1 or §4.2
- [ ] No production code path emits an alias from §4.2 (legacy reads only)
- [ ] No web page reads `localStorage["accessToken"]` / `localStorage["provider_token"]` directly (only via `auth-service.ts`)
- [ ] No backend route handler trusts `req.body.userId` / `req.query.userId` as actor identity
