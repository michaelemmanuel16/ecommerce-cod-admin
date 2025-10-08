#!/bin/bash

# Rollback Script
# Rolls back to a previous deployment

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

ENVIRONMENT="${1:-production}"
REVISION="${2:-0}"

echo -e "${RED}WARNING: You are about to rollback ${ENVIRONMENT}!${NC}"
read -p "Are you sure you want to continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo -e "${RED}Rollback cancelled${NC}"
    exit 0
fi

echo -e "${YELLOW}Starting rollback for ${ENVIRONMENT}...${NC}"

if command -v kubectl &> /dev/null; then
    # Kubernetes rollback
    NAMESPACE="ecommerce-cod"
    if [ "$ENVIRONMENT" == "staging" ]; then
        NAMESPACE="ecommerce-cod-staging"
    fi

    echo -e "${YELLOW}Rolling back Kubernetes deployment...${NC}"

    # Rollback backend
    if [ "$REVISION" -eq 0 ]; then
        kubectl rollout undo deployment/backend -n $NAMESPACE
    else
        kubectl rollout undo deployment/backend -n $NAMESPACE --to-revision=$REVISION
    fi

    # Rollback frontend
    if [ "$REVISION" -eq 0 ]; then
        kubectl rollout undo deployment/frontend -n $NAMESPACE
    else
        kubectl rollout undo deployment/frontend -n $NAMESPACE --to-revision=$REVISION
    fi

    # Wait for rollback
    kubectl rollout status deployment/backend -n $NAMESPACE
    kubectl rollout status deployment/frontend -n $NAMESPACE

    # Show rollout history
    echo -e "${GREEN}Rollback completed. Current revision:${NC}"
    kubectl rollout history deployment/backend -n $NAMESPACE
    kubectl rollout history deployment/frontend -n $NAMESPACE
else
    # Docker Compose rollback
    echo -e "${YELLOW}Rolling back Docker Compose deployment...${NC}"

    # Stop current containers
    docker-compose -f docker-compose.prod.yml down

    # Restore from backup (you need to specify which backup)
    echo -e "${YELLOW}Available database backups:${NC}"
    ls -lh ./backups/ | tail -10

    read -p "Enter backup filename to restore (or 'skip' to skip): " BACKUP_FILE

    if [ "$BACKUP_FILE" != "skip" ]; then
        ./scripts/database-restore.sh "$BACKUP_FILE"
    fi

    # Start previous version
    docker-compose -f docker-compose.prod.yml up -d
fi

# Health check
echo -e "${YELLOW}Running health checks...${NC}"
sleep 10
./scripts/health-check.sh $ENVIRONMENT

echo -e "${GREEN}Rollback completed successfully!${NC}"
