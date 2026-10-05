# Backend Dependency Vulnerability Remediation Priority (Post axios/qs + express-validator + validator + lodash + jsonwebtoken Patch)

- Status: Review / Backlog Closed (Residual Accepted for `swagger-jsdoc` minimatch path)
- Scope: `apps/backend` runtime dependency risk only (not full monorepo)
- Date: 2026-02-22

## Context

After patching backend `axios` and forcing `qs` to `6.14.2`, backend-specific issues from the earlier Red Hat overview mismatch were reduced.

This note prioritizes the remaining backend-relevant advisories from `pnpm --dir apps/backend audit --prod --json` using:

1. exploitability in our code path
2. runtime exposure (public request path vs startup/admin tooling)
3. patch blast radius

## Already Remediated (This Round)

1. `axios` (backend direct dependency) upgraded to `1.13.5`
2. shared `qs` transitive issue in `express` / `express-rate-limit` / `swagger-ui-express` chain patched via `pnpm` override to `6.14.2`
3. removed unused `express-validator` from `apps/backend` dependencies (reduced `validator` and `lodash` vulnerable paths)
4. patched remaining backend `validator` path in `swagger-jsdoc` toolchain via `pnpm` override to `13.15.26`
5. patched backend `bull -> lodash` path via `pnpm` override to `4.17.23`
6. upgraded backend `jsonwebtoken` to `9.0.3`, resolving backend `jws` path to `4.0.1`

## Remaining Backend-Relevant Items (Residual)

### 0. `basic-ftp` via `puppeteer -> proxy-agent -> get-uri` (Critical advisory, **not exploitable in our usage**) — Accepted Residual

Discovered during 2026-05-05 QA sweep (post-3.2.1).

- Audit path: `apps/backend > puppeteer@24.35.0 > @puppeteer/browsers > proxy-agent > pac-proxy-agent > get-uri > basic-ftp@5.0.5`
- Why not exploitable in our setup:
  - `puppeteer` is used **only** for local headless-Chrome PDF rendering in `apps/backend/services/pdf/pdf-generator.service.js`. The launch is `puppeteer.launch()` against a bundled local Chromium binary — no proxy is configured, no FTP scheme is dialed.
  - The `basic-ftp` advisory (ReDoS via malicious FTP server response) requires the chain `proxy-agent → get-uri → basic-ftp` to actually *contact an FTP server*. That path is reachable only when puppeteer is configured with a `proxy-server` argument that uses `ftp://` scheme. We do not.
- Why not patching now: there is no patched `basic-ftp` line on the locked range; the upstream chain is locked behind `puppeteer/@puppeteer/browsers`. Forcing a higher `basic-ftp` would require pnpm overrides that conflict with the chain-mandated version.
- Review triggers (re-open when any becomes true):
  1. `puppeteer` releases a chain that drops `proxy-agent` or its `get-uri` dependency.
  2. Our PDF-generation flow starts using a configurable proxy (any operator-supplied `proxy-server` argument changes the threat model).
  3. A new advisory clarifies exploitability without an FTP scheme in puppeteer's specific chain.

### 1. `minimatch` via `swagger-jsdoc -> glob` (High advisory, low runtime exploitability in our setup) - Accepted Residual (Monitor Upstream)

- Audit path:
  - `apps__backend > swagger-jsdoc > glob > minimatch`
- Why lower practical priority:
  - Vulnerability is ReDoS on user-controlled glob patterns
  - Our `swagger-jsdoc` usage builds docs from static local globs, not user input:
    - `apps/backend/config/swagger.js:174`
    - `apps/backend/config/swagger.js:175`
    - `apps/backend/config/swagger.js:181`
  - Swagger route is exposed (`/api-docs`) but the vulnerable glob processing happens during spec generation/config startup, not per user pattern input:
    - `apps/backend/server.js:187`
    - `apps/backend/server-production.js:148`
- Why not patching now:
  - `swagger-jsdoc@6.2.8` (latest stable) still depends on `glob@7.1.6`
  - `swagger-jsdoc@7.0.0-rc.6` also still depends on `glob@7.1.6`
  - Forcing `minimatch@10.x` under `glob@7` is a risky major-incompatible override
- Review triggers (re-open item when any becomes true):
  1. `swagger-jsdoc` releases a version that upgrades away from vulnerable `glob/minimatch` chain.
  2. Our Swagger/OpenAPI file discovery becomes user-configurable or request-driven.
  3. We refactor API docs generation/mount behavior and can safely replace `swagger-jsdoc`.

## Suggested Execution Order (Pragmatic)

1. No immediate code patch required for backend runtime risk in current design.
2. Re-check `swagger-jsdoc` dependency chain during next dependency maintenance cycle.

## Guardrails

1. Keep dependency PRs small (one risk cluster at a time).
2. Run at least:
   - `pnpm --dir apps/backend audit --prod --json`
   - targeted tests/smoke for any dependency path you changed
   - smoke `/api-docs` when touching swagger docs toolchain
3. Do not mix dependency upgrades with feature code changes.
