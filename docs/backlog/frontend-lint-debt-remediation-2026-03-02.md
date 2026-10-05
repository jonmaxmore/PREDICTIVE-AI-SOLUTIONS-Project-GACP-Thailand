# Frontend Lint Debt Remediation Plan

Date: 2026-03-02

## Current Baseline

- ESLint result (`apps/web-app`):
  - `errors: 0`
  - `warnings: 333`
  - `files scanned: 399`

Top rule categories:

- `@typescript-eslint/no-explicit-any`: 258
- `@typescript-eslint/no-unused-vars`: 69
- `react-hooks/exhaustive-deps`: 6

## High-Impact Files (Priority)

1. `src/app/health/planting/[id]/planting-cycle-detail-tabs-section-a-overview-plots.tsx` (30)
2. `src/app/provider/criteria/page.tsx` (15)
3. `src/app/health/training/page.tsx` (12)
4. `src/app/health/planting/[id]/planting-cycle-detail-tabs-section-a-units.tsx` (12)
5. `src/app/health/profile/page.tsx` (11)

## Execution Strategy

1. Remove `any` first in shared/API boundary code
2. Split large page-level components into typed helper modules
3. Resolve unused vars from refactor leftovers
4. Fix `exhaustive-deps` by stabilizing callbacks/memo dependencies

## Control Gates (Added)

- `apps/web-app/package.json`: `lint:trust`
- root `package.json`: `gate:trust-interoperability-lint`
- `verify:build` now runs trust/interoperability lint gate

## Acceptance Targets

1. Short term: reduce warnings from 333 -> <= 250
2. Mid term: reduce warnings from <= 250 -> <= 120
3. Final: zero warnings for `src/app/api/**`, `src/hooks/**`, `src/lib/services/**`

## Status as of 2026-05-04

Re-measured baseline (`pnpm --dir apps/web-app exec eslint src --no-error-on-unmatched-pattern`):

- `errors: 0`
- `warnings: 1` (down from 333, -332)

Acceptance Targets:

- Short term (<= 250): **met**
- Mid term (<= 120): **met**
- Final (zero warnings in `src/app/api/**`, `src/hooks/**`, `src/lib/services/**`): **met** (each path returns 0 warnings)

Remaining single warning:

- `src/app/provider/audits/[id]/audit-application-tab-panel.tsx:168:41` — `@next/next/no-img-element`

## Status as of 2026-05-05 — **CLOSED (0/0)**

The single residual `@next/next/no-img-element` warning was resolved
with a documented `eslint-disable-next-line` + rationale block on the
audit-application document previewer. The `<img>` is the deliberate
choice: the previewer renders arbitrary user-uploaded URLs from any
storage backend (S3, Azure Blob, legacy local paths) and `next/image`
would require every remote host to be enumerated in
`next.config.ts > images.remotePatterns`. LCP impact is bounded — the
preview pane only opens on click, never above-the-fold.

Re-measured baseline (`pnpm --dir apps/web-app exec eslint src --no-error-on-unmatched-pattern`):

- `errors: 0`
- `warnings: 0`

This backlog ticket is fully resolved. No further short/mid/final
target action required.
- Context: document preview viewer for user-uploaded audit attachments. The `<img>` is intentional because (a) image source is from arbitrary upload host and `next.config.ts` does not declare `images.remotePatterns`, (b) zoom/rotate transforms target the raw element, (c) document fidelity matters more than bandwidth optimization for audit evidence. Switching to `next/image` is a regression risk on the audit reviewer flow without offsetting benefit.
- Recommendation: leave as-is until either `images.remotePatterns` is configured for upload origins, or the viewer is redesigned. Current `apps/web-app` `lint` script uses `--max-warnings=50`, so the 1 remaining warning is well under the gate.

This file is left as the dated 2026-03-02 baseline snapshot for history. No further reduction is required by the original plan.
