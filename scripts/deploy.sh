#!/bin/bash

# Production Deployment Script
# Usage: ./scripts/deploy.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   E-Commerce COD Admin - Production Deployment               ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo -e "${RED}Error: .env.production file not found!${NC}"
    echo -e "${YELLOW}Please create .env.production from .env.production.example${NC}"
    exit 1
fi

# Load environment variables
export $(cat .env.production | grep -v '^#' | xargs)

# Confirmation prompt
echo -e "${YELLOW}This will deploy the application to production.${NC}"
read -p "Are you sure you want to continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo -e "${RED}Deployment cancelled.${NC}"
    exit 0
fi

echo -e "${GREEN}Starting deployment process...${NC}"

# Step 1: Backup database
echo -e "${BLUE}[1/7] Backing up database...${NC}"
if docker-compose -f docker-compose.prod.yml ps postgres | grep -q "Up"; then
    ./scripts/backup-database.sh || echo -e "${YELLOW}Warning: Backup failed or skipped${NC}"
else
    echo -e "${YELLOW}Database not running, skipping backup${NC}"
fi

# Step 2: Pull latest code (if in git repo)
if [ -d .git ]; then
    echo -e "${BLUE}[2/7] Pulling latest code from repository...${NC}"
    git pull origin main
else
    echo -e "${YELLOW}[2/7] Not a git repository, skipping pull${NC}"
fi

# Step 3: Build Docker images
echo -e "${BLUE}[3/7] Building Docker images...${NC}"
docker-compose -f docker-compose.prod.yml build --no-cache

# Step 4: Stop existing containers
echo -e "${BLUE}[4/7] Stopping existing containers...${NC}"
docker-compose -f docker-compose.prod.yml down

# Step 5: Start new containers
echo -e "${BLUE}[5/7] Starting new containers...${NC}"
docker-compose -f docker-compose.prod.yml up -d

# Step 6: Run database migrations
echo -e "${BLUE}[6/7] Running database migrations...${NC}"
sleep 10  # Wait for containers to be ready
docker-compose -f docker-compose.prod.yml exec -T backend npx prisma migrate deploy

# Step 7: Health checks
echo -e "${BLUE}[7/7] Performing health checks...${NC}"
sleep 15  # Wait for services to start

# Check backend health
if curl -f http://localhost:3000/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Backend is healthy${NC}"
else
    echo -e "${RED}✗ Backend health check failed${NC}"
    echo -e "${YELLOW}Checking logs...${NC}"
    docker-compose -f docker-compose.prod.yml logs --tail=50 backend
    exit 1
fi

# Check frontend health (via nginx)
if curl -f http://localhost/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Frontend is healthy${NC}"
else
    echo -e "${RED}✗ Frontend health check failed${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Deployment completed successfully!                          ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Application Status:${NC}"
docker-compose -f docker-compose.prod.yml ps
echo ""
echo -e "${BLUE}View logs:${NC}"
echo "  docker-compose -f docker-compose.prod.yml logs -f"
echo ""
echo -e "${BLUE}Stop application:${NC}"
echo "  docker-compose -f docker-compose.prod.yml down"
echo ""
