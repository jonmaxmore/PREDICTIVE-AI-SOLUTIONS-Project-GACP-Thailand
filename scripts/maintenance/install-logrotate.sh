#!/bin/bash
# ═══════════════════════════════════════════════════════════
# GACP Platform — install logrotate config
# ═══════════════════════════════════════════════════════════
#
# Idempotent installer for /etc/logrotate.d/gacp-platform. Re-run safely
# any time the source config changes — it just overwrites the destination.
#
# Behaviour:
#   - Verifies it is running as root (writes /etc/logrotate.d/).
#   - Copies deploy/logrotate/gacp-platform.conf → /etc/logrotate.d/gacp-platform
#     at mode 0644 (logrotate ignores world-writable configs).
#   - Validates with `logrotate -d` (debug / dry-run).
#
# Usage (on the production droplet):
#   sudo /opt/gacp-platform/scripts/maintenance/install-logrotate.sh
#
# Note about the host nginx:
#   The TLS-terminating host nginx writes to /var/log/nginx/. Most distro
#   packages ship their own /etc/logrotate.d/nginx that handles those —
#   do NOT duplicate it here. If the host nginx ever stops being managed
#   by the OS package, add an explicit block to deploy/logrotate/gacp-platform.conf.

set -euo pipefail

# ── Constants ──
SOURCE="${SOURCE:-/opt/gacp-platform/deploy/logrotate/gacp-platform.conf}"
TARGET="/etc/logrotate.d/gacp-platform"

# ── Colors ──
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[install-logrotate]${NC} $1"; }
warn() { echo -e "${YELLOW}[install-logrotate]${NC} $1"; }
err()  { echo -e "${RED}[install-logrotate]${NC} $1" >&2; }

# ── Pre-flight ──
if [[ "${EUID}" -ne 0 ]]; then
    err "Must run as root (writes ${TARGET}). Try: sudo $0"
    exit 1
fi

if [[ ! -f "${SOURCE}" ]]; then
    err "Source config not found: ${SOURCE}"
    err "  Is the deploy at /opt/gacp-platform? If not, set SOURCE=<path> and re-run."
    exit 1
fi

if ! command -v logrotate >/dev/null 2>&1; then
    err "logrotate is not installed. Install it first:  apt-get install -y logrotate"
    exit 1
fi

# ── Install ──
log "Installing ${SOURCE} → ${TARGET}…"
cp "${SOURCE}" "${TARGET}"
chmod 0644 "${TARGET}"
chown root:root "${TARGET}"
log "Installed ${TARGET} (mode 0644, root:root)"

# ── Validate ──
# logrotate -d is the debug/dry-run mode: it parses the config and reports
# what it would do, without rotating anything. A non-zero exit means
# the config is broken; we surface that clearly.
log "Running logrotate -d (dry-run validation)…"
if ! logrotate -d "${TARGET}"; then
    err "logrotate -d failed for ${TARGET}"
    err "  The config is installed at ${TARGET} but is rejecting validation."
    err "  Fix and re-run; until then, /etc/cron.daily/logrotate may skip it."
    exit 1
fi

log "Validated. logrotate will pick this up on the next /etc/cron.daily/logrotate run."
log ""
log "Container nginx logs:    /opt/gacp-platform/logs/nginx/*.log     (daily, 14 rotations)"
log "Operational logs:        /var/log/gacp-deploys/*.log              (weekly, 12 rotations)"
log "                         /var/log/gacp-backup.log"
log "                         /var/log/gacp-secret-rotations.log"
