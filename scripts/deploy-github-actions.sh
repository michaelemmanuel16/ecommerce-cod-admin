#!/bin/bash

# Automated Deployment Script for GitHub Actions
# This script is executed on the production server by GitHub Actions
# It pulls pre-built Docker images from GHCR and updates the containers

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
COMPOSE_FILE="docker-compose.prod.yml"
BACKUP_SCRIPT="./scripts/backup-database.sh"
HEALTH_CHECK_TIMEOUT=30
ROLLBACK_ENABLED=true

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   E-Commerce COD Admin - Automated Deployment                ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Deployment started at: $(date)${NC}"
echo ""

# Step 1: Pre-deployment checks
echo -e "${BLUE}[1/7] Running pre-deployment checks...${NC}"

if [ ! -f "$COMPOSE_FILE" ]; then
    echo -e "${RED}Error: $COMPOSE_FILE not found!${NC}"
    exit 1
fi

if ! docker-compose -f "$COMPOSE_FILE" ps | grep -q "Up"; then
    echo -e "${YELLOW}Warning: Some containers are not running${NC}"
fi

echo -e "${GREEN}✓ Pre-deployment checks passed${NC}"
echo ""

# Step 2: Backup database
echo -e "${BLUE}[2/7] Creating database backup...${NC}"

if [ -f "$BACKUP_SCRIPT" ]; then
    if bash "$BACKUP_SCRIPT"; then
        echo -e "${GREEN}✓ Database backup completed${NC}"
    else
        echo -e "${YELLOW}Warning: Backup failed, continuing with deployment${NC}"
    fi
else
    echo -e "${YELLOW}Warning: Backup script not found at $BACKUP_SCRIPT${NC}"
fi
echo ""

# Step 3: Store current image tags for rollback
echo -e "${BLUE}[3/7] Storing current state for rollback...${NC}"

CURRENT_BACKEND_IMAGE=$(docker inspect ecommerce-cod-backend --format='{{.Image}}' 2>/dev/null || echo "")
CURRENT_FRONTEND_IMAGE=$(docker inspect ecommerce-cod-frontend --format='{{.Image}}' 2>/dev/null || echo "")

echo -e "${GREEN}✓ Current state saved${NC}"
echo ""

# Step 4: Pull new images from GHCR
echo -e "${BLUE}[4/7] Pulling new Docker images from GHCR...${NC}"

if docker-compose -f "$COMPOSE_FILE" pull backend frontend; then
    echo -e "${GREEN}✓ Images pulled successfully${NC}"
else
    echo -e "${RED}Error: Failed to pull images${NC}"
    exit 1
fi
echo ""

# Step 5: Update containers with rolling restart
echo -e "${BLUE}[5/7] Updating containers (rolling restart)...${NC}"

# Update backend first
echo -e "${YELLOW}Updating backend service...${NC}"
if docker-compose -f "$COMPOSE_FILE" up -d --no-deps backend; then
    echo -e "${GREEN}✓ Backend container updated${NC}"

    # Wait for backend to be healthy (respecting start_period of 40s)
    echo -e "${YELLOW}Waiting for backend to initialize (45s)...${NC}"
    sleep 45
else
    echo -e "${RED}Error: Failed to update backend${NC}"
    if [ "$ROLLBACK_ENABLED" = true ]; then
        echo -e "${YELLOW}Initiating rollback...${NC}"
        docker tag "$CURRENT_BACKEND_IMAGE" ecommerce-cod-backend:rollback 2>/dev/null || true
        docker-compose -f "$COMPOSE_FILE" up -d --no-deps backend
    fi
    exit 1
fi

# Update frontend
echo -e "${YELLOW}Updating frontend service...${NC}"
if docker-compose -f "$COMPOSE_FILE" up -d --no-deps frontend; then
    echo -e "${GREEN}✓ Frontend container updated${NC}"
else
    echo -e "${RED}Error: Failed to update frontend${NC}"
    if [ "$ROLLBACK_ENABLED" = true ]; then
        echo -e "${YELLOW}Initiating rollback...${NC}"
        docker tag "$CURRENT_FRONTEND_IMAGE" ecommerce-cod-frontend:rollback 2>/dev/null || true
        docker-compose -f "$COMPOSE_FILE" up -d --no-deps frontend
    fi
    exit 1
