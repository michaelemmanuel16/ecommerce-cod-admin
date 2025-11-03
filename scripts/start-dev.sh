#!/bin/bash

# Development Environment Start Script
# Usage: ./scripts/start-dev.sh

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   E-Commerce COD Admin - Development Environment             ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}Error: Docker is not running!${NC}"
    exit 1
fi

echo -e "${GREEN}Starting development environment...${NC}"

# Start services
docker-compose -f docker-compose.dev.yml up -d

echo ""
echo -e "${GREEN}Waiting for services to be ready...${NC}"
sleep 10

# Run migrations
echo -e "${GREEN}Running database migrations...${NC}"
docker-compose -f docker-compose.dev.yml exec backend npx prisma migrate dev

# Seed database (optional)
read -p "Do you want to seed the database? (y/n): " SEED
if [ "$SEED" = "y" ] || [ "$SEED" = "Y" ]; then
    echo -e "${GREEN}Seeding database...${NC}"
    docker-compose -f docker-compose.dev.yml exec backend npx prisma db seed
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Development environment is ready!                           ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Services:${NC}"
echo "  Frontend:  http://localhost:5173"
echo "  Backend:   http://localhost:3000"
echo "  API Docs:  http://localhost:3000/api"
echo "  Postgres:  localhost:5432"
echo "  Redis:     localhost:6379"
echo ""
echo -e "${BLUE}View logs:${NC}"
echo "  docker-compose -f docker-compose.dev.yml logs -f"
echo ""
echo -e "${BLUE}Stop services:${NC}"
echo "  docker-compose -f docker-compose.dev.yml down"
echo ""
