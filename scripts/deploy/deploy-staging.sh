#!/usr/bin/env bash
#
# scripts/deploy/deploy-staging.sh
#
# Deploy to the staging slot on the same droplet.
# Smaller resource budget than prod, separate DB (`gacp_staging`),
# separate redis keyspace (db index 1), separate uploads volume.
#
# Flow (5 steps — simpler than prod because no zero-downtime requirement):
#   1. Pre-flight (env file present, image exists on GHCR)
#   2. Backup staging DB (small + fast)
#   3. Pull new image into staging slot
#   4. Run prisma migrate deploy on staging DB
#   5. Recreate staging containers (~10 s downtime — staging traffic = devs)
#
# IMAGE_TAG resolution:
#   - explicit env override
#   - .env.staging line
#   - default: `main-latest` (rolling tag for main branch builds)
#
# Exit codes mirror deploy-production.sh.

set -Eeuo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/gacp-platform}"
COMPOSE_PROD="${COMPOSE_FILE:-docker-compose.production.yml}"
COMPOSE_STAGING="${COMPOSE_STAGING_FILE:-docker-compose.staging.yml}"
ENV_FILE="${ENV_FILE:-.env.staging}"
DEPLOY_LOG_DIR="${DEPLOY_LOG_DIR:-/var/log/gacp-deploys}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/gacp-staging}"

REQUIRED_ENV_VARS=(
    DB_PASSWORD HEALTH_JWT_SECRET PROVIDER_JWT_SECRET ENCRYPTION_KEY
    QR_SIGNATURE_FALLBACK_SECRET PAYMENT_WEBHOOK_SECRET
)

TS="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$DEPLOY_LOG_DIR/staging-$TS.log"
mkdir -p "$DEPLOY_LOG_DIR" "$BACKUP_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1

err() { echo "❌ $*" >&2; }
ok()  { echo "✅ $*"; }
inf() { echo "ℹ️  $*"; }

trap 'err "staging deploy aborted on line $LINENO"; exit 99' ERR

cd "$PROJECT_DIR"

DESIRED_TAG="${IMAGE_TAG:-$(grep -E '^STAGING_IMAGE_TAG=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2)}"
DESIRED_TAG="${DESIRED_TAG:-main-latest}"

inf "[$(date)] staging deploy starting (tag=$DESIRED_TAG, log=$LOG_FILE)"

# ─── 1. Pre-flight ───────────────────────────────────────────────────────

inf "[1/5] Pre-flight"

if [ ! -f "$ENV_FILE" ]; then
    err "$ENV_FILE not found — copy .env.production and adjust staging-specific values"
    err "  see docs/operations/staging-activation.md"
    exit 1
fi

MISSING=()
for v in "${REQUIRED_ENV_VARS[@]}"; do
    grep -qE "^${v}=.+" "$ENV_FILE" || MISSING+=("$v")
done
if [ "${#MISSING[@]}" -gt 0 ]; then
    err "missing env vars in $ENV_FILE: ${MISSING[*]}"
    exit 1
fi
ok "  env: ok"

BACKEND_IMG="ghcr.io/jonmaxmore/gacp-backend:$DESIRED_TAG"
FRONTEND_IMG="ghcr.io/jonmaxmore/gacp-frontend:$DESIRED_TAG"

# Image source: LOCAL FIRST, then GHCR.
#
# This step used to require the tag on GHCR and exit 1 otherwise, which made the
# registry a hard dependency of deploying anything. On 2026-08-14 that became a
# wall: GitHub Actions minutes are gone by operator decision, so build-images.yml
# cannot produce a new image, and the only images that exist are the ones
# `docker build` makes on this box. An image already present on this machine does
# not need fetching from anywhere, and refusing to use it is a constraint with no
# safety behind it.
#
# BOTH images are checked now, not just the backend. Passing pre-flight on the
# backend alone meant a missing frontend surfaced at step 5 — after the database
# had already been migrated, which is the worst place to discover it.
NEED_PULL=0
IMG_REPORT=""
for _img in "$BACKEND_IMG" "$FRONTEND_IMG"; do
    if docker image inspect "$_img" >/dev/null 2>&1; then
        IMG_REPORT="${IMG_REPORT}${_img##*/}=local "
    elif docker buildx imagetools inspect "$_img" >/dev/null 2>&1; then
        IMG_REPORT="${IMG_REPORT}${_img##*/}=ghcr "
        NEED_PULL=1
    else
        err "image not found locally OR on GHCR: $_img"
        err "  build it on this machine:"
        err "    SHA=\$(git rev-parse HEAD)"
        err "    docker build -f apps/backend/Dockerfile --build-arg GIT_SHA=\$SHA -t ghcr.io/jonmaxmore/gacp-backend:$DESIRED_TAG ."
        exit 1
    fi
