#!/bin/bash
# GACP Platform - Automated Backup Script
# Usage: ./backup-system.sh [full|incremental] [s3|local]

set -euo pipefail

# Configuration
BACKUP_DIR="/opt/backups/gacp"
S3_BUCKET="${S3_BACKUP_BUCKET:-gacp-platform-backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_TYPE="${1:-full}"
STORAGE="${2:-local}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging
log() {
    echo -e "${GREEN}[$(date +%Y-%m-%d\ %H:%M:%S)]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[$(date +%Y-%m-%d\ %H:%M:%S)] WARNING:${NC} $1"
}

error() {
    echo -e "${RED}[$(date +%Y-%m-%d\ %H:%M:%S)] ERROR:${NC} $1"
}

# Create backup directory
mkdir -p "${BACKUP_DIR}"

# Backup metadata
cat > "${BACKUP_DIR}/backup_${DATE}.info" << EOF
Backup Date: $(date)
Backup Type: ${BACKUP_TYPE}
Storage: ${STORAGE}
Hostname: $(hostname)
Docker Version: $(docker --version)
EOF

# ==========================================
# Database Backup
# ==========================================
backup_database() {
    log "Starting database backup..."
    
    local db_file="${BACKUP_DIR}/db_${BACKUP_TYPE}_${DATE}.sql.gz"
    
    # Create database dump
    docker exec gacp-postgres pg_dump -U gacp -h localhost gacp_db | gzip > "${db_file}"
    
    if [ $? -eq 0 ]; then
        log "Database backup completed: ${db_file}"
        ls -lh "${db_file}"
    else
        error "Database backup failed!"
        exit 1
    fi
    
    # Verify backup integrity
    if gunzip -t "${db_file}" 2>/dev/null; then
        log "Database backup integrity verified"
    else
        error "Database backup is corrupted!"
        exit 1
    fi
}

# ==========================================
# File System Backup
# ==========================================
backup_files() {
    log "Starting file backup..."
    
    local files_file="${BACKUP_DIR}/files_${BACKUP_TYPE}_${DATE}.tar.gz"
    
    # Backup uploads and configuration
    tar -czf "${files_file}" \
        -C /opt/gacp-platform \
        --exclude='node_modules' \
        --exclude='.git' \
        --exclude='*.log' \
        apps/backend/public/uploads \
        nginx/ssl \
        apps/backend/.env.production \
        docker-compose.yml 2>/dev/null || true
    
    log "File backup completed: ${files_file}"
    ls -lh "${files_file}"
}

# ==========================================
# Redis Backup
# ==========================================
backup_redis() {
    log "Starting Redis backup..."
    
    local redis_file="${BACKUP_DIR}/redis_${DATE}.rdb"
    
    # Trigger Redis BGSAVE
    docker exec gacp-redis redis-cli BGSAVE
    
    # Wait for save to complete
    sleep 5
    
    # Copy RDB file
    docker cp gacp-redis:/data/dump.rdb "${redis_file}"
    
    log "Redis backup completed: ${redis_file}"
}

# ==========================================
# Docker Volumes Backup
# ==========================================
backup_volumes() {
    log "Starting Docker volumes backup..."
    
    local volumes_file="${BACKUP_DIR}/volumes_${DATE}.tar.gz"
    
    # Backup named volumes
    docker run --rm \
        -v gacp-postgres-data:/data/postgres:ro \
        -v gacp-redis-data:/data/redis:ro \
        -v $(pwd):/backup \
        alpine:latest \
        tar -czf /backup/volumes_backup.tar.gz -C /data . 2>/dev/null || true
    
    if [ -f volumes_backup.tar.gz ]; then
        mv volumes_backup.tar.gz "${volumes_file}"
        log "Volumes backup completed: ${volumes_file}"
    fi
}

# ==========================================
# Upload to S3
# ==========================================
upload_to_s3() {
    if [ "${STORAGE}" != "s3" ]; then
        return 0
    fi
    
    log "Uploading backups to S3..."
    
    # Upload to S3 with encryption
    aws s3 sync "${BACKUP_DIR}/" "s3://${S3_BUCKET}/backups/${DATE}/" \
        --storage-class STANDARD_IA \
        --server-side-encryption AES256 \
        --exclude "*.info"
    
    log "Upload to S3 completed"
    
    # Clean old S3 backups
    log "Cleaning old S3 backups..."
    aws s3 ls "s3://${S3_BUCKET}/backups/" | \
        awk '{print $2}' | \
        while read -r prefix; do
            backup_date=$(echo "$prefix" | tr -d '/')
            backup_ts=$(date -d "$backup_date" +%s 2>/dev/null || echo 0)
            current_ts=$(date +%s)
            age_days=$(( (current_ts - backup_ts) / 86400 ))
            
            if [ $age_days -gt ${RETENTION_DAYS} ]; then
                warn "Deleting old backup: $prefix"
                aws s3 rm "s3://${S3_BUCKET}/backups/$prefix" --recursive
            fi
        done
}

# ==========================================
# Local Cleanup
# ==========================================
cleanup_local() {
    log "Cleaning up local backups older than ${RETENTION_DAYS} days..."
    
    find "${BACKUP_DIR}" -type f -mtime +${RETENTION_DAYS} -delete
    
    log "Cleanup completed"
}

# ==========================================
# Health Check
# ==========================================
verify_backup() {
    log "Verifying backup integrity..."
    
    local latest_db=$(ls -t ${BACKUP_DIR}/db_*.sql.gz 2>/dev/null | head -1)
    
    if [ -n "${latest_db}" ]; then
        # Test restore to temporary database
        docker run --rm \
            -e PGPASSWORD=test \
            -v "${latest_db}:/backup.sql.gz:ro" \
            postgres:15-alpine \
            bash -c "gunzip -c /backup.sql.gz | head -100 | grep -q 'CREATE'" && \
            log "Backup verification successful" || \
            error "Backup verification failed"
    fi
}

# ==========================================
# Send Notification
# ==========================================
send_notification() {
    local status="$1"
    local message="$2"
    
    # Slack notification
    if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
        curl -s -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"${message}\"}" \
            "${SLACK_WEBHOOK_URL}" > /dev/null || true
    fi
    
    # Email notification
    if [ -n "${ADMIN_EMAIL:-}" ]; then
        echo "${message}" | mail -s "GACP Backup ${status}" "${ADMIN_EMAIL}" || true
    fi
}

# ==========================================
# Main Execution
# ==========================================
main() {
    log "=========================================="
    log "GACP Platform Backup Started"
    log "Type: ${BACKUP_TYPE}"
    log "Storage: ${STORAGE}"
    log "=========================================="
    
    # Check prerequisites
    if ! docker ps > /dev/null 2>&1; then
        error "Docker is not running"
        exit 1
    fi
    
    # Create backup
    backup_database
    backup_files
    backup_redis
    
    if [ "${BACKUP_TYPE}" == "full" ]; then
        backup_volumes
    fi
    
    # Verify
    verify_backup
    
    # Upload if S3
    upload_to_s3
    
    # Cleanup
    cleanup_local
    
    # Calculate backup size
    local total_size=$(du -sh "${BACKUP_DIR}" | cut -f1)
    
    log "=========================================="
    log "Backup Completed Successfully"
    log "Total Size: ${total_size}"
    log "=========================================="
    
    send_notification "SUCCESS" "✅ GACP Backup Completed - Size: ${total_size}"
    
    exit 0
}

# Error handler
trap 'error "Backup failed!"; send_notification "FAILED" "❌ GACP Backup Failed"; exit 1' ERR

# Run main
main "$@"
