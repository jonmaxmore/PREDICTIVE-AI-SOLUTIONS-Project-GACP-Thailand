# AUTH_ROLE_BOUNDARY_MATRIX

Last updated: 2026-03-06

This document is a Phase 1.10 runtime map of authentication and role boundaries.
It records which artifacts, guards, and role checks are active across web, mobile, and backend layers.
It is not a target-state design and does not propose remediation.

## Scope

- Backend auth and role middleware: `apps/backend/middleware/auth-middleware.js`, `apps/backend/middleware/role-middleware.js`
- Backend canonical role model: `apps/backend/shared/canonical-rbac.js`
- Backend auth entry routes: `apps/backend/routes/api/auth-health.js`, `apps/backend/routes/api/auth-provider.js`
- Backend protected families: `apps/backend/routes/api/applications.js`, `apps/backend/routes/api/payments.js`, `apps/backend/routes/api/certificates.js`, `apps/backend/routes/api/identity.js`, `apps/backend/routes/api/trace.js`, `apps/backend/routes/api/sync.js`, `apps/backend/routes/api/admin/*`, `apps/backend/routes/api/provider/*`, `apps/backend/routes/api/interoperability.js`
- Backend role-heavy route families using generic auth alias: `apps/backend/routes/api/analytics.js`, `apps/backend/routes/api/fraud-detection.js`, `apps/backend/routes/api/farm-audit.js`, `apps/backend/routes/api/lab-integration.js`, `apps/backend/routes/api/notifications.js`
- Web route guard and session transport: `apps/web-app/src/middleware.ts`, `apps/web-app/src/lib/services/auth-service.ts`, `apps/web-app/src/app/api/[...path]/route.ts`, `apps/web-app/src/app/api/session/set-cookie/route.ts`
- Mobile auth transport: `apps/mobile-app/lib/core/config/api_config.dart`, `apps/mobile-app/lib/core/network/dio_client.dart`, `apps/mobile-app/lib/core/services/api_service.dart`

## Boundary terms used in this inventory

- `identity artifact`: cookie, storage key, or bearer token used to represent identity
- `identity gate`: code path that decides whether a request is authenticated
- `role gate`: code path that decides whether an authenticated identity can enter a namespace or action
- `client gate`: UI or route-level guard before backend enforcement
- `mixed`: namespace contains more than one identity or role boundary in the same family

## Auth artifact inventory

| Artifact | Produced by | Read by | Primary layer | Evidence | Initial signals |
| --- | --- | --- | --- | --- | --- |
| `auth_token` cookie | backend health auth handlers, web auth service, Next session cookie route | web middleware, generic API proxy, backend `authenticateHealth` | web + backend | `apps/backend/controllers/auth-controller.js`, `apps/web-app/src/middleware.ts`, `apps/web-app/src/app/api/[...path]/route.ts`, `apps/backend/middleware/auth-middleware.js` | Health identity is represented as both backend-set httpOnly cookie and frontend-written cookie depending on path |
| `provider_token` cookie | backend provider auth route, web auth service, Next session cookie route | web middleware, generic API proxy, backend `authenticateProvider` | web + backend | `apps/backend/routes/api/auth-provider.js`, `apps/web-app/src/middleware.ts`, `apps/web-app/src/lib/services/auth-service.ts`, `apps/backend/middleware/auth-middleware.js` | Provider identity also exists as both backend cookie and frontend-synced cookie |
| `refresh_token` cookie | backend health auth handlers | backend refresh/logout handlers | backend | `apps/backend/controllers/auth-controller.js`, `apps/backend/controllers/auth-controller/auth-session-security-handlers.js` | Refresh cookie exists only on the health auth path in the inspected runtime |
| `csrf_token` cookie plus `x-csrf-token` header | backend health auth handlers | backend Express CSRF check | backend + browser client | `apps/backend/controllers/auth-controller.js`, `apps/backend/server.js`, `apps/web-app/src/lib/api/api-client.ts` | CSRF enforcement is tied to presence of `auth_token` cookie, not `provider_token` |
| localStorage `accessToken`, `refreshToken`, `user` | web auth service | web auth service and provider pages as fallback | web | `apps/web-app/src/lib/services/auth-service.types.ts`, `apps/web-app/src/lib/services/auth-service.ts` | Web session model persists tokens outside cookies as first-class runtime state |
| localStorage `provider_token`, `provider_user` | web auth service dual-write | many provider/admin pages | web | `apps/web-app/src/lib/services/auth-service.ts`, `apps/web-app/src/app/provider/*`, `apps/web-app/src/app/admin/*` | Provider UI still reads legacy per-role localStorage keys directly |
| mobile secure storage `auth_token` | Flutter `DioClient` flows | `DioClient` interceptor | mobile | `apps/mobile-app/lib/core/network/dio_client.dart` | One mobile client path stores bearer token under `auth_token` |
| mobile secure storage `jwt_token` and `refresh_token` | Flutter `ApiService` flows | `ApiService` interceptor and refresh flow | mobile | `apps/mobile-app/lib/core/services/api_service.dart` | A second mobile client path uses different token key names and a different refresh endpoint |
| `Authorization: Bearer <token>` header | web proxy callers, mobile clients, direct API consumers | backend auth middleware and provider `me` route | cross-layer | `apps/web-app/src/app/api/[...path]/route.ts`, `apps/backend/middleware/auth-middleware.js`, `apps/backend/routes/api/auth-provider.js` | Header precedence differs by auth type: provider prefers header first, health prefers cookie first |

