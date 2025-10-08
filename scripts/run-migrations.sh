#!/bin/bash

# Database Migration Script for E-commerce COD Admin
# This script runs Prisma migrations

set -e

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Change to backend directory
cd "$(dirname "$0")/../backend" || exit 1

echo -e "${GREEN}Running database migrations...${NC}"

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}Error: DATABASE_URL not set${NC}"
    exit 1
fi

# Generate Prisma Client
echo -e "${YELLOW}Generating Prisma Client...${NC}"
npx prisma generate

# Run migrations
echo -e "${YELLOW}Applying migrations...${NC}"
npx prisma migrate deploy

# Verify migrations
echo -e "${YELLOW}Verifying migrations...${NC}"
npx prisma migrate status

echo -e "${GREEN}Migration process completed!${NC}"
