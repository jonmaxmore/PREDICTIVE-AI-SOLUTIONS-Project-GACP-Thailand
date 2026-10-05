# ADR-010: Commit-Scoped Quality Gates for Prisma Schema and ESLint Warnings

- Status: Accepted
- Date: 2026-02-22

## Context

The project has frequent concurrent changes and a large working tree. Two regressions are high-risk during handoff and deploy:

1. Prisma schema updates can be committed without corresponding migrations, creating runtime drift.
2. New lint warnings can be introduced in touched files and silently increase maintenance debt.

Relying only on manual review is not sufficient for these two failure modes.

## Decision

Add executable guards and include them in the existing auth/security preview gate:

1. `scripts/ci/check-prisma-migration-consistency.js`
   - Fails when any file under `apps/backend/prisma/schema/` changes in `HEAD` without migration changes under `apps/backend/prisma/migrations/`.
   - Optionally runs strict Prisma diff when `SHADOW_DATABASE_URL` is provided.
2. `scripts/ci/check-no-new-eslint-warnings.js`
   - Lints only files changed in `HEAD` under `apps/backend` and `apps/web-app`.
   - Enforces `--max-warnings=0` to prevent new warning debt.
3. Integrate both checks into `scripts/run-auth-hardening-gate.js` before tests/lint.

## Consequences

### Positive

- Reduces deploy risk from schema/migration mismatch.
- Prevents warning growth in changed code while avoiding full-repo lint churn.
- Keeps quality enforcement aligned with existing preview gate discipline (ADR-008, ADR-009).

### Trade-offs

- Checks are commit-scoped by design; they do not clean historical warnings outside changed files.
- Strict Prisma drift validation requires `SHADOW_DATABASE_URL` in CI for full coverage.
