#!/bin/bash

# Database Backup Script
# Usage: ./scripts/backup-database.sh

set -e
set -o pipefail  # so a pg_dump failure in the dump | gzip pipe aborts the script

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

# Resolve the production postgres container by its pinned container_name.
# Do NOT use `docker-compose exec postgres` here: on this host it resolves to the
# wrong container (ecommerce-cod-postgres-staging) or none, producing an empty
# dump. The prod compose file pins `container_name: ecommerce-cod-postgres`, so
# match it exactly — an unanchored name filter would also catch the -staging
# container, so the regex is anchored.
PG_CONTAINER=$(docker ps --filter "name=^ecommerce-cod-postgres$" --format '{{.ID}}' | head -1)
if [ -z "${PG_CONTAINER}" ]; then
    echo -e "${RED}Backup failed: container 'ecommerce-cod-postgres' not found or not running.${NC}"
    exit 1
fi

# Run backup (pipefail above ensures a pg_dump failure aborts before the verify step)
docker exec "${PG_CONTAINER}" pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" | gzip > "${BACKUP_FILE}"

# Verify the backup is real — an empty pg_dump still produces a ~20-byte gzip,
# which previously slipped through as "success". Fail loudly if it is too small.
MIN_BYTES=1000
DECOMPRESSED_BYTES=$(gzip -dc "${BACKUP_FILE}" 2>/dev/null | wc -c | tr -d ' ')
if [ "${DECOMPRESSED_BYTES:-0}" -lt "${MIN_BYTES}" ]; then
    echo -e "${RED}Backup failed: dump is empty or too small (${DECOMPRESSED_BYTES} bytes uncompressed).${NC}"
    rm -f "${BACKUP_FILE}"
    exit 1
fi

echo -e "${GREEN}Backup completed successfully: ${BACKUP_FILE}${NC}"
SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo -e "${GREEN}Backup size: ${SIZE} (${DECOMPRESSED_BYTES} bytes uncompressed)${NC}"

# Remove old backups
echo -e "${YELLOW}Removing backups older than ${RETENTION_DAYS} days...${NC}"
find "${BACKUP_DIR}" -name "postgres_backup_*.sql.gz" -mtime +${RETENTION_DAYS} -delete

# List recent backups
echo -e "${GREEN}Recent backups:${NC}"
ls -lh "${BACKUP_DIR}" | tail -5

echo -e "${GREEN}Backup process completed!${NC}"
