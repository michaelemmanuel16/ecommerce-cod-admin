# DevOps Infrastructure - Quick Reference

Complete DevOps infrastructure for the E-commerce COD Admin Dashboard.

## Directory Structure

```
ecommerce-cod-admin/
├── .github/
│   └── workflows/
│       ├── backend-ci.yml          # Backend CI/CD pipeline
│       ├── frontend-ci.yml         # Frontend CI/CD pipeline
│       └── security-audit.yml      # Security scanning
├── backend/
│   ├── Dockerfile                  # Backend Docker image
│   └── .dockerignore               # Docker ignore patterns
├── frontend/
│   ├── Dockerfile                  # Frontend Docker image
│   ├── nginx.conf                  # Frontend Nginx config
│   └── .dockerignore               # Docker ignore patterns
├── k8s/
│   ├── namespace.yaml              # Kubernetes namespace
│   ├── configmap.yaml              # Configuration
│   ├── secrets.yaml                # Secrets template
│   ├── postgres-deployment.yaml    # PostgreSQL deployment
│   ├── redis-deployment.yaml       # Redis deployment
│   ├── backend-deployment.yaml     # Backend deployment
│   ├── frontend-deployment.yaml    # Frontend deployment
│   ├── ingress.yaml                # Ingress configuration
│   └── hpa.yaml                    # Auto-scaling config
├── monitoring/
│   ├── docker-compose.monitoring.yml
│   ├── prometheus/
│   │   ├── prometheus.yml          # Prometheus config
│   │   ├── alertmanager.yml        # Alert config
│   │   └── rules/
│   │       └── alerts.yml          # Alert rules
│   └── grafana/
│       ├── provisioning/
│       │   ├── datasources/
│       │   │   └── prometheus.yml
│       │   └── dashboards/
│       │       └── default.yml
│       └── dashboards/
│           └── application-dashboard.json
├── nginx/
│   ├── Dockerfile                  # Nginx Docker image
│   ├── nginx.conf                  # Production Nginx config
│   └── ssl/
│       └── README.md               # SSL setup guide
├── scripts/
│   ├── setup-dev.sh                # Development setup
│   ├── deploy-staging.sh           # Staging deployment
│   ├── deploy-production.sh        # Production deployment
│   ├── rollback.sh                 # Rollback script
│   ├── health-check.sh             # Health verification
│   ├── database-backup.sh          # Database backup
│   ├── database-restore.sh         # Database restore
│   ├── run-migrations.sh           # Migration runner
│   └── init-db.sh                  # DB initialization
├── docker-compose.yml              # Development environment
├── docker-compose.prod.yml         # Production environment
├── .env.example                    # Environment template
├── .env.development                # Development config
├── .env.staging                    # Staging config
├── .env.production                 # Production template
├── .gitignore                      # Git ignore patterns
├── DEVOPS.md                       # Complete DevOps guide
├── DEPLOYMENT_OPTIONS.md           # Deployment strategies
└── DEVOPS_SUMMARY.md               # This summary
```

---

## Quick Start Commands

### Local Development
```bash
# One-command setup
./scripts/setup-dev.sh

# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Production Deployment

**Option 1: Docker Compose**
```bash
# Deploy
docker-compose -f docker-compose.prod.yml up -d

# Run migrations
./scripts/run-migrations.sh

# Health check
./scripts/health-check.sh production
```

**Option 2: Kubernetes**
```bash
# Deploy all resources
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/postgres-deployment.yaml
kubectl apply -f k8s/redis-deployment.yaml
kubectl apply -f k8s/backend-deployment.yaml
kubectl apply -f k8s/frontend-deployment.yaml
kubectl apply -f k8s/ingress.yaml
kubectl apply -f k8s/hpa.yaml

# Or deploy all at once
kubectl apply -k k8s/

# Check status
kubectl get pods -n ecommerce-cod
```

**Option 3: Automated Scripts**
```bash
# Staging
./scripts/deploy-staging.sh

# Production
./scripts/deploy-production.sh v1.0.0
```

---

## Essential Scripts

### Development Setup
```bash
./scripts/setup-dev.sh
```
Sets up complete development environment in one command.

### Database Management
```bash
# Backup
./scripts/database-backup.sh

# Restore
./scripts/database-restore.sh backups/backup_file.dump

# Migrations
./scripts/run-migrations.sh
```

### Deployment
```bash
# Staging
./scripts/deploy-staging.sh

# Production
./scripts/deploy-production.sh v1.0.0

# Rollback
./scripts/rollback.sh production
```

### Health Checks
```bash
# All services
./scripts/health-check.sh production

# Individual endpoints
curl http://localhost:3000/health
curl http://localhost:3000/ready
curl http://localhost:3000/live
curl http://localhost:3000/health/detailed
curl http://localhost:3000/metrics
```

---

## Docker Commands

### Build & Run
```bash
# Build services
docker-compose build

# Start services
docker-compose up -d

# Scale services
docker-compose up -d --scale backend=3

# Restart specific service
docker-compose restart backend
```

### Logs & Debugging
```bash
# View all logs
docker-compose logs -f

# View specific service
docker-compose logs -f backend

# Execute command in container
docker-compose exec backend sh

# View resource usage
docker stats
```

### Cleanup
```bash
# Stop and remove containers
docker-compose down

# Remove volumes
docker-compose down -v

# Clean up system
docker system prune -a
```

---

## Kubernetes Commands

### Deployment
```bash
# Apply configuration
kubectl apply -f k8s/

# Update image
kubectl set image deployment/backend backend=new-image:tag -n ecommerce-cod

