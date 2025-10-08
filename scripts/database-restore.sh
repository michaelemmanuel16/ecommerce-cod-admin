#!/bin/bash

# Database Restore Script for E-commerce COD Admin
# This script restores a PostgreSQL database from backup

set -e

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups}"

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

# Check if backup file is provided
if [ -z "$1" ]; then
    echo -e "${RED}Error: No backup file specified${NC}"
    echo "Usage: $0 <backup_file>"
    echo ""
    echo "Available backups:"
    ls -lh "$BACKUP_DIR" | grep "ecommerce_cod_backup"
    exit 1
fi

BACKUP_FILE="$1"

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ] && [ ! -f "${BACKUP_DIR}/${BACKUP_FILE}" ]; then
    echo -e "${RED}Error: Backup file not found${NC}"
    exit 1
fi

# Determine full path to backup file
if [ -f "$BACKUP_FILE" ]; then
    FULL_BACKUP_PATH="$BACKUP_FILE"
else
    FULL_BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILE}"
fi

# Warning message
echo -e "${YELLOW}WARNING: This will replace all data in the database!${NC}"
echo -e "Database: ${DB_NAME}"
echo -e "Backup file: ${FULL_BACKUP_PATH}"
echo ""
read -p "Are you sure you want to continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo -e "${RED}Restore cancelled${NC}"
    exit 0
fi

# Export password for psql/pg_restore
export PGPASSWORD="$DB_PASSWORD"

echo -e "${GREEN}Starting database restore...${NC}"

# Drop existing connections to the database
echo -e "${YELLOW}Dropping existing connections...${NC}"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();"

# Drop and recreate database
echo -e "${YELLOW}Recreating database...${NC}"
dropdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" --if-exists "$DB_NAME"
createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME"

# Restore from backup
echo -e "${YELLOW}Restoring data...${NC}"

# Check if backup is compressed custom format or plain SQL
if [[ "$FULL_BACKUP_PATH" == *.dump ]]; then
    # Custom format backup
    pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        --verbose \
        --no-owner \
        --no-acl \
        "$FULL_BACKUP_PATH"
elif [[ "$FULL_BACKUP_PATH" == *.sql.gz ]]; then
    # Compressed SQL backup
    gunzip -c "$FULL_BACKUP_PATH" | psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME"
elif [[ "$FULL_BACKUP_PATH" == *.sql ]]; then
    # Plain SQL backup
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" < "$FULL_BACKUP_PATH"
else
    echo -e "${RED}Error: Unknown backup format${NC}"
    unset PGPASSWORD
    exit 1
fi

# Verify restore
echo -e "${YELLOW}Verifying restore...${NC}"
TABLE_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';")

if [ "$TABLE_COUNT" -gt 0 ]; then
    echo -e "${GREEN}Restore completed successfully!${NC}"
    echo -e "Tables restored: ${TABLE_COUNT}"
else
    echo -e "${RED}Restore may have failed - no tables found${NC}"
    unset PGPASSWORD
    exit 1
fi

# Unset password
unset PGPASSWORD

echo -e "${GREEN}Database restore process completed!${NC}"
