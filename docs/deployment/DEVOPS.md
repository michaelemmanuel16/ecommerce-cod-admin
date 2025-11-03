# DevOps Documentation - E-commerce COD Admin Dashboard

Complete guide for deploying, monitoring, and maintaining the e-commerce COD admin dashboard.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Local Development Setup](#local-development-setup)
5. [Docker Deployment](#docker-deployment)
6. [Kubernetes Deployment](#kubernetes-deployment)
7. [CI/CD Pipeline](#cicd-pipeline)
8. [Monitoring & Logging](#monitoring--logging)
9. [Database Management](#database-management)
10. [Security](#security)
11. [Scaling](#scaling)
12. [Troubleshooting](#troubleshooting)

---

## Overview

This project uses modern DevOps practices with containerization, automated CI/CD, comprehensive monitoring, and infrastructure as code.

**Tech Stack:**
- **Backend**: Node.js, Express, TypeScript, Prisma
- **Frontend**: React, TypeScript, Vite
- **Database**: PostgreSQL 15
- **Cache**: Redis 7
- **Reverse Proxy**: Nginx
- **Containerization**: Docker, Docker Compose
- **Orchestration**: Kubernetes (optional)
- **CI/CD**: GitHub Actions
- **Monitoring**: Prometheus, Grafana
- **Deployment**: Docker Swarm, Kubernetes, or standalone

---

## Architecture

```
┌─────────────────┐
│   Users/Clients │
└────────┬────────┘
         │
         ▼
    ┌────────┐
    │ Nginx  │ (Reverse Proxy, SSL, Rate Limiting)
    └───┬────┘
        │
        ├──────────────┬──────────────┐
        ▼              ▼              ▼
   ┌─────────┐   ┌─────────┐   ┌──────────┐
   │Frontend │   │Backend  │   │Socket.IO │
   └─────────┘   └────┬────┘   └──────────┘
                      │
                      ├──────────┬─────────┐
                      ▼          ▼         ▼
                 ┌──────────┐ ┌─────┐ ┌──────┐
                 │PostgreSQL│ │Redis│ │Queue │
                 └──────────┘ └─────┘ └──────┘
```

---

## Prerequisites

### Development
- Node.js 20+
- npm or yarn
- Docker 24+
- Docker Compose 2+
- Git

### Production
- Docker 24+ & Docker Compose 2+ OR
- Kubernetes cluster (1.25+)
- Domain name with SSL certificate
- At least 2GB RAM, 2 CPU cores
- PostgreSQL 15+ (managed or self-hosted)
- Redis 7+ (managed or self-hosted)

---

## Local Development Setup

### Quick Start (One Command)

```bash
./scripts/setup-dev.sh
```

This script will:
1. Install all dependencies
2. Set up environment files
3. Start Docker services (PostgreSQL, Redis)
4. Run database migrations
5. Optionally seed the database

### Manual Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/ecommerce-cod-admin.git
   cd ecommerce-cod-admin
   ```

2. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start infrastructure services**
   ```bash
   docker-compose up -d postgres redis
   ```

4. **Install backend dependencies**
   ```bash
   cd backend
   npm install
   npx prisma generate
   npx prisma migrate deploy
   ```

5. **Install frontend dependencies**
   ```bash
   cd frontend
   npm install
   ```

6. **Start development servers**
   ```bash
   # Terminal 1 - Backend
   cd backend && npm run dev

   # Terminal 2 - Frontend
   cd frontend && npm run dev
   ```

7. **Access the application**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:3000
   - API Documentation: http://localhost:3000/api/docs

---

## Docker Deployment

### Development Environment

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down

# Restart specific service
docker-compose restart backend
```

### Production Environment

1. **Configure environment**
   ```bash
   cp .env.production .env
   # Update with production values
   ```

2. **Build and start services**
   ```bash
   docker-compose -f docker-compose.prod.yml up -d
   ```

3. **Run migrations**
   ```bash
   ./scripts/run-migrations.sh
   ```

4. **Health check**
   ```bash
   ./scripts/health-check.sh production
   ```

### Docker Commands Reference

```bash
# Build specific service
docker-compose build backend

# Scale services
docker-compose up -d --scale backend=3

# View resource usage
docker stats

# Clean up unused resources
docker system prune -a

# View logs for specific service
docker-compose logs -f backend

# Execute command in running container
docker-compose exec backend sh
```

---

## Kubernetes Deployment

### Prerequisites
- kubectl configured with cluster access
- Helm 3+ (optional, for easier management)
- Ingress controller installed
- cert-manager for SSL (optional)

### Deployment Steps

1. **Create namespace**
   ```bash
   kubectl apply -f k8s/namespace.yaml
   ```

2. **Configure secrets**
   ```bash
   # Edit k8s/secrets.yaml with actual values
   kubectl apply -f k8s/secrets.yaml
   ```

3. **Deploy infrastructure**
   ```bash
   kubectl apply -f k8s/postgres-deployment.yaml
   kubectl apply -f k8s/redis-deployment.yaml
   ```

4. **Deploy applications**
   ```bash
   kubectl apply -f k8s/configmap.yaml
   kubectl apply -f k8s/backend-deployment.yaml
   kubectl apply -f k8s/frontend-deployment.yaml
   ```

5. **Configure ingress**
   ```bash
   kubectl apply -f k8s/ingress.yaml
   ```

6. **Enable autoscaling**
   ```bash
   kubectl apply -f k8s/hpa.yaml
   ```

7. **Verify deployment**
   ```bash
   kubectl get pods -n ecommerce-cod
   kubectl get services -n ecommerce-cod
   kubectl get ingress -n ecommerce-cod
   ```

### Kubernetes Management

```bash
# View pod logs
kubectl logs -f deployment/backend -n ecommerce-cod

# Scale deployment
kubectl scale deployment backend --replicas=5 -n ecommerce-cod

# Update image
kubectl set image deployment/backend backend=new-image:tag -n ecommerce-cod

# Rollback deployment
kubectl rollout undo deployment/backend -n ecommerce-cod

# View rollout history
kubectl rollout history deployment/backend -n ecommerce-cod

# Port forwarding for debugging
kubectl port-forward service/backend-service 3000:3000 -n ecommerce-cod
```

---

## CI/CD Pipeline

### GitHub Actions Workflows

The project includes three main workflows:

#### 1. Backend CI/CD (`.github/workflows/backend-ci.yml`)
- **Triggers**: Push/PR to main/develop, changes in backend/
- **Jobs**:
  - Lint code
  - Run tests (unit & integration)
  - Build Docker image
  - Push to GitHub Container Registry
  - Deploy to staging (develop branch)
  - Deploy to production (main branch)

#### 2. Frontend CI/CD (`.github/workflows/frontend-ci.yml`)
- **Triggers**: Push/PR to main/develop, changes in frontend/
- **Jobs**:
  - Lint code
  - Run tests
  - Build application
  - Build Docker image
  - Push to GitHub Container Registry
  - Deploy to staging/production

#### 3. Security Audit (`.github/workflows/security-audit.yml`)
- **Triggers**: Push, PR, weekly schedule
- **Jobs**:
  - npm audit
  - Dependency review
  - Trivy security scan
  - CodeQL analysis
  - Secret scanning

### Setting Up CI/CD

1. **Configure GitHub Secrets**
   - Navigate to repository Settings > Secrets and variables > Actions
   - Add required secrets:
     - `GHCR_TOKEN`: GitHub token for container registry
     - `VITE_API_URL`: Frontend API URL
     - `VITE_WS_URL`: Frontend WebSocket URL
     - Additional deployment secrets as needed

2. **Enable GitHub Packages**
   - Ensure GitHub Packages is enabled for your organization
   - Configure package permissions

3. **Configure Deployment Environments**
   - Create "staging" and "production" environments in GitHub
   - Add environment-specific secrets and protection rules

---

## Monitoring & Logging

### Prometheus & Grafana Setup

1. **Start monitoring stack**
   ```bash
   cd monitoring
   docker-compose -f docker-compose.monitoring.yml up -d
   ```

2. **Access dashboards**
   - Prometheus: http://localhost:9090
   - Grafana: http://localhost:3001 (admin/admin)
   - Alertmanager: http://localhost:9093

3. **Import Grafana dashboards**
   - Grafana will automatically load dashboards from `monitoring/grafana/dashboards/`
   - Access pre-configured application dashboard

### Health Check Endpoints

- **Basic Health**: `GET /health`
  - Returns basic health status
  - Used by load balancers

- **Readiness Probe**: `GET /ready`
  - Checks database and Redis connections
  - Used by Kubernetes readiness probes

- **Liveness Probe**: `GET /live`
  - Checks if application is alive
  - Used by Kubernetes liveness probes

- **Detailed Health**: `GET /health/detailed`
  - Comprehensive health check with all dependencies
  - Response times for each service

- **Metrics**: `GET /metrics`
  - Prometheus-compatible metrics endpoint
  - CPU, memory, uptime, custom metrics

### Alerting

Configure alerts in `monitoring/prometheus/rules/alerts.yml`:
- Backend service down
- High error rate
- High response time
- High CPU/memory usage
- Database connection issues
- Redis issues

Notifications are sent via:
- Email
- Slack (configure webhook in `monitoring/prometheus/alertmanager.yml`)

---

## Database Management

### Backup

```bash
# Create backup
./scripts/database-backup.sh

# Backups are stored in ./backups/
# Format: ecommerce_cod_backup_YYYYMMDD_HHMMSS.dump
```

### Restore

```bash
# List available backups
ls -lh backups/

# Restore from backup
./scripts/database-restore.sh backups/ecommerce_cod_backup_20250108_120000.dump
```

### Migrations

```bash
# Run migrations
./scripts/run-migrations.sh

# Create new migration (development)
cd backend
npx prisma migrate dev --name migration_name

# View migration status
npx prisma migrate status
```

### Database Access

```bash
# Connect to PostgreSQL
docker exec -it ecommerce-cod-postgres psql -U postgres -d ecommerce_cod

# Prisma Studio (GUI)
cd backend
npx prisma studio
```

---

## Security

### Best Practices

1. **Environment Variables**
   - Never commit `.env` files with real credentials
   - Use strong, random secrets for JWT and database passwords
   - Rotate secrets regularly

2. **SSL/TLS**
   - Always use HTTPS in production
   - Use Let's Encrypt for free SSL certificates
   - Configure strong cipher suites

3. **Database Security**
   - Use connection pooling
   - Enable SSL for database connections
   - Regular backups
   - Principle of least privilege for database users

4. **Container Security**
   - Run containers as non-root users
   - Use official base images
   - Scan images for vulnerabilities (Trivy)
   - Keep images updated

5. **Network Security**
   - Use internal networks for service communication
   - Don't expose database/Redis ports publicly
   - Configure firewall rules

### SSL Certificate Setup

```bash
# Using Let's Encrypt (Certbot)
sudo certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com

# Copy certificates
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem ./nginx/ssl/cert.pem
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem ./nginx/ssl/key.pem

# Set permissions
chmod 644 ./nginx/ssl/cert.pem
chmod 600 ./nginx/ssl/key.pem
```

---

## Scaling

### Horizontal Scaling

**Docker Compose:**
```bash
docker-compose up -d --scale backend=3
```

**Kubernetes:**
```bash
kubectl scale deployment backend --replicas=5 -n ecommerce-cod
```

**Auto-scaling (Kubernetes):**
- HPA configurations are in `k8s/hpa.yaml`
- Scales based on CPU and memory usage
- Min replicas: 3 (backend), 2 (frontend)
- Max replicas: 10 (backend), 5 (frontend)

### Vertical Scaling

Update resource limits in:
- Docker Compose: `docker-compose.prod.yml`
- Kubernetes: `k8s/*-deployment.yaml`

### Database Scaling

1. **Connection Pooling**: Configure in Prisma
2. **Read Replicas**: Set up PostgreSQL replication
3. **Managed Database**: Use AWS RDS, Google Cloud SQL, etc.

### Caching Strategy

- Redis for session storage
- Application-level caching
- CDN for static assets

---

## Troubleshooting

### Common Issues

#### 1. Backend won't start
```bash
# Check logs
docker-compose logs backend

# Common causes:
# - Database connection failed
# - Redis connection failed
# - Missing environment variables

# Solutions:
# Verify database is running
docker-compose ps postgres

# Check environment variables
docker-compose exec backend env | grep DATABASE_URL
```

#### 2. Database connection errors
```bash
# Check PostgreSQL is running
docker-compose ps postgres

# Test connection
docker exec ecommerce-cod-postgres pg_isready -U postgres

# Check credentials
docker-compose exec backend env | grep POSTGRES
```

#### 3. Migration failures
```bash
# Check migration status
cd backend
npx prisma migrate status

# Reset database (development only!)
npx prisma migrate reset

# Deploy specific migration
npx prisma migrate deploy
```

#### 4. Docker build failures
```bash
# Clear Docker cache
docker builder prune -a

# Rebuild without cache
docker-compose build --no-cache backend
```

#### 5. Health check failures
```bash
# Run detailed health check
./scripts/health-check.sh local

# Check individual services
curl http://localhost:3000/health/detailed
```

### Debugging Commands

```bash
# View all container logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f backend

# Execute shell in container
docker-compose exec backend sh

# View container resource usage
docker stats

# Inspect container
docker inspect ecommerce-cod-backend

# View network configuration
docker network ls
docker network inspect ecommerce-network
```

### Performance Issues

1. **High memory usage**
   - Check for memory leaks
   - Increase container memory limits
   - Optimize database queries

2. **Slow response times**
   - Check database query performance
   - Add database indexes
   - Implement caching
   - Scale horizontally

3. **High CPU usage**
   - Profile application
   - Optimize hot code paths
   - Scale horizontally

---

## Deployment Checklist

### Pre-Deployment
- [ ] All tests passing
- [ ] Code reviewed and approved
- [ ] Environment variables configured
- [ ] SSL certificates ready
- [ ] Database backup created
- [ ] Monitoring configured
- [ ] Alerting tested

### Deployment
- [ ] Deploy to staging first
- [ ] Run smoke tests on staging
- [ ] Monitor for 24 hours
- [ ] Get approval for production
- [ ] Deploy to production
- [ ] Run health checks
- [ ] Monitor metrics

### Post-Deployment
- [ ] Verify all services healthy
- [ ] Check error rates
- [ ] Review logs
- [ ] Monitor performance
- [ ] Notify team
- [ ] Update documentation

---

## Quick Reference

### Essential Commands

```bash
# Development setup
./scripts/setup-dev.sh

# Start all services
docker-compose up -d

# Deploy to production
./scripts/deploy-production.sh v1.0.0

# Create database backup
./scripts/database-backup.sh

# Health check
./scripts/health-check.sh production

# Rollback deployment
./scripts/rollback.sh production

# View logs
docker-compose logs -f backend

# Run migrations
./scripts/run-migrations.sh
```

### Service URLs (Production)

- **Frontend**: https://yourdomain.com
- **Backend API**: https://api.yourdomain.com
- **Prometheus**: http://monitoring.yourdomain.com:9090
- **Grafana**: http://monitoring.yourdomain.com:3001

---

## Support

For issues and questions:
- GitHub Issues: [Repository Issues](https://github.com/your-org/ecommerce-cod-admin/issues)
- Documentation: [Project Docs](https://github.com/your-org/ecommerce-cod-admin/docs)

---

**Last Updated**: 2025-01-08
**Version**: 1.0.0
