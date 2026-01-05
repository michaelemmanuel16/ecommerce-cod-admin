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

# Check if .env.staging exists
if [ ! -f .env.staging ]; then
    echo -e "${RED}Error: .env.staging file not found!${NC}"
    echo -e "${YELLOW}Please create .env.staging with proper configuration${NC}"
    exit 1
fi

# Load environment variables
export $(cat .env.staging | grep -v '^#' | xargs)

echo -e "${GREEN}Starting staging deployment...${NC}"

# Step 1: Backup database (if running)
echo -e "${BLUE}[1/6] Checking for existing database...${NC}"
if docker ps | grep -q "ecommerce-cod-postgres-staging"; then
    echo -e "${YELLOW}Creating database backup...${NC}"
    docker exec ecommerce-cod-postgres-staging pg_dump -U ${POSTGRES_USER:-ecommerce_user} ${POSTGRES_DB:-ecommerce_cod_staging} > ./backups/staging-backup-$(date +%Y%m%d-%H%M%S).sql || echo -e "${YELLOW}Warning: Backup skipped${NC}"
else
    echo -e "${YELLOW}No existing database found, skipping backup${NC}"
fi

# Step 2: Pull latest images from develop branch
echo -e "${BLUE}[2/6] Pulling latest Docker images (develop branch)...${NC}"
docker pull ghcr.io/michaelemmanuel16/ecommerce-cod-admin/backend:develop || echo -e "${YELLOW}Warning: Failed to pull backend image, will use existing${NC}"
docker pull ghcr.io/michaelemmanuel16/ecommerce-cod-admin/frontend:develop || echo -e "${YELLOW}Warning: Failed to pull frontend image, will use existing${NC}"

# Step 3: Stop and remove existing containers
echo -e "${BLUE}[3/6] Stopping existing staging containers...${NC}"
# Stop containers using docker-compose
docker-compose -f docker-compose.staging.yml --env-file .env.staging down --remove-orphans || true

# Remove any orphan containers with staging in the name
echo -e "${YELLOW}Removing any orphan staging containers...${NC}"
docker ps -aq --filter "name=staging" | xargs -r docker rm -f || true

# Step 4: Start new containers
echo -e "${BLUE}[4/6] Starting staging containers...${NC}"
docker-compose -f docker-compose.staging.yml --env-file .env.staging up -d

# Step 5: Run database migrations
echo -e "${BLUE}[5/6] Running database migrations...${NC}"
sleep 10  # Wait for containers to be ready
docker-compose -f docker-compose.staging.yml --env-file .env.staging exec -T backend npx prisma migrate deploy || echo -e "${YELLOW}Warning: Migrations may have failed or already applied${NC}"

# Step 6: Health checks
echo -e "${BLUE}[6/6] Performing health checks...${NC}"
sleep 15  # Wait for services to start

# Check backend health
if curl -f http://localhost:3001/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Backend (staging) is healthy${NC}"
else
    echo -e "${RED}✗ Backend (staging) health check failed${NC}"
    echo -e "${YELLOW}Checking logs...${NC}"
    docker-compose -f docker-compose.staging.yml logs --tail=50 backend-staging
    exit 1
fi

# Check frontend health (via nginx)
if curl -f http://localhost:8080/health > /dev/null 2>&1; then
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
docker-compose -f docker-compose.staging.yml --env-file .env.staging ps
echo ""
echo -e "${BLUE}Access staging at:${NC}"
echo "  https://staging.codadminpro.com (via nginx reverse proxy)"
echo "  http://localhost:3001 (backend direct)"
echo "  http://localhost:5174 (frontend direct)"
echo ""
echo -e "${BLUE}View logs:${NC}"
echo "  docker-compose -f docker-compose.staging.yml logs -f"
echo ""
echo -e "${BLUE}Stop staging:${NC}"
echo "  docker-compose -f docker-compose.staging.yml down"
echo ""
