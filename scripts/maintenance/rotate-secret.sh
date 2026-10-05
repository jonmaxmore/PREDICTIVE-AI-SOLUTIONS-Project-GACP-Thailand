#!/bin/bash
# ═══════════════════════════════════════════════════════════
# GACP Platform — generic secret rotator
# ═══════════════════════════════════════════════════════════
#
# Rotates one secret in /opt/gacp-platform/.env.production, restarts the
# backend container with the new value, and rolls back automatically if
# the smoke test fails.
#
# Usage (on the production droplet):
#   sudo /opt/gacp-platform/scripts/maintenance/rotate-secret.sh <SECRET_NAME>
#
# Examples:
#   sudo ./rotate-secret.sh HEALTH_JWT_SECRET
#   sudo ./rotate-secret.sh PROVIDER_JWT_SECRET
#   sudo ./rotate-secret.sh QR_SIGNATURE_FALLBACK_SECRET
#   sudo ./rotate-secret.sh PAYMENT_WEBHOOK_SECRET
#
# WARNING — ENCRYPTION_KEY is special:
#   ENCRYPTION_KEY (and MASTER_ENCRYPTION_KEY) protect data at rest. A
#   straight rotation here will leave existing encrypted columns
#   un-decryptable. DO NOT rotate ENCRYPTION_KEY with this script unless
#   you have already re-encrypted all dependent rows under the new key.
#   See docs/operations/runbooks/secret-rotation.md.
#
# Steps:
#   1. Pre-flight: root, on production server, secret name valid.
#   2. Backup .env.production to /var/backups/gacp/env-rotations/.
#   3. Generate a new 48-byte (base64-encoded → 64 chars) secret.
#   4. Atomically replace the line in .env.production.
#   5. Verify file mode is 0600.
#   6. Restart the backend container.
#   7. Smoke-test /api/health. On failure, restore the backup.
#   8. Append a record to /var/log/gacp-secret-rotations.log.

set -euo pipefail

# ── Constants ──
ENV_FILE="/opt/gacp-platform/.env.production"
COMPOSE_FILE="/opt/gacp-platform/docker-compose.production.yml"
COMPOSE_DIR="/opt/gacp-platform"
BACKUP_ROOT="/var/backups/gacp/env-rotations"
ROTATION_LOG="/var/log/gacp-secret-rotations.log"
# Default smoke URL hits nginx, which proxies to the backend container.
# 127.0.0.1:8000 was the Express direct port in early dev — but production
# fronts nginx on :80 and the backend isn't published on 8000 anymore, so
# the old default caused this script to fail rollback every time on prod.
# Override via env: `SMOKE_URL=http://localhost/api/health rotate-secret.sh ...`
SMOKE_URL="${SMOKE_URL:-http://127.0.0.1/api/health}"
SMOKE_RETRIES=10
SMOKE_DELAY=3

# Allow-list of secrets this script knows how to rotate.
# Add new names here as the platform grows.
ALLOWED_SECRETS=(
    HEALTH_JWT_SECRET
    PROVIDER_JWT_SECRET
    QR_SIGNATURE_FALLBACK_SECRET
    PAYMENT_WEBHOOK_SECRET
    ENCRYPTION_KEY
    MASTER_ENCRYPTION_KEY
)

# ── Colors ──
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[rotate-secret]${NC} $1"; }
warn() { echo -e "${YELLOW}[rotate-secret]${NC} $1"; }
err()  { echo -e "${RED}[rotate-secret]${NC} $1" >&2; }

# ── Pre-flight ──
if [[ "${EUID}" -ne 0 ]]; then
    err "Must run as root (touches .env.production at mode 0600). Try: sudo $0 $*"
    exit 1
fi

