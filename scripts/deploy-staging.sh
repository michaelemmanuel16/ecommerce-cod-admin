#!/bin/bash

# Staging Deployment Script
# Deploys the application to staging environment

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting staging deployment...${NC}"

# Configuration
ENVIRONMENT="staging"
DOCKER_REGISTRY="ghcr.io"
IMAGE_TAG="${1:-latest}"

# Load environment variables
if [ -f .env.staging ]; then
    export $(cat .env.staging | grep -v '^#' | xargs)
fi

# Step 1: Build and push Docker images
echo -e "${YELLOW}Building Docker images...${NC}"
docker-compose -f docker-compose.yml build

echo -e "${YELLOW}Tagging images...${NC}"
docker tag ecommerce-cod-backend:latest ${DOCKER_REGISTRY}/ecommerce-cod-backend:${IMAGE_TAG}
docker tag ecommerce-cod-frontend:latest ${DOCKER_REGISTRY}/ecommerce-cod-frontend:${IMAGE_TAG}

echo -e "${YELLOW}Pushing images to registry...${NC}"
docker push ${DOCKER_REGISTRY}/ecommerce-cod-backend:${IMAGE_TAG}
docker push ${DOCKER_REGISTRY}/ecommerce-cod-frontend:${IMAGE_TAG}

# Step 2: Run database migrations
echo -e "${YELLOW}Running database migrations...${NC}"
./scripts/run-migrations.sh

# Step 3: Deploy to staging (Docker Swarm or Kubernetes)
if command -v kubectl &> /dev/null; then
    echo -e "${YELLOW}Deploying to Kubernetes staging...${NC}"

    # Update image tags in deployment
    kubectl set image deployment/backend backend=${DOCKER_REGISTRY}/ecommerce-cod-backend:${IMAGE_TAG} -n ecommerce-cod-staging
    kubectl set image deployment/frontend frontend=${DOCKER_REGISTRY}/ecommerce-cod-frontend:${IMAGE_TAG} -n ecommerce-cod-staging

    # Wait for rollout
    kubectl rollout status deployment/backend -n ecommerce-cod-staging
    kubectl rollout status deployment/frontend -n ecommerce-cod-staging
else
    echo -e "${YELLOW}Deploying using Docker Compose...${NC}"

    # Pull latest images
    docker-compose -f docker-compose.prod.yml pull

    # Deploy
    docker-compose -f docker-compose.prod.yml up -d
fi

# Step 4: Health check
echo -e "${YELLOW}Running health checks...${NC}"
./scripts/health-check.sh staging

echo -e "${GREEN}Staging deployment completed successfully!${NC}"
echo -e "Environment: ${ENVIRONMENT}"
echo -e "Image tag: ${IMAGE_TAG}"
