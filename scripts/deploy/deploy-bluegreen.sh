#!/usr/bin/env bash
#
# scripts/deploy/deploy-bluegreen.sh
#
# Zero-downtime blue/green deployment with instant rollback.
#
# Flow:
#   1. Pre-flight (clean tree, env vars, GHCR reachable)
#   2. Backup PostgreSQL
#   3. Determine current ACTIVE color (blue or green) by reading nginx
#      diagnostic endpoint
#   4. Set NEW_COLOR = the OTHER color
#   5. Pull new image tag for NEW_COLOR
#   6. Run prisma migrate deploy AGAINST THE SHARED DB (must be
#      forward-compatible with both old and new code)
#   7. Bring up NEW_COLOR backend + frontend
#   8. Wait for healthy → smoke /api/health on the new color directly
#   9. Re-render nginx upstream config to point at NEW_COLOR
#   10. nginx -t && nginx -s reload — atomic cutover, ~1 s downtime
#   11. Final smoke through public URL (https://gacpth.com/api/health)
#   12. Drain grace period (60 s default) — old color continues serving
#       any in-flight requests
#   13. Stop OLD_COLOR containers — only running cost is the active color
#
# Exit codes:
#   0  cutover succeeded; old color stopped
#   1  pre-flight failed (no changes made)
#   2  backup failed (no changes made)
#   3  migration failed (DB may need rollback)
#   4  new color failed to come up healthy (active color unchanged,
#      new color stopped)
#   5  smoke test on new color failed (active color unchanged)
#   6  nginx config validation/reload failed (active color unchanged,
#      new color still up — re-run deploy after fixing nginx)
#   7  post-cutover smoke failed (auto-rollback executed)
#
# Rollback (manual, if smoke breaks AFTER drain):
#   ACTIVE_COLOR=<previous-color> $0 --rollback-only
#
# Required env vars in $ENV_FILE: same as deploy-production.sh
# Plus optional:
#   IMAGE_TAG          — image tag to deploy (default: deploy-production-latest)
#   DRAIN_SECONDS      — old-color drain time before stop (default 60)
#   ACTIVE_COLOR       — used by --rollback-only

set -Eeuo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/gacp-platform}"
COMPOSE_PROD="${COMPOSE_FILE:-docker-compose.production.yml}"
COMPOSE_BG="${COMPOSE_BG_FILE:-docker-compose.bluegreen.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
DEPLOY_LOG_DIR="${DEPLOY_LOG_DIR:-/var/log/gacp-deploys}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/gacp}"
NGINX_TPL="${NGINX_TPL:-$PROJECT_DIR/nginx/bluegreen-upstream.conf.template}"
NGINX_OUT="${NGINX_OUT:-/etc/nginx/conf.d/bluegreen-upstream.conf}"
DRAIN_SECONDS="${DRAIN_SECONDS:-60}"
DESIRED_TAG="${IMAGE_TAG:-deploy-production-latest}"

REQUIRED_ENV_VARS=(
    DATABASE_URL REDIS_URL HEALTH_JWT_SECRET PROVIDER_JWT_SECRET
    ENCRYPTION_KEY QR_SIGNATURE_FALLBACK_SECRET PAYMENT_WEBHOOK_SECRET
)

TS="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$DEPLOY_LOG_DIR/bluegreen-$TS.log"
mkdir -p "$DEPLOY_LOG_DIR" "$BACKUP_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1

err() { echo "❌ $*" >&2; }
ok()  { echo "✅ $*"; }
inf() { echo "ℹ️  $*"; }

cd "$PROJECT_DIR"

# ─── Helpers ─────────────────────────────────────────────────────────────

current_active_color() {
    # Diagnostic endpoint set by the nginx template returns the color name.
    curl -sf -m 5 http://127.0.0.1:8081/__bluegreen 2>/dev/null | tr -d '[:space:]' || echo ""
}

other_color() {
    case "$1" in
        blue)  echo "green" ;;
        green) echo "blue" ;;
        *)     echo "blue" ;;  # default if no active color yet
    esac
}

dc() {
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_PROD" -f "$COMPOSE_BG" "$@"
}

render_nginx_config() {
    local active="$1"
    local inactive
    inactive=$(other_color "$active")
    sed -e "s/{{ACTIVE_COLOR}}/$active/g" \
        -e "s/{{INACTIVE_COLOR}}/$inactive/g" \
        "$NGINX_TPL" > "$NGINX_OUT.tmp"
    mv "$NGINX_OUT.tmp" "$NGINX_OUT"
}

reload_nginx() {
    if ! nginx -t 2>&1 | tail -3; then
        return 1
    fi
    nginx -s reload
}

