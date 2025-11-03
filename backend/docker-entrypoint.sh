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
2>/dev/null | tail -n 1 || echo "0")

if [ "$USER_COUNT" = "0" ]; then
  echo "🌱 Database is empty, running seed..."
  # Create admin user
  node -e "
    const { PrismaClient } = require('@prisma/client');
    const bcrypt = require('bcrypt');
    const prisma = new PrismaClient();

    async function createAdmin() {
      try {
        const hashedPassword = await bcrypt.hash('admin123', 10);
        await prisma.user.create({
          data: {
            email: 'admin@example.com',
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
