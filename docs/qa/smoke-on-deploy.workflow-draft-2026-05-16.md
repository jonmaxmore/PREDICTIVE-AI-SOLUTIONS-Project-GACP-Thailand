# DRAFT — `.github/workflows/smoke-on-deploy.yml`

**Date:** 2026-05-16
**Owner:** QA (hardening loop, Iter 29)
**Status:** WRITTEN BUT NOT COMMITTED. The orchestrator (hardening loop release
manager) decides when to copy this file to `.github/workflows/` to activate it.

---

## Why this file is parked here

`.github/workflows/` files become active the moment they land on a branch
that GitHub Actions watches. We don't want the smoke workflow to start
firing while the rest of the deploy pipeline is still being shaken out in
Iter 28 + Iter 30 work, and we want a release manager to make the call
about which trigger surface (push-only? webhook? both?) goes live first.

Once the orchestrator approves activation, do exactly:

```bash
cp docs/qa/smoke-on-deploy.workflow-draft-2026-05-16.md \
   /tmp/extract-workflow.md
# (then extract the YAML block below into the actual workflow file)
cat > .github/workflows/smoke-on-deploy.yml <<'YAML'
<paste contents of the ``` yaml block below ```>
YAML
git add .github/workflows/smoke-on-deploy.yml
git commit -m "ci: activate smoke-on-deploy workflow (Iter 29)"
```

The YAML below is verbatim — do not edit during the copy.

---

## Workflow design

### Trigger surface

Two triggers, by design:

1. **`repository_dispatch` event `deploy-completed`** — sent by the
   production deploy pipeline (or any external orchestrator) the moment
   a deploy reaches "complete". This is the **post-deploy webhook** the
   spec calls for.
2. **`workflow_dispatch`** — manual button. Lets SRE re-run the smoke at
   will (e.g. after a config rollback, before a chaos drill).

Branch-push triggers are **deliberately omitted** — smoke must run against
*the deployed environment*, not source. Coupling the trigger to a push
would make the smoke a CI-only check, not a post-deploy gate.

### Failure routing

A failed smoke run does two things:

1. Exits the job non-zero (visible in the Actions tab + PR check list).
2. Sends an on-call alert via PagerDuty webhook. The on-call SRE then
   decides whether to roll back. We do **not** auto-rollback from this
   workflow — a smoke failure could be a transient blip, and an automatic
   rollback storm during a real incident would compound damage.

### Environments

The workflow targets **either** staging **or** production. Caller chooses
via the `target` input on `workflow_dispatch`, or via the
`client_payload.target` field on `repository_dispatch`.

---

## YAML — copy verbatim when activating

