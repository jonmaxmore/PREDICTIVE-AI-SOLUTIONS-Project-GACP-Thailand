# SURFACE_MOUNT_PRECEDENCE_MAP

Last updated: 2026-03-06

This document is a Phase 1.11 runtime surface and mount precedence map.
It records how incoming paths are resolved across nginx, Next.js, and Express in the current repository.
It is not a target-state design and does not propose remediation.

## Scope

- Gateway and edge routing: `nginx/gacp.production.conf`, `docker-compose.production.yml`
- Backend app mounts: `apps/backend/server.js`
- Backend API mount tree: `apps/backend/routes/api/index.js`
- Backend overlapping routers: `apps/backend/routes/public-trace.js`, `apps/backend/routes/api/plots.js`, `apps/backend/routes/api/plant-units.js`, `apps/backend/routes/api/provider.js`, `apps/backend/routes/api/provider/index.js`
- Frontend rewrites and API routes: `apps/web-app/next.config.ts`, `apps/web-app/src/app/api/[...path]/route.ts`, `apps/web-app/src/app/api/proxy/[...path]/route.ts`, `apps/web-app/src/app/api/auth/health/[...path]/route.ts`, `apps/web-app/src/app/api/auth/provider/[...path]/route.ts`, `apps/web-app/src/app/api/session/set-cookie/route.ts`, `apps/web-app/src/app/api/auth/set-session-cookie/route.ts`
- Frontend public route surfaces: `apps/web-app/src/app/trace/*`, `apps/web-app/src/app/verify/page.tsx`, `apps/web-app/src/app/verify-identity/page.tsx`

## Resolution layers

- `gateway`: nginx chooses frontend or backend container
- `frontend runtime`: Next.js filesystem routes and rewrites decide whether request stays in frontend or is proxied onward
- `backend app`: Express top-level `app.use(...)` order in `server.js`
- `backend api tree`: mount order inside `apps/backend/routes/api/index.js`

## Production gateway precedence

The nginx config defines the first effective routing layer for production browser traffic.
The matching order below follows nginx location specificity present in the current config.

| Path pattern | Winning nginx location | Upstream | Evidence | Initial signals |
| --- | --- | --- | --- | --- |
| `/health` | `location = /health` | nginx direct 200 response | `nginx/gacp.production.conf` | Health probes stop at nginx and do not reach frontend or backend containers |
| `/_next/webpack-hmr` | exact prefix location | frontend | `nginx/gacp.production.conf` | Special development/HMR path is pinned to frontend |
| `/_next/static/*` | exact prefix location | frontend | `nginx/gacp.production.conf` | Static build assets bypass backend completely |
| `/public/*` | exact prefix location | frontend | `nginx/gacp.production.conf` | Public assets are frontend-served at edge |
| `/api/auth/*` | exact prefix location | backend | `nginx/gacp.production.conf` | Auth traffic is routed directly to backend before any generic `/api/*` handling |
| `/api/applications/*` | exact prefix location | backend | `nginx/gacp.production.conf` | Application family gets stricter upload/rate settings than generic API traffic |
| `/api/session/*` | exact prefix location | frontend | `nginx/gacp.production.conf` | Session cookie helper paths are intentionally handled by frontend, not backend |
| `/api/*` | generic API prefix | backend | `nginx/gacp.production.conf` | All remaining API traffic goes to backend |
| `/*` | catch-all location | frontend | `nginx/gacp.production.conf` | All non-API public pages resolve to frontend first in production |

## Frontend runtime precedence

Within the frontend runtime, Next.js resolves more specific filesystem routes before the catch-all API route.
The following surfaces are active in the inspected app tree.

