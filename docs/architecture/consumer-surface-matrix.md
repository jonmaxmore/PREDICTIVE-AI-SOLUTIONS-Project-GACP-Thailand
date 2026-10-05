# Consumer Surface Matrix

Phase 1.13 maps active consumers to the runtime surfaces they call.

Scope:
- human-facing consumers: web health, web provider, web admin, public web, mobile
- bridge consumers: web BFF and generic proxy layers
- machine/public API consumers where they are explicit in runtime

This file stays in mapping mode only. It does not propose consolidation or fixes.

## Matrix

| Consumer | Entry routes or shell | Outbound runtime surfaces | Auth artifact or boundary | Primary entities | Path dialect signal | Key evidence | Current signal |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Web health portal | `/health/*` | `/api/applications/*`, `/api/preview/*`, `/api/payments/*`, `/api/farms/*`, `/api/site-analyses/*`, `/api/training-records/*`, `/api/lots/*`, root `/api/plant-units/*`, `/api/auth/health/*` | `auth_token` cookie via middleware and generic proxy; some direct bearer/cookie forwarding through Next proxy | `Application`, `ApplicationDraft`, `Farm`, `PlantingCycle`, `Lot`, `Certificate`, `Notification` | mixed canonical and implementation vocabulary: applications plus preview, but also wizard and draft-document language | `apps/web-app/src/app/health/applications/review-step.tsx`, `apps/web-app/src/app/health/applications/new/steps/documents-step.tsx`, `apps/web-app/src/app/health/site-analysis/page.tsx`, `apps/web-app/src/app/health/training/page.tsx`, `apps/web-app/src/app/health/tracking/lots/page.tsx` | broadest human consumer on web; mixes `apiClient` and raw `fetch`, and still carries `establishments` naming on top of farm APIs |
| Web provider portal | `/provider/*` | canonical `/api/provider/*`, `/api/auth/provider/me`, plus some audit-adjacent reads through provider helper paths | provider cookie or localStorage bearer forwarded by page helpers and proxy | `Application`, `ApplicationComment`, `Certificate`, planting oversight read models, scheduler rosters | most canonical web consumer; outbound paths cluster around `providerApiPaths` | `apps/web-app/src/lib/services/provider-api.ts`, `apps/web-app/src/app/provider/dashboard/page.tsx`, `apps/web-app/src/app/provider/applications/[id]/page.tsx`, `apps/web-app/src/app/provider/calendar/page.tsx`, `apps/web-app/src/app/provider/profile/page.tsx` | provider web is the cleanest consumer-to-API match in the current runtime |
| Web admin portal | `/admin/*` | `/api/admin/*` and provider-admin surfaces | `provider_token` from localStorage plus `credentials: include`; route access enforced by provider/admin gate in middleware | admin planting oversight, users, settings, system config | admin is a subfamily of provider identity rather than a separate auth stack | `apps/web-app/src/middleware.ts`, `apps/web-app/src/app/admin/planting/page.tsx` | admin consumer does not have a distinct session model; it rides provider auth artifacts and admin route rules |
| Web public trace | `/trace/*` | `/api/trace/*` | public, no auth | `PlantUnit`, `HarvestBatch`, `Lot`, plot-cycle trace payloads | browser path and API path use different namespaces for the same public trace flow | `apps/web-app/src/app/trace/[qr-code]/page.tsx`, `apps/web-app/src/app/trace/plant/[qr-code]/page.tsx`, `apps/web-app/src/app/trace/batch/[qr-code]/page.tsx`, `apps/web-app/src/app/trace/lot/[lot-id]/page.tsx` | public trace is consumer-facing on `/trace/*` but data-facing on `/api/trace/*` |
| Web public trust verifier | `/verify`, `/verify-identity` | `/api/interoperability/v1/verification`, `/api/interoperability/v1/trust/*`, `/api/interoperability/v1/signatures/verify`, `/api/interoperability/v1/trace/events/*`, identity-adjacent public surfaces | public, no auth for inspected reads | `Certificate`, trust registry rows, revocation feed, signature payloads, trace events | verification language is trust-centric rather than trace-centric | `apps/web-app/src/app/verify/page.tsx`, `apps/web-app/src/components/feature/trust-verifier-portal.tsx`, `apps/web-app/src/app/verify-identity/page.tsx` | public verification is split into trust/interoperability concepts rather than sharing the trace namespace |
| Web BFF generic proxy | `/api/[...path]` | backend `/api/*` passthrough | header precedence is explicit bearer, then `auth_token`, then `provider_token` | all entities, depending on caller | bridge layer is intentionally mixed-auth and mixed-domain | `apps/web-app/src/app/api/[...path]/route.ts` | this is the main web bridge that allows health and provider calls to coexist behind one Next route family |
| Web auth/session bridge | `/api/auth/health/*`, `/api/auth/provider/*`, `/api/session/*` in Next app tree | backend auth endpoints and cookie sync helpers | mixed browser cookie, SSR cookie sync, and bearer forwarding | `User`, session state, cookie artifacts | route family exists in app tree, but production gateway precedence differs by subpath | `apps/web-app/src/app/api/auth/health/[...path]/route.ts`, `apps/web-app/src/app/api/auth/provider/[...path]/route.ts`, `apps/web-app/src/app/api/session/set-cookie/route.ts`, `nginx/gacp.production.conf` | auth bridge surfaces are present in frontend code, but not all of them win in production routing |
| Mobile health app | `/dashboard`, `/applications*`, `/establishments*`, `/certificates`, `/documents`, `/tracking`, `/profile` | root `/applications/*`, root `/establishments/*`, `/auth-health/*`, `/auth/provider/login`, `/v2/applications/*`, `/v2/notifications`, `/v2/documents`, `/v2/certificates` | `auth_token` secure storage key, plus `user_role` and `account_type`; `DioClient` injects one bearer token | `Application`, `Farm` or establishment read model, `Notification`, `Certificate`, document lists, tracking read models | highest dialect spread: root paths, `/v2/*`, and legacy auth-health naming all coexist | `apps/mobile-app/lib/core/router/app_router.dart`, `apps/mobile-app/lib/data/repositories/auth_repository_impl.dart`, `apps/mobile-app/lib/data/repositories/application_repository_impl.dart`, `apps/mobile-app/lib/data/repositories/establishment_repository_impl.dart`, `apps/mobile-app/lib/presentation/features/application/services/application_service.dart`, `apps/mobile-app/lib/presentation/features/tracking/tracking_screen.dart` | mobile health is the noisiest consumer contract in the repo; route names and API families are not singular |
| Mobile provider shell | `/provider/*` mobile routes and `PROVIDERAppShell` | provider login path is explicit, but inspected data consumers still share generic mobile transport and token storage | provider login uses `/auth/provider/login`, but stored token key remains `auth_token` in inspected auth repo | provider dashboard, document review shell, audit shell, quote/invoice shell, provider management shell | provider vocabulary exists in routes and shells even where app comments describe Applicant-only scope | `apps/mobile-app/lib/core/router/app_router.dart`, `apps/mobile-app/lib/presentation/navigation/PROVIDER_app_shell.dart`, `apps/mobile-app/lib/data/repositories/auth_repository_impl.dart` | mobile contains an active provider shell without a cleanly separated provider session artifact model |
| Mobile legacy transport layer | not route-driven; shared service object | hardcoded `https://api.dtam.go.th`, `/api/auth/refresh`, token-refresh flow | `jwt_token` and `refresh_token` secure storage keys | generic API payloads | legacy transport does not share the same base URL or token keys as `DioClient` | `apps/mobile-app/lib/core/services/api_service.dart` | this is a second mobile consumer bridge with its own base URL and auth artifacts |
| External public trust consumers | no in-repo UI route required | `/api/interoperability/v1/*`, `/api/trace/*` | mostly public, admin/provider auth only on revoke-like actions | `Certificate`, trust registry, revocations, trace events, public trace entities | public consumers depend on two API families rather than one | `apps/backend/routes/api/interoperability.js`, `apps/backend/routes/api/trace.js`, `apps/backend/routes/public-trace.js` | machine/public consumers inherit the same trace-versus-trust split visible in public web pages |

