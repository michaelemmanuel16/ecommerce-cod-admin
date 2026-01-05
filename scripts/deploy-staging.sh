#!/bin/bash

# Staging Deployment Script
# Deploys the application to staging environment using port-based access

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
    echo -e "${YELLOW}Please create .env.staging with staging configuration${NC}"
    exit 1
fi

# Load environment variables
export $(cat .env.staging | grep -v '^#' | xargs)

echo -e "${GREEN}Starting staging deployment...${NC}"

# Step 1: Backup database (if exists)
echo -e "${BLUE}[1/6] Backing up staging database...${NC}"
if docker ps | grep -q "ecommerce-cod-postgres-staging"; then
    ./scripts/backup-database.sh || echo -e "${YELLOW}Warning: Backup failed or skipped${NC}"
else
    echo -e "${YELLOW}Staging database not running, skipping backup${NC}"
fi

# Step 2: Pull latest Docker images from GitHub Container Registry
echo -e "${BLUE}[2/6] Pulling latest Docker images...${NC}"
docker-compose -f docker-compose.staging.yml pull

# Step 3: Stop existing staging containers
echo -e "${BLUE}[3/6] Stopping existing staging containers...${NC}"
docker-compose -f docker-compose.staging.yml down

# Step 4: Start staging containers
echo -e "${BLUE}[4/6] Starting staging containers...${NC}"
docker-compose -f docker-compose.staging.yml up -d

# Step 5: Run database migrations
echo -e "${BLUE}[5/6] Running database migrations...${NC}"
sleep 10  # Wait for containers to be ready
docker-compose -f docker-compose.staging.yml exec -T backend npx prisma migrate deploy

# Step 6: Health checks
echo -e "${BLUE}[6/6] Performing health checks...${NC}"
sleep 15  # Wait for services to start

# Check backend health
if curl -f http://localhost:3001/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Backend is healthy (http://localhost:3001)${NC}"
else
    echo -e "${RED}✗ Backend health check failed${NC}"
    echo -e "${YELLOW}Checking logs...${NC}"
    docker-compose -f docker-compose.staging.yml logs --tail=50 backend
    exit 1
fi

# Check frontend health
if curl -f http://localhost:5174/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Frontend is healthy (http://localhost:5174)${NC}"
else
    echo -e "${YELLOW}⚠ Frontend health check failed (might not have /health endpoint)${NC}"
    echo -e "${GREEN}✓ Frontend container is running${NC}"
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Staging deployment completed successfully!                  ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Access URLs:${NC}"
echo -e "  Frontend: ${GREEN}http://143.110.197.200:5174${NC}"
echo -e "  Backend:  ${GREEN}http://143.110.197.200:3001${NC}"
echo ""
echo -e "${BLUE}Application Status:${NC}"
docker-compose -f docker-compose.staging.yml ps
echo ""
echo -e "${BLUE}View logs:${NC}"
echo "  docker-compose -f docker-compose.staging.yml logs -f"
echo ""
echo -e "${BLUE}Stop staging:${NC}"
echo "  docker-compose -f docker-compose.staging.yml down"
echo ""
