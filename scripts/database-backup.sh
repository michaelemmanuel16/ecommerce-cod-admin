#!/bin/bash

# Database Backup Script for E-commerce COD Admin
# This script creates backups of the PostgreSQL database

set -e

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="ecommerce_cod_backup_${TIMESTAMP}.sql"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

# Database credentials
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${POSTGRES_DB:-ecommerce_cod}"
DB_USER="${POSTGRES_USER:-postgres}"
DB_PASSWORD="${POSTGRES_PASSWORD:-postgres}"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting database backup...${NC}"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Export password for pg_dump
export PGPASSWORD="$DB_PASSWORD"

# Create backup
echo -e "${YELLOW}Creating backup: ${BACKUP_FILE}${NC}"
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    --format=custom \
    --compress=9 \
    --file="${BACKUP_DIR}/${BACKUP_FILE}.dump"

# Create plain SQL backup as well
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    --format=plain \
    --file="${BACKUP_DIR}/${BACKUP_FILE}"

# Compress plain SQL backup
gzip -f "${BACKUP_DIR}/${BACKUP_FILE}"

# Verify backup
if [ -f "${BACKUP_DIR}/${BACKUP_FILE}.dump" ] && [ -f "${BACKUP_DIR}/${BACKUP_FILE}.gz" ]; then
    BACKUP_SIZE=$(du -h "${BACKUP_DIR}/${BACKUP_FILE}.dump" | cut -f1)
    echo -e "${GREEN}Backup created successfully!${NC}"
    echo -e "File: ${BACKUP_FILE}.dump"
    echo -e "Size: ${BACKUP_SIZE}"
else
    echo -e "${RED}Backup failed!${NC}"
    exit 1
fi

# Remove old backups
echo -e "${YELLOW}Cleaning up old backups (older than ${RETENTION_DAYS} days)...${NC}"
find "$BACKUP_DIR" -name "ecommerce_cod_backup_*.dump" -type f -mtime +$RETENTION_DAYS -delete
find "$BACKUP_DIR" -name "ecommerce_cod_backup_*.sql.gz" -type f -mtime +$RETENTION_DAYS -delete

# List recent backups
echo -e "${GREEN}Recent backups:${NC}"
ls -lh "$BACKUP_DIR" | tail -5

# Unset password
unset PGPASSWORD

echo -e "${GREEN}Backup process completed!${NC}"