done
ok "  images: $IMG_REPORT"

# ─── 2. Backup ───────────────────────────────────────────────────────────

inf "[2/5] Backup staging DB"
STAGING_DB_NAME="$(grep -E '^STAGING_DB_NAME=' "$ENV_FILE" | head -1 | cut -d= -f2)"
STAGING_DB_NAME="${STAGING_DB_NAME:-gacp_staging}"
DB_USER_VAL="$(grep -E '^DB_USER=' "$ENV_FILE" | head -1 | cut -d= -f2)"
DB_USER_VAL="${DB_USER_VAL:-gacp}"

BACKUP_FILE="$BACKUP_DIR/staging-pre-deploy-$TS.sql.gz"

# The staging database is the Supabase project named in .env.staging (repointed
# 2026-09-08); the local postgres container was retired 2026-09-15 — see the
# RETIRED block in docker-compose.production.yml. Until this change, step 2 dumped
# and step 4 migrated the STALE local copy while step 5 started the app against
# Supabase, so the real database was never backed up or migrated by this script.
#
# Tools talk to Supabase over DIRECT_URL (session mode, port 5432). The pooled
# DATABASE_URL carries `?pgbouncer=true`, which libpq rejects as an unknown URI
# parameter and prisma migrate cannot run through anyway. The URL travels via the
# environment so it never lands in `ps` output or this log.
STAGING_TOOL_URL="$(grep -E '^DIRECT_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
if [ -z "$STAGING_TOOL_URL" ]; then
    STAGING_TOOL_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
    [ -n "$STAGING_TOOL_URL" ] && inf "  DIRECT_URL not set in $ENV_FILE — falling back to DATABASE_URL for pg_dump/migrate"
fi

if [ -n "$STAGING_TOOL_URL" ]; then
    if PGURL="$STAGING_TOOL_URL" docker run --rm -i -e PGURL \
            "${PG_CLIENT_IMAGE:-postgres:17-alpine}" \
            sh -c 'pg_dump --clean --if-exists --no-owner --no-acl "$PGURL"' \
            | gzip > "$BACKUP_FILE" && [ -s "$BACKUP_FILE" ]; then
        ok "  $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
    else
        err "pg_dump against the staging Supabase database failed — cannot back up; aborting"
        rm -f "$BACKUP_FILE"
        exit 2
    fi
elif docker compose --env-file "$ENV_FILE" -f "$COMPOSE_PROD" ps postgres --format '{{.State}}' 2>/dev/null | grep -q running; then
    # Legacy path: no Supabase URL in the env file, local postgres still around.
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_PROD" exec -T postgres \
        pg_dump --clean --if-exists -U "$DB_USER_VAL" "$STAGING_DB_NAME" \
        2>/dev/null | gzip > "$BACKUP_FILE" || true
    if [ -s "$BACKUP_FILE" ]; then
        ok "  $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
    else
        inf "  staging DB '$STAGING_DB_NAME' empty or new — skipping (will be created on first migrate)"
        rm -f "$BACKUP_FILE"
    fi
else
    err "no DIRECT_URL/DATABASE_URL in $ENV_FILE and no postgres container — cannot back up; aborting"
    exit 2
fi

# ─── 3. Pull image ───────────────────────────────────────────────────────

inf "[3/5] Pull staging image"
# Skipped when pre-flight found both images already on this machine. `pull` on a
# tag that exists only locally fails, which would abort the deploy AFTER the
# database backup in step 2 and leave nothing deployed — for a tag that was
# sitting right there.
if [ "$NEED_PULL" = "0" ]; then
    ok "  both images already present locally — nothing to pull"
else
    STAGING_IMAGE_TAG="$DESIRED_TAG" \
        docker compose --env-file "$ENV_FILE" \
        -f "$COMPOSE_PROD" -f "$COMPOSE_STAGING" \
        pull backend-staging frontend-staging
    ok "  pulled"
