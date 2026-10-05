#!/usr/bin/env bash
#
# scripts/deploy/deploy-preview.sh
#
# Build and (re)start the hidden preview stack — preview.gacpth.com.
#
# Scope, stated as a promise this script keeps:
#   - it touches ONLY the two preview containers (project `gacp-preview`)
#   - it NEVER runs docker-compose.production.yml or docker-compose.staging.yml
#   - it NEVER writes /etc/nginx, reloads nginx, or restarts gacp-nginx
#   - it NEVER runs a database migration unless --migrate is passed
#
# That last one matters more than it looks. Preview points at the SAME Supabase
# dev database the laptop tests against, so a migration run here lands on the
# dataset someone may be using right now. The normal state is "schema already
# current, applied from the laptop"; this script prints the exact command and
# stops.
#
# Flow:
#   1. resolve the SHA and the image tag
#   2. clone or fetch /tmp/gacp-build at that SHA (idempotent)
#   3. build backend + frontend with the preview build-args
#   4. verify GIT_SHA baked INTO the images
#   5. (optional) prisma migrate deploy
#   6. docker compose up -d, wait for both healthchecks
#   7. verify: which-build.sh on :3002 and /api/health on :8002
#
# Usage:
#   scripts/deploy/deploy-preview.sh                     # HEAD of origin/main
#   scripts/deploy/deploy-preview.sh --sha 687494c6…     # pin a commit
#   scripts/deploy/deploy-preview.sh --migrate           # also migrate
#   scripts/deploy/deploy-preview.sh --no-build          # reuse existing images
#   scripts/deploy/deploy-preview.sh --prune             # reclaim dangling images
#
# Exit codes: 1 pre-flight, 2 clone/fetch, 3 build, 4 image identity,
#             5 migrate, 6 compose up / health, 7 verification.

set -Eeuo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/gacp-platform}"
BUILD_DIR="${BUILD_DIR:-/tmp/gacp-build}"
REPO_URL="${REPO_URL:-git@github.com:jonmaxmore/GACP-Certification-Application.git}"
COMPOSE_FILE="${COMPOSE_PREVIEW_FILE:-docker-compose.preview.yml}"
ENV_FILE="${ENV_FILE:-.env.preview}"
COMPOSE_PROJECT="gacp-preview"

PREVIEW_URL="${PREVIEW_PUBLIC_URL:-https://preview.gacpth.com}"
BACKEND_PORT="${PREVIEW_BACKEND_PORT:-8002}"
FRONTEND_PORT="${PREVIEW_FRONTEND_PORT:-3002}"

BACKEND_REPO="${PREVIEW_BACKEND_IMAGE:-ghcr.io/jonmaxmore/gacp-backend}"
FRONTEND_REPO="${PREVIEW_FRONTEND_IMAGE:-ghcr.io/jonmaxmore/gacp-frontend}"

WANT_SHA=""
DO_MIGRATE=0
DO_BUILD=1
DO_PRUNE=0

err() { echo "[FAIL] $*" >&2; }
ok()  { echo "[ OK ] $*"; }
inf() { echo "[INFO] $*"; }

usage() {
    sed -n '3,30p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --sha)      WANT_SHA="${2:-}"; shift 2 ;;
        --sha=*)    WANT_SHA="${1#*=}"; shift ;;
        --migrate)  DO_MIGRATE=1; shift ;;
        --no-build) DO_BUILD=0; shift ;;
        --prune)    DO_PRUNE=1; shift ;;
        -h|--help)  usage ;;
        *)          err "unknown argument: $1"; err "try --help"; exit 1 ;;
    esac
done

trap 'err "preview deploy aborted on line $LINENO"; exit 99' ERR

# ─── 1. Pre-flight ───────────────────────────────────────────────────────

inf "[1/7] Pre-flight"

command -v docker >/dev/null 2>&1 || { err "docker not found on PATH"; exit 1; }
docker compose version >/dev/null 2>&1 || { err "docker compose v2 plugin not available"; exit 1; }

cd "$PROJECT_DIR" || { err "$PROJECT_DIR not found"; exit 1; }

