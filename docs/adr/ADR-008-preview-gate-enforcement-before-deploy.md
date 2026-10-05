# ADR-008: Enforce Preview Gates Before Any Production Deploy

- Status: Accepted
- Date: 2026-02-22

## Context

The repository has multiple CI/CD workflows (`ci.yml`, `production.yml`, `build-images.yml`).
Before this ADR, some production deployment paths could run without explicitly verifying that preview-level quality/security gates were successful on the latest `main` commit.

This created avoidable risk:
- Security hardening regressions could bypass deploy if workflow dependencies drifted.
- Manual dispatch and automated deploy paths could enforce different standards.
- Review discipline could become inconsistent across teams.

## Decision

We enforce a single required gate set before production deploy execution:

- `Auth Hardening Gate`
- `ERP Regression Gate`
- `Build Success`

Implementation:

- `ci.yml` produces all three required checks. `Build Success` is a meta-job that depends on auth-hardening, erp-regression, lint, test, bi-integrity, ux-ui-baseline, security, runtime-readiness, e2e, and enforcement-guardrails — gating on it transitively gates on the full preview surface.
- `production.yml` adds `release-test-gate` (Phase 1 #1.10) so production deploys on tag also re-run the unit suite.
- `ci.yml` `deploy-staging` / `promote-deploy-branch` / `deploy` jobs use `needs: [build-success]` to ensure no main commit is promoted until the gate is green.

**2026-04-28 update**: `ci-cd.yml` (which originally hosted `verify-preview-gates`) was deleted as duplicate of `ci.yml`. The polling-style `verify-preview-gates` is no longer needed because `ci.yml`'s deploy jobs gate directly on `build-success` within the same workflow run.

## Consequences

### Positive

- Production promotion is consistently blocked until preview-quality evidence exists.
- Security and regression expectations are uniform across manual and automated deploy paths.
- Reduced risk of accidental process bypass.

### Trade-offs

- Deploy start may wait for upstream checks (polling delay).
- Workflow maintenance must keep required check names stable and synchronized.

## Operational Notes

- If check names change in `ci.yml`, update all gate verification lists in deploy workflows in the same PR.
- Do not relax required checks without a new ADR that explicitly supersedes this one.