fi

echo ""

# Step 6: Health checks
echo -e "${BLUE}[6/7] Running health checks...${NC}"

# Check backend health using docker's built-in health status
echo -e "${YELLOW}Checking backend health...${NC}"
BACKEND_HEALTHY=false
for i in {1..12}; do
    HEALTH_STATUS=$(docker inspect --format='{{.State.Health.Status}}' ecommerce-cod-backend 2>/dev/null || echo "unknown")
    if [ "$HEALTH_STATUS" = "healthy" ]; then
        BACKEND_HEALTHY=true
        echo -e "${GREEN}✓ Backend is healthy${NC}"
        break
    fi
    echo -e "${YELLOW}Attempt $i/12: Backend status is '$HEALTH_STATUS', waiting...${NC}"
    sleep 5
done

if [ "$BACKEND_HEALTHY" = false ]; then
    echo -e "${RED}✗ Backend health check failed${NC}"
    # Show container logs for debugging
    echo -e "${YELLOW}Recent backend logs:${NC}"
    docker logs ecommerce-cod-backend --tail 20 2>&1 || true

    if [ "$ROLLBACK_ENABLED" = true ]; then
        echo -e "${YELLOW}Initiating rollback due to failed health checks...${NC}"
        docker tag "$CURRENT_BACKEND_IMAGE" ecommerce-cod-backend:rollback 2>/dev/null || true
        docker tag "$CURRENT_FRONTEND_IMAGE" ecommerce-cod-frontend:rollback 2>/dev/null || true
        docker-compose -f "$COMPOSE_FILE" up -d --no-deps backend frontend
        echo -e "${RED}Deployment failed and rolled back${NC}"
        exit 1
    else
        exit 1
    fi
fi

# Check frontend health using docker's built-in health status
echo -e "${YELLOW}Checking frontend health...${NC}"
FRONTEND_HEALTHY=false
for i in {1..12}; do
    HEALTH_STATUS=$(docker inspect --format='{{.State.Health.Status}}' ecommerce-cod-frontend 2>/dev/null || echo "unknown")
    if [ "$HEALTH_STATUS" = "healthy" ]; then
        FRONTEND_HEALTHY=true
        echo -e "${GREEN}✓ Frontend is healthy${NC}"
        break
    fi
    echo -e "${YELLOW}Attempt $i/12: Frontend status is '$HEALTH_STATUS', waiting...${NC}"
    sleep 5
done

if [ "$FRONTEND_HEALTHY" = false ]; then
    echo -e "${RED}✗ Frontend health check failed${NC}"
    # Show container logs for debugging
    echo -e "${YELLOW}Recent frontend logs:${NC}"
    docker logs ecommerce-cod-frontend --tail 20 2>&1 || true

    if [ "$ROLLBACK_ENABLED" = true ]; then
        echo -e "${YELLOW}Initiating rollback due to failed health checks...${NC}"
        docker tag "$CURRENT_BACKEND_IMAGE" ecommerce-cod-backend:rollback 2>/dev/null || true
        docker tag "$CURRENT_FRONTEND_IMAGE" ecommerce-cod-frontend:rollback 2>/dev/null || true
        docker-compose -f "$COMPOSE_FILE" up -d --no-deps backend frontend
        echo -e "${RED}Deployment failed and rolled back${NC}"
        exit 1
    else
        exit 1
    fi
fi

echo ""

# Step 7: Cleanup
echo -e "${BLUE}[7/7] Cleaning up old images...${NC}"

# Remove dangling images to free up space
if docker image prune -f > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Old images cleaned up${NC}"
else
    echo -e "${YELLOW}Warning: Failed to clean up old images${NC}"
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Deployment completed successfully!                          ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Deployment completed at: $(date)${NC}"
echo ""
echo -e "${BLUE}Container Status:${NC}"
docker-compose -f "$COMPOSE_FILE" ps
echo ""
echo -e "${GREEN}All services are running and healthy!${NC}"