| Frontend surface | Type | Resolves to | Evidence | Initial signals |
| --- | --- | --- | --- | --- |
| `/api/session/set-cookie` | specific API route | frontend route handler | `apps/web-app/src/app/api/session/set-cookie/route.ts` | This route exists specifically so middleware-visible cookies can be set on the frontend side |
| `/api/auth/set-session-cookie` | specific API route | frontend route handler in app tree | `apps/web-app/src/app/api/auth/set-session-cookie/route.ts` | This path exists in Next, but production nginx sends `/api/auth/*` to backend first |
| `/api/auth/change-password` | specific API route | frontend route handler that proxies to backend | `apps/web-app/src/app/api/auth/change-password/route.ts` | Change-password has its own dedicated proxy path rather than using the generic catch-all |
| `/api/auth/health` | specific API route | frontend health-check route | `apps/web-app/src/app/api/auth/health/route.ts` | This path is a frontend-side backend health wrapper in the app tree |
| `/api/auth/health/*` | auth proxy catch-all | frontend route handler that forwards to backend `/api/auth/health/*` | `apps/web-app/src/app/api/auth/health/[...path]/route.ts` | In app runtime this is a real proxy family, but production nginx bypasses frontend for `/api/auth/*` |
| `/api/auth/provider/*` | auth proxy catch-all | frontend route handler that forwards to backend `/api/auth/provider/*` | `apps/web-app/src/app/api/auth/provider/[...path]/route.ts` | Same precedence note as health auth path |
| `/api/proxy/*` | proxy catch-all | frontend route handler that forwards to backend candidates | `apps/web-app/src/app/api/proxy/[...path]/route.ts` | Exists alongside the generic `/api/[...path]` proxy |
| `/api/*` | generic catch-all | frontend generic proxy route | `apps/web-app/src/app/api/[...path]/route.ts` | This is the broadest frontend API route and loses to all more specific app API routes |
| `/trace/*` | frontend page namespace | frontend page tree | `apps/web-app/src/app/trace/*` | Public trace paths have active frontend pages in the web app |
| `/verify` and `/verify-identity` | frontend page namespace | frontend page tree | `apps/web-app/src/app/verify/page.tsx`, `apps/web-app/src/app/verify-identity/page.tsx` | Public trust pages are frontend-first surfaces |

## Backend top-level mount order

The order below follows `apps/backend/server.js`.
Earlier mounts take precedence over later ones when path patterns overlap.

| Order | Backend app mount | Target | Evidence | Initial signals |
| --- | --- | --- | --- | --- |
| 1 | `/uploads` | Express static file serving from backend filesystem | `apps/backend/server.js` | Backend can serve uploads directly if request reaches backend container |
| 2 | `/trace` | backend public trace redirect router | `apps/backend/server.js`, `apps/backend/routes/public-trace.js` | Backend has its own `/trace/*` redirect surface even though production browser traffic to `/trace/*` goes to frontend first |
| 3 | `/api` | main API router | `apps/backend/server.js`, `apps/backend/routes/api/index.js` | Main API tree is mounted before later `/api` additions |
| 4 | `/api` | `plotsRouter` mounted again | `apps/backend/server.js`, `apps/backend/routes/api/plots.js` | Plot routes are registered a second time at app level after already being mounted inside the API tree |
| 5 | `/api/mock-payment` | mock payment routes in non-production | `apps/backend/server.js` | Mock payment lives outside the main API router ordering |
| 6 | `/api-docs` | Swagger UI | `apps/backend/server.js` | Docs are outside `/api/*` |
| 8 | `/health` and `/api/health` | app-level health route | `apps/backend/server.js` | `/api/health` also exists inside the API router, so earlier API-router handling wins first |

## Backend API tree precedence

The order below follows `apps/backend/routes/api/index.js`.
Only overlap-relevant and structure-relevant groups are highlighted here.

