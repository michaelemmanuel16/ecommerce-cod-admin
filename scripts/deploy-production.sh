#!/bin/bash

# Production Deployment Script
# Deploys the application to production environment

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}WARNING: You are about to deploy to PRODUCTION!${NC}"
read -p "Are you sure you want to continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo -e "${RED}Deployment cancelled${NC}"
    exit 0
fi

echo -e "${GREEN}Starting production deployment...${NC}"

# Configuration
ENVIRONMENT="production"
DOCKER_REGISTRY="ghcr.io"
IMAGE_TAG="${1:-latest}"

# Validate image tag
if [ "$IMAGE_TAG" == "latest" ]; then
    echo -e "${RED}Error: Cannot deploy 'latest' tag to production${NC}"
    echo "Please specify a version tag: ./deploy-production.sh v1.0.0"
    exit 1
fi

# Load environment variables
if [ -f .env.production ]; then
    export $(cat .env.production | grep -v '^#' | xargs)
fi

# Step 1: Create database backup
echo -e "${YELLOW}Creating database backup...${NC}"
./scripts/database-backup.sh

# Step 2: Pull Docker images
echo -e "${YELLOW}Pulling Docker images...${NC}"
docker pull ${DOCKER_REGISTRY}/ecommerce-cod-backend:${IMAGE_TAG}
docker pull ${DOCKER_REGISTRY}/ecommerce-cod-frontend:${IMAGE_TAG}

# Step 3: Run database migrations
echo -e "${YELLOW}Running database migrations...${NC}"
./scripts/run-migrations.sh

# Step 4: Deploy to production
if command -v kubectl &> /dev/null; then
    echo -e "${YELLOW}Deploying to Kubernetes production...${NC}"

    # Update image tags in deployment
    kubectl set image deployment/backend backend=${DOCKER_REGISTRY}/ecommerce-cod-backend:${IMAGE_TAG} -n ecommerce-cod
    kubectl set image deployment/frontend frontend=${DOCKER_REGISTRY}/ecommerce-cod-frontend:${IMAGE_TAG} -n ecommerce-cod

    # Wait for rollout
    kubectl rollout status deployment/backend -n ecommerce-cod --timeout=5m
    kubectl rollout status deployment/frontend -n ecommerce-cod --timeout=5m
else
    echo -e "${YELLOW}Deploying using Docker Compose...${NC}"

    # Set image tags
    export BACKEND_IMAGE=${DOCKER_REGISTRY}/ecommerce-cod-backend:${IMAGE_TAG}
    export FRONTEND_IMAGE=${DOCKER_REGISTRY}/ecommerce-cod-frontend:${IMAGE_TAG}

    # Deploy with zero downtime
    docker-compose -f docker-compose.prod.yml up -d --no-deps --build backend
    sleep 10
    docker-compose -f docker-compose.prod.yml up -d --no-deps --build frontend
fi

# Step 5: Health check
echo -e "${YELLOW}Running health checks...${NC}"
sleep 15
./scripts/health-check.sh production

# Step 6: Smoke tests
echo -e "${YELLOW}Running smoke tests...${NC}"
# Add smoke tests here

echo -e "${GREEN}Production deployment completed successfully!${NC}"
echo -e "Environment: ${ENVIRONMENT}"
echo -e "Image tag: ${IMAGE_TAG}"
echo -e "Deployment time: $(date)"

# Send notification
echo -e "${GREEN}Sending deployment notification...${NC}"
# Add notification logic here (Slack, email, etc.)