if [[ $# -ne 1 ]]; then
    err "Usage: $0 <SECRET_NAME>"
    err "  Allowed: ${ALLOWED_SECRETS[*]}"
    exit 1
fi

SECRET_NAME="$1"

# Validate against allow-list. We don't accept arbitrary names so a
# typo can't append a new line to .env.production.
allowed=0
for s in "${ALLOWED_SECRETS[@]}"; do
    if [[ "${s}" == "${SECRET_NAME}" ]]; then
        allowed=1
        break
    fi
done
if [[ "${allowed}" -ne 1 ]]; then
    err "Unknown secret: ${SECRET_NAME}"
    err "  Allowed: ${ALLOWED_SECRETS[*]}"
    err "  If this is a legitimate new secret, add it to ALLOWED_SECRETS in this script."
    exit 1
fi

# Special-case ENCRYPTION_KEY — refuse without an explicit override flag.
# Rotating ENCRYPTION_KEY without re-encrypting data corrupts the system.
if [[ "${SECRET_NAME}" == "ENCRYPTION_KEY" || "${SECRET_NAME}" == "MASTER_ENCRYPTION_KEY" ]]; then
    if [[ "${I_HAVE_REENCRYPTED_DATA:-}" != "yes" ]]; then
        err "Refusing to rotate ${SECRET_NAME} via this generic script."
        err ""
        err "  ${SECRET_NAME} protects encrypted data at rest. Rotating it without"
        err "  re-encrypting all dependent rows will leave the data un-decryptable."
        err ""
        err "  See: docs/operations/runbooks/secret-rotation.md (ENCRYPTION_KEY section)."
        err ""
        err "  If you truly have re-encrypted, set I_HAVE_REENCRYPTED_DATA=yes and re-run."
        exit 1
    fi
    warn "ENCRYPTION_KEY rotation override accepted via I_HAVE_REENCRYPTED_DATA=yes"
fi

if [[ ! -f "${ENV_FILE}" ]]; then
    err "Env file not found: ${ENV_FILE}"
    err "  Is the deploy at /opt/gacp-platform? If not, edit ENV_FILE in this script."
    exit 1
fi

if ! grep -qE "^${SECRET_NAME}=" "${ENV_FILE}"; then
    err "Secret ${SECRET_NAME} is not present in ${ENV_FILE} — refusing to add a new line."
    err "  This script only rotates existing secrets."
    exit 1
fi

# ── Backup ──
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "${BACKUP_ROOT}"
chmod 0700 "${BACKUP_ROOT}"
BACKUP_FILE="${BACKUP_ROOT}/.env.production-${TIMESTAMP}.bak"
cp "${ENV_FILE}" "${BACKUP_FILE}"
chmod 0600 "${BACKUP_FILE}"
log "Backed up env to: ${BACKUP_FILE}"

# ── Generate new secret ──
# 48 bytes of /dev/urandom → 64 url-safe base64 chars (no '=' padding).
# Strong enough for HMAC and JWT signing keys.
NEW_VALUE=$(head -c 48 /dev/urandom | base64 | tr -d '\n=' | tr '/+' '_-')
if [[ ${#NEW_VALUE} -lt 32 ]]; then
    err "Failed to generate a 32+ char secret (got ${#NEW_VALUE} chars)."
    exit 1
fi
log "Generated new secret (${#NEW_VALUE} chars)"

# ── Atomic replace ──
TMP_FILE="$(mktemp "${ENV_FILE}.XXXXXX")"
chmod 0600 "${TMP_FILE}"

# We use awk (not sed) to avoid shell-escape issues with secrets that
# contain regex metacharacters. The new value is passed via env, never
# interpolated into the awk program.
NEW_VALUE="${NEW_VALUE}" awk -v key="${SECRET_NAME}" '
    BEGIN { replaced = 0 }
    {
        if (substr($0, 1, length(key) + 1) == key "=") {
            print key "=" ENVIRON["NEW_VALUE"]
            replaced = 1
        } else {
            print
        }
    }
    END { if (!replaced) { exit 1 } }
' "${ENV_FILE}" > "${TMP_FILE}"

mv "${TMP_FILE}" "${ENV_FILE}"
chmod 0600 "${ENV_FILE}"

# Verify mode 0600 (umask edge case).
ACTUAL_MODE=$(stat -c '%a' "${ENV_FILE}")
if [[ "${ACTUAL_MODE}" != "600" ]]; then
    err ".env.production has mode ${ACTUAL_MODE}, expected 600. Fixing."
    chmod 0600 "${ENV_FILE}"
fi
log "Updated ${SECRET_NAME} in ${ENV_FILE} (mode 0600 verified)"

# ── Restart backend ──
#
# We must pin IMAGE_TAG to whatever's currently running. Without this the
# compose file falls back to `deploy-production-latest` (the rolling tag),
# which can downgrade the running version when CI hasn't yet pushed a new
# rolling tag for the latest commit. (Hit 2026-04-28 — backend got rolled
# back from v3.4.2 to a 24h-old image during a routine rotation.)
#
# v3.5.1 (2026-04-28): hard-fail if we cannot determine the currently-running
# tag. The previous fallback to `deploy-production-latest` re-introduced the
# silent-downgrade risk if `docker inspect` returned empty (e.g. container
# stopped during the rotation). A loud failure is preferable; the operator
# can re-run after starting the container or pass IMAGE_TAG explicitly.
log "Restarting backend container with new secret…"

if [[ -z "${IMAGE_TAG:-}" ]]; then
    CURRENT_IMAGE=$(docker inspect gacp-backend --format '{{.Config.Image}}' 2>/dev/null || echo '')
    CURRENT_TAG="${CURRENT_IMAGE##*:}"
    if [[ -z "${CURRENT_TAG}" || "${CURRENT_TAG}" == "${CURRENT_IMAGE}" ]]; then
        err "Cannot determine running backend image tag (gacp-backend not running?)."
        err "  Refusing to restart with implicit 'deploy-production-latest' fallback."
        err "  Either start the backend first, or re-run with IMAGE_TAG=v3.x.x explicitly:"
        err "    IMAGE_TAG=v3.5.1 sudo $0 ${SECRET_NAME}"
        # Restore .env from backup before exiting — don't leave the env in
        # a half-rotated state when we won't restart the service.
        cp "${BACKUP_FILE}" "${ENV_FILE}"
        chmod 0600 "${ENV_FILE}"
        chown root:root "${ENV_FILE}" 2>/dev/null || true
        {
            echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ABORT_NO_TAG secret=${SECRET_NAME} actor=${SUDO_USER:-${USER:-unknown}} backup=${BACKUP_FILE}"
        } >> "${ROTATION_LOG}"
        exit 1
    fi
    log "  pinning IMAGE_TAG=${CURRENT_TAG} (preserves running version)"
    export IMAGE_TAG="${CURRENT_TAG}"
fi

restart_ok=0
if (cd "${COMPOSE_DIR}" && IMAGE_TAG="${IMAGE_TAG}" \
        docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --no-deps backend); then
    restart_ok=1
fi

# ── Smoke test ──
smoke_ok=0
if [[ "${restart_ok}" -eq 1 ]]; then
    log "Smoke-testing ${SMOKE_URL} (up to ${SMOKE_RETRIES} tries)…"
    for i in $(seq 1 "${SMOKE_RETRIES}"); do
        if curl -fsS -o /dev/null -m 5 "${SMOKE_URL}"; then
            smoke_ok=1
            log "  smoke ok on try ${i}"
            break
        fi
        sleep "${SMOKE_DELAY}"
    done
fi

if [[ "${smoke_ok}" -ne 1 ]]; then
    err "Smoke test FAILED. Restoring previous .env.production."
    cp "${BACKUP_FILE}" "${ENV_FILE}"
    chmod 0600 "${ENV_FILE}"
    # Same IMAGE_TAG pinning as the success path — never accidentally
    # downgrade to deploy-production-latest during a rollback.
    (cd "${COMPOSE_DIR}" && IMAGE_TAG="${IMAGE_TAG:-deploy-production-latest}" \
        docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --no-deps backend) || true

    # Audit the failed attempt.
    {
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ROLLBACK secret=${SECRET_NAME} actor=${SUDO_USER:-${USER:-unknown}} backup=${BACKUP_FILE}"
    } >> "${ROTATION_LOG}"
    chmod 0600 "${ROTATION_LOG}" 2>/dev/null || true
    exit 1
fi

# ── Audit log ──
{
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ROTATED secret=${SECRET_NAME} actor=${SUDO_USER:-${USER:-unknown}} backup=${BACKUP_FILE}"
} >> "${ROTATION_LOG}"
chmod 0600 "${ROTATION_LOG}" 2>/dev/null || true

log "Rotation complete: ${SECRET_NAME}"
log "  backup:     ${BACKUP_FILE}"
log "  rotation log: ${ROTATION_LOG}"
log ""
log "Verify after-action checks (see runbook):"
log "  - watch backend logs for auth errors:  docker compose -f ${COMPOSE_FILE} logs --tail=200 backend"
log "  - re-issue any signed artifacts that depended on the old secret"
