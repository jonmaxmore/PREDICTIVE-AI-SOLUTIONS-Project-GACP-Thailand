# Security CI Policy

**Status**: **NOT IN FORCE as written** (was ACTIVE 2026-05-17, Iter W2)
**Owner**: Platform / Ops
**Audience**: Engineers landing PRs, Ops on call, Security reviewers
**Truth-checked**: 2026-08-14

> **Read this before relying on anything below.** Every gate in this document is
> a GitHub Actions job. The operator ruled on 2026-08-14 that Actions will not be
> paid for (the change log 2026-08-14), so none of these jobs can dispatch —
> including `security-scan.yml` (TruffleHog/SAST) and the `security` job's
> `pnpm audit`. What survives, and where:
>
> | scan | live home today |
> |---|---|
> | deep secret scan | full-gate required check `secret-scan-deep` (gitleaks over the full history) — `scripts/ci/full-gate-checks.txt`; scanner absent = NOT-RUN, never PASS |
> | grep-level secret pin | probe `no-secret` in the `ci` set, run by `scripts/ci/probe-gate.js` from local-gate/full-gate |
> | `pnpm audit` ≥ high | **nowhere.** No gate runs it |
> | CVE-suppression register | **nowhere automated** — `node scripts/ci/check-vulnerability-exceptions.js` by hand |
> | SAST / CodeQL | **nowhere** |
>
> The sections below are kept as the specification of the intended policy and as
> the exception process (which still governs `security/vulnerability-exceptions.json`).
> Do not cite them as evidence that a scan ran.

---

## Purpose

This document is the single source of truth for which security scans are meant to
gate merges to `main` and how to handle exceptions. Before W2 the four
scans in `.github/workflows/security-scan.yml` plus the npm-audit job in
`.github/workflows/ci.yml` were all `continue-on-error: true` (advisory
only). W2 flipped them to gating. The trade-off was intentional:
supply-chain CVEs, verified secret leaks, and SAST findings blocked
the merge — until the runner that executed them went away (see the status note
above).

---

## Gating jobs (5)