[ -f "$COMPOSE_FILE" ] || { err "$PROJECT_DIR/$COMPOSE_FILE not found (git pull in $PROJECT_DIR first)"; exit 1; }

if [ ! -f "$ENV_FILE" ]; then
    err "$PROJECT_DIR/$ENV_FILE not found"
    err "  cp .env.preview.example $ENV_FILE  &&  chmod 600 $ENV_FILE  && fill it in"
    exit 1
fi

# Fail on an env file that is world-readable — it holds the Supabase URL and
# every backend secret.
ENV_MODE="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo '')"
case "$ENV_MODE" in
    600|400|640|440) : ;;
    '') inf "  could not stat $ENV_FILE permissions (non-GNU stat?) — check by hand" ;;
    *)  err "$ENV_FILE is mode $ENV_MODE; it holds secrets. run: chmod 600 $ENV_FILE"; exit 1 ;;
esac

# Required keys, by NAME only — no value is ever echoed by this script.
MISSING=()
for v in DATABASE_URL REDIS_URL HEALTH_JWT_SECRET PROVIDER_JWT_SECRET \
         ENCRYPTION_KEY QR_SIGNATURE_FALLBACK_SECRET RSA_PRIVATE_KEY_PASSPHRASE \
         PAYMENT_WEBHOOK_SECRET; do
    grep -qE "^${v}=.+" "$ENV_FILE" || MISSING+=("$v")
done
if [ "${#MISSING[@]}" -gt 0 ]; then
    err "missing or empty in $ENV_FILE: ${MISSING[*]}"
    exit 1
fi

# The external network the preview containers join to reach gacp-redis. It is
# created and owned by docker-compose.production.yml; this script must find it,
# never create it.
docker network inspect gacp-network >/dev/null 2>&1 || {
    err "docker network 'gacp-network' not found — the production stack owns it and must be up"
    exit 1
}
ok "  env, compose file and gacp-network present"

# ─── 2. Source at a known SHA ────────────────────────────────────────────

inf "[2/7] Source tree at $BUILD_DIR"

if [ -d "$BUILD_DIR/.git" ]; then
    git -C "$BUILD_DIR" fetch --quiet origin '+refs/heads/main:refs/remotes/origin/main' || {
        err "git fetch failed in $BUILD_DIR"; exit 2; }
else
    rm -rf "$BUILD_DIR"
    git clone -q "$REPO_URL" "$BUILD_DIR" || { err "git clone failed"; exit 2; }
fi

if [ -n "$WANT_SHA" ]; then
    git -C "$BUILD_DIR" checkout -q --detach "$WANT_SHA" || {
        err "commit not found: $WANT_SHA"; exit 2; }
else
    git -C "$BUILD_DIR" checkout -q --detach origin/main || {
        err "could not check out origin/main"; exit 2; }
fi

SHA="$(git -C "$BUILD_DIR" rev-parse HEAD)"
SHORT="${SHA:0:12}"
TAG="${PREVIEW_IMAGE_TAG:-local-$SHORT}"
BACKEND_IMG="$BACKEND_REPO:$TAG"
FRONTEND_IMG="$FRONTEND_REPO:$TAG"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ok "  $SHA  →  tag $TAG"

# ─── 3. Build ────────────────────────────────────────────────────────────