| Order group | API mount | Target router | Evidence | Initial signals |
| --- | --- | --- | --- | --- |
| A | `/applications/car` | CAR sidecar router | `apps/backend/routes/api/index.js` | Mounted before `/applications`, so CAR paths resolve there first |
| B | `/applications/config` | application config router | `apps/backend/routes/api/index.js` | Mounted before `/applications`, so config paths resolve there first |
| C | `/applications` | main applications router | `apps/backend/routes/api/index.js` | Main family comes after its more specific sidecars |
| D | `/provider` | composite router containing provider operations, then provider directory | `apps/backend/routes/api/index.js`, `apps/backend/routes/api/provider/index.js`, `apps/backend/routes/api/provider.js` | `/api/provider/*` resolution depends on internal mount order inside the composite provider router |
| E | `/audits/reassign` | audit reassignment router | `apps/backend/routes/api/index.js` | Mounted before `/audits`, so reassignment paths resolve first |
| F | `/audits` | main audit router | `apps/backend/routes/api/index.js` | Main audit family comes after its sidecar |
| G | `/auth/health` and `/auth/provider` | canonical auth routers | `apps/backend/routes/api/index.js` | Auth exists in backend API tree even though production nginx sends `/api/auth/*` directly to backend before frontend app routes |
| H | `/trace` and `/interoperability` | public trust API routers | `apps/backend/routes/api/index.js` | Trust surfaces sit inside main API tree alongside internal workflows |
| I | `/webhooks` and `/callbacks` | payment and lab callback routers | `apps/backend/routes/api/index.js` | Machine-to-machine surfaces live near the end of the main API tree |
| J | `/admin` | admin router | `apps/backend/routes/api/index.js` | Admin is mounted after preview but before sync/fraud/analytics/labs |
| K | `/sync`, `/consumer-feedback`, `/post-audit`, `/revision-deadline` | post-core workflow surfaces | `apps/backend/routes/api/index.js` | These families are late additions to the API tree |
| L | `/farm-audits`, `/fraud-detection`, `/analytics`, `/labs` | advanced feature families | `apps/backend/routes/api/index.js` | These sit after core workflow families and before root-mounted leftovers |
| M | `/` via `rootMountedRouter` | plots and plant-units root-style paths | `apps/backend/routes/api/index.js`, `apps/backend/routes/api/plots.js`, `apps/backend/routes/api/plant-units.js` | Root-mounted subresource paths are intentionally placed last inside the API router |
| N | `/health`, `/metrics`, `/version` | API support endpoints | `apps/backend/routes/api/index.js` | Support endpoints are declared after router mounts inside the same API tree |

## Composite and overlapping namespace details

| Surface | Overlap or precedence rule | Evidence | Initial signals |
| --- | --- | --- | --- |
| `/api/provider/*` | provider operations router mounts first, provider directory router mounts second | `apps/backend/routes/api/index.js`, `apps/backend/routes/api/provider/index.js`, `apps/backend/routes/api/provider.js` | Canonical provider subpaths such as `/applications`, `/reviewer`, `/scheduler`, `/auditor`, `/admin`, `/certificates`, `/analytics`, and `/planting-cycles` resolve before generic provider directory paths such as `/:id` |
| `/api/provider/stats` | provider operations router defines `/stats` 404 before provider directory router also defines `/stats` 404 | `apps/backend/routes/api/provider/index.js`, `apps/backend/routes/api/provider.js` | This path is effectively shadowed by the first provider router layer |
| `/api/farms/:farmId/plots` and `/api/plots/:id` | plots router is mounted inside API root-mounted router and again at backend app level under `/api` | `apps/backend/routes/api/index.js`, `apps/backend/server.js`, `apps/backend/routes/api/plots.js` | Plot routes are duplicated in runtime mount structure |
| `/api/plant-units/*` | plant-units router is root-mounted inside API tree | `apps/backend/routes/api/index.js`, `apps/backend/routes/api/plant-units.js` | Plant-unit paths are namespace-shaped but implemented through the root-mounted fallback layer |
| `/api/health` | declared inside API router and again at app level | `apps/backend/routes/api/index.js`, `apps/backend/server.js` | Because `/api` router mount happens first, API-router health handling resolves before the later app-level duplicate |
| `/trace/*` | frontend has page namespace; backend also has redirect router | `nginx/gacp.production.conf`, `apps/backend/server.js`, `apps/backend/routes/public-trace.js`, `apps/web-app/src/app/trace/*` | On production browser edge, nginx sends `/trace/*` to frontend first; backend `/trace/*` remains relevant for direct backend access or non-nginx execution paths |
| `/uploads/*` | frontend rewrite bridges browser requests to backend static route | `nginx/gacp.production.conf`, `apps/web-app/next.config.ts`, `apps/backend/server.js` | Browser-facing production path resolves through frontend edge first even though backend owns the file surface |
| `/api/auth/*` | frontend app contains matching proxy routes, but production nginx sends these paths straight to backend | `nginx/gacp.production.conf`, `apps/web-app/src/app/api/auth/health/[...path]/route.ts`, `apps/web-app/src/app/api/auth/provider/[...path]/route.ts` | Frontend auth proxy routes exist in the app tree, but production edge precedence bypasses them for browser traffic |
| `/api/session/set-cookie` vs `/api/auth/set-session-cookie` | both exist in frontend app tree, but nginx only reserves `/api/session/*` for frontend | `nginx/gacp.production.conf`, `apps/web-app/src/app/api/session/set-cookie/route.ts`, `apps/web-app/src/app/api/auth/set-session-cookie/route.ts` | The session helper under `/api/session/*` is edge-reachable through frontend; the auth-namespaced helper is shadowed by nginx `/api/auth/*` routing in production |

