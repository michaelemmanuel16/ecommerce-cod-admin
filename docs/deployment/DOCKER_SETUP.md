# Docker Setup Guide

This guide explains how to run the E-commerce COD Admin application using Docker.

## Prerequisites

- Docker Desktop installed and running
- Docker Compose (included with Docker Desktop)

## Quick Start

### Development Environment

```bash
# Start all services
docker-compose -f docker-compose.dev.yml up -d

# View logs
docker-compose -f docker-compose.dev.yml logs -f

# Stop all services
docker-compose -f docker-compose.dev.yml down

# Stop and remove all data (reset everything)
docker-compose -f docker-compose.dev.yml down -v
```

### Production Environment

```bash
# Start all services
docker-compose -f docker-compose.prod.yml up -d

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Stop all services
docker-compose -f docker-compose.prod.yml down
```

## What Happens When Containers Start

### Automatic Database Setup

The backend container automatically:

1. **Waits for PostgreSQL** to be ready
2. **Runs database migrations** (`prisma migrate deploy`)
3. **Seeds the database** if it's empty:
   - Creates admin user: `admin@example.com` / `admin123`
4. **Starts the application**

### Default Credentials

After first run, you can login with:
- **Email**: `admin@example.com`
- **Password**: `admin123`

**⚠️ IMPORTANT**: Change these credentials in production!

## Services

The Docker setup includes:

1. **PostgreSQL** (port 5432)
   - Database for storing all application data

2. **Redis** (port 6379)
   - Caching and queue management

3. **Backend API** (port 3000)
   - Node.js/Express REST API
   - Auto-runs migrations on startup

4. **Frontend** (port 5173 dev / 8080 prod)
   - React/Vite SPA

## Accessing Services

- **Frontend**: http://localhost:5173 (dev) or http://localhost:8080 (prod)
- **Backend API**: http://localhost:3000
- **API Health**: http://localhost:3000/health

## Troubleshooting

### "Database does not exist" errors

This is normal during first startup. The entrypoint script handles:
- Running migrations
- Creating tables
- Seeding initial data

Wait 30-60 seconds for the backend container to complete initialization.

### Check Container Logs

```bash
# All containers
docker-compose -f docker-compose.dev.yml logs

# Specific container
docker-compose -f docker-compose.dev.yml logs backend
docker-compose -f docker-compose.dev.yml logs postgres
```

### Reset Everything

If you want to start fresh:

```bash
# Stop and remove all containers and volumes
docker-compose -f docker-compose.dev.yml down -v

# Rebuild and start
docker-compose -f docker-compose.dev.yml up -d --build
```

### Backend Won't Start

Check if migrations are failing:

```bash
# View backend logs
docker-compose -f docker-compose.dev.yml logs backend

# Run migrations manually
docker-compose -f docker-compose.dev.yml exec backend npx prisma migrate deploy

# Create admin user manually
docker-compose -f docker-compose.dev.yml exec backend npx ts-node create-admin.ts
```

## Development Workflow

### Making Schema Changes

1. Edit `backend/prisma/schema.prisma`
2. Create migration:
   ```bash
   cd backend
   npm run prisma:migrate -- --name your_migration_name
   ```
3. Rebuild backend container:
   ```bash
   docker-compose -f docker-compose.dev.yml up -d --build backend
   ```

### Viewing Database

Using Prisma Studio (on host):
```bash
cd backend
npx prisma studio
```

Or connect directly to PostgreSQL:
```bash
docker-compose -f docker-compose.dev.yml exec postgres psql -U ecommerce_user -d ecommerce_cod
```

## Environment Variables

### Development (docker-compose.dev.yml)

All environment variables are defined in the compose file:
- `DATABASE_URL`: PostgreSQL connection
- `JWT_SECRET`: Development secret (change in prod!)
- `REDIS_HOST`: Redis connection

### Production

For production, create `.env.production` file with secure values:

```env
DATABASE_URL=postgresql://user:password@postgres:5432/dbname
JWT_SECRET=your-super-secure-secret-minimum-64-characters-long
JWT_REFRESH_SECRET=your-refresh-secret-minimum-64-characters
WEBHOOK_SECRET=your-webhook-secret
FRONTEND_URL=https://yourdomain.com
```

## Health Checks

All services have health checks configured:

- **PostgreSQL**: Ready when `pg_isready` succeeds
- **Redis**: Ready when `redis-cli ping` succeeds
- **Backend**: Ready when `/health` endpoint returns 200

The backend waits for PostgreSQL and Redis to be healthy before starting.

## Volumes

Data is persisted in Docker volumes:

- `postgres_data`: Database files
- `redis_data`: Redis cache
- `./backend/uploads`: File uploads
- `./backend/logs`: Application logs

## Production Considerations

1. **Change default credentials** immediately
2. **Use strong secrets** for JWT and webhooks
3. **Enable HTTPS** via reverse proxy (nginx/Caddy)
4. **Set up backups** for PostgreSQL volume
5. **Configure proper CORS** origins
6. **Monitor container health** and logs
7. **Set resource limits** in docker-compose.prod.yml

## Common Commands

```bash
# View running containers
docker-compose -f docker-compose.dev.yml ps

# Restart a service
docker-compose -f docker-compose.dev.yml restart backend

# View resource usage
docker stats

# Execute command in container
docker-compose -f docker-compose.dev.yml exec backend sh

# Follow logs for specific service
docker-compose -f docker-compose.dev.yml logs -f backend
```

## Architecture

```
┌─────────────┐
│   Frontend  │ :5173/:8080
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌──────────┐
│   Backend   │────▶│  Redis   │ :6379
│     API     │     └──────────┘
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ PostgreSQL  │ :5432
└─────────────┘
```

## Next Steps

After successful Docker setup:

1. Login at http://localhost:5173
2. Change admin password in Settings
3. Create additional users if needed
4. Start using the application!
