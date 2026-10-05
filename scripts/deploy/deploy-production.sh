#!/usr/bin/env bash
#
# scripts/deploy/deploy-production.sh
#
# Production deployment with safety guards. Run ON the production server
# (or via SSH from CI). Refuses to proceed if any safety check fails.
#
# Flow:
#   1. Pre-flight: clean git state, correct branch, env vars present
#   2. Backup PostgreSQL data
#   3. Pull latest deploy/production
#   4. Run Prisma migrations
#   5. Rolling restart backend + frontend (other services keep running)
#   6. Smoke test /api/health and /api/subscription/me
#   7. Audit-log everything to /var/log/gacp-deploys/
#
# Rollback: see ROLLBACK section at bottom of /var/log/gacp-deploys/<ts>.log
#
# Usage (on server):
#   sudo /opt/gacp-platform/scripts/deploy/deploy-production.sh
#
# Usage (from CI, via SSH):
#   ssh root@host "/opt/gacp-platform/scripts/deploy/deploy-production.sh"
#
# Exit codes:
#   0  success
#   1  pre-flight check failed (no changes made)
#   2  backup failed (no changes made)
#   3  migration failed (DB state may need rollback — see log)
#   4  container restart failed (running old image)
#   5  smoke test failed (rollback recommended)

set -Eeuo pipefail

# ─── Config ──────────────────────────────────────────────────────────────
PROJECT_DIR="${PROJECT_DIR:-/opt/gacp-platform}"
BRANCH="${DEPLOY_BRANCH:-deploy/production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
DEPLOY_LOG_DIR="${DEPLOY_LOG_DIR:-/var/log/gacp-deploys}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/gacp}"
HEALTH_URL="${HEALTH_URL:-http://localhost/api/health}"
ENTITLEMENTS_URL="${ENTITLEMENTS_URL:-http://localhost/api/subscription/plans}"

# Environment variables that MUST be set in $ENV_FILE.
REQUIRED_ENV_VARS=(
    DATABASE_URL
    REDIS_URL
    HEALTH_JWT_SECRET
    PROVIDER_JWT_SECRET
    ENCRYPTION_KEY
    QR_SIGNATURE_FALLBACK_SECRET
    PAYMENT_WEBHOOK_SECRET
)

TS="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$DEPLOY_LOG_DIR/$TS.log"

mkdir -p "$DEPLOY_LOG_DIR" "$BACKUP_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1

err() { echo "❌ $*" >&2; }
ok()  { echo "✅ $*"; }
inf() { echo "ℹ️  $*"; }

trap 'err "deploy aborted on line $LINENO"; exit 99' ERR

# ─── 1/7 Pre-flight ──────────────────────────────────────────────────────

inf "[$(date)] gacp-platform deploy starting (log: $LOG_FILE)"
cd "$PROJECT_DIR"

echo
inf "[1/7] Pre-flight checks"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
    err "currently on '$CURRENT_BRANCH', expected '$BRANCH'"
    err "  fix: git checkout $BRANCH"
    exit 1
fi
ok "  branch: $CURRENT_BRANCH"

# Refuse to deploy with uncommitted edits — production must equal git HEAD.
if [ -n "$(git status --porcelain)" ]; then
    err "working tree dirty — production must match git HEAD exactly"
    err "  see: git status"
    err "  resolve: snapshot uncommitted edits to a backup branch, then reset --hard"
    exit 1
fi
ok "  working tree clean"

if [ ! -f "$ENV_FILE" ]; then
    err "$ENV_FILE not found"
    exit 1
fi

MISSING_VARS=()
for var in "${REQUIRED_ENV_VARS[@]}"; do
    if ! grep -qE "^${var}=.+" "$ENV_FILE"; then
        MISSING_VARS+=("$var")
    fi
done
if [ "${#MISSING_VARS[@]}" -gt 0 ]; then
    err "missing required env vars in $ENV_FILE:"
    for var in "${MISSING_VARS[@]}"; do err "    - $var"; done
    err "  (each variable must be present and non-empty)"
    exit 1
fi
ok "  env vars: all $(printf '%s, ' "${REQUIRED_ENV_VARS[@]}" | sed 's/, $//') present"

# SENTRY_DSN is OPTIONAL (never a boot gate). Error tracking was re-added
# 2026-10-02 by operator decision, with PII scrubbing (apps/backend/config/sentry.js):
# set SENTRY_DSN in $ENV_FILE to turn it on, leave it empty to keep it off.
# Runbook: docs/operations/sentry-error-tracking.md
if grep -qE "^SENTRY_DSN=." "$ENV_FILE"; then
    inf "  env vars: SENTRY_DSN present (optional) — error tracking on (PII-scrubbed)"
else
    inf "  env vars: SENTRY_DSN not set (optional) — error tracking off"
fi

OLD_HEAD="$(git rev-parse HEAD)"
inf "  current HEAD: $(git log --oneline -1)"

# ─── 2/7 Backup ──────────────────────────────────────────────────────────

echo
inf "[2/7] PostgreSQL backup"
BACKUP_FILE="$BACKUP_DIR/gacp-pre-deploy-$TS.sql.gz"

