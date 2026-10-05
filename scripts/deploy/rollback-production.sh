#!/bin/bash
# ════════════════════════════════════════════════════════════════════════════
# rollback-production.sh — Emergency manual rollback for GACP production
# ════════════════════════════════════════════════════════════════════════════
# Sprint 6 (Tech Debt #4, 2026-05-15): companion to the auto-rollback in
# .github/workflows/production.yml. Use this when:
#   - A deploy succeeded health check but later broke in production
#   - You need to roll back without going through the GitHub Actions UI
#   - The auto-rollback itself failed and left containers in a bad state
#
# This script:
#   1. Verifies you're on the production server (refuses to run elsewhere)
#   2. Resolves the rollback target (explicit SHA, last-good tag, or HEAD~1)
#   3. Captures current state for post-mortem (logs, git SHA, container status)
#   4. Restores the database from the most recent pre-deploy backup
#      (you can opt out with --skip-db-restore if migrations are forward-compatible)
#   5. Switches the working tree to the target ref
#   6. Rebuilds or pulls images and restarts containers
#   7. Runs health checks; refuses to declare success unless ALL pass
#
# Usage:
#   ./rollback-production.sh                          # rolls back to HEAD~1
#   ./rollback-production.sh --to <sha-or-tag>        # rolls back to a specific ref
#   ./rollback-production.sh --to <ref> --skip-db-restore
#   ./rollback-production.sh --list-backups           # show available DB backups
#
# Required environment (usually present on the production host):
#   PRODUCTION_DEPLOY_PATH — where the repo is checked out
#   COMPOSE_FILE           — defaults to docker-compose.production.yml
#   ENV_FILE               — defaults to .env.production
# ════════════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_PATH="${PRODUCTION_DEPLOY_PATH:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
USE_REGISTRY_IMAGES="${USE_REGISTRY_IMAGES:-false}"

NGINX_HEALTH_URL="${NGINX_HEALTH_URL:-http://127.0.0.1/nginx-health}"
BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-http://127.0.0.1:8080/health}"
API_HEALTH_URL="${API_HEALTH_URL:-http://127.0.0.1:8080/api/health}"
HEALTH_WAIT_SECS="${HEALTH_WAIT_SECS:-25}"

log()  { echo "[rollback] $*"; }
warn() { echo "[rollback] ⚠️  $*" >&2; }
err()  { echo "[rollback] ❌ $*" >&2; }
die()  { err "$@"; exit 1; }

usage() {
    sed -n '4,40p' "$0"
    exit "${1:-0}"
}

# ──────── Argument parsing ────────
TARGET_REF=""
SKIP_DB_RESTORE=false
LIST_BACKUPS=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --to)               TARGET_REF="$2"; shift 2;;
        --skip-db-restore)  SKIP_DB_RESTORE=true; shift;;
        --list-backups)     LIST_BACKUPS=true; shift;;
        -h|--help)          usage 0;;
        *)                  err "unknown argument: $1"; usage 1;;
    esac
done

cd "$DEPLOY_PATH"

# ──────── List backups mode ────────
if [ "$LIST_BACKUPS" = "true" ]; then
    log "Available pre-deploy backups in $DEPLOY_PATH/backups/:"
    ls -lh backups/predeploy_*.sql 2>/dev/null || warn "No backups found."
    exit 0
fi

# ──────── Resolve target ref ────────
if [ -z "$TARGET_REF" ]; then
    TARGET_REF="HEAD~1"
    log "No --to provided; defaulting to HEAD~1"
fi

CURRENT_SHA="$(git rev-parse HEAD)"
git fetch --tags origin >/dev/null 2>&1 || warn "git fetch failed; proceeding with local refs only"
TARGET_SHA="$(git rev-parse --verify "$TARGET_REF" 2>/dev/null || true)"
if [ -z "$TARGET_SHA" ]; then
    die "Cannot resolve target ref '$TARGET_REF' — check spelling or run --list-backups"
fi
if [ "$CURRENT_SHA" = "$TARGET_SHA" ]; then
    die "Already at target SHA $TARGET_SHA — nothing to roll back to"
fi

log "Rolling back: $CURRENT_SHA → $TARGET_SHA"

