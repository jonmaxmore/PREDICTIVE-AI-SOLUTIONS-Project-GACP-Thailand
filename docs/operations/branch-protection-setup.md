# Branch protection setup — main

> Status: **pending, and the "required status checks" half is currently
> unusable.** Date of writing: 2026-04-28 · truth-checked 2026-08-14.
>
> Every check named below is a GitHub Actions job, and Actions is permanently
> unavailable (operator ruling — the change log 2026-08-14). A required check
> that can never report leaves every PR unmergeable, so **do not enable the
> status-check requirement as written**. The branch-hygiene half (no direct
> push, no force-push, no deletion, 1 approval, linear history) is independent
> of Actions and still worth enabling.
>
> What proves a commit was gated today: `scripts/ci/full-gate.sh` on the staging
> box writes `evidence/gate/<sha>.json`, and the probe `gate-attestation`
> (in the `ci` probe set) fails when a commit touching `apps/` has none. That is
> visibility, not enforcement — nothing can block a merge without branch
> protection, and that gap is stated in the probe registry itself.
> Why now: post-v3.2.0 release, production-grade safety infrastructure
> (release-test-gate, tenant guardrail, CSP/HSTS, etc.)
> is in place. Without branch protection on `main`, any of those gates
> can be bypassed with a direct push. Protection turns "best practice"
> into "enforced policy".

## What this gives us

- No direct pushes to `main` — every change must go through a PR.
- No force-pushes — git history on `main` is append-only.
- No deletions — `main` cannot be deleted accidentally.
- PRs require: 1 approval, status checks green, conversations resolved,
  linear history.
- Required status checks block merge until they pass.
- Even repository admins cannot bypass (this is the government-grade
  posture; relax later if it gets in the way).

## Pre-flight — verify all required checks are running green

Before enabling protection with required status checks, the named
checks below must have at least one successful run on `main` so that
GitHub recognises them as a valid status. Otherwise the protection
config refers to checks that "never report" and every PR gets stuck.

The required-check list below is **deliberately small**. `Build Success`
in `ci.yml` is a meta-job that depends on `[lint, test, auth-hardening,
bi-integrity, ux-ui-baseline, security, erp-regression, runtime-readiness,
e2e]` — gating on it transitively gates on all of those. Adding new
gates to `ci.yml` later automatically inherits the protection without
having to edit this ruleset every time.

DO NOT include `Validate Release Topology`, `Release Test Gate`, or
`Build & Push Container Images` — those workflows fire on tag/push,
not on pull requests, so requiring them on PRs causes every PR to
hang forever.

Verify each of these is GREEN at least once on the latest `main` SHA:

```text
System Integrity Check
Build Success
```

If any are still red, fix them first (paste the failing log into a
new branch, work through it, re-push). Branch protection is the
LAST step — not the first.

## Procedure — enable protection

1. Open the repo settings:
   <https://github.com/jonmaxmore/GACP-Certification-Application/settings/branches>

2. Click **Add branch ruleset** (the modern UI; it replaces the older
   "branch protection rules"). Use a ruleset rather than a classic rule
   so it generalises to other branches (`deploy/production` later).

3. Configure the ruleset:

   ```
   Ruleset name: main-protection
   Enforcement status: Active

   Bypass list:
     (empty — no bypass, even for admins)

   Target branches:
     [+] Add target → Include default branch
     (this targets `main` automatically)

   Branch protections:
     [x] Restrict deletions
     [x] Block force pushes
     [x] Require linear history
     [x] Require a pull request before merging
         Required approvals: 1
         [x] Dismiss stale pull request approvals when new commits are pushed
         [x] Require approval of the most recent reviewable push
         [x] Require conversation resolution before merging
         (Code Owners: enable when CODEOWNERS file exists)

     [x] Require status checks to pass
         [x] Require branches to be up to date before merging
         Required status checks (type each name + Add):
           System Integrity Check
           Build Success
           review

         (Build Success is a meta-job in ci.yml that already requires
         lint / test / auth-hardening / bi-integrity / ux-ui-baseline /
         security / erp-regression / runtime-readiness / e2e — gating
         on it gates on all of them transitively.)

     [x] Require code scanning results
         (only if/when CodeQL is enabled — currently behind
          `vars.ENABLE_CODEQL`; safe to leave off until then)
   ```

4. Click **Create**.

## Day-after smoke test

After enabling, the next time anyone tries to push directly to main:

```bash
git push origin main
# remote: error: GH013: Repository rule violations
# remote: - Cannot update this protected ref
# ! [remote rejected] main -> main (push declined due to repository rule violations)
```

That's the success signal — the rule is enforced.

To merge any change going forward:

```bash
git checkout -b feat/my-change
# ... edit, commit ...
git push -u origin feat/my-change
gh pr create --title "..." --body "..."   # or via web UI
# wait for CI green + review
gh pr merge --squash    # or via web UI
```

## Future tightening (optional)

When the team grows beyond a single committer, layer on:

- **Increase required approvals**: 1 → 2 for high-risk paths.
- **CODEOWNERS file**: route reviews to domain experts automatically.
- **Required signed commits**: enforce GPG / SSH signing.
- **Restrict who can push to matching branches**: limit branch creation
  to specific teams.

## Rollback (if protection blocks legitimate work)

GitHub branch protection has no per-PR bypass once locked. If genuinely
stuck (e.g., hot-fix during an incident and a required check is broken):

1. Settings → Branches → main-protection → temporarily set
   **Enforcement status: Disabled**
2. Apply the hotfix
3. Re-enable protection immediately after

Do this through audit-trail tools (settings changes are logged), not
ad-hoc.
