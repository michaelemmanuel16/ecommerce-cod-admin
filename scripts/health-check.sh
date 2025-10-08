#!/bin/bash

# Health Check Script
# Checks the health of all services

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

ENVIRONMENT="${1:-local}"
MAX_RETRIES=10
RETRY_DELAY=3

# Service URLs based on environment
if [ "$ENVIRONMENT" == "production" ]; then
    BACKEND_URL="${BACKEND_URL:-https://api.yourdomain.com}"
    FRONTEND_URL="${FRONTEND_URL:-https://yourdomain.com}"
elif [ "$ENVIRONMENT" == "staging" ]; then
    BACKEND_URL="${BACKEND_URL:-https://staging-api.yourdomain.com}"
    FRONTEND_URL="${FRONTEND_URL:-https://staging.yourdomain.com}"
else
    BACKEND_URL="${BACKEND_URL:-http://localhost:3000}"
    FRONTEND_URL="${FRONTEND_URL:-http://localhost:8080}"
fi

echo -e "${GREEN}Running health checks for ${ENVIRONMENT}...${NC}"

# Function to check service health
check_service() {
    local SERVICE_NAME=$1
    local URL=$2
    local RETRIES=0

    echo -e "${YELLOW}Checking ${SERVICE_NAME}...${NC}"

    while [ $RETRIES -lt $MAX_RETRIES ]; do
        if curl -f -s -o /dev/null "$URL"; then
            echo -e "${GREEN}✓ ${SERVICE_NAME} is healthy${NC}"
            return 0
        else
            RETRIES=$((RETRIES + 1))
            echo -e "${YELLOW}Attempt $RETRIES/$MAX_RETRIES failed. Retrying in ${RETRY_DELAY}s...${NC}"
            sleep $RETRY_DELAY
        fi
    done

    echo -e "${RED}✗ ${SERVICE_NAME} is unhealthy${NC}"
    return 1
}

# Check backend health
check_service "Backend" "${BACKEND_URL}/health"
BACKEND_STATUS=$?

# Check frontend health
check_service "Frontend" "${FRONTEND_URL}/health"
FRONTEND_STATUS=$?

# Check database (if local)
if [ "$ENVIRONMENT" == "local" ]; then
    echo -e "${YELLOW}Checking PostgreSQL...${NC}"
    if docker exec ecommerce-cod-postgres pg_isready -U postgres > /dev/null 2>&1; then
        echo -e "${GREEN}✓ PostgreSQL is healthy${NC}"
        DB_STATUS=0
    else
        echo -e "${RED}✗ PostgreSQL is unhealthy${NC}"
        DB_STATUS=1
    fi

    echo -e "${YELLOW}Checking Redis...${NC}"
    if docker exec ecommerce-cod-redis redis-cli ping > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Redis is healthy${NC}"
        REDIS_STATUS=0
    else
        echo -e "${RED}✗ Redis is unhealthy${NC}"
        REDIS_STATUS=1
    fi
fi

# Summary
echo ""
echo -e "${GREEN}Health Check Summary:${NC}"
echo "===================="
[ $BACKEND_STATUS -eq 0 ] && echo -e "${GREEN}Backend: OK${NC}" || echo -e "${RED}Backend: FAIL${NC}"
[ $FRONTEND_STATUS -eq 0 ] && echo -e "${GREEN}Frontend: OK${NC}" || echo -e "${RED}Frontend: FAIL${NC}"

if [ "$ENVIRONMENT" == "local" ]; then
    [ $DB_STATUS -eq 0 ] && echo -e "${GREEN}PostgreSQL: OK${NC}" || echo -e "${RED}PostgreSQL: FAIL${NC}"
    [ $REDIS_STATUS -eq 0 ] && echo -e "${GREEN}Redis: OK${NC}" || echo -e "${RED}Redis: FAIL${NC}"
fi

# Exit with error if any service is unhealthy
if [ $BACKEND_STATUS -ne 0 ] || [ $FRONTEND_STATUS -ne 0 ]; then
    exit 1
fi

if [ "$ENVIRONMENT" == "local" ] && ([ $DB_STATUS -ne 0 ] || [ $REDIS_STATUS -ne 0 ]); then
    exit 1
fi

echo ""
echo -e "${GREEN}All services are healthy!${NC}"
exit 0