fi

# ─── 4. Migrate ─────────────────────────────────────────────────────────

inf "[4/5] Prisma migrate deploy on staging DB"
# Run a one-shot container against the staging database so we don't need the
# staging backend container to be up yet. Use the same image that's about to
# run, so prisma's expected schema matches. Same URL as the backup above: the
# session-mode DIRECT_URL, never the pooled one. When there is no Supabase URL
# at all (legacy path), fall back to the local container the old way.
if [ -z "$STAGING_TOOL_URL" ]; then
    STAGING_TOOL_URL="postgresql://${DB_USER_VAL}:$(grep -E '^DB_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2-)@postgres:5432/${STAGING_DB_NAME}?schema=public"
fi
if DATABASE_URL="$STAGING_TOOL_URL" DIRECT_URL="$STAGING_TOOL_URL" \
    docker run --rm --network gacp-network -e DATABASE_URL -e DIRECT_URL \
    "$BACKEND_IMG" \
    sh -c "cd /app/apps/backend && npx prisma migrate deploy" 2>&1 | tail -15; then
    ok "  migrations applied"
else
    err "migration failed; staging DB may be in inconsistent state"
    exit 3
fi

# ─── 5. Recreate containers ──────────────────────────────────────────────

inf "[5/5] (Re)start staging stack"
STAGING_IMAGE_TAG="$DESIRED_TAG" \
    docker compose --env-file "$ENV_FILE" \
    -f "$COMPOSE_PROD" -f "$COMPOSE_STAGING" \
    up -d backend-staging frontend-staging
ok "  staging stack up"

# Ensure the uploads volume is writable by the app user (uid 1001). A freshly
# (re)mounted named volume inherits the image dir's root:root ownership, so the
# non-root app user can't mkdir into it → multer EACCES → 502 on document upload
# (2026-06-25). Idempotent; runs every deploy. The container must be up to exec.
for _ in 1 2 3 4 5; do
    if docker exec -u 0 gacp-backend-staging chown -R 1001:1001 /app/apps/backend/public/uploads 2>/dev/null; then
        ok "  uploads dir owned by app user (1001)"
        break
    fi
    sleep 2
done

# Smoke
sleep 10
SMOKE_URL="${STAGING_PUBLIC_URL:-https://staging.gacpth.com}/api/health"
SMOKE_OK=false
for _ in 1 2 3 4 5; do
    if curl -sk -m 5 "$SMOKE_URL" 2>/dev/null | grep -q '"success":true'; then
        SMOKE_OK=true
        break
    fi
    sleep 3
done

# Fallback to direct loopback hit if the public URL isn't routable yet
if [ "$SMOKE_OK" != "true" ]; then
    if curl -sf -m 5 "http://127.0.0.1:8001/api/health" | grep -q '"success":true'; then
        SMOKE_OK=true
        ok "  staging /api/health 200 (loopback — DNS or nginx vhost not yet wired up?)"
    fi
fi

if [ "$SMOKE_OK" = "true" ]; then
    ok "  staging /api/health 200"
else
    err "staging smoke failed — check container logs"
    err "    docker logs gacp-backend-staging --tail 50"
    exit 5
fi

# Reclaim the now-dangling previous image + build cache so repeated deploys do
# not fill the shared droplet disk. 2026-06-24 incident: ~56GB of unpruned dangling
# images filled the 79G disk → Redis AOF "No space left on device" → auth/queues
# broke on BOTH staging and prod. Non-fatal — a prune hiccup must not fail a deploy.
inf "Pruning dangling images + build cache (disk hygiene)"
docker image prune -f >/dev/null 2>&1 || true
docker builder prune -f >/dev/null 2>&1 || true

echo
ok "STAGING DEPLOY COMPLETE  tag=$DESIRED_TAG  log=$LOG_FILE"

cat <<EOF

────────────── NEXT STEPS ──────────────
# Smoke staging end-to-end:
curl -sk ${STAGING_PUBLIC_URL:-https://staging.gacpth.com}/api/health

# Promote staging tag → prod (when ready):
ssh root@203.0.113.10
IMAGE_TAG=$DESIRED_TAG /opt/gacp-platform/scripts/deploy/deploy-production.sh

# Roll staging back if needed:
IMAGE_TAG=<previous-tag> $0
─────────────────────────────────────────
EOF