## Client-side boundary matrix

| Surface | Client gate | Auth artifacts read / written | Role mapping source | Backend counterpart | Evidence | Initial signals |
| --- | --- | --- | --- | --- | --- | --- |
| `/health/*` web routes | Next middleware requires `auth_token` cookie presence | reads `auth_token`; auth service also writes `accessToken`, `refreshToken`, `user` | no route-level role normalization beyond "has health cookie" | health-auth backend families | `apps/web-app/src/middleware.ts`, `apps/web-app/src/lib/services/auth-service.ts` | Health route protection is cookie-presence based, not role-content based |
| `/provider/*` web routes | Next middleware requires `provider_token`; role rules for selected prefixes | reads `provider_token`; provider pages also read localStorage `provider_token` and `accessToken` | `providerRoleAlias` in web middleware | provider backend families | `apps/web-app/src/middleware.ts`, `apps/web-app/src/app/provider/*` | Client gate mixes cookie routing and localStorage bearer fetches in provider pages |
| `/admin/*` web routes | Next middleware requires provider token and `admin` canonicalized role | reads `provider_token`; admin pages also read localStorage `provider_token` directly | `providerRouteRoleRules` plus `providerRoleAlias` | `/api/admin/*` | `apps/web-app/src/middleware.ts`, `apps/web-app/src/app/admin/*` | Client-side admin gate is stricter than some backend submodules, because backend admin mount is not uniformly admin-only inside each file |
| generic web proxy `/api/[...path]` | no route block; forwards runtime auth artifacts | prefers incoming bearer, then `auth_token`, then `provider_token` | none | all backend `/api/*` families | `apps/web-app/src/app/api/[...path]/route.ts` | Proxy boundary is intentionally mixed-auth and can forward either health or provider identity through the same path |
| web auth session sync | auth service writes cookies and localStorage; Next session route mirrors cookie server-side | writes `auth_token` or `provider_token` plus localStorage keys | resolves cookie type from `user.providerId` or `authType` | web middleware and SSR/BFF paths | `apps/web-app/src/lib/services/auth-service.ts`, `apps/web-app/src/app/api/session/set-cookie/route.ts` | Session state is dual-written across browser storage, `document.cookie`, and Next server cookie sync |
| mobile `DioClient` path | no route-level gate; bearer token attached by interceptor | reads secure storage `auth_token` | none in client | backend `/api/*` under `ApiConfig.baseUrl` | `apps/mobile-app/lib/core/config/api_config.dart`, `apps/mobile-app/lib/core/network/dio_client.dart` | Mobile central config path uses one base URL and one token key |
| mobile `ApiService` path | no route-level gate; bearer token attached by interceptor | reads `jwt_token`, `refresh_token` | none in client | hardcoded host `https://api.dtam.go.th` and `/api/auth/refresh` refresh path | `apps/mobile-app/lib/core/services/api_service.dart` | Mobile still contains a second auth transport model with different base URL and token names |

## Backend namespace boundary matrix

