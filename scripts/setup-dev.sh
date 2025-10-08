#!/bin/bash

# Development Environment Setup Script
# One-command setup for local development

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════════════╗"
echo "║     E-commerce COD Admin - Development Setup              ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

command -v node >/dev/null 2>&1 || { echo -e "${RED}Node.js is not installed. Please install Node.js 20+${NC}"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo -e "${RED}npm is not installed. Please install npm${NC}"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo -e "${RED}Docker is not installed. Please install Docker${NC}"; exit 1; }
command -v docker-compose >/dev/null 2>&1 || { echo -e "${RED}Docker Compose is not installed. Please install Docker Compose${NC}"; exit 1; }

echo -e "${GREEN}✓ All prerequisites met${NC}"

# Step 1: Create environment files
echo -e "${YELLOW}Setting up environment files...${NC}"

if [ ! -f .env ]; then
    cat > .env << 'EOF'
# Database
POSTGRES_DB=ecommerce_cod
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_PORT=5432

# Redis
REDIS_PASSWORD=redis
REDIS_PORT=6379

# Backend
BACKEND_PORT=3000
JWT_SECRET=dev-secret-change-in-production
JWT_REFRESH_SECRET=dev-refresh-secret-change-in-production

# Frontend
FRONTEND_PORT=8080
VITE_API_URL=http://localhost:3000
VITE_WS_URL=http://localhost:3000

# CORS
CORS_ORIGIN=http://localhost:5173

# Backup
BACKUP_DIR=./backups
RETENTION_DAYS=7
EOF
    echo -e "${GREEN}✓ Created .env file${NC}"
else
    echo -e "${YELLOW}! .env file already exists, skipping${NC}"
fi

# Step 2: Create directories
echo -e "${YELLOW}Creating necessary directories...${NC}"
mkdir -p backups
mkdir -p backend/logs
mkdir -p backend/uploads
echo -e "${GREEN}✓ Directories created${NC}"

# Step 3: Install backend dependencies
echo -e "${YELLOW}Installing backend dependencies...${NC}"
cd backend
npm install
echo -e "${GREEN}✓ Backend dependencies installed${NC}"

# Step 4: Generate Prisma Client
echo -e "${YELLOW}Generating Prisma Client...${NC}"
npx prisma generate
echo -e "${GREEN}✓ Prisma Client generated${NC}"
cd ..

# Step 5: Install frontend dependencies
echo -e "${YELLOW}Installing frontend dependencies...${NC}"
cd frontend
npm install
echo -e "${GREEN}✓ Frontend dependencies installed${NC}"
cd ..

# Step 6: Start Docker services
echo -e "${YELLOW}Starting Docker services (PostgreSQL, Redis)...${NC}"
docker-compose up -d postgres redis

# Wait for services to be ready
echo -e "${YELLOW}Waiting for services to be ready...${NC}"
sleep 10

# Step 7: Run database migrations
echo -e "${YELLOW}Running database migrations...${NC}"
cd backend
npx prisma migrate deploy
echo -e "${GREEN}✓ Database migrations completed${NC}"

# Step 8: Seed database (optional)
read -p "Do you want to seed the database with sample data? (yes/no): " SEED_DB
if [ "$SEED_DB" == "yes" ]; then
    echo -e "${YELLOW}Seeding database...${NC}"
    npx prisma db seed
    echo -e "${GREEN}✓ Database seeded${NC}"
fi

cd ..

# Step 9: Health check
echo -e "${YELLOW}Running health checks...${NC}"
./scripts/health-check.sh local || echo -e "${YELLOW}Some services may not be ready yet${NC}"

# Summary
echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║              Setup Completed Successfully!                 ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Next steps:${NC}"
echo -e "1. Start the backend:  ${YELLOW}cd backend && npm run dev${NC}"
echo -e "2. Start the frontend: ${YELLOW}cd frontend && npm run dev${NC}"
echo -e "3. Access the app:     ${YELLOW}http://localhost:5173${NC}"
echo -e "4. Access the API:     ${YELLOW}http://localhost:3000${NC}"
echo ""
echo -e "${GREEN}Useful commands:${NC}"
echo -e "- View logs:           ${YELLOW}docker-compose logs -f${NC}"
echo -e "- Stop services:       ${YELLOW}docker-compose down${NC}"
echo -e "- Database backup:     ${YELLOW}./scripts/database-backup.sh${NC}"
echo -e "- Health check:        ${YELLOW}./scripts/health-check.sh${NC}"
echo ""
echo -e "${GREEN}Happy coding! 🚀${NC}"
