#!/bin/bash

# Staging Deployment Script
# Deploys the application to staging environment

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   E-Commerce COD Admin - Staging Deployment                  ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Load environment variables from .env.staging (preferred) or .env (fallback)
if [ -f .env.staging ]; then
    echo -e "${GREEN}Loading .env.staging${NC}"
    set -a
    source <(grep -v '^#' .env.staging | sed -e 's/ = /=/g' -e 's/=[[:space:]]*/=/g' -e 's/[[:space:]]*=/=/g')
    set +a
elif [ -f .env ]; then
    echo -e "${YELLOW}No .env.staging found, falling back to .env${NC}"
    set -a
    source <(grep -v '^#' .env | sed -e 's/ = /=/g' -e 's/=[[:space:]]*/=/g' -e 's/[[:space:]]*=/=/g')
    set +a
else
    echo -e "${YELLOW}No .env file found, using docker-compose defaults${NC}"
fi

echo -e "${GREEN}Starting staging deployment...${NC}"

# Step 1: Backup database (if running)
echo -e "${BLUE}[1/6] Creating database backup...${NC}"
mkdir -p ./backups
if docker ps | grep -q "ecommerce-cod-postgres-staging"; then
    BACKUP_FILE="./backups/staging-backup-$(date +%Y%m%d-%H%M%S).sql"
    echo -e "${YELLOW}Backing up to ${BACKUP_FILE}...${NC}"
    if docker exec ecommerce-cod-postgres-staging pg_dump -U ${POSTGRES_USER:-ecommerce_user} ${POSTGRES_DB:-ecommerce_cod_staging} > "${BACKUP_FILE}" 2>/dev/null; then
        BACKUP_SIZE=$(wc -c < "${BACKUP_FILE}" 2>/dev/null || echo "0")
        if [ "$BACKUP_SIZE" -gt 1000 ]; then
            echo -e "${GREEN}✓ Database backup completed (${BACKUP_SIZE} bytes)${NC}"
        else
            echo -e "${RED}✗ Backup file is suspiciously small (${BACKUP_SIZE} bytes) - database may be empty${NC}"
        fi
    else
        echo -e "${RED}✗ Database backup FAILED${NC}"
        echo -e "${YELLOW}Continuing with deployment - check backup manually${NC}"
    fi
else
    echo -e "${YELLOW}No existing database found, skipping backup${NC}"
fi

# Step 2: Pull latest images from develop branch
echo -e "${BLUE}[2/6] Pulling latest Docker images (develop branch)...${NC}"
docker pull ghcr.io/michaelemmanuel16/ecommerce-cod-admin/backend:develop || echo -e "${YELLOW}Warning: Failed to pull backend image, will use existing${NC}"
docker pull ghcr.io/michaelemmanuel16/ecommerce-cod-admin/frontend:develop || echo -e "${YELLOW}Warning: Failed to pull frontend image, will use existing${NC}"

# Step 3: Ensure infrastructure is running, then rolling-update app containers
echo -e "${BLUE}[3/6] Updating staging containers (rolling update)...${NC}"

# Check if postgres/redis are already running
POSTGRES_EXISTS=$(docker ps --filter "name=ecommerce-cod-postgres-staging" --format "{{.Names}}" 2>/dev/null || true)

if [ -z "$POSTGRES_EXISTS" ]; then
    # Fresh deployment - start full stack
    echo -e "${YELLOW}Fresh deployment detected - starting full stack...${NC}"
    docker-compose -p staging -f docker-compose.staging.yml up -d || {
        echo -e "${RED}Failed to start containers${NC}"
        docker logs ecommerce-cod-postgres-staging 2>&1 || true
        exit 1
    }
else
    # Rolling update - only update app containers, leave postgres/redis untouched
    echo -e "${YELLOW}Existing deployment detected - performing rolling update...${NC}"

    # Remove old app containers to prevent name conflicts
    docker rm -f ecommerce-cod-backend-staging ecommerce-cod-frontend-staging 2>/dev/null || true

    # Start app containers without touching infrastructure
    docker-compose -p staging -f docker-compose.staging.yml up -d --no-deps backend frontend || {
        echo -e "${RED}Failed to update app containers${NC}"
        exit 1
    }
fi

echo -e "${GREEN}✓ Containers updated${NC}"

# Step 4: Wait for backend to be healthy
echo -e "${BLUE}[4/6] Waiting for backend to be healthy...${NC}"
for i in $(seq 1 12); do
    HEALTH=$(docker inspect --format='{{.State.Health.Status}}' ecommerce-cod-backend-staging 2>/dev/null || echo "unknown")
    if [ "$HEALTH" = "healthy" ]; then
        echo -e "${GREEN}✓ Backend is healthy${NC}"
        break
    fi
    echo -e "${YELLOW}Attempt $i/12: Backend status is '$HEALTH', waiting 10s...${NC}"
    sleep 10
done

# Step 5: Run database migrations
echo -e "${BLUE}[5/6] Running database migrations...${NC}"
docker-compose -p staging -f docker-compose.staging.yml exec -T backend npx prisma migrate deploy || echo -e "${YELLOW}Warning: Migrations may have failed or already applied${NC}"

# Step 6: Health checks
echo -e "${BLUE}[6/6] Final health checks...${NC}"

# Check backend health
MAX_RETRIES=5
RETRY_COUNT=0
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -f http://localhost:3001/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Backend (staging) is healthy${NC}"
        break
    else
        RETRY_COUNT=$((RETRY_COUNT + 1))
        if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
            echo -e "${YELLOW}⚠ Backend health check failed (attempt $RETRY_COUNT/$MAX_RETRIES), retrying in 10 seconds...${NC}"
            sleep 10
        else
            echo -e "${RED}✗ Backend (staging) health check failed after $MAX_RETRIES attempts${NC}"
            echo -e "${YELLOW}Checking backend container status...${NC}"
            docker-compose -p staging -f docker-compose.staging.yml ps backend
            echo -e "${YELLOW}Checking backend logs...${NC}"
            docker-compose -p staging -f docker-compose.staging.yml logs --tail=100 backend
            exit 1
        fi
    fi
done

# Check frontend health (direct)
if curl -f http://localhost:5174/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Frontend (staging) is healthy${NC}"
else
    echo -e "${YELLOW}⚠ Frontend health check failed (may need nginx configuration)${NC}"
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Staging Deployment Completed Successfully!                  ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Application Status:${NC}"
docker-compose -p staging -f docker-compose.staging.yml ps
echo ""
echo -e "${BLUE}Access staging at:${NC}"
echo "  https://staging.codadminpro.com (via nginx reverse proxy)"
echo "  http://localhost:3001 (backend direct)"
echo "  http://localhost:5174 (frontend direct)"
echo ""
echo -e "${BLUE}View logs:${NC}"
echo "  docker-compose -p staging -f docker-compose.staging.yml logs -f"
echo ""
echo -e "${BLUE}Stop staging:${NC}"
echo "  docker-compose -p staging -f docker-compose.staging.yml down"
echo ""
