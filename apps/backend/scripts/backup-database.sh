#!/bin/bash
# PostgreSQL Backup Script for GACP Platform
# Usage: ./backup-database.sh

# Configuration
DB_NAME="${DB_NAME:-gacp_production}"
DB_USER="${DB_USER:-gacp_user}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
BACKUP_DIR="./backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/gacp_backup_${DATE}.sql.gz"

# Create backup directory if not exists
mkdir -p $BACKUP_DIR

# Check if pg_dump exists
if ! command -v pg_dump &> /dev/null; then
    echo "❌ pg_dump not found. Please install PostgreSQL client."
    exit 1
fi

echo "🔄 Starting backup of ${DB_NAME}..."

# Perform backup with compression
pg_dump -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME | gzip > $BACKUP_FILE

if [ $? -eq 0 ]; then
    echo "✅ Backup completed: $BACKUP_FILE"
    echo "📊 Size: $(du -h $BACKUP_FILE | cut -f1)"
    
    # Keep only last 7 backups
    ls -t ${BACKUP_DIR}/gacp_backup_*.sql.gz | tail -n +8 | xargs -r rm
    echo "🗑️  Old backups cleaned (keeping last 7)"
else
    echo "❌ Backup failed!"
    exit 1
fi