The following five CI jobs FAIL the workflow if they fail. A red ❌ on
any one of them blocks the PR from being merged into `main` (branch
protection enforces this via the `Build Success` aggregator and / or the
job's individual required-check entry).

| # | Workflow | Job | Tool | Threshold |
|---|---|---|---|---|
| 1 | `security-scan.yml` | `dependency-review` | GitHub Dependency Review action | `fail-on-severity: high` |
| 2 | `security-scan.yml` | `codeql` | GitHub CodeQL (JavaScript) | Any new alert at severity ≥ high |
| 3 | `security-scan.yml` | `secret-scanning` | TruffleHog (`--only-verified`) | Any verified secret in the diff |
| 4 | `security-scan.yml` | `sast` | Semgrep (`p/security-audit p/javascript p/typescript p/nodejs`) | Any blocking finding from the configured rulesets |
| 5 | `ci.yml` | `security` | `pnpm audit --audit-level=high` (repo root) | Any advisory ≥ high severity across the entire pnpm workspace |

### Why a workspace-wide `pnpm audit` instead of per-workspace `npm audit`?

Pre-W2 the job ran `npm audit --audit-level=high` from
`apps/backend`. That always failed with:

```
npm ERR! code ENOLOCK
npm ERR! audit This command requires an existing lockfile.
```

because this repository is a pnpm workspace — the only lockfile is
`pnpm-lock.yaml` at the repo root. Per-workspace `package-lock.json`
files do not exist by design. With `continue-on-error: true`, the
failure was invisible: every run reported success while no audit was
actually performed.

W2 migrated to `pnpm audit --audit-level=high` at the repo root. One
invocation covers the root `package.json`, `apps/backend/package.json`,
and `apps/web-app/package.json` plus every transitive dependency in a
single pass — strictly more coverage than the broken per-workspace
script, with no false sense of safety.

---

## CodeQL precondition: `ENABLE_CODEQL` repository variable

CodeQL is gated by `if: vars.ENABLE_CODEQL == 'true'` (security-scan.yml
line 32). This is intentional and orthogonal to W2's gating flip:

- If `ENABLE_CODEQL` is **unset** or any value other than `'true'`, the
  CodeQL job is SKIPPED. A skipped job neither passes nor fails — it is
  invisible to the merge gate.
- If `ENABLE_CODEQL == 'true'`, the CodeQL job RUNS and is gating: a
  failure blocks the merge.

W2 did not change the `ENABLE_CODEQL` variable because it is an Ops
decision (CodeQL consumes GitHub Advanced Security minutes and emits
findings into Security tab — both have governance implications). To
enable CodeQL repo-wide:

1. A repo admin / Ops navigates to **Settings → Secrets and variables →
   Actions → Variables → New repository variable**.
2. Name: `ENABLE_CODEQL`, Value: `true`.
3. Confirm. The next push to `main` (or scheduled Monday run) executes
   the CodeQL analyse step. Any high-severity finding will block merges
   until remediated or explicitly overridden via the procedure below.

---

## Override procedure (do NOT skip lightly)

When a CI security gate fails on a PR you believe should land
regardless, follow this order:

### Tier 1 — Remediate (preferred, > 95% of cases)

- **Dependency Review / pnpm audit**: bump the dep, use a `pnpm`
  override in root `package.json`, or replace the dep entirely. See
  `docs/handoffs/iter-W2/W2-A-audit-triage.md` (created by W2-A) for
  the catalogue of accepted residuals and remediation patterns.
- **Semgrep**: fix the code. Semgrep findings on `p/security-audit` are
  rarely false positives.
- **TruffleHog**: ROTATE the secret immediately, then remove from the
  diff. NEVER push a workaround that hides a real leak.
- **CodeQL**: triage in the Security tab. Real findings → fix. False
  positives → suppress via inline `// codeql[js/...]` comment with a
  justification.

### Tier 2 — Time-boxed acceptance (rare, requires written sign-off)

If remediation cannot land in the same PR (e.g., upstream patch not yet
released, multi-day dep migration), record the exception in
`docs/operations/security-ci-accepted-residuals.md` (created on first
exception) with:

- (a) GHSA / CVE ID or Semgrep rule ID
- (b) affected package and version range
- (c) why it is safe to merge today (compensating control)
- (d) owner + re-evaluate-by date (≤ 14 days)
- (e) tracking issue link

Then suppress the specific finding via the tool's native mechanism:

- pnpm audit: add to `pnpm.auditConfig.ignoreGhsas` in root
  `package.json` (with a comment pointing at the residuals doc)
- Semgrep: add `// nosemgrep: <rule-id>` with justification
- CodeQL: dismiss via Security tab with reason "won't fix" + comment
- Dependency Review: there is no per-advisory ignore — must either fix
  or temporarily lower the `fail-on-severity` threshold on a branch
  (NOT main) and merge with explicit Ops approval recorded in the PR
  description

### Tier 3 — Emergency bypass (incident-only, post-mortem required)

For a genuine production-incident hotfix that cannot wait, a repo admin
may temporarily disable the failing job by editing the workflow YAML on
a hotfix branch. The PR description MUST link to the incident ticket.
A post-mortem MUST land within 48 hours that either re-enables the gate
or documents the residual under Tier 2. The hotfix PR is exempt only
for the single merge.

---

## What changed in W2 (audit trail)

Pre-W2 state (confirmed 2026-05-17):

- `.github/workflows/security-scan.yml` — 4 jobs all
  `continue-on-error: true` (lines 19, 47-50, 62, 80)
- `.github/workflows/ci.yml` — `security` job
  `continue-on-error: true` (line 460) running broken per-workspace
  `npm audit --audit-level=high` (always ENOLOCK)

W2 commit (this change):

- security-scan.yml: removed `continue-on-error: true` from all 4 jobs
  (`dependency-review`, `codeql`, `secret-scanning`, `sast`). CodeQL's
  `if: vars.ENABLE_CODEQL == 'true'` precondition retained.
- ci.yml: replaced broken per-workspace `npm audit
  --audit-level=high` with workspace-wide `pnpm audit
  --audit-level=high` at the repo root. Removed `continue-on-error:
  true`. The `security` job is already in the `build-success`
  `needs:` array (ci.yml line 579), so flipping it makes it a true
  merge gate.

Post-W2 state: all 5 scans gating; CodeQL remains conditional on
`ENABLE_CODEQL` repo variable. Branch protection on `main` should
require `Build Success` (existing) plus the four `security-scan.yml`
jobs individually if scheduled-run failures should also block (Ops
decision — see `docs/operations/branch-protection-setup.md`).

---

## See also

- `.github/workflows/security-scan.yml` — the 4 scans
- `.github/workflows/ci.yml` (search for `security:`) — the pnpm audit
  job
- `docs/handoffs/iter-W2/W2-A-audit-triage.md` — per-advisory remediation
  decisions for the W2 surface (84 → 0 high+critical target)
- `docs/handoffs/iter-W2/W2-B.md` — this PR's handoff
- `docs/operations/branch-protection-setup.md` — required-checks config
  on `main`
