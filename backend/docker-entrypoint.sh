#!/bin/sh
set -e

echo "🚀 Starting E-commerce COD Admin Backend..."

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL..."
while ! nc -z postgres 5432; do
  sleep 1
done
echo "✅ PostgreSQL is ready!"

# Run migrations
echo "📦 Running Prisma migrations..."
npx prisma migrate deploy

# Note: Auto-seeding removed for security
# To create the first admin user, run: npm run create-admin
echo "ℹ️  Migrations complete. If this is a fresh database, create an admin user with: npm run create-admin"

echo "🎉 Starting application..."
# Start the application
exec node dist/server.js
