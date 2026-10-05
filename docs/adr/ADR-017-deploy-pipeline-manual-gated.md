# ADR-017 — Deploy pipeline: manual-gated, no auto-deploy

**Status:** proposed (operator ratifies) · **Date:** 2026-08-05 · **Supersedes-in-part:** the implicit push-triggered deploy in `ci.yml` removed by PR #775 · **Owner:** Infra + operator (mandate §0)

## Context

The deploy pipeline had **no documented owner** and two silent hazards (A11):
1. `ci.yml` `deploy-staging` **and** `promote-deploy-branch` both triggered on **push to main** — auto-deploy that contradicts the operator's standing **NO AUTO-DEPLOY** mandate (§0). They only ever failed (SSH key unset), which made `main` show red on every commit and masked real gate failures; and left `deploy/production` frozen at #728.
2. There was **no first-class "Deploy to Staging" action** — staging was an ad-hoc VM process, running a ~22 July image while `main` moved ~150 commits ahead.

Facts this ADR builds on:
- **Images are built automatically and safely** by `build-images.yml` on push to main (`:main-<sha>`, `:main-latest`) — building/pushing an image touches no running host, so it is *not* a deploy and stays automatic.
- **Recreating containers on a host IS the deploy** and is a **Tier C action** (money/uptime/rollback-harder-than-git-revert). Per the merge-tier policy, Tier C = operator-only, forever.
- `deploy/production` is advanced by promoting `main → deploy/production`; a production deploy then runs `scripts/deploy/deploy-production.sh` on the droplet.

## Decision

**The deploy pipeline is manual-gated end to end. CI builds; a human deploys.**

```
push main ──(auto)──► build-images.yml → GHCR :main-<sha> / :main-latest      [automatic — no host touched]
                                              │
  operator clicks ───────────────────────────▼
  "Deploy to Staging" (deploy-staging.yml, workflow_dispatch)                  [MANUAL — operator]
      → build fresh staging-<sha> → SSH VM → deploy-staging.sh
        (preflight → pg_dump gacp_staging → migrate deploy → recreate → health)
                                              │
  operator verifies on staging (runbook §3, incl. functional watch-items) ─────▼
                                              │
  operator PROMOTES main → deploy/production  ▼                                [MANUAL — operator, explicit]
      (only after staging is verified good)
                                              │
  operator runs production deploy on the droplet ─► deploy-production.sh        [MANUAL — operator]
      (preflight → pg_dump → migrate → rolling recreate → smoke → ensure backup cron)
```

**Rules:**
1. **No job deploys on `push`.** Every deploy/promote job is `workflow_dispatch`-only or operator-run on the host. `ci.yml`'s `deploy-staging` is `workflow_dispatch`-only (#775); `promote-deploy-branch` stays `if: false` until this ADR is ratified and a deliberate manual promote path is added (a `workflow_dispatch` promote job, or an operator-run script) — it must **never** auto-follow staging.
2. **Who triggers:** the **operator only** initiates any deploy/promote. Agents propose (scripts, workflows, runbooks) but never run a deploy (no server access + Tier C).
3. **Criteria to advance a stage:**
   - *to staging:* the change is merged to `main` and its gates are green.
   - *to production (promote):* staging has been deployed **and verified good** (runbook §3 health + functional watch-items), and any Tier C changes in the batch were operator-merged.
4. **Freeze interaction:** when a compose-freeze is active (e.g. INCIDENT-2026-08-04), **all** deploy/recreate actions are blocked until the operator lifts it in writing — the freeze overrides this pipeline. (Freeze lifted 2026-08-05.)
5. **Secrets:** the staging/production deploy needs `PRODUCTION_HOST`, `PRODUCTION_USER`, `SSH_PRIVATE_KEY` (the last is currently unset — the reason the old job failed). Alternative: a self-hosted runner on the VM (SSH steps become local). This is an operator provisioning decision.
6. **Every deploy is auditable:** `deploy-*.sh` log to `/var/log/gacp-deploys/`; the daily DB-backup cron is ensured on every production deploy (A12).

## Consequences

- `main` stays green (no perpetual deploy-job failure). Real gate failures are visible again.
- Staging deploys are stepwise and reversible (pre-deploy `pg_dump`, additive migrations, documented rollback — runbook `deploy-staging-manual.md`).
- Production never advances by accident; promotion is a deliberate, verified, operator act.
- Cost: the operator must click/run each stage (by design). The `deploy-staging.yml` workflow (A11 part 2) makes staging a one-click action once `SSH_PRIVATE_KEY` is set.

## Follow-ups

- Ratify this ADR; then add a deliberate manual **promote** path (replace `promote-deploy-branch: if:false` with a `workflow_dispatch` promote job that requires an explicit confirmation input) — or keep promotion an operator-run script. Operator decides.
- Set `SSH_PRIVATE_KEY` (or adopt a self-hosted VM runner) to enable `deploy-staging.yml`.
- A3: alert on backup-cron freshness (>25h) and on a staging/prod health regression.

## Related

- PR #775 (removed push-triggered auto-deploy) · `deploy-staging.yml` (A11 part 2) · `docs/operations/runbooks/deploy-staging-manual.md` (A11 part 3) · `scripts/deploy/deploy-production.sh` + A12 backup-cron wiring · merge-tier policy (`scripts/probes/tier-check.sh`).