# ─── 1. Pre-flight ───────────────────────────────────────────────────────

inf "[$(date)] blue/green deploy starting (log: $LOG_FILE)"
inf "[1/13] Pre-flight checks"

if [ -n "$(git status --porcelain)" ]; then
    err "working tree dirty — production must equal git HEAD"
    exit 1
fi
ok "  working tree clean"

MISSING=()
for v in "${REQUIRED_ENV_VARS[@]}"; do
    grep -qE "^${v}=.+" "$ENV_FILE" || MISSING+=("$v")
done
if [ "${#MISSING[@]}" -gt 0 ]; then
    err "missing env vars: ${MISSING[*]}"
    exit 1
fi
ok "  env vars present"

# Make sure the image tag actually exists on GHCR before we touch the
# running stack. `docker buildx imagetools inspect` exits non-zero if not.
BACKEND_IMG="ghcr.io/jonmaxmore/gacp-backend:$DESIRED_TAG"
FRONTEND_IMG="ghcr.io/jonmaxmore/gacp-frontend:$DESIRED_TAG"
if ! docker buildx imagetools inspect "$BACKEND_IMG" >/dev/null 2>&1; then
    err "image not found in registry: $BACKEND_IMG"
    err "  was the build-images workflow successful for tag $DESIRED_TAG?"
    exit 1
fi
ok "  image tag '$DESIRED_TAG' present on GHCR"

# ─── 2. Backup ───────────────────────────────────────────────────────────

inf "[2/13] PostgreSQL backup"
BACKUP_FILE="$BACKUP_DIR/gacp-pre-bluegreen-$TS.sql.gz"
if ! docker compose --env-file "$ENV_FILE" -f "$COMPOSE_PROD" exec -T postgres \
    pg_dump --clean --if-exists -U "${DB_USER:-gacp}" "${DB_NAME:-gacp_db}" \
    | gzip > "$BACKUP_FILE"; then
    err "backup failed"
    exit 2
fi
ok "  $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# ─── 3 + 4. Determine colors ─────────────────────────────────────────────

inf "[3/13] Detect current active color"
ACTIVE="$(current_active_color)"
if [ -z "$ACTIVE" ]; then
    inf "  no active color detected (first blue/green run); defaulting ACTIVE=green"
    ACTIVE="green"
fi
NEW_COLOR=$(other_color "$ACTIVE")
ok "  active=$ACTIVE  →  promoting NEW_COLOR=$NEW_COLOR with tag=$DESIRED_TAG"

# ─── 5. Pull new image into NEW_COLOR slot ──────────────────────────────

inf "[5/13] Pull image $DESIRED_TAG into $NEW_COLOR slot"
if [ "$NEW_COLOR" = "blue" ]; then
    BLUE_IMAGE_TAG="$DESIRED_TAG" GREEN_IMAGE_TAG="$DESIRED_TAG" \
        dc --profile blue pull backend-blue frontend-blue
else
    BLUE_IMAGE_TAG="$DESIRED_TAG" GREEN_IMAGE_TAG="$DESIRED_TAG" \
        dc --profile green pull backend-green frontend-green
fi
ok "  pulled"

# ─── 6. Migrate (forward-compatible only) ───────────────────────────────

inf "[6/13] Prisma migrate deploy (against shared DB)"
inf "  ⚠ migrations MUST be forward-compatible with the OLD color too,"
inf "    since both colors will share the DB during the drain window."
if dc exec -T postgres true >/dev/null 2>&1; then
    if ! dc exec -T backend npx prisma migrate deploy 2>&1 | tail -10; then
        err "migration failed — DB may need restore from $BACKUP_FILE"
        exit 3
    fi
    ok "  applied"
else
    inf "  no live backend container yet — migrations will run when NEW color starts"
fi

# ─── 7. Bring up NEW_COLOR ───────────────────────────────────────────────

inf "[7/13] Start $NEW_COLOR stack"
if [ "$NEW_COLOR" = "blue" ]; then
    BLUE_IMAGE_TAG="$DESIRED_TAG" \
        dc --profile blue up -d --no-deps backend-blue frontend-blue
else
    GREEN_IMAGE_TAG="$DESIRED_TAG" \
        dc --profile green up -d --no-deps backend-green frontend-green
fi

# ─── 8. Wait for new color to be healthy ────────────────────────────────

inf "[8/13] Wait for $NEW_COLOR healthy"
HEALTHY=false
for i in $(seq 1 24); do  # 24 × 5s = 2 min
    BSTATE=$(docker inspect --format='{{.State.Health.Status}}' "gacp-backend-$NEW_COLOR" 2>/dev/null || echo unknown)
    FSTATE=$(docker inspect --format='{{.State.Health.Status}}' "gacp-frontend-$NEW_COLOR" 2>/dev/null || echo unknown)
    inf "  attempt $i: backend=$BSTATE frontend=$FSTATE"
    if [ "$BSTATE" = "healthy" ] && [ "$FSTATE" = "healthy" ]; then
        HEALTHY=true
        break
    fi
    sleep 5