# The database is Supabase (operator ruling 2026-08-23) — there is no postgres in
# this stack to exec into, so dump over the wire using DATABASE_URL from the deploy
# env file. A throwaway postgres client image supplies pg_dump; the host needs none.
# The URL is passed through the environment, never on the command line, so it does
# not land in `ps` output or the deploy log.
DB_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
if [ -z "$DB_URL" ]; then
    err "DATABASE_URL not found in $ENV_FILE — cannot back up"
    exit 2
fi

if PGURL="$DB_URL" docker run --rm -i -e PGURL \
        "${PG_CLIENT_IMAGE:-postgres:17-alpine}" \
        sh -c 'pg_dump --clean --if-exists --no-owner --no-acl "$PGURL"' \
        | gzip > "$BACKUP_FILE" && [ -s "$BACKUP_FILE" ]; then
    ok "  backup: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
else
    err "pg_dump against DATABASE_URL failed — cannot back up"
    rm -f "$BACKUP_FILE"
    exit 2
fi

# ─── 3/7 Pull latest config (compose, env, scripts) ─────────────────────
#
# We still need to keep `docker-compose.production.yml` and `.env.production`
# in sync with main, even though the application code itself ships via the
# pre-built image. Skipping the FF if HEAD already matches origin lets a
# rollback (`IMAGE_TAG=sha-old ./deploy-production.sh`) work even when no
# new commits exist — image pull alone is the meaningful change there.

echo
inf "[3/7] Fetch + fast-forward $BRANCH (config files only)"
git fetch origin "$BRANCH" --quiet
NEW_HEAD="$(git rev-parse "origin/$BRANCH")"

if [ "$OLD_HEAD" = "$NEW_HEAD" ]; then
    inf "  already at $NEW_HEAD — proceeding to image-tag step"
else
    # Ensure fast-forward only — if branches diverged something is very wrong.
    if ! git merge-base --is-ancestor "$OLD_HEAD" "$NEW_HEAD"; then
        err "local HEAD is NOT an ancestor of origin/$BRANCH — refusing to deploy"
        err "  manual intervention required"
        exit 1
    fi
    git merge --ff-only "$NEW_HEAD"
    ok "  fast-forwarded: $OLD_HEAD → $NEW_HEAD"
    inf "  new commits:"
    git log --oneline "$OLD_HEAD..$NEW_HEAD" | sed 's/^/    /'
fi

# ─── 4/7 Pull image ──────────────────────────────────────────────────────
#
# Image-based deploy (Level 4): docker-compose.production.yml references
# `image: ghcr.io/.../gacp-{backend,frontend}:${IMAGE_TAG}` rather than
# `build:`. We pull the new tag here so step [5/7] can use the new image's
# Prisma client + migration files without touching the running containers.
#
# IMAGE_TAG resolution (in order of precedence):
#   1. IMAGE_TAG env passed to this script (rollback / pin)
#   2. .env.production's IMAGE_TAG line
#   3. Default: `deploy-production-latest`
#
# To roll back to a specific build: `IMAGE_TAG=sha-abc1234 ./deploy-production.sh`

echo
inf "[4/7] Pull image"

# Resolve DESIRED_TAG defensively. The grep is wrapped with `|| true` because
# `set -Eeuo pipefail` + the ERR trap turn a no-match (exit 1) into a script
# abort, which breaks the deploy on any host whose .env.production lacks an
# IMAGE_TAG line — i.e. every host using the rolling default.
if [[ -n "${IMAGE_TAG:-}" ]]; then
    DESIRED_TAG="$IMAGE_TAG"
