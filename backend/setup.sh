#!/bin/bash

# E-commerce COD Admin Backend Setup Script
# This script automates the setup process

echo "======================================"
echo "E-commerce COD Admin Backend Setup"
echo "======================================"
echo ""

# Check Node.js version
echo "Checking Node.js version..."
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Error: Node.js 18+ required. Current version: $(node -v)"
    exit 1
fi
echo "✅ Node.js $(node -v) detected"
echo ""

# Check PostgreSQL
echo "Checking PostgreSQL..."
if ! command -v psql &> /dev/null; then
    echo "⚠️  Warning: PostgreSQL not found. Please install PostgreSQL 14+"
else
    echo "✅ PostgreSQL found"
fi
echo ""

# Check Redis
echo "Checking Redis..."
if ! command -v redis-cli &> /dev/null; then
    echo "⚠️  Warning: Redis not found. Please install Redis 6.0+"
else
    echo "✅ Redis found"
fi
echo ""

# Install dependencies
echo "Installing dependencies..."
npm install
echo ""

# Copy environment file
if [ ! -f .env ]; then
    echo "Creating .env file from .env.example..."
    cp .env.example .env
    echo "⚠️  Please update .env with your actual configuration"
else
    echo "✅ .env file already exists"
fi
echo ""

# Generate Prisma Client
echo "Generating Prisma Client..."
npm run prisma:generate
echo ""

echo "======================================"
echo "Setup Complete!"
echo "======================================"
echo ""
echo "Next steps:"
echo "1. Update .env with your database credentials"
echo "2. Create PostgreSQL database: createdb ecommerce_cod"
echo "3. Run SQL migration: psql -d ecommerce_cod -f migrations/001_initial_schema.sql"
echo "4. Start Redis: redis-server"
echo "5. Start development server: npm run dev"
echo ""
echo "Documentation:"
echo "- README.md - Setup guide"
echo "- API_DOCUMENTATION.md - API reference"
echo "- PROJECT_SUMMARY.md - Project overview"
echo ""
echo "API will be available at: http://localhost:3000"
echo ""