## Resolution examples

| Incoming path | First winning layer | Effective runtime path | Evidence-backed interpretation |
| --- | --- | --- | --- |
| `/api/auth/provider/login` | nginx `/api/auth/` | backend `/api/auth/provider/login` | Browser traffic goes directly to backend auth route in production |
| `/api/session/set-cookie` | nginx `/api/session/` | frontend Next route `/api/session/set-cookie` | This path is intentionally reserved for frontend-side cookie sync |
| `/api/applications/draft` | nginx `/api/applications/` | backend `/api/applications/draft` | Application family gets its own gateway rule before generic API handling |
| `/api/provider/applications` | backend API composite provider mount | provider operations router | Operations router wins before provider directory router |
| `/api/provider/123` | backend API composite provider mount | provider directory router `/:id` | Falls through operations router and lands in provider directory lookup |
| `/api/farms/<farmId>/plots` | backend API root-mounted plots router | plots subresource route | Same path also exists because plots router is mounted again at app level under `/api` |
| `/trace/<qr-code>` | nginx catch-all `/` | frontend page `/trace/[qr-code]` | Production public trace page resolves to frontend, not backend redirect router |
| `/uploads/<file>` | nginx catch-all `/` then Next rewrite | backend `/uploads/<file>` | Public upload URL is frontend-edge-visible but backend-owned |
| `/api/health` | nginx `/api/` then backend `/api` router | API-router `/health` endpoint | API-router health path is encountered before app-level duplicate `/api/health` |

## Surface signals

- The production edge is not a simple "frontend for pages, backend for APIs" split. There are API exceptions in both directions: `/api/session/*` goes to frontend, while `/api/auth/*` bypasses frontend.
- The repository contains frontend auth proxy routes under `/api/auth/*`, but production nginx precedence sends browser traffic for those paths straight to backend.
- Backend has both frontend-facing and backend-facing `/trace/*` implementations in the repository. Which one wins depends on whether traffic arrives through nginx or directly at the backend process.
- Plot routes are mounted twice in backend runtime structure: once inside the API tree root-mounted router and once again at the app level under `/api`.
- Root-mounted leftovers (`plots`, `plant-units`) are intentionally placed late inside the API router, so namespaced families resolve first.
- The provider namespace is composite. Path meaning is determined partly by mount order, not just by the visible `/api/provider/*` prefix.

## Read together with

- `docs/canonical-inventory.md`
- `docs/runtime-drift-register.md`
- `docs/flow-runtime-matrix.md`
- `docs/entity-runtime-matrix.md`
- `docs/dependency-integration-matrix.md`
- `docs/auth-role-boundary-matrix.md`
