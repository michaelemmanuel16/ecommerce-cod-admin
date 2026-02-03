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

# Bootstrap admin user if database is empty
echo "🔐 Checking if admin bootstrap is needed..."
npm run bootstrap || echo "⚠️  Bootstrap skipped (not needed for existing deployment)"

echo "🎉 Starting application..."
# Start the application
exec node dist/server.js
