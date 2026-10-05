#!/bin/bash
# ═══════════════════════════════════════════════════════════
# GACP Platform — Automated PostgreSQL Backup Script
# ═══════════════════════════════════════════════════════════
#
# Retention policy:
#   - Daily backups: kept for 7 days
#   - Weekly backups (Sunday): kept for 4 weeks
#   - Monthly backups (1st of month): kept for 6 months
#
# Usage:
#   ./pg-backup.sh                    # Run backup
#   ./pg-backup.sh --restore <file>   # Restore from backup
#
# Cron installation:
#   Use scripts/backup/install-cron.sh (preferred — installs /etc/cron.d/gacp-backup).
#   Manual reference: scripts/backup/cron.gacp-backup.template
#
# Path/DB defaults (must match the rest of the platform):
#   - BACKUP_DIR: /var/backups/gacp/scheduled
#       Same canonical root as deploy-production.sh's pre-deploy backups
#       (/var/backups/gacp), with a `scheduled` subdir to keep cron output
#       separate from manual pre-deploy snapshots.
#   - Target database: whatever DATABASE_URL points at (Supabase since
#       2026-08-23). Taken from the environment, or from ENV_FILE
#       (/opt/gacp-platform/.env.production) when the environment does not set it.
#       There is no in-stack postgres to fall back to.

set -euo pipefail

# ── Configuration ──
BACKUP_DIR="${BACKUP_DIR:-/var/backups/gacp/scheduled}"

# The database is Supabase (operator ruling 2026-08-23) — there is no postgres
# container on this host to exec into, so dump over the wire. pg_dump comes from a
# throwaway client image; it must match the SERVER major version (Supabase is on
# 17, and a 15 client refuses with "server version mismatch"), so bump
# PG_CLIENT_IMAGE when Supabase upgrades.
PG_CLIENT_IMAGE="${PG_CLIENT_IMAGE:-postgres:17-alpine}"
ENV_FILE="${ENV_FILE:-/opt/gacp-platform/.env.production}"

# DATABASE_URL may come from the environment or from the deploy env file. It is
# never echoed and never passed as an argument — only through the child's env.
if [[ -z "${DATABASE_URL:-}" && -r "${ENV_FILE}" ]]; then
    DATABASE_URL="$(grep -E '^DATABASE_URL=' "${ENV_FILE}" | head -1 | cut -d= -f2-)"
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "Error: DATABASE_URL is not set and ${ENV_FILE} does not supply one." >&2
    echo "       Backups cannot run without it — fix this now, do not ignore it." >&2
    exit 1
fi

# pg_dump/psql against DATABASE_URL, run in the client image.
pg_client() { PGURL="${DATABASE_URL}" docker run --rm -i -e PGURL "${PG_CLIENT_IMAGE}" "$@"; }

# What the logs are allowed to say about the target: host and database, never the
# credentials. An operator reading a backup log has to be able to tell WHICH
# database was dumped — "gacp_db" was the old container's name and would now be a
# lie on every line.
DB_TARGET_LABEL="$(printf '%s' "${DATABASE_URL}" | sed -E 's#^(postgres(ql)?://)[^@]*@#\1#; s#\?.*$##')"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DAY_OF_WEEK=$(date +%u)   # 1=Monday, 7=Sunday
DAY_OF_MONTH=$(date +%d)

# ── Directories ──
DAILY_DIR="${BACKUP_DIR}/daily"
WEEKLY_DIR="${BACKUP_DIR}/weekly"
MONTHLY_DIR="${BACKUP_DIR}/monthly"

mkdir -p "${DAILY_DIR}" "${WEEKLY_DIR}" "${MONTHLY_DIR}"

# ── Colors ──
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1"; }

