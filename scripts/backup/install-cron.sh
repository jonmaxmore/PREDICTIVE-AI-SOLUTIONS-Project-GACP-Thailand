#!/bin/bash
# ═══════════════════════════════════════════════════════════
# GACP Platform — install /etc/cron.d/gacp-backup
# ═══════════════════════════════════════════════════════════
#
# Idempotent installer for the daily Postgres-backup cron entry.
# Re-run safely to update the schedule or after editing the template.
#
# Behaviour:
#   - Verifies it is running as root (cron.d edits require it).
#   - Verifies the backup script exists and is executable.
#   - Writes /etc/cron.d/gacp-backup (mode 0644 — cron requires that).
#   - Reloads the cron service so changes take effect immediately.
#
# Usage (on the production droplet):
#   sudo /opt/gacp-platform/scripts/backup/install-cron.sh
#
# After install, watch the next run land in /var/log/gacp-backup.log.

set -euo pipefail

CRON_FILE="/etc/cron.d/gacp-backup"
BACKUP_SCRIPT="/opt/gacp-platform/scripts/backup/pg-backup.sh"
LOG_FILE="/var/log/gacp-backup.log"

# ── Colors ──
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[install-cron]${NC} $1"; }
warn() { echo -e "${YELLOW}[install-cron]${NC} $1"; }
err()  { echo -e "${RED}[install-cron]${NC} $1" >&2; }

# ── Pre-flight ──
if [[ "${EUID}" -ne 0 ]]; then
    err "Must run as root (writes /etc/cron.d/gacp-backup). Try: sudo $0"
    exit 1
fi

if [[ ! -f "${BACKUP_SCRIPT}" ]]; then
    err "Backup script not found: ${BACKUP_SCRIPT}"
    err "  Is the deploy directory at /opt/gacp-platform? If not, edit BACKUP_SCRIPT in this installer."
    exit 1
fi

if [[ ! -x "${BACKUP_SCRIPT}" ]]; then
    warn "Backup script is not executable — fixing now: chmod +x ${BACKUP_SCRIPT}"
    chmod +x "${BACKUP_SCRIPT}"
fi

# ── Ensure log file exists with sensible perms ──
if [[ ! -f "${LOG_FILE}" ]]; then
    touch "${LOG_FILE}"
    chmod 0644 "${LOG_FILE}"
    log "Created log file: ${LOG_FILE}"
fi

# ── Write cron file ──
# Schedule: 02:17 daily. Minute 17 (off-hour) avoids the Internet-wide
# top-of-hour load spike that hits every cron service simultaneously.
log "Writing ${CRON_FILE}…"
cat > "${CRON_FILE}" <<'CRON_EOF'
# GACP Platform — daily Postgres backup
# Owned by scripts/backup/install-cron.sh (re-run to update)
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
17 2 * * * root /opt/gacp-platform/scripts/backup/pg-backup.sh >> /var/log/gacp-backup.log 2>&1
CRON_EOF

# cron.d files MUST be mode 0644 and owned by root, otherwise cron silently
# ignores them (a classic gotcha).
chmod 0644 "${CRON_FILE}"
chown root:root "${CRON_FILE}"
log "Installed: ${CRON_FILE} (mode 0644, root:root)"

# ── Reload cron ──
# Different distros use different service names. Try the common ones; if
# none are managed by systemd, fall back to the SysV init script.
if command -v systemctl >/dev/null 2>&1; then
    if systemctl list-unit-files | grep -qE '^cron\.service'; then
        systemctl reload cron 2>/dev/null || systemctl restart cron
        log "Reloaded cron.service"
    elif systemctl list-unit-files | grep -qE '^crond\.service'; then
        systemctl reload crond 2>/dev/null || systemctl restart crond
        log "Reloaded crond.service"
    else
        warn "No cron systemd unit found; cron.d files are usually picked up automatically."
    fi
elif [[ -x /etc/init.d/cron ]]; then
    /etc/init.d/cron reload || /etc/init.d/cron restart
    log "Reloaded /etc/init.d/cron"
else
    warn "Could not detect a cron service to reload — cron.d files are usually picked up on the next minute boundary anyway."
fi

# ── Verify ──
log "Active GACP cron entry:"
grep -v '^#\|^$' "${CRON_FILE}" || true

log "Done. First scheduled run will be at the next 02:17 local time."
log "Watch with:  tail -f ${LOG_FILE}"
