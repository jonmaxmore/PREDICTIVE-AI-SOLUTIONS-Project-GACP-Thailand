#!/usr/bin/env bash
#
# scripts/deploy-prod.sh — Iter 29 (2026-05-16) production deploy wrapper
#
# A POSIX-bash deploy harness intended to be runnable on:
#   - a production server (run locally over SSH)
#   - a CI runner targeting production via SSH or kubectl
#   - a developer laptop performing a controlled cut against a staging-prod
#
# This script INTENTIONALLY does the minimum needed to roll an image-based
# deploy forward safely. The historical `scripts/deploy/deploy-production.sh`
# remains the canonical droplet-based deploy harness; `deploy-prod.sh` is
# the slimmer, orchestrator-agnostic checklist that wraps it.
#
# Pre-flight  → Build → DB migrate → Smoke → Orchestrator notify → Verify
#
# Flow (exit codes match Iter 27 / Iter 29 contracts):
#   0   success
#   10  pre-flight failed (NODE_ENV / secrets / git state)
#   20  build failed
#   30  migration failed
#   40  smoke test failed
#   50  orchestrator notify failed
#   60  post-deploy verify failed
#
# Inputs (env, all optional unless noted):
#   NODE_ENV                 must be "production" (default fail-closed)
#   ROLLBACK_SHA_FILE        path to write pre-deploy SHA (default /tmp/gacp-rollback-sha)
#   HEALTH_URL               smoke-test target (default http://localhost:8000/api/health)
#   READY_URL                readiness target (default http://localhost:8000/api/health/ready)
#   DEPLOY_TARGET            "compose" | "systemd" | "k8s" | "none" (default "compose")
#   COMPOSE_FILE             path for DEPLOY_TARGET=compose (default docker-compose.production.yml)
#   KUBE_DEPLOYMENT          deployment name for DEPLOY_TARGET=k8s (e.g. "gacp-backend")
#   KUBE_NAMESPACE           namespace for DEPLOY_TARGET=k8s (default "default")
#   SYSTEMD_UNIT             unit name for DEPLOY_TARGET=systemd (e.g. "gacp-backend.service")
#   SKIP_BUILD               "true" to skip pnpm build (use a CI-prebuilt image)
#   SKIP_MIGRATE             "true" to skip prisma migrate deploy (already done out-of-band)
#
# Usage:
#   NODE_ENV=production ./scripts/deploy-prod.sh
#   NODE_ENV=production DEPLOY_TARGET=k8s KUBE_DEPLOYMENT=gacp-backend ./scripts/deploy-prod.sh
#
# Rollback:
#   The pre-deploy git SHA is captured to $ROLLBACK_SHA_FILE during phase 1.
#   See docs/operations/rollback-runbook-2026-05-16.md for the recovery flow.

set -Eeuo pipefail

# ─── Config + helpers ────────────────────────────────────────────────────

NODE_ENV_REQUIRED="production"
ROLLBACK_SHA_FILE="${ROLLBACK_SHA_FILE:-/tmp/gacp-rollback-sha}"
HEALTH_URL="${HEALTH_URL:-http://localhost:8000/api/health}"
READY_URL="${READY_URL:-http://localhost:8000/api/health/ready}"
DEPLOY_TARGET="${DEPLOY_TARGET:-compose}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
KUBE_DEPLOYMENT="${KUBE_DEPLOYMENT:-}"
KUBE_NAMESPACE="${KUBE_NAMESPACE:-default}"
SYSTEMD_UNIT="${SYSTEMD_UNIT:-}"
SKIP_BUILD="${SKIP_BUILD:-false}"
SKIP_MIGRATE="${SKIP_MIGRATE:-false}"

# Resolve script directory + repo root regardless of caller's cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

TS="$(date +%Y%m%d-%H%M%S)"

