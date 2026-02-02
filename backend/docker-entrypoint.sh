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

# Check if database needs seeding
echo "🌱 Checking if database needs seeding..."
USER_COUNT=$(npx prisma db execute --stdin <<EOF
SELECT COUNT(*) FROM users;
EOF
2>/dev/null | grep -E '^[[:space:]]*[0-9]+[[:space:]]*$' | tr -d ' ' || echo "0")

if [ "$USER_COUNT" = "0" ] && [ "${ALLOW_ADMIN_AUTO_CREATE:-true}" = "true" ]; then
  echo "🌱 Database is empty and ALLOW_ADMIN_AUTO_CREATE is true, running seed..."
  # Create admin user
  node -e "
    const { PrismaClient } = require('@prisma/client');
    const bcrypt = require('bcrypt');
    const prisma = new PrismaClient();

    async function createAdmin() {
      try {
        if (!process.env.DEFAULT_SEED_PASSWORD) {
          console.error('❌ FATAL: DEFAULT_SEED_PASSWORD environment variable is required');
          console.error('Set DEFAULT_SEED_PASSWORD in your .env or k8s secrets');
          process.exit(1);
        }
        const defaultPassword = process.env.DEFAULT_SEED_PASSWORD;
        const hashedPassword = await bcrypt.hash(defaultPassword, 10);
        await prisma.user.create({
          data: {
            email: 'admin@codadmin.com',
            password: hashedPassword,
            firstName: 'Admin',
            lastName: 'User',
            phoneNumber: '+1234567890',
            role: 'super_admin',
            isActive: true,
            isAvailable: true,
          }
        });
        console.log('✅ Admin user created');
      } catch (error) {
        console.log('ℹ️  Admin user may already exist');
      } finally {
        await prisma.\$disconnect();
      }
    }
    createAdmin();
  "
else
  echo "ℹ️  Database already seeded"
fi

echo "🎉 Starting application..."
# Start the application
exec node dist/server.js