if [ "$DO_BUILD" = "1" ]; then
    inf "[3/7] Build images (cold ~55 s backend, ~280 s frontend; warm ~10 s each)"
    cd "$BUILD_DIR"

    BUILD_LOG="$(mktemp)"

    # ARG GIT_SHA sits at the BOTTOM of both Dockerfiles so the expensive layers
    # (pnpm install, prisma generate, next build) stay cached across commits.
    # Never move it up.
    docker build -f apps/backend/Dockerfile \
        --build-arg GIT_SHA="$SHA" \
        --build-arg BUILT_AT="$BUILT_AT" \
        -t "$BACKEND_IMG" . 2>&1 | tee "$BUILD_LOG" | tail -5 || { err "backend build failed"; exit 3; }

    # Trap #1 from docs/operations/runbooks/build-images-on-the-box.md:
    # NEXT_PUBLIC_API_URL is the BARE ORIGIN with NO /api suffix. Adding /api
    # makes the whole frontend call the API at the wrong path.
    docker build -f apps/web-app/Dockerfile \
        --build-arg GIT_SHA="$SHA" \
        --build-arg BUILT_AT="$BUILT_AT" \
        --build-arg NEXT_PUBLIC_API_URL="$PREVIEW_URL" \
        --build-arg NEXT_PUBLIC_PWA_ENABLED=false \
        --build-arg NEXT_PUBLIC_CHECKOUT_UI_ENABLED=true \
        -t "$FRONTEND_IMG" . 2>&1 | tee -a "$BUILD_LOG" | tail -5 || { err "frontend build failed"; exit 3; }

    # Trap #2: a --build-arg the Dockerfile never declares as ARG is IGNORED,
    # with nothing but a warning at the end of the log — producing an image with
    # the flag silently off. Read that warning instead of scrolling past it.
    if grep -qi 'build-args* .*were not consumed\|was not consumed' "$BUILD_LOG"; then
        err "docker reported unconsumed build-args — a flag did not reach the image:"
        grep -i 'not consumed' "$BUILD_LOG" >&2 || true
        rm -f "$BUILD_LOG"
        exit 3
    fi
    rm -f "$BUILD_LOG"
    ok "  built $BACKEND_IMG and $FRONTEND_IMG"
    cd "$PROJECT_DIR"
else
    inf "[3/7] Build skipped (--no-build)"
    for _img in "$BACKEND_IMG" "$FRONTEND_IMG"; do
        docker image inspect "$_img" >/dev/null 2>&1 || { err "image not present: $_img"; exit 3; }
    done
    ok "  both images already present locally"
fi

# ─── 4. Image identity ───────────────────────────────────────────────────

# Checks the value baked INTO the image, before anything is started. An image
# whose GIT_SHA is empty makes /api/webapp-version answer "unknown build", and
# then nobody can say what preview is showing — which is the entire point of
# preview.
inf "[4/7] Verify GIT_SHA inside the images"
for pair in "backend:$BACKEND_IMG" "frontend:$FRONTEND_IMG"; do
    _name="${pair%%:*}"
    _img="${pair#*:}"
    _got="$(docker run --rm --entrypoint sh "$_img" -c 'echo $GIT_SHA' 2>/dev/null | tr -d '\r\n')"
    if [ "$_got" != "$SHA" ]; then
        err "$_name image GIT_SHA mismatch: image='$_got' expected='$SHA'"
        exit 4
    fi
    ok "  $_name GIT_SHA = $SHORT"
done

# ─── 5. Migrations (opt-in only) ─────────────────────────────────────────

MIGRATE_CMD="docker run --rm --env-file $PROJECT_DIR/$ENV_FILE $BACKEND_IMG sh -c 'cd /app/apps/backend && npx prisma migrate deploy'"

if [ "$DO_MIGRATE" = "1" ]; then
    inf "[5/7] prisma migrate deploy on the SHARED Supabase dev database"
    inf "  this is the same database the laptop tests against. proceeding because --migrate was passed."
    if docker run --rm --env-file "$PROJECT_DIR/$ENV_FILE" "$BACKEND_IMG" \
        sh -c 'cd /app/apps/backend && npx prisma migrate deploy' 2>&1 | tail -20; then
        ok "  migrations applied"
    else
        err "migration failed — the shared dev DB may be mid-change; stopping before containers are recreated"
        exit 5
    fi
else
    inf "[5/7] Migrations NOT run (no --migrate)."
    inf "  The Supabase dev schema is normally already current, applied from the laptop."
    inf "  To apply pending migrations, run exactly:"
    echo
    echo "    $MIGRATE_CMD"
    echo
fi

# ─── 6. Start the preview stack ──────────────────────────────────────────

inf "[6/7] docker compose up -d (project $COMPOSE_PROJECT, preview containers only)"

# -p pins the project so this can never be confused with the production stack's
# label. --remove-orphans is deliberately NOT passed.
PREVIEW_IMAGE_TAG="$TAG" \
    docker compose -p "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
    up -d || { err "compose up failed"; exit 6; }