# Plain-text logging (no emojis per Iter 29 spec).
log()  { printf '[%s] [deploy-prod] %s\n' "$(date +%H:%M:%S)" "$*"; }
fail() { printf '[%s] [deploy-prod] FAIL: %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
ok()   { printf '[%s] [deploy-prod] OK:   %s\n' "$(date +%H:%M:%S)" "$*"; }

trap 'fail "aborted on line $LINENO (exit $?)"' ERR

# ─── 1/6 Pre-flight ──────────────────────────────────────────────────────

log "phase 1/6 pre-flight checks"

if [ "${NODE_ENV:-}" != "$NODE_ENV_REQUIRED" ]; then
    fail "NODE_ENV must be '$NODE_ENV_REQUIRED' (got '${NODE_ENV:-<unset>}')"
    fail "  refusing to deploy: set NODE_ENV=production explicitly"
    exit 10
fi
ok "  NODE_ENV=$NODE_ENV"

# Validate Iter 27 secret catalog. Calls into apps/backend/scripts/check-secrets.js;
# exit code is the source of truth (1 = missing/short/pending sentinel).
SECRETS_SCRIPT="apps/backend/scripts/check-secrets.js"
if [ ! -f "$SECRETS_SCRIPT" ]; then
    fail "secrets validator missing: $SECRETS_SCRIPT"
    fail "  this script is required (Iter 27) — refusing to deploy"
    exit 10
fi

# Run secrets validation inside the backend workspace so its require('./config/...')
# paths resolve. Capture exit code without aborting (pipefail + set -e).
SECRETS_RC=0
node "$SECRETS_SCRIPT" --env="$NODE_ENV" || SECRETS_RC=$?
if [ "$SECRETS_RC" -ne 0 ]; then
    fail "secret catalog readiness check FAILED (exit $SECRETS_RC)"
    fail "  fix the listed secrets in your production secret manager, then re-run"
    exit 10
fi
ok "  secrets catalog: all required secrets present"

# Capture pre-deploy SHA so a rollback can `git reset --hard <sha>` deterministically.
# `git` is optional in some container-only deploy paths — if not present, skip with a warning.
PRE_DEPLOY_SHA=""
if command -v git >/dev/null 2>&1 && [ -d ".git" ]; then
    PRE_DEPLOY_SHA="$(git rev-parse HEAD 2>/dev/null || echo "")"
fi
if [ -n "$PRE_DEPLOY_SHA" ]; then
    printf '%s\n' "$PRE_DEPLOY_SHA" > "$ROLLBACK_SHA_FILE"
    ok "  pre-deploy SHA captured to $ROLLBACK_SHA_FILE ($PRE_DEPLOY_SHA)"
else
    log "  pre-deploy SHA: not available (no .git dir or git binary); rollback must use image tag"
fi

# ─── 2/6 Build ───────────────────────────────────────────────────────────

log "phase 2/6 build"

if [ "$SKIP_BUILD" = "true" ]; then
    log "  SKIP_BUILD=true — assuming a CI-prebuilt image already pushed to the registry"
else
    if ! command -v pnpm >/dev/null 2>&1; then
        fail "pnpm not on PATH and SKIP_BUILD!=true"
        fail "  install pnpm or set SKIP_BUILD=true if the image is prebuilt"
        exit 20
    fi
    if ! pnpm install --frozen-lockfile; then
        fail "pnpm install --frozen-lockfile failed"
        exit 20
    fi
    if ! pnpm build; then
        fail "pnpm build failed"
        exit 20
    fi
    ok "  build complete"
fi

# ─── 3/6 Database migrations ─────────────────────────────────────────────

log "phase 3/6 database migrations"

if [ "$SKIP_MIGRATE" = "true" ]; then
    log "  SKIP_MIGRATE=true — assuming migrations were applied out-of-band"
else
    # Run migrations from the backend workspace where prisma/schema/ lives.
    if ! (cd apps/backend && npx --no-install prisma migrate deploy); then
        fail "prisma migrate deploy failed"
        fail "  inspect: cd apps/backend && npx prisma migrate status"
        fail "  database state may be partially migrated — see runbook before retrying"
        exit 30
    fi
    ok "  migrations applied"
fi

# ─── 4/6 Orchestrator notify (rolling restart) ──────────────────────────

log "phase 4/6 orchestrator notify (target=$DEPLOY_TARGET)"

case "$DEPLOY_TARGET" in
    none)
        log "  DEPLOY_TARGET=none — caller manages restarts; skipping"
        ;;
    compose)
        if [ ! -f "$COMPOSE_FILE" ]; then
            fail "compose file not found: $COMPOSE_FILE"
            exit 50
        fi
        if ! command -v docker >/dev/null 2>&1; then
            fail "docker not on PATH but DEPLOY_TARGET=compose"
            exit 50
        fi
        # Rolling restart of the backend+frontend services only — leave
        # postgres/redis/nginx untouched (they run independently and cycling
        # them would drop user connections unnecessarily).
        if ! docker compose -f "$COMPOSE_FILE" up -d --no-deps backend frontend; then
            fail "docker compose up -d --no-deps backend frontend failed"
            exit 50
        fi
        ok "  compose rolling restart issued"
        ;;
    systemd)
        if [ -z "$SYSTEMD_UNIT" ]; then
            fail "DEPLOY_TARGET=systemd but SYSTEMD_UNIT is empty"
            exit 50
        fi
        if ! command -v systemctl >/dev/null 2>&1; then
            fail "systemctl not on PATH but DEPLOY_TARGET=systemd"
            exit 50
        fi
        # `reload-or-restart` lets the unit's ExecReload (if defined) issue a
        # SIGHUP, falling back to a full restart only if reload is unavailable.
        if ! systemctl reload-or-restart "$SYSTEMD_UNIT"; then
            fail "systemctl reload-or-restart $SYSTEMD_UNIT failed"
            exit 50
        fi
        ok "  systemd: $SYSTEMD_UNIT reloaded"
        ;;
    k8s)
        if [ -z "$KUBE_DEPLOYMENT" ]; then
            fail "DEPLOY_TARGET=k8s but KUBE_DEPLOYMENT is empty"
            exit 50
        fi
        if ! command -v kubectl >/dev/null 2>&1; then
            fail "kubectl not on PATH but DEPLOY_TARGET=k8s"
            exit 50
        fi
        # `rollout restart` triggers a rolling pod update with the existing
        # template (assumes a new image was pushed under the same tag, or the
        # PodTemplate was already patched out-of-band). Wait for rollout to
        # complete so the smoke phase tests the NEW pods, not a half-rolled set.
        if ! kubectl -n "$KUBE_NAMESPACE" rollout restart "deployment/$KUBE_DEPLOYMENT"; then
            fail "kubectl rollout restart failed"
            exit 50
        fi
        if ! kubectl -n "$KUBE_NAMESPACE" rollout status "deployment/$KUBE_DEPLOYMENT" --timeout=300s; then
            fail "kubectl rollout status timed out — pods are not healthy"
            exit 50
        fi
        ok "  k8s: deployment/$KUBE_DEPLOYMENT rolled out"
        ;;
    *)
        fail "unknown DEPLOY_TARGET: $DEPLOY_TARGET"
        fail "  valid values: compose | systemd | k8s | none"
        exit 50
        ;;
