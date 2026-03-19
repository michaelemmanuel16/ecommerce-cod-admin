# Quick Start Guide

Get the E-commerce COD Admin backend running in 5 minutes!

## Prerequisites

- Node.js 18+ installed
- PostgreSQL 14+ installed
- Redis 6.0+ installed

## Installation Steps

### 1. Install Dependencies

```bash
npm install
```

### 2. Setup Environment

```bash
# Copy environment template
cp .env.example .env

# Edit .env and update these values:
# - DATABASE_URL (your PostgreSQL connection string)
# - JWT_SECRET (generate a random secret)
# - JWT_REFRESH_SECRET (generate another random secret)
# - WEBHOOK_SECRET (for webhook verification)
```

### 3. Setup Database

```bash
# Create database
createdb ecommerce_cod

# Run migration
psql -d ecommerce_cod -f migrations/001_initial_schema.sql

# Generate Prisma Client
npm run prisma:generate
```

### 4. Start Redis

```bash
# In a new terminal
redis-server
```

### 5. Start Development Server

```bash
npm run dev
```

The API will be running at `http://localhost:3000`

## Test the API

### 1. Health Check

```bash
curl http://localhost:3000/health
```

### 2. Register a User

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "admin123",
    "firstName": "Admin",
    "lastName": "User",
    "role": "super_admin"
  }'
```

### 3. Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "admin123"
  }'
```

Save the `accessToken` from the response!

### 4. Get Current User

```bash
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Next Steps

1. Read the [README.md](README.md) for detailed documentation
2. Check [API_DOCUMENTATION.md](API_DOCUMENTATION.md) for all endpoints
3. Review [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md) for architecture details

## Common Issues

### "Port 3000 already in use"
Change `PORT` in `.env` to another port (e.g., 3001)

### "Database connection failed"
Check that PostgreSQL is running and `DATABASE_URL` is correct

### "Redis connection failed"
Make sure Redis server is running: `redis-server`

### "Prisma Client not generated"
Run: `npm run prisma:generate`

## Production Build

```bash
# Build TypeScript
npm run build

# Start production server
npm start
```

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Start production server
- `npm run prisma:generate` - Generate Prisma Client
- `npm run prisma:studio` - Open Prisma Studio GUI
- `npm run lint` - Run ESLint

## Project Structure

```
backend/
├── src/
│   ├── controllers/    # 11 controller files
│   ├── routes/         # 11 route files
│   ├── middleware/     # 4 middleware files
│   ├── utils/          # 5 utility files
│   ├── services/       # Service layer
│   ├── queues/         # Bull queue processors
│   ├── sockets/        # Socket.io handlers
│   └── server.ts       # Main entry point
├── prisma/
│   └── schema.prisma   # Database schema
├── migrations/
│   └── 001_initial_schema.sql
└── [config files]
```

## Environment Variables Reference

```env
NODE_ENV=development          # development | production
PORT=3000                     # Server port
DATABASE_URL=postgresql://... # PostgreSQL connection
JWT_SECRET=...               # JWT signing secret
JWT_REFRESH_SECRET=...       # Refresh token secret
REDIS_URL=redis://...        # Redis connection
FRONTEND_URL=http://...      # CORS allowed origin
WEBHOOK_SECRET=...           # Webhook HMAC secret
```

## Support

For issues or questions, check the documentation or create an issue.

Happy coding! 🚀