else
    DESIRED_TAG=$(grep -E '^IMAGE_TAG=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2 || true)
fi
DESIRED_TAG="${DESIRED_TAG:-deploy-production-latest}"
inf "  pulling tag: $DESIRED_TAG"

if ! IMAGE_TAG="$DESIRED_TAG" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
    pull backend frontend; then
    err "image pull failed — old containers still running"
    err "  check: docker login ghcr.io is configured on this host"
    err "  check: the tag '$DESIRED_TAG' exists at ghcr.io/jonmaxmore/gacp-backend"
    exit 4
fi
ok "  pulled $DESIRED_TAG (backend + frontend)"

# ─── 5/7 Prisma migrate deploy (using NEW image's migration files) ──────
#
# Run migrations in a transient container spawned from the just-pulled image.
# This guarantees the migration files inside the container match the new
# code about to start in step [6/7]. The previous order (migrate before
# pull) ran against the OLD container's filesystem, which silently reported
# "No pending" when a release added new migrations — verified during the
# 2026-04-30 deploy of the slip-flow Phase 1 schema.

echo
inf "[5/7] Prisma migrate deploy (using new image)"
if ! IMAGE_TAG="$DESIRED_TAG" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
    run --rm --no-deps backend npx prisma migrate deploy; then
    err "migration failed — running containers untouched, no traffic switched yet"
    err "  rollback: nothing to undo on the container side"
    err "  database state: see $BACKUP_FILE for restore point"
    exit 3
fi
ok "  migrations applied"

# ─── 6/7 Rolling restart ────────────────────────────────────────────────
#
# `up -d` recreates only services whose image hash changed; nginx, postgres,
# redis, etc. continue uninterrupted.

echo
inf "[6/7] Rolling restart backend / frontend"
if ! IMAGE_TAG="$DESIRED_TAG" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
    up -d --no-deps backend frontend; then
    err "container restart failed — running mixed image versions"
    err "  manual recovery: docker compose --env-file $ENV_FILE -f $COMPOSE_FILE up -d backend frontend"
    exit 4
fi
ok "  backend + frontend rolled to $DESIRED_TAG"

# Ensure the uploads volume is writable by the app user (uid 1001). A freshly
# (re)mounted named volume inherits the image dir's root:root ownership, so the
# non-root app user can't mkdir into it → multer EACCES → 502 on document upload
# (2026-06-25). Idempotent; runs every deploy. The container must be up to exec.
for _ in 1 2 3 4 5; do
    if docker exec -u 0 gacp-backend chown -R 1001:1001 /app/apps/backend/public/uploads 2>/dev/null; then
        ok "  uploads dir owned by app user (1001)"
        break
    fi
    sleep 2
done

# ─── 7/7 Smoke test ─────────────────────────────────────────────────────

echo
inf "[7/7] Smoke test"
sleep 8  # give backend a moment to boot

HEALTH_OK=false
for attempt in 1 2 3 4 5; do
    if curl -sf -m 5 "$HEALTH_URL" >/dev/null; then
        HEALTH_OK=true
        break
    fi
    sleep 3
done
if [ "$HEALTH_OK" = "true" ]; then
    ok "  /api/health: 200"
else
    err "/api/health failed after 5 attempts"
    err "  consider rollback: git reset --hard $OLD_HEAD && docker compose ... up -d --build backend frontend"
    exit 5
fi

if curl -sf -m 5 "$ENTITLEMENTS_URL" >/dev/null; then
    ok "  /api/subscription/plans: 200"
else
    inf "  /api/subscription/plans: not yet (might not be deployed); continuing"
fi

# ─── Disk hygiene ─────────────────────────────────────────────────────────
# Reclaim the now-dangling previous image + build cache so repeated deploys do
# not fill the shared droplet disk. 2026-06-24 incident: ~56GB of unpruned dangling
# images filled the 79G disk → Redis AOF "No space left on device" → auth/queues
# broke on BOTH prod and staging. The active (rolled-to) image is tagged, so prune
# keeps it. Non-fatal — a prune hiccup must not fail or roll back a successful deploy.
ok "Pruning dangling images + build cache (disk hygiene)" 2>/dev/null || true
docker image prune -f >/dev/null 2>&1 || true
docker builder prune -f >/dev/null 2>&1 || true

# ─── Backup cron (idempotent) ─────────────────────────────────────────────
# A12 (2026-08-05): the daily DB-backup cron (/etc/cron.d/gacp-backup) was
# NEVER installed on the droplet — install-cron.sh existed but no deploy path
# ran it, so the platform had zero automated backups (the only backup on disk
# was one manual pg-backup.sh run). Ensure it here on every deploy;
# install-cron.sh is idempotent (re-writes the same cron.d file). Non-fatal —
# a cron-install hiccup must not fail an otherwise-successful deploy, but it is
# loud so a missing backup schedule is visible in the deploy log.
if [ -x "$PROJECT_DIR/scripts/backup/install-cron.sh" ]; then
    inf "Ensuring daily DB-backup cron (/etc/cron.d/gacp-backup)"
    if "$PROJECT_DIR/scripts/backup/install-cron.sh"; then
        ok "  backup cron installed/verified"
    else
        err "  install-cron.sh failed — DB backups may NOT be scheduled. Fix ASAP (non-fatal to this deploy)."
    fi
else
    err "  scripts/backup/install-cron.sh missing/not executable — DB backup schedule NOT ensured."
fi

# ─── Done ───────────────────────────────────────────────────────────────

echo
ok "DEPLOY COMPLETE  $OLD_HEAD → $NEW_HEAD  (log: $LOG_FILE)"

cat <<EOF

────────────── ROLLBACK (if smoke breaks later) ──────────────
# Image-based deploy (Level 4) — rollback is just a tag swap, no rebuild:
ssh root@<host>
cd $PROJECT_DIR

# 1. Reset code to previous commit (so config matches running image)
git reset --hard $OLD_HEAD

# 2. Re-run deploy with the PREVIOUS image tag (find it in /var/log/gacp-deploys/)
PREV_TAG=\$(grep 'pulling tag:' /var/log/gacp-deploys/\$(ls -t /var/log/gacp-deploys/ | sed -n 2p) | awk '{print \$NF}')
IMAGE_TAG="\$PREV_TAG" $0

# 3. If migration regression, restore DB from this deploy's backup:
zcat $BACKUP_FILE | docker compose --env-file $ENV_FILE -f $COMPOSE_FILE \\
    exec -T $DB_SVC psql -U gacp gacp_db
──────────────────────────────────────────────────────────────
EOF