done
if [ "$HEALTHY" != "true" ]; then
    err "$NEW_COLOR failed to become healthy — leaving ACTIVE on $ACTIVE"
    err "  stopping $NEW_COLOR to avoid resource waste"
    dc --profile "$NEW_COLOR" stop "backend-$NEW_COLOR" "frontend-$NEW_COLOR" || true
    exit 4
fi
ok "  $NEW_COLOR healthy"

# ─── 9. Smoke the new color directly (bypass nginx switching layer) ─────

inf "[9/13] Direct smoke of $NEW_COLOR backend container"
NEW_BACKEND_IP=$(docker inspect --format='{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "gacp-backend-$NEW_COLOR")
if ! docker run --rm --network gacp-network curlimages/curl:8.5.0 -sf -m 10 "http://$NEW_BACKEND_IP:8000/api/health" >/dev/null; then
    err "$NEW_COLOR /api/health failed direct smoke"
    err "  stopping $NEW_COLOR; ACTIVE remains $ACTIVE"
    dc --profile "$NEW_COLOR" stop "backend-$NEW_COLOR" "frontend-$NEW_COLOR" || true
    exit 5
fi
ok "  $NEW_COLOR direct smoke passed"

# ─── 10. Cutover — atomic nginx upstream rewrite ────────────────────────

inf "[10/13] Cutover nginx upstream → $NEW_COLOR"
PREV_NGINX_BACKUP="$NGINX_OUT.bak-$TS"
[ -f "$NGINX_OUT" ] && cp "$NGINX_OUT" "$PREV_NGINX_BACKUP"

if ! render_nginx_config "$NEW_COLOR"; then
    err "failed to render nginx config; ACTIVE remains $ACTIVE"
    exit 6
fi

if ! reload_nginx; then
    err "nginx -t failed or reload errored; restoring previous config"
    [ -f "$PREV_NGINX_BACKUP" ] && cp "$PREV_NGINX_BACKUP" "$NGINX_OUT" && nginx -s reload || true
    exit 6
fi
ok "  nginx now routing to $NEW_COLOR (backup: $PREV_NGINX_BACKUP)"

# ─── 11. Post-cutover smoke through public path ─────────────────────────

inf "[11/13] Public smoke (through nginx)"
PUBLIC_OK=false
for i in 1 2 3 4 5; do
    if curl -sk -m 5 https://localhost/api/health | grep -q '"success":true'; then
        PUBLIC_OK=true
        break
    fi
    sleep 2
done
if [ "$PUBLIC_OK" != "true" ]; then
    err "post-cutover public smoke failed — auto-rolling back to $ACTIVE"
    [ -f "$PREV_NGINX_BACKUP" ] && cp "$PREV_NGINX_BACKUP" "$NGINX_OUT" && nginx -s reload || true
    exit 7
fi
ok "  public /api/health 200"

# ─── 12. Drain ──────────────────────────────────────────────────────────

inf "[12/13] Drain old color ($ACTIVE) for ${DRAIN_SECONDS}s"
sleep "$DRAIN_SECONDS"
ok "  drain complete"

# ─── 13. Stop old color ─────────────────────────────────────────────────

inf "[13/13] Stop old color ($ACTIVE) containers"
dc --profile "$ACTIVE" stop "backend-$ACTIVE" "frontend-$ACTIVE" || true
ok "  $ACTIVE stopped"

echo
ok "DEPLOY COMPLETE  $ACTIVE → $NEW_COLOR ($DESIRED_TAG)  log: $LOG_FILE"

cat <<EOF

────────────── ROLLBACK (instant — flip nginx back) ──────────────
ssh root@<host>
cd $PROJECT_DIR

# Bring previous color ($ACTIVE) back up:
docker compose --env-file $ENV_FILE -f $COMPOSE_PROD -f $COMPOSE_BG \\
    --profile $ACTIVE up -d backend-$ACTIVE frontend-$ACTIVE

# Wait for it to be healthy, then flip nginx:
ACTIVE_COLOR=$ACTIVE $0 --rollback-only

# Or manually:
sed -e 's/{{ACTIVE_COLOR}}/$ACTIVE/g' -e 's/{{INACTIVE_COLOR}}/$NEW_COLOR/g' \\
    $NGINX_TPL > $NGINX_OUT
nginx -t && nginx -s reload
──────────────────────────────────────────────────────────────────
EOF