# ──────── Capture forensics BEFORE changing anything ────────
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
FORENSICS_DIR="rollback-forensics/${TIMESTAMP}_${CURRENT_SHA:0:8}_to_${TARGET_SHA:0:8}"
mkdir -p "$FORENSICS_DIR"
log "Saving forensics to: $FORENSICS_DIR"

git log --oneline -20 > "$FORENSICS_DIR/git-log.txt" 2>/dev/null || true
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps > "$FORENSICS_DIR/containers-before.txt" 2>/dev/null || true
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=500 backend  > "$FORENSICS_DIR/backend-logs.txt"  2>/dev/null || true
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=500 frontend > "$FORENSICS_DIR/frontend-logs.txt" 2>/dev/null || true
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=200 nginx    > "$FORENSICS_DIR/nginx-logs.txt"    2>/dev/null || true
echo "current_sha=$CURRENT_SHA"  >  "$FORENSICS_DIR/meta.txt"
echo "target_sha=$TARGET_SHA"    >> "$FORENSICS_DIR/meta.txt"
echo "rollback_at=$TIMESTAMP"    >> "$FORENSICS_DIR/meta.txt"

# ──────── Database restore decision ────────
if [ "$SKIP_DB_RESTORE" = "true" ]; then
    log "DB restore SKIPPED (--skip-db-restore). Use only if the deploy's migrations are forward-compatible."
else
    LATEST_BACKUP="$(ls -t backups/predeploy_*.sql 2>/dev/null | head -1 || true)"
    if [ -z "$LATEST_BACKUP" ]; then
        warn "No pre-deploy backup found in backups/ — DB will NOT be rolled back."
        warn "If the failed deploy ran migrations, you must restore manually before proceeding."
        read -r -p "Continue anyway? [y/N] " ans
        [[ "$ans" =~ ^[Yy]$ ]] || die "Aborted by operator"
    else
        log "Will restore DB from: $LATEST_BACKUP"
        cp "$LATEST_BACKUP" "$FORENSICS_DIR/restored-from-$(basename "$LATEST_BACKUP")"
    fi
fi

# ──────── Stop application containers (keep postgres/redis up) ────────
log "Stopping application containers (postgres/redis remain up)..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop backend frontend nginx || true

# ──────── Restore DB ────────
if [ "$SKIP_DB_RESTORE" != "true" ] && [ -n "${LATEST_BACKUP:-}" ]; then
    log "Restoring database from $LATEST_BACKUP..."
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
        sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$LATEST_BACKUP"
    log "DB restore complete"
fi

# ──────── Checkout target ref ────────
log "Checking out $TARGET_SHA..."
git checkout "$TARGET_SHA"

# ──────── Rebuild or pull images ────────
if [ "$USE_REGISTRY_IMAGES" = "true" ]; then
    log "Pulling images from registry for target ref..."
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull backend frontend
else
    log "Rebuilding images for target ref..."
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build backend frontend
fi

# ──────── Bring containers back up ────────
log "Starting containers..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d backend frontend nginx

# ──────── Health check ────────
log "Waiting ${HEALTH_WAIT_SECS}s for services to settle..."
sleep "$HEALTH_WAIT_SECS"

ALL_OK=true
for url_name_pair in \
    "$NGINX_HEALTH_URL|nginx"     \
    "$BACKEND_HEALTH_URL|backend" \
    "$API_HEALTH_URL|api"
do
    url="${url_name_pair%|*}"
    name="${url_name_pair#*|}"
    if curl -fsS --max-time 10 "$url" >/dev/null 2>&1; then
        log "  ✓ $name health OK ($url)"
    else
        err "  ✗ $name health FAILED ($url)"
        ALL_OK=false
    fi
done

if [ "$ALL_OK" != "true" ]; then
    err "Rollback completed code-wise but health checks did NOT all pass."
    err "Forensics: $FORENSICS_DIR"
    err "Inspect logs: bash scripts/deploy/service-manager.sh logs backend --tail=200"
    exit 2
fi

log "✓ Rollback successful. Now at: $(git rev-parse HEAD)"
log "Forensics saved to: $FORENSICS_DIR"
log ""
log "Next steps:"
log "  1. Investigate the failed deploy using the forensics above"
log "  2. Open a post-mortem issue with: $FORENSICS_DIR/meta.txt"
log "  3. Do NOT re-deploy the broken SHA without fixing the root cause"