# Scale deployment
kubectl scale deployment backend --replicas=5 -n ecommerce-cod
```

### Monitoring
```bash
# Get pods
kubectl get pods -n ecommerce-cod

# View logs
kubectl logs -f deployment/backend -n ecommerce-cod

# Describe pod
kubectl describe pod <pod-name> -n ecommerce-cod

# Port forward
kubectl port-forward service/backend-service 3000:3000 -n ecommerce-cod
```

### Rollback
```bash
# View rollout history
kubectl rollout history deployment/backend -n ecommerce-cod

# Rollback to previous version
kubectl rollout undo deployment/backend -n ecommerce-cod

# Rollback to specific revision
kubectl rollout undo deployment/backend --to-revision=2 -n ecommerce-cod
```

---

## Monitoring

### Start Monitoring Stack
```bash
cd monitoring
docker-compose -f docker-compose.monitoring.yml up -d
```

### Access Dashboards
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001 (admin/admin)
- **Alertmanager**: http://localhost:9093

### Available Metrics
- Request rates and response times
- Error rates (4xx, 5xx)
- CPU and memory usage
- Database connections
- Redis operations
- System metrics

---

## CI/CD Pipeline

### GitHub Actions Workflows

**Backend CI/CD** (`backend-ci.yml`)
- Triggers: Push/PR to main/develop
- Jobs: Lint → Test → Build → Deploy
- Deploys to staging (develop) or production (main)

**Frontend CI/CD** (`frontend-ci.yml`)
- Triggers: Push/PR to main/develop
- Jobs: Lint → Test → Build → Deploy
- Builds optimized production bundle

**Security Audit** (`security-audit.yml`)
- Triggers: Push, PR, weekly schedule
- Scans: npm audit, Trivy, CodeQL, secrets

### Required GitHub Secrets
- `GITHUB_TOKEN` (automatically provided)
- `VITE_API_URL` - Frontend API URL
- `VITE_WS_URL` - Frontend WebSocket URL

---

## Environment Variables

### Development
```bash
cp .env.development .env
```

### Staging
```bash
cp .env.staging .env
# Update with staging values
```

### Production
```bash
cp .env.production .env
# Update with production secrets
```

### Key Variables
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- `JWT_SECRET`, `JWT_REFRESH_SECRET`
- `CORS_ORIGIN` - Allowed origins
- `SMTP_*` - Email configuration

---

## Security Checklist

- [ ] Update all default passwords
- [ ] Generate strong JWT secrets
- [ ] Configure SSL/TLS certificates
- [ ] Set up firewall rules
- [ ] Enable rate limiting
- [ ] Configure CORS properly
- [ ] Set up backup encryption
- [ ] Enable monitoring alerts
- [ ] Regular security scans
- [ ] Update dependencies regularly

---

## Troubleshooting

### Service Won't Start
```bash
# Check logs
docker-compose logs backend

# Check environment
docker-compose exec backend env

# Verify database connection
docker-compose exec postgres pg_isready
```

### Database Issues
```bash
# Check PostgreSQL
docker-compose ps postgres

# Access database
docker-compose exec postgres psql -U postgres

# Check migrations
cd backend && npx prisma migrate status
```

### Performance Issues
```bash
# Check resource usage
docker stats

# View detailed metrics
curl http://localhost:3000/metrics

# Check Grafana dashboards
open http://localhost:3001
```

---

## Backup & Recovery

### Automated Backups
- Run daily (can be configured in cron)
- Stored in `./backups/`
- Retention: 7 days (configurable)

### Manual Backup
```bash
./scripts/database-backup.sh
```

### Restore from Backup
```bash
# List backups
ls -lh backups/

# Restore
./scripts/database-restore.sh backups/backup_file.dump
```

---

## Scaling

### Horizontal Scaling

**Docker Compose**
```bash
docker-compose up -d --scale backend=3
```

**Kubernetes**
```bash
kubectl scale deployment backend --replicas=5 -n ecommerce-cod
```

### Auto-Scaling (Kubernetes)
- Configured in `k8s/hpa.yaml`
- Based on CPU/memory usage
- Min/max replicas defined per service

---

## Cost Estimates

| Setup | Monthly Cost | Use Case |
|-------|-------------|----------|
| Single Server | $15 | Development, Small |
| Docker Swarm | $50 | Medium scale, HA |
| Self-Managed K8s | $150 | Enterprise |
| Managed K8s | $250-500 | Production |
| PaaS | $50-150 | Quick deployment |

---

## Support Resources

### Documentation
- **DEVOPS.md** - Complete DevOps guide (comprehensive)
- **DEPLOYMENT_OPTIONS.md** - Deployment strategies
- **DEVOPS_SUMMARY.md** - Infrastructure summary
- **README.md** - Project overview

### External Resources
- [Docker Documentation](https://docs.docker.com/)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Prometheus Documentation](https://prometheus.io/docs/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)

---

## Next Steps

1. **Immediate**
   - [ ] Review environment variables
   - [ ] Set up SSL certificates
   - [ ] Configure GitHub secrets
   - [ ] Test in staging

2. **Short Term**
   - [ ] Set up automated backups
   - [ ] Configure monitoring alerts
   - [ ] Run security audit
   - [ ] Performance testing

3. **Long Term**
   - [ ] Implement auto-scaling
   - [ ] Set up disaster recovery
   - [ ] Optimize costs
   - [ ] Advanced monitoring

---

## Contact & Support

For issues or questions:
- **Issues**: GitHub Issues
- **Documentation**: Project Wiki
- **Email**: devops@yourdomain.com

---

**Version**: 1.0.0
**Last Updated**: 2025-01-08
**Status**: Production Ready ✅
