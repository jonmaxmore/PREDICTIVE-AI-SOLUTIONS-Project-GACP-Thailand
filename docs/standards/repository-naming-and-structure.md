# Repository Naming and Structure Standard

Effective date: `2026-02-17`  
Scope: web app, backend API, shared docs/scripts

## 1) Domain First, UI Second

Use business domain as the primary naming model.

- use `application` as core resource
- use `wizard` only as UI behavior

Example:

- good: `applications/new/steps/documents-step.tsx`
- avoid: `wizard-documents.tsx` as the only business identifier

## 2) URL and Route Naming

Use plural resources and stable IDs.

- web route: `/health/applications/new`
- web route: `/health/applications/{applicationId}`
- api route: `/api/health/applications/{applicationId}/documents`
- api route: `/api/provider/applications/{applicationId}/review`

Rules:

- lowercase only
- kebab-case for multiword segments
- Next.js dynamic route params use kebab-case (`[cert-number]`, `[qr-code]`)
- no verbs in resource paths unless action endpoint is required (`/submit`, `/approve`)

## 3) File and Folder Naming

- folder names: `kebab-case`
- React component files: `kebab-case.tsx`
- component symbols: `PascalCase`
- utility files: `kebab-case.ts`
- avoid generic names (`step1.tsx`, `new-form.tsx`, `temp.ts`)
- avoid leading underscores in production code and scripts (`_file.js`)
- avoid mixed dot-suffix naming for internal modules (`module.helpers.js`)
- keep local tool artifacts out of git (`.playwright-cli/`, screenshots, traces, generated reports)

Preferred suffix patterns:

- route helper modules: `*-helpers.js` (example: `applications-helpers.js`)
- route registrars: `*-routes.js` (example: `lots-label-routes.js`)
- script helpers: `*-helpers.js` with scope in filename (example: `regression-test-billing-helpers.js`)
- UI split modules: `*-config.ts`, `*-utils.ts`, `*-<component>.tsx`

Preferred step file pattern:

- `general-step.tsx`
- `farm-info-step.tsx`
- `documents-step.tsx`
- `review-step.tsx`

## 4) Monorepo Layout Convention

Keep each layer explicit:

- `apps/web-app/src/app/...` for route entries
- `apps/web-app/src/features/<domain>/...` for domain components/hooks/services
- `apps/backend/routes/api/...` for HTTP surface
- `apps/backend/services/...` for domain logic
- `docs/standards/...` for governance
- `docs/testing/legacy/...` for archived test docs

## 4.1) Cross-Platform Exceptions

Some ecosystems require uppercase or framework-defined names. These are allowed only when the toolchain expects them:

- root or package docs: `README.md`, `CHANGELOG.md`
- container/build entrypoints: `Dockerfile`, `CMakeLists.txt`
- mobile platform files: `AndroidManifest.xml`, `Info.plist`, Xcode workspace/project assets
- generated OpenAPI/mobile client output that should be regenerated rather than hand-renamed
- ADR identifiers such as `ADR-013-platform-neutral-production-strategy.md`

Everything else should trend toward lowercase kebab-case. Use `npm run check:repo-naming` before adding new files.

## 5) Legacy and Cleanup Policy

- keep historical scripts under `scripts/legacy/...`
- keep historical test/UAT docs under `docs/testing/legacy/...`
- keep generated reports out of git by default
- for tracked report directories, commit only `.gitkeep`

## 6) Migration Rule (Safe Refactor)

When renaming files or paths:

1. move with `git mv` to preserve history
2. update all imports/links in same PR
3. keep API aliases only when required by production compatibility
4. remove aliases after a deprecation window
