#!/bin/bash

# Database Backup Script
# Usage: ./scripts/backup-database.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Load environment variables from .env file
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
elif [ -f .env.production ]; then
    export $(cat .env.production | grep -v '^#' | xargs)
fi

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/postgres_backup_${TIMESTAMP}.sql.gz"

echo -e "${GREEN}Starting database backup...${NC}"

# Create backup directory if it doesn't exist
mkdir -p "${BACKUP_DIR}"

# Run backup using docker-compose
docker-compose -f docker-compose.prod.yml exec -T postgres \
    pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" | gzip > "${BACKUP_FILE}"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}Backup completed successfully: ${BACKUP_FILE}${NC}"
    
    # Get file size
    SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
    echo -e "${GREEN}Backup size: ${SIZE}${NC}"
else
    echo -e "${RED}Backup failed!${NC}"
    exit 1
fi

# Remove old backups
echo -e "${YELLOW}Removing backups older than ${RETENTION_DAYS} days...${NC}"
find "${BACKUP_DIR}" -name "postgres_backup_*.sql.gz" -mtime +${RETENTION_DAYS} -delete

# List recent backups
echo -e "${GREEN}Recent backups:${NC}"
ls -lh "${BACKUP_DIR}" | tail -5

echo -e "${GREEN}Backup process completed!${NC}"