| Namespace / family | Identity gate | Role / permission gate | Effective actors | Evidence | Initial signals |
| --- | --- | --- | --- | --- | --- |
| `/api/auth/health/*` | public entry; health login/callback set `auth_token`, `refresh_token`, `csrf_token` | health profile/session handlers after login | health applicant | `apps/backend/routes/api/auth-health.js`, `apps/backend/controllers/auth-controller.js` | Health auth is the only inspected path that clearly provisions refresh and CSRF cookies together |
| `/api/auth/provider/*` | public entry; provider login validates providerId, account status, accountType, and provider role before minting `provider_token` | PROVIDER-role validation inside login route; no refresh path shown in inspected file | provider provider | `apps/backend/routes/api/auth-provider.js`, `apps/backend/shared/canonical-rbac.js` | Provider auth is identity- and role-aware at login time, but session artifact is still just one bearer/cookie token |
| health-only data families: `/api/farms/*`, `/api/consent/*`, `/api/planting-cycles/*`, `/api/site-analyses/*`, `/api/training-records/*`, `/api/cultivation-logs/*`, `/api/gacp-scoring/*` | `authenticateHealth` | usually none beyond health identity | health applicant | `apps/backend/routes/api/farms.js`, `apps/backend/routes/api/consent.js`, `apps/backend/routes/api/planting-cycles.js`, `apps/backend/routes/api/site-analyses.js`, `apps/backend/routes/api/training-records.js`, `apps/backend/routes/api/cultivation-logs.js`, `apps/backend/routes/api/gacp-scoring.js` | These families are the clearest health-only boundary in backend runtime |
| `/api/applications/*` | mixed: mostly `authenticateHealth`, one inspected provider action uses `authenticateProvider` | route-specific; no single family-level role wrapper | health applicants plus selected provider actions | `apps/backend/routes/api/applications.js` | One namespace carries both draft/submit/self-service flows and at least one provider-side rejection action |
| `/api/payments/*` | mixed: health on create/phase1/status/url, provider on phase2 | route-specific by payment phase | health applicants and provider provider | `apps/backend/routes/api/payments.js` | Payment family uses actor boundary by phase rather than one auth model |
| `/api/certificates/*` | mixed: provider list, health self-detail, public download and verify | no uniform family role gate | provider, health, public | `apps/backend/routes/api/certificates.js` | Certificate family includes protected and public routes in the same file, including unauthenticated download |
| `/api/identity/*` | mixed: health for self verify/status, provider for pending/review endpoints | identity split by route intent | health applicants and provider provider | `apps/backend/routes/api/identity.js` | Identity verification is not isolated to one actor family |
| `/api/trace/*` | mixed: public trace/verify routes plus health-auth QR generation | route-specific; generation path checks owner after `authenticateHealth` | public and health applicants | `apps/backend/routes/api/trace.js`, `apps/backend/routes/api/trace-verification-routes.js` | Trace family is public-first but not purely public |
| `/trace/*` | public redirect only | none | public | `apps/backend/routes/public-trace.js`, `apps/backend/server.js` | Public trace has a second edge that just redirects into `/api/trace/*` |
| `/api/provider/*` | most inspected handlers start with `authenticateProvider` | `requireRole(PROVIDERRoles)`, `requireRole(adminRoles)`, or `requireCanonicalPermission(...)` | provider provider and provider admins | `apps/backend/routes/api/provider/index.js`, `apps/backend/routes/api/provider/handlers/shared.js`, `apps/backend/routes/api/provider/handlers/applications.js`, `apps/backend/routes/api/provider/handlers/admin.js` | Provider namespace uses both raw role arrays and canonical permission checks, depending on submodule |
| `/api/admin/*` | mount-level `authenticateProvider` | submodule-specific and inconsistent: `users` and `planting` add admin role checks, `config` and `plants` do not in-file | provider-authenticated users, with admin intent varying by submodule | `apps/backend/routes/api/admin/index.js`, `apps/backend/routes/api/admin/users.js`, `apps/backend/routes/api/admin/config.js`, `apps/backend/routes/api/admin/plants.js`, `apps/backend/routes/api/admin/planting.js` | Admin namespace is provider-authenticated at mount, but not every submodule re-checks admin role inside the file |
| `/api/interoperability/v1/*` | mostly public; revoke route uses provider auth | revoke path uses raw admin role check against `ADMIN` / `SUPER_ADMIN` | public trust consumers and admin provider | `apps/backend/routes/api/interoperability.js`, `apps/backend/routes/api/interoperability/interoperability-core.js` | Public trust export and admin revocation live in one namespace with different gate styles |
| `/api/sync/offline` | auth inferred from cookie presence or decoded bearer token shape | none beyond inferred identity type | health or provider identities | `apps/backend/routes/api/sync.js` | Sync entry does not bind to one auth middleware upfront; it dispatches by token/cookie heuristics |
| `/api/notifications/*` | `router.use(authenticate)` | `checkPermission('dashboard.view')` and `checkPermission('system.admin')` | "authenticated user" in route intent, but auth alias source is health auth | `apps/backend/routes/api/notifications.js`, `apps/backend/middleware/auth-middleware.js`, `apps/backend/services/security-compliance.js` | Notification family uses permission strings from `RBACService`, not the canonical permission set used in provider handlers |
| PROVIDER-labeled families using generic `authenticate`: `/api/analytics/*`, `/api/fraud-detection/*`, `/api/farm-audits/*`, `/api/labs/*`, `/api/lab-integration-import-sync-routes/*` | `authenticate` export from auth middleware | `requireRole([...Provider roles...])` | intended as provider families | `apps/backend/routes/api/analytics.js`, `apps/backend/routes/api/fraud-detection.js`, `apps/backend/routes/api/farm-audit.js`, `apps/backend/routes/api/lab-integration.js`, `apps/backend/routes/api/lab-integration-import-sync-routes.js`, `apps/backend/middleware/auth-middleware.js` | In current runtime, `authenticate` is exported as alias of `authenticateHealth`, so the identity gate source and PROVIDER-role intent are not the same abstraction |