## Consumer groups

### Web consumers

- Web health is the widest application consumer and touches the largest mix of workflow, farm, planting, payment, and trace APIs.
- Web provider is the most canonical in route language because it largely consumes `providerApiPaths`.
- Web admin behaves as a provider-admin specialization, not as an isolated admin runtime.
- Public web is split into two families: trace pages and trust-verifier pages.

### Mobile consumers

- Mobile health combines route language from the health portal with API contracts from multiple generations.
- Mobile provider shells still exist and are not isolated from the generic mobile auth/token model.
- `DioClient` and `ApiService` form two different transport consumers inside the same app.

### Bridge consumers

- The Next generic proxy is the main cross-domain bridge for browser calls.
- Auth/session routes in Next form a second bridge, but only some of them are effective under production gateway precedence.

## Path dialect summary

| Dialect | Where it is strongest | Evidence | Signal |
| --- | --- | --- | --- |
| canonical `/api/provider/*` | web provider | `apps/web-app/src/lib/services/provider-api.ts` | strongest consumer-to-runtime alignment |
| canonical `/api/trace/*` and `/api/interoperability/v1/*` | public web and external trust consumers | `apps/web-app/src/components/feature/trust-verifier-portal.tsx`, `apps/web-app/src/app/trace/*` | public verification uses two dialect families |
| mixed `/api/*` through generic proxy | web health and web BFF | `apps/web-app/src/app/api/[...path]/route.ts` | mixed-auth bridge by design |
| root resource paths like `/applications/*` and `/establishments/*` | mobile health | `apps/mobile-app/lib/data/repositories/application_repository_impl.dart`, `apps/mobile-app/lib/data/repositories/establishment_repository_impl.dart` | consumer contract is not tied to one mounted backend family |
| legacy `/auth-health/*` | mobile auth | `apps/mobile-app/lib/data/repositories/auth_repository_impl.dart` | health auth naming in mobile lags behind canonical docs |
| `/v2/*` contract family | mobile screens and repositories | `apps/mobile-app/lib/presentation/features/tracking/tracking_screen.dart`, `apps/mobile-app/lib/presentation/features/certificates/certificates_screen.dart`, `apps/mobile-app/lib/presentation/features/documents/documents_screen.dart` | mobile still depends on a versioned API dialect that does not match the main mounted runtime tree |

## Signals from this matrix

- Consumer cleanliness is uneven: provider web is relatively canonical, while mobile is not.
- Web and mobile do not share one stable outward contract family.
- Public verification is split by concept and consumer, not just by route prefix.
- Admin is an access specialization of provider surfaces more than a separate platform.
- The generic web proxy is a major coupling point because it can forward either health or provider identity through one path family.
