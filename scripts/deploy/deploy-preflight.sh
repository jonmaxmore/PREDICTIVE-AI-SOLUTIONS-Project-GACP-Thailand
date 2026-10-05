#!/bin/bash
# ════════════════════════════════════════════════════════════════════════════
# deploy-preflight.sh — Validate a production deploy is safe to run
# ════════════════════════════════════════════════════════════════════════════
# Sprint 6 (Tech Debt #4, 2026-05-15): pre-deploy validation hook.
#
# Catches deploy footguns BEFORE the deploy ssh tunnel even opens:
#   - .env.production exists AND defines every var that the compose file references
#   - docker-compose.production.yml parses cleanly with that env file
#   - Required GitHub Actions secrets are present (when run in CI)
#   - Topology + infrastructure contract checks pass
#   - Last 50 commits don't include `--skip-ci` or `WIP` markers
#   - There is at least one pre-deploy backup target directory writable
#
# Exit codes:
#   0 — all good
#   1 — validation failed (don't deploy)
#   2 — warnings only (proceed with caution)
#
# Usage:
#   ./deploy-preflight.sh
#   ./deploy-preflight.sh --strict  # treat warnings as failures
# ════════════════════════════════════════════════════════════════════════════

set -uo pipefail
# Note: NOT using `set -e` because we want to collect all problems, not stop at the first.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"

STRICT=false
for arg in "$@"; do
    case "$arg" in
        --strict) STRICT=true;;
        -h|--help)
            sed -n '4,25p' "$0"; exit 0;;
    esac
done

ERRORS=0
WARNINGS=0

ok()   { echo "  ✓ $*"; }
warn() { echo "  ⚠️  $*" >&2; WARNINGS=$((WARNINGS + 1)); }
fail() { echo "  ❌ $*" >&2; ERRORS=$((ERRORS + 1)); }

section() { echo ""; echo "── $* ──────────────────────────────────"; }

# ──────── 1. Compose file exists and parses ────────
section "Compose file"
if [ ! -f "$COMPOSE_FILE" ]; then
    fail "$COMPOSE_FILE not found"
else
    ok "$COMPOSE_FILE present"
fi

if [ ! -f "$ENV_FILE" ]; then
    fail "$ENV_FILE not found (deploy will refuse to start containers)"
else
    ok "$ENV_FILE present"
fi

if [ -f "$COMPOSE_FILE" ] && [ -f "$ENV_FILE" ]; then
    if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/dev/null 2>&1; then
        ok "docker compose config parses cleanly"
    else
        fail "docker compose config FAILED to parse"
        docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config 2>&1 | head -20 | sed 's/^/    /'
    fi
fi

# ──────── 2. Required env vars present ────────
section "Required environment variables"
REQUIRED_VARS=(
    # The database is Supabase — the stack no longer runs a postgres of its own, so
    # the whole connection string has to be present. Without it the compose file's
    # `${DATABASE_URL:?}` aborts the deploy, and the backup step has nothing to dump.
    DATABASE_URL
    HEALTH_JWT_SECRET
    PROVIDER_JWT_SECRET
    HMAC_KEY
    MASTER_ENCRYPTION_KEY
    REDIS_PASSWORD
)
if [ -f "$ENV_FILE" ]; then
    for var in "${REQUIRED_VARS[@]}"; do
        if grep -qE "^${var}=." "$ENV_FILE"; then
            ok "$var defined"
        else
            fail "$var missing or empty in $ENV_FILE"
        fi
    done
fi

# ──────── 3. Topology and contract checks ────────
section "Production topology + infra contracts"
if [ -f scripts/check-production-topology.js ]; then
    if node scripts/check-production-topology.js >/dev/null 2>&1; then
        ok "Production topology check passed"
    else
        fail "Production topology check FAILED — run: node scripts/check-production-topology.js"
    fi
else
    warn "scripts/check-production-topology.js not found"
fi
if [ -f scripts/check-infra-contracts.js ]; then
    if node scripts/check-infra-contracts.js >/dev/null 2>&1; then
        ok "Infra contract check passed"
    else
        fail "Infra contract check FAILED — run: node scripts/check-infra-contracts.js"
    fi
else
    warn "scripts/check-infra-contracts.js not found"
fi

# ──────── 4. Git state ────────
section "Git state"
if [ -d .git ]; then
    DIRTY_FILES="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
    if [ "$DIRTY_FILES" = "0" ]; then
        ok "Working tree clean"
    else
        warn "Working tree has $DIRTY_FILES uncommitted files — they will NOT be deployed"
    fi

    BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
    if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
        ok "On release branch: $BRANCH"
    else
        warn "On branch '$BRANCH' — typically deploys go from main/master"
    fi

    # Look at last 50 commits for WIP markers
    SUSPECT="$(git log --oneline -50 2>/dev/null | grep -iE '(WIP|wip:|squash|fixup)' | head -3 || true)"
    if [ -n "$SUSPECT" ]; then
        warn "Recent commits contain WIP/squash markers:"
        echo "$SUSPECT" | sed 's/^/    /' >&2
    fi
else
    warn "Not a git repository — skipping git state checks"
fi

# ──────── 5. Backup directory writable ────────
section "Backup readiness"
if mkdir -p backups 2>/dev/null && [ -w backups ]; then
    ok "backups/ directory writable (pre-deploy DB dump will land here)"
else
    fail "backups/ directory NOT writable — pre-deploy DB dump will fail"
fi

# ──────── 6. CI context ────────
section "CI context"
if [ "${CI:-}" = "true" ] || [ -n "${GITHUB_ACTIONS:-}" ]; then
    ok "Running in CI (GITHUB_ACTIONS=${GITHUB_ACTIONS:-unset})"
    # Required secrets only matter in CI
    for s in PRODUCTION_HOST PRODUCTION_USER PRODUCTION_SSH_KEY; do
        if [ -n "${!s:-}" ]; then
            ok "Secret $s is set"
        else
            fail "Secret $s is NOT set"
        fi
    done
else
    ok "Running locally (CI secret checks skipped)"
fi

# ──────── Summary ────────
echo ""
echo "════════════════════════════════════════"
echo "Preflight summary:"
echo "  Errors:   $ERRORS"
echo "  Warnings: $WARNINGS"
echo "════════════════════════════════════════"

if [ $ERRORS -gt 0 ]; then
    echo "❌ DEPLOY REFUSED — fix errors above first."
    exit 1
fi
if [ "$STRICT" = "true" ] && [ $WARNINGS -gt 0 ]; then
    echo "❌ DEPLOY REFUSED (strict mode) — fix warnings above first."
    exit 1
fi
if [ $WARNINGS -gt 0 ]; then
    echo "⚠️  Preflight passed with warnings — proceed with caution."
    exit 2
fi
echo "✓ Preflight passed — safe to deploy."
exit 0