# A freshly created named volume inherits root:root from the image directory, so
# the non-root app user (uid 1001) cannot mkdir into it and every document
# upload becomes a 502. Idempotent; runs every deploy. The container must be up.
for _ in 1 2 3 4 5; do
    if docker exec -u 0 gacp-backend-preview chown -R 1001:1001 /app/apps/backend/public/uploads 2>/dev/null; then
        ok "  uploads volume owned by uid 1001"
        break
    fi
    sleep 2
done

inf "  waiting for both healthchecks (up to 180 s)"
DEADLINE=$(( $(date +%s) + 180 ))
HEALTHY=0
_b="none"
_f="none"
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
    _b="$(docker inspect -f '{{.State.Health.Status}}' gacp-backend-preview 2>/dev/null || echo none)"
    _f="$(docker inspect -f '{{.State.Health.Status}}' gacp-frontend-preview 2>/dev/null || echo none)"
    if [ "$_b" = "healthy" ] && [ "$_f" = "healthy" ]; then
        HEALTHY=1
        break
    fi
    if [ "$_b" = "unhealthy" ] || [ "$_f" = "unhealthy" ]; then
        err "a container went unhealthy (backend=$_b frontend=$_f)"
        err "  docker logs gacp-backend-preview --tail 50"
        err "  docker logs gacp-frontend-preview --tail 50"
        exit 6
    fi
    sleep 5
done
if [ "$HEALTHY" != "1" ]; then
    err "healthchecks did not go green within 180 s (backend=$_b frontend=$_f)"
    err "  docker logs gacp-backend-preview --tail 50"
    exit 6
fi
ok "  both containers healthy"

# ─── 7. Verify ───────────────────────────────────────────────────────────

inf "[7/7] Verify on loopback"

# Loopback only. This proves the CONTAINERS are right; it says nothing about
# nginx, Cloudflare or the gate — the runbook's step (f) covers the public URL,
# and a direct-port pass has been overruled by nginx before (2026-08-14).
HEALTH_BODY="$(curl -sf -m 10 "http://127.0.0.1:${BACKEND_PORT}/api/health" || true)"
if printf '%s' "$HEALTH_BODY" | grep -q '"success":true'; then
    ok "  backend /api/health on :${BACKEND_PORT} → success"
else
    err "backend /api/health on :${BACKEND_PORT} did not report success"
    err "  body: ${HEALTH_BODY:-<empty>}"
    exit 7
fi

if [ -x "$BUILD_DIR/scripts/ops/which-build.sh" ]; then
    WHICH="$BUILD_DIR/scripts/ops/which-build.sh"
else
    WHICH="bash $BUILD_DIR/scripts/ops/which-build.sh"
fi
if ! $WHICH "http://127.0.0.1:${FRONTEND_PORT}"; then
    err "which-build.sh could not identify the frontend build on :${FRONTEND_PORT}"
    exit 7
fi

if [ "$DO_PRUNE" = "1" ]; then
    # Dangling (untagged) images and build cache only. Every live stack's image
    # is tagged, so this cannot reach production's or staging's. Opt-in because
    # the 2026-06-24 disk-full incident cuts both ways: unpruned images filled
    # the disk, and a prune during someone else's build is its own surprise.
    inf "Pruning dangling images and build cache"
    docker image prune -f >/dev/null 2>&1 || true
    docker builder prune -f >/dev/null 2>&1 || true
fi

echo
ok "PREVIEW DEPLOY COMPLETE  sha=$SHORT  tag=$TAG"
cat <<EOF

────────────── NEXT ──────────────
# 1. From a device that has already passed the gate:
curl -sk ${PREVIEW_URL}/api/health

# 2. If that returns 403, the device has not been through the cookie door yet:
#    open ${PREVIEW_URL}/__gate?t=<token>  once, then reload.
#    Token: /etc/nginx/gacp-gate-token.conf on this box (root:root 600).

# 3. Confirm the public URL serves the build this script just started:
bash $BUILD_DIR/scripts/ops/which-build.sh ${PREVIEW_URL}

# This script did NOT touch host nginx. If ${PREVIEW_URL} does not resolve or
# 502s, install the vhost per docs/operations/runbooks/preview-stack.md.
EOF