esac

# ─── 5/6 Smoke test ──────────────────────────────────────────────────────

log "phase 5/6 smoke test"

# Give the new process(es) a moment to bind their port. Most orchestrators
# return BEFORE the new process is listening — we poll instead of guessing.
sleep 3

SMOKE_OK=false
for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if curl -sf -m 5 "$HEALTH_URL" >/dev/null 2>&1; then
        SMOKE_OK=true
        break
    fi
    log "  /api/health attempt $attempt failed; retrying in 3s"
    sleep 3
done
if [ "$SMOKE_OK" != "true" ]; then
    fail "smoke test failed: $HEALTH_URL did not return 200 after 10 attempts (~30s)"
    fail "  rollback: see docs/operations/rollback-runbook-2026-05-16.md"
    exit 40
fi
ok "  liveness /api/health = 200"

# Readiness is best-effort: failure logs a warning but does NOT abort the
# deploy. Reasoning: liveness already proved the process is up; readiness
# may legitimately flap during the first few seconds as Prisma's pool warms.
READY_OK=false
for attempt in 1 2 3 4 5; do
    if curl -sf -m 5 "$READY_URL" >/dev/null 2>&1; then
        READY_OK=true
        break
    fi
    sleep 3
done
if [ "$READY_OK" = "true" ]; then
    ok "  readiness /api/health/ready = 200"
else
    log "  readiness /api/health/ready did NOT return 200 within ~15s"
    log "  the deploy is technically live, but the orchestrator should treat this instance as not-yet-routable"
fi

# ─── 6/6 Post-deploy verify ──────────────────────────────────────────────

log "phase 6/6 post-deploy verify"

# Fetch /api/version (if exposed) and log the deployed version so the deploy
# log makes pre/post versions visible without re-running curl by hand.
VERSION_URL="${VERSION_URL:-${HEALTH_URL%/health}/version}"
VERSION_PAYLOAD="$(curl -sf -m 5 "$VERSION_URL" 2>/dev/null || echo '{}')"
log "  deployed version payload: $VERSION_PAYLOAD"

ok "deploy complete at $TS"
log "  pre-deploy SHA: ${PRE_DEPLOY_SHA:-<unknown>}"
log "  rollback file:  $ROLLBACK_SHA_FILE"
log "  to roll back:   see docs/operations/rollback-runbook-2026-05-16.md"

exit 0