## Role normalization layers

| Layer | Normalization / gate source | Behavior | Evidence | Initial signals |
| --- | --- | --- | --- | --- |
| Backend canonical RBAC | `normalizeRole` and canonical role aliases | maps legacy roles into canonical roles such as `admin`, `scheduler`, `document_reviewer`, `auditor`, `head_auditor`, `account`, `health` | `apps/backend/shared/canonical-rbac.js` | canonical alias map treats `reviewer_auditor` as `auditor` |
| Web middleware role aliases | `providerRoleAlias` and `providerRouteRoleRules` | normalizes only a subset of provider roles for route gating | `apps/web-app/src/middleware.ts` | web alias map treats `reviewer_auditor` as `document_reviewer` and does not list `head_auditor`, `approver`, `final_approver`, or `assessor` |
| Backend role middleware | `requireRole([...])` | compares raw role strings and canonicalized values against allowed arrays | `apps/backend/middleware/role-middleware.js` | role groups mix raw legacy DB roles and canonical lowercase aliases in the same guard |
| Provider handler shared roles | `PROVIDERRoles`, `adminRoles`, `requireCanonicalPermission` | provider submodules sometimes gate by role arrays, sometimes by canonical permission lookup | `apps/backend/routes/api/provider/handlers/shared.js` | provider namespace is internally split between role-array and permission-based enforcement |
| Security compliance RBAC | `RBACService.rbacMiddleware` | uses a separate permission namespace such as `dashboard.view`, `system.admin`, `application.read` | `apps/backend/services/security-compliance.js`, `apps/backend/middleware/auth-middleware.js` | canonical RBAC permissions and `RBACService` permissions are not the same vocabulary |

## Boundary signals

- `reviewer_auditor` is normalized differently across layers: backend canonical RBAC maps it to `auditor`, while web middleware maps it to `document_reviewer`.
- Web middleware role alias coverage is narrower than backend role coverage; `head_auditor`, `approver`, `final_approver`, and `assessor` are accepted in backend-related code paths but are not normalized in the inspected web middleware.
- Provider and admin web pages still read `provider_token` and `provider_user` from localStorage directly even though cookie-aware middleware and proxy routes also exist.
- Backend `authenticateProvider` prefers bearer header before cookie, while `authenticateHealth` prefers cookie before bearer header.
- `/api/admin/*` is provider-authenticated at mount, but admin-role enforcement is not uniform across submodules.
- PROVIDER-labeled route families such as analytics and fraud-detection import `authenticate`, and `auth-middleware` currently exports `authenticate` as alias of `authenticateHealth`.
- Permission vocabulary is split between canonical RBAC permissions in provider handlers and `RBACService` permission strings in other route families such as notifications.
- CSRF enforcement in `server.js` is keyed off `auth_token` cookie presence, which makes the health cookie flow a distinct boundary from provider cookie flow.

## Read together with

- `docs/canonical-inventory.md`
- `docs/runtime-drift-register.md`
- `docs/flow-runtime-matrix.md`
- `docs/entity-runtime-matrix.md`
- `docs/dependency-integration-matrix.md`
