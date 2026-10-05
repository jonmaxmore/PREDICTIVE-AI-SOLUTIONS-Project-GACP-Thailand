# Web App Dependency Vulnerability Remediation Priority (Stabilization / Release-Readiness)

- Status: Review / Backlog Closed (Residual Accepted for `@serwist/next` minimatch path)
- Scope: `apps/web-app` production dependency risk only (not full monorepo)
- Date: 2026-02-22

## Context

This note records the `web-app` remediation decisions taken during the `Stabilization / Release-Readiness` phase.

We prioritized direct, production-path vulnerabilities first, then reviewed remaining transitive advisories for practical exploitability in our deployment.

## Remediated (This Round)

1. upgraded `axios` to `1.13.5` (`apps/web-app` direct dependency)
2. upgraded `jsonwebtoken` to `9.0.3` (resolves `jws` to `4.0.1`)
3. upgraded `next` runtime from `15.5.9` to `15.5.12`

## Risk Notes (Why These Were Prioritized)

1. `axios` is used directly in runtime UI/server integration paths:
   - `apps/web-app/src/contexts/config-context.tsx`
   - `apps/web-app/src/app/provider/settings/system/page.tsx`
2. `jsonwebtoken` is used in app code:
   - `apps/web-app/src/lib/auth.ts`
3. `next` is the application runtime and affects App Router / request handling behavior.

Additionally, `apps/web-app/next.config.ts` does not define `images.remotePatterns`, which reduced practical exposure for one of the reported Next.js image optimizer advisories, but we patched `next` anyway to remove ambiguity for release-readiness.

## Remaining Web-App-Relevant Item (Residual)

### 1. `minimatch` via `@serwist/next -> glob` (High advisory, accepted residual pending upstream)

- Audit path:
  - `apps__web-app > @serwist/next > glob > minimatch`
- Why not patching now:
  - Latest `@serwist/next` currently resolves to `glob@10.5.0`
  - `glob@10.5.0` depends on `minimatch@^9.0.4`
  - Advisories currently require `minimatch>=10.2.1`
  - Forcing `minimatch@10.x` under `glob@10.5.0` would be a major-version override with compatibility risk during release-readiness
- Practical risk note:
  - This is a ReDoS issue on user-controlled glob pattern input
  - In our path, this comes from build/runtime tooling chain (`@serwist/next`), not a user-facing glob input feature

## Review Triggers (Re-open Item When Any Becomes True)

1. `@serwist/next` (or its `glob` chain) upgrades to a patched `minimatch` major/version.
2. We change PWA/service worker tooling and can safely replace the affected chain.
3. A new advisory clarifies exploitability in our exact `@serwist/next` usage path beyond user-controlled patterns.

## Guardrails

1. Keep dependency upgrades scoped by package/app (`web-app` vs `backend`).
2. Validate after each dependency patch:
   - `pnpm --dir apps/web-app audit --prod --json`
   - version/path checks (`pnpm why`)
   - basic load/smoke for changed runtime deps
3. Do not mix dependency maintenance with feature code changes.