# ── Restore Mode ──
if [[ "${1:-}" == "--restore" ]]; then
    RESTORE_FILE="${2:-}"
    if [[ -z "${RESTORE_FILE}" || ! -f "${RESTORE_FILE}" ]]; then
        echo -e "${RED}Error: Provide a valid backup file path${NC}"
        echo "Usage: $0 --restore <backup-file.sql.gz>"
        exit 1
    fi
    
    # ── Guard: make the operator name the database this will actually hit ──
    # History (reports/risk-assessment/2026-08-13.md §4 R2): two runbooks sent
    # operators to this command for two different databases while DB_NAME defaulted
    # to gacp_db, so the wrong target did not fail — it SUCCEEDED, dropping and
    # replacing objects in the wrong database inside one transaction.
    #
    # Since the cutover to Supabase the target is no longer selectable: it is
    # whatever DATABASE_URL points at. A DB_NAME the operator types cannot redirect
    # this restore, so asking for DB_NAME would be worse than no guard at all —
    # someone typing DB_NAME=gacp_staging would still overwrite production and
    # believe they had not. The confirmation is therefore bound to the real target:
    # retype the database name from DATABASE_URL itself.
    TARGET_DB="${DB_TARGET_LABEL##*/}"
    if [[ "${RESTORE_TARGET:-}" != "${TARGET_DB}" ]]; then
        echo -e "${RED}Error: --restore needs you to confirm the database it will overwrite.${NC}"
        echo ""
        echo "  This restore will DROP AND REPLACE objects in:"
        echo "      ${DB_TARGET_LABEL}"
        echo "  There is no other target — DATABASE_URL decides, nothing else."
        echo ""
        echo "  Confirm by naming that database:"
        echo "      sudo env RESTORE_TARGET=${TARGET_DB} bash $0 --restore ${RESTORE_FILE}"
        echo ""
        echo "  To restore somewhere else, point DATABASE_URL there first."
        echo ""
        echo "  This path reads gzipped PLAIN SQL (*.sql.gz) only. Files ending"
        echo "  .dump are pg_dump -Fc and need pg_restore instead — see"
        echo "  docs/operations/runbooks/backup-and-restore.md."
        exit 1
    fi

    log "${YELLOW}⚠️  Restoring from: ${RESTORE_FILE}${NC}"
    log "This will REPLACE all data in ${DB_TARGET_LABEL}. Press Ctrl+C within 5 seconds to abort."
    sleep 5
    
    log "Restoring..."
    # ON_ERROR_STOP is not optional here. With --single-transaction alone, psql
    # aborts the transaction on the first SQL error, silently skips every
    # following statement, rolls back at the end — and still exits 0. A restore
    # that applied nothing would report success, which is the same failure class
    # the guard above exists to close.
    gunzip -c "${RESTORE_FILE}" | pg_client sh -c 'psql "$PGURL" -v ON_ERROR_STOP=1 --single-transaction'
    
    log "${GREEN}✅ Restore complete from: ${RESTORE_FILE}${NC}"
    exit 0
fi

# ── Backup ──
BACKUP_FILE="${DAILY_DIR}/gacp_${TIMESTAMP}.sql.gz"

log "🔄 Starting backup of ${DB_TARGET_LABEL}..."

# pg_dump with custom format for best compression + selective restore
pg_client sh -c 'pg_dump "$PGURL" --no-owner --no-privileges --clean --if-exists' \
    | gzip > "${BACKUP_FILE}"

# A backup nobody checks is not a backup. pipefail already fails the run when
# pg_dump errors; this catches the quieter case — a file that exists but holds
# nothing, which is what an empty or wrong-database dump looks like on disk.
if [[ ! -s "${BACKUP_FILE}" ]] || [[ "$(stat -c %s "${BACKUP_FILE}")" -lt 1024 ]]; then
    log "${RED}❌ Backup file is empty or implausibly small — treating as FAILED${NC}"
    rm -f "${BACKUP_FILE}"
    exit 1
fi

BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
log "${GREEN}✅ Daily backup complete: ${BACKUP_FILE} (${BACKUP_SIZE})${NC}"

# ── Weekly Backup (Sunday) ──
if [[ "${DAY_OF_WEEK}" == "7" ]]; then
    WEEKLY_FILE="${WEEKLY_DIR}/gacp_weekly_${TIMESTAMP}.sql.gz"
    cp "${BACKUP_FILE}" "${WEEKLY_FILE}"
    log "${GREEN}📅 Weekly backup saved: ${WEEKLY_FILE}${NC}"
fi

# ── Monthly Backup (1st of month) ──
if [[ "${DAY_OF_MONTH}" == "01" ]]; then
    MONTHLY_FILE="${MONTHLY_DIR}/gacp_monthly_${TIMESTAMP}.sql.gz"
    cp "${BACKUP_FILE}" "${MONTHLY_FILE}"
    log "${GREEN}📆 Monthly backup saved: ${MONTHLY_FILE}${NC}"
fi

# ── Cleanup: Retention Policy ──
log "🧹 Applying retention policy..."

# Daily: keep last 7 days
find "${DAILY_DIR}" -name "gacp_*.sql.gz" -mtime +7 -delete 2>/dev/null && \
    log "  Daily: removed backups older than 7 days" || true

# Weekly: keep last 4 weeks  
find "${WEEKLY_DIR}" -name "gacp_weekly_*.sql.gz" -mtime +28 -delete 2>/dev/null && \
    log "  Weekly: removed backups older than 28 days" || true

# Monthly: keep last 6 months
find "${MONTHLY_DIR}" -name "gacp_monthly_*.sql.gz" -mtime +180 -delete 2>/dev/null && \
    log "  Monthly: removed backups older than 180 days" || true

# ── Summary ──
TOTAL_DAILY=$(find "${DAILY_DIR}" -name "*.sql.gz" | wc -l)
TOTAL_WEEKLY=$(find "${WEEKLY_DIR}" -name "*.sql.gz" | wc -l)
TOTAL_MONTHLY=$(find "${MONTHLY_DIR}" -name "*.sql.gz" | wc -l)
TOTAL_SIZE=$(du -sh "${BACKUP_DIR}" | cut -f1)

log "📊 Backup inventory: ${TOTAL_DAILY} daily, ${TOTAL_WEEKLY} weekly, ${TOTAL_MONTHLY} monthly (Total: ${TOTAL_SIZE})"
log "${GREEN}✅ Backup process complete${NC}"