```yaml
name: Smoke on Deploy

# DO NOT MOVE this file to `.github/workflows/` until the orchestrator
# (hardening loop release manager) has signed off. See
# docs/qa/smoke-on-deploy.workflow-draft-2026-05-16.md for context.

on:
  # Fired by the deploy pipeline (or any external orchestrator) the
  # moment a deploy reaches "complete". client_payload must contain:
  #   { "target": "staging" | "production",
  #     "image_tag": "<deployed image tag>",
  #     "actor": "<who triggered the deploy>" }
  repository_dispatch:
    types: [deploy-completed]

  # Manual button — SRE can re-run smoke any time.
  workflow_dispatch:
    inputs:
      target:
        description: Environment to smoke-test
        required: true
        type: choice
        options:
          - staging
          - production
        default: staging

env:
  NODE_VERSION: '20'

concurrency:
  # Never run two smoke jobs against the same environment in parallel.
  # A second deploy that fires while the first smoke is still in flight
  # will queue here rather than fight for the same metrics window.
  group: smoke-${{ github.event.inputs.target || github.event.client_payload.target }}
  cancel-in-progress: false

jobs:
  smoke:
    name: Post-deploy smoke
    runs-on: ubuntu-latest
    timeout-minutes: 10

    # Resolve target. workflow_dispatch puts it on inputs;
    # repository_dispatch puts it on client_payload.
    env:
      TARGET: ${{ github.event.inputs.target || github.event.client_payload.target }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v3
        with:
          version: 8

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'

      - name: Install backend dependencies
        run: pnpm install --frozen-lockfile --ignore-scripts

      # ────────────────────────────────────────────────────────────────
      # Step 1 — Run the hermetic Jest smoke suite. This proves the
      # backend code base itself is shippable; mocks isolate the suite
      # from network state.
      # ────────────────────────────────────────────────────────────────
      - name: Jest smoke (hermetic, < 10s)
        working-directory: apps/backend
        run: |
          npx jest __tests__/integration/production-smoke \
            --no-coverage \
            --runInBand \
            --bail

      # ────────────────────────────────────────────────────────────────
      # Step 2 — Black-box probe against the deployed environment.
      # This is the second half of the smoke: prove the actual hosts
      # serve the contract the Jest suite asserts in mock form.
      # ────────────────────────────────────────────────────────────────
      - name: Resolve target URL
        id: target_url
        run: |
          case "${TARGET}" in
            staging)    echo "url=https://staging.gacp.dtam.go.th" >> "$GITHUB_OUTPUT" ;;
            production) echo "url=https://gacp.dtam.go.th" >> "$GITHUB_OUTPUT" ;;
            *)
              echo "::error::Unknown target '${TARGET}'"
              exit 1
              ;;
          esac

      - name: Probe /api/health on ${{ env.TARGET }}
        run: |
          URL="${{ steps.target_url.outputs.url }}/api/health"
          echo "Probing $URL"
          for i in 1 2 3 4 5; do
            if curl -fsS --max-time 5 "$URL" -o /tmp/health.json; then
              cat /tmp/health.json
              if jq -e '.success == true' /tmp/health.json > /dev/null; then
                echo "Health probe succeeded on attempt $i"
                exit 0
              fi
            fi
            echo "Attempt $i failed, retrying in 5s"
            sleep 5
          done
          echo "::error::Health probe failed after 5 attempts on $URL"
          exit 1

      - name: Probe public verify endpoint
        run: |
          CERT="${{ secrets.SMOKE_CERT_NUMBER }}"
          URL="${{ steps.target_url.outputs.url }}/api/auth/public/verify/${CERT}"
          curl -fsS --max-time 5 "$URL" | jq -e '.success == true'

      # ────────────────────────────────────────────────────────────────
      # Step 3 — On failure, page the on-call. Success path does not
      # notify, by design — alert fatigue is real.
      # ────────────────────────────────────────────────────────────────
      - name: Notify on-call on failure
        if: failure()
        uses: actions/github-script@v7
        env:
          PAGERDUTY_INTEGRATION_KEY: ${{ secrets.PAGERDUTY_INTEGRATION_KEY }}
          TARGET: ${{ env.TARGET }}
          DEPLOY_ACTOR: ${{ github.event.client_payload.actor || github.actor }}
          IMAGE_TAG: ${{ github.event.client_payload.image_tag || 'manual' }}
        with:
          script: |
            const fetch = (await import('node-fetch')).default;
            const payload = {
              routing_key: process.env.PAGERDUTY_INTEGRATION_KEY,
              event_action: 'trigger',
              payload: {
                summary: `Smoke failed on ${process.env.TARGET} (deploy ${process.env.IMAGE_TAG})`,
                source: 'github-actions:smoke-on-deploy',
                severity: process.env.TARGET === 'production' ? 'critical' : 'warning',
                component: 'gacp-backend',
                group: process.env.TARGET,
                custom_details: {
                  workflow_run: `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`,
                  deploy_actor: process.env.DEPLOY_ACTOR,
                  image_tag: process.env.IMAGE_TAG,
                  target: process.env.TARGET,
                },
              },
            };
            const res = await fetch('https://events.pagerduty.com/v2/enqueue', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            if (!res.ok) {
              core.setFailed(`PagerDuty enqueue failed: ${res.status} ${await res.text()}`);
            }

      - name: Summary
        if: always()
        run: |
          echo "## Smoke result: ${{ job.status }}" >> "$GITHUB_STEP_SUMMARY"
          echo "Target: ${TARGET}" >> "$GITHUB_STEP_SUMMARY"
          echo "Triggered by: ${{ github.event_name }}" >> "$GITHUB_STEP_SUMMARY"
          if [ "${{ github.event_name }}" = "repository_dispatch" ]; then
            echo "Image tag: ${{ github.event.client_payload.image_tag }}" >> "$GITHUB_STEP_SUMMARY"
            echo "Deploy actor: ${{ github.event.client_payload.actor }}" >> "$GITHUB_STEP_SUMMARY"
          fi
```

---

## Secrets the workflow needs

When the orchestrator activates this workflow, set these repo-level
secrets first:

| Secret name                  | Used by                | Notes |
|------------------------------|------------------------|-------|
| `PAGERDUTY_INTEGRATION_KEY`  | failure-notify step    | Service integration key, not user API key. |
| `SMOKE_CERT_NUMBER`          | public-verify probe    | A known-valid cert number that exists in BOTH staging + prod seed data. |

Repository **variables** (not secrets) optional:

| Variable name | Purpose |
|---------------|---------|
| `SMOKE_TIMEOUT_MS` | Override per-probe timeout. Default 5000. |

---

## Test plan before activation

1. Land the workflow on a feature branch (NOT `main`).
2. Manually trigger via `workflow_dispatch` against staging only.
3. Verify both steps run + summary appears.
4. Force a failure (point at a bogus cert) — verify PagerDuty receives
   the test event (use a "smoke-test" service in PagerDuty so it doesn't
   page the real on-call).
5. Switch the PagerDuty integration to the real on-call service.
6. Merge to `main`. The workflow now waits for `repository_dispatch`
   events from the deploy pipeline.
7. Coordinate with the deploy pipeline owner to start emitting
   `deploy-completed` repository_dispatch events.

---

## References

- Smoke test suite: `apps/backend/__tests__/integration/production-smoke.test.js`
- Smoke runbook: `docs/qa/smoke-test-runbook-2026-05-16.md`
- Existing CI surface: `.github/workflows/ci.yml`, `.github/workflows/production.yml`
- PagerDuty Events API v2: https://developer.pagerduty.com/docs/events-api-v2/trigger-events/
- `repository_dispatch` reference: https://docs.github.com/actions/using-workflows/events-that-trigger-workflows#repository_dispatch
