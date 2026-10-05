#!/bin/bash
# ============================================================
# GACP Platform — Automated Database Backup
# ============================================================
# Dumps PostgreSQL database from the Docker container,
# compresses it, and keeps the last 7 daily backups.
#
# Usage:
#   ./scripts/backup-database.sh
#
# Install as daily cron:
#   crontab -e
#   0 3 * * * /opt/gacp-platform/scripts/backup-database.sh >> /var/log/gacp-backup.log 2>&1
# ============================================================

set -euo pipefail

# ── CONFIG ──────────────────────────────────────────
BACKUP_DIR="/opt/gacp-backups"
CONTAINER_NAME="gacp-postgres"
DB_NAME="${DB_NAME:-gacp_db}"
DB_USER="${DB_USER:-gacp}"
RETENTION_DAYS=7
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_FILE="${BACKUP_DIR}/gacp_db_${TIMESTAMP}.sql.gz"

# ── SETUP ───────────────────────────────────────────
mkdir -p "${BACKUP_DIR}"

echo "────────────────────────────────────────"
echo "[$(date)] Starting backup: ${DB_NAME}"

# ── HEALTH CHECK ────────────────────────────────────
if ! docker exec "${CONTAINER_NAME}" pg_isready -U "${DB_USER}" -d "${DB_NAME}" > /dev/null 2>&1; then
    echo "[ERROR] PostgreSQL is not ready. Aborting."
    exit 1
fi

# ── DUMP ────────────────────────────────────────────
echo "[$(date)] Dumping to ${BACKUP_FILE}..."
docker exec "${CONTAINER_NAME}" pg_dump \
    -U "${DB_USER}" \
    -d "${DB_NAME}" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    --format=plain \
    | gzip > "${BACKUP_FILE}"

# ── VERIFY ──────────────────────────────────────────
FILESIZE=$(stat -c%s "${BACKUP_FILE}" 2>/dev/null || stat -f%z "${BACKUP_FILE}" 2>/dev/null || echo "0")
if [ "${FILESIZE}" -lt 1024 ]; then
    echo "[ERROR] Backup file is suspiciously small (${FILESIZE} bytes). Check for errors."
    exit 1
fi
echo "[$(date)] Backup complete: ${BACKUP_FILE} ($(numfmt --to=iec ${FILESIZE}))"

# ── RETENTION ───────────────────────────────────────
echo "[$(date)] Removing backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "gacp_db_*.sql.gz" -mtime +${RETENTION_DAYS} -delete
REMAINING=$(find "${BACKUP_DIR}" -name "gacp_db_*.sql.gz" | wc -l)
echo "[$(date)] ${REMAINING} backup(s) on disk."

echo "[$(date)] ✅ Backup finished successfully."
echo "────────────────────────────────────────"
