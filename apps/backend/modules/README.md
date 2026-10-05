# `apps/backend/modules/` — Phase A6 module boundaries

This directory establishes the **module-boundary contract** specified in
Phase A6 RFC §A6-1. Each subdirectory under `modules/` is a domain
module with two surfaces:

```
modules/<domain>/
├── index.js          ← PUBLIC API — what other modules may import
├── internal/         ← PRIVATE implementation — must NOT be imported
│   │                  from outside this module
│   └── ...
├── routes/           ← optional: HTTP route definitions, registered by
│                       `apps/backend/server.js`
└── README.md         ← module charter — what it owns + dependencies
```

## Lint enforcement

The `gacp/no-cross-module-internal` ESLint rule (registered in
`apps/backend/eslint.config.js`) flags any `require()` or `import` of a
path matching `**/modules/<other>/internal/**` from outside that module's
own subtree.

Severity: **`warn`** (advisory) — flips to `error` once existing
cross-module reaches are migrated to public APIs (Phase A6 step 2).

Imports allowed without warning:
- `modules/<self>/internal/...` — same module's internals are fine
- `modules/<other>` — public barrel imports
- `modules/<other>/index.js` — same as above
- `modules/<other>/routes/...` — public route definitions

## Migration plan

Phase A6 step 1 (this PR) only ships the directory + ESLint rule.
**No service files have been moved yet.** Existing code keeps importing
from `services/` / `routes/` paths exactly as before.

Subsequent PRs will move services into modules one domain at a time:

1. **billing/** — fee-service, phase-billing-service, invoice-finance-ops, payment-service*
2. **application/** — application-service, application-status-writer, workflow-transition-service
3. **audit/** — audit-trail, audit-logger, audit-chain-verifier
4. **certificate/** — certificate-service, certificate-renewal-service
5. **document/** — pdf services, document-precheck
6. **identity/** — auth, role-utils, jwt-security, token-rotation
7. **public/** — public-trace, sslip-mirror, share-tokens

Each migration PR moves a single domain into `modules/<domain>/`,
updates direct callers to use the new public API, and confirms the
ESLint count of `gacp/no-cross-module-internal` stays at 0 or
decreases.

## Service registry

`apps/backend/services/service-registry.js` provides a lazy-resolution
registry that surfaces circular-dependency issues at registration time
rather than at runtime import. New code in `modules/` should register
services through it; old code may keep using direct `require()` until
its module is migrated.
