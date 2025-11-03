# Production Deployment Checklist

## Pre-Deployment Verification

### 1. Security ✓
- [ ] All environment variables use strong, unique secrets (32+ characters)
- [ ] No default secrets in code
- [ ] JWT_SECRET and JWT_REFRESH_SECRET are different
- [ ] WEBHOOK_SECRET is configured
- [ ] Database credentials are secure
- [ ] Redis password is set
- [ ] SSL/TLS certificates are valid
- [ ] CORS origins are properly configured
- [ ] Rate limiting is enabled
- [ ] Helmet security headers are active
- [ ] All dependencies are updated and audited (`npm audit`)

### 2. Environment Configuration ✓
- [ ] All `.env` variables are set correctly
- [ ] DATABASE_URL points to production database
- [ ] REDIS_URL points to production Redis
- [ ] FRONTEND_URL is set to production domain
- [ ] NODE_ENV=production
- [ ] Port configurations are correct
- [ ] API keys for external services configured

### 3. Database ✓
- [ ] Production database created
- [ ] Migrations executed successfully
- [ ] Database indexes verified
- [ ] Connection pooling configured
- [ ] Backup strategy in place
- [ ] Database user has appropriate permissions only

### 4. Testing ✓
- [ ] All backend tests passing (`npm test`)
- [ ] All frontend tests passing (`npm test`)
- [ ] Integration tests completed
- [ ] API endpoints manually tested
- [ ] Authentication flow verified
- [ ] Webhook integration tested
- [ ] Workflow automation tested
- [ ] Load testing completed (100+ concurrent users)

### 5. Performance ✓
- [ ] Frontend bundle size < 500KB gzipped
- [ ] API response times < 200ms (p95)
- [ ] Database queries < 50ms (p95)
- [ ] Lighthouse score > 90
- [ ] Images optimized
- [ ] Code splitting implemented
- [ ] Redis caching enabled and working
- [ ] Compression enabled

### 6. Monitoring & Logging ✓
- [ ] Prometheus metrics collecting
- [ ] Grafana dashboards configured
- [ ] Alert rules configured
- [ ] Email/Slack notifications set up
- [ ] Log aggregation working
- [ ] Error tracking configured
- [ ] Health check endpoints responding
- [ ] Uptime monitoring configured

### 7. Backup & Recovery ✓
- [ ] Automated database backups scheduled
- [ ] Backup retention policy configured (7 days)
- [ ] Backup restore tested successfully
- [ ] Disaster recovery plan documented
- [ ] Database backups stored off-site

### 8. DevOps & Infrastructure ✓
- [ ] CI/CD pipeline working
- [ ] Docker images built and pushed
- [ ] Kubernetes manifests applied (if using K8s)
- [ ] Load balancer configured
- [ ] Auto-scaling configured
- [ ] DNS records updated
- [ ] CDN configured (if using)

### 9. Documentation ✓
- [ ] README.md complete
- [ ] API documentation complete
- [ ] Deployment guide reviewed
- [ ] User guide available
- [ ] Developer guide available
- [ ] Runbook created

### 10. Legal & Compliance ✓
- [ ] Privacy policy in place
- [ ] Terms of service available
- [ ] GDPR compliance reviewed (if applicable)
- [ ] Data retention policy defined
- [ ] Cookie policy configured

## Deployment Steps

1. **Final Code Review**
   ```bash
   git status
   git log -5
   ```

2. **Run Tests**
   ```bash
   cd backend && npm test
   cd frontend && npm test
   ```

3. **Build for Production**
   ```bash
   cd backend && npm run build
   cd frontend && npm run build
   ```

4. **Deploy Backend**
   ```bash
   ./scripts/deploy-production.sh v1.0.0
   ```

5. **Deploy Frontend**
   ```bash
   # Upload dist/ to hosting service or deploy via CI/CD
   ```

6. **Verify Deployment**
   ```bash
   ./scripts/health-check.sh
   ```

7. **Monitor for First 24 Hours**
   - Watch error rates
   - Monitor response times
   - Check resource usage
   - Verify cache hit ratio

## Post-Deployment Verification

- [ ] Application loads successfully
- [ ] Login works
- [ ] Can create orders
- [ ] Kanban board functioning
- [ ] Workflows executing
- [ ] Webhooks receiving data
- [ ] Real-time updates working (Socket.io)
- [ ] Email notifications working
- [ ] SMS notifications working (if enabled)
- [ ] Mobile responsive
- [ ] All roles/permissions working
- [ ] Analytics dashboard showing data

## Rollback Plan

If issues are detected:

```bash
./scripts/rollback.sh v0.9.0
```

## Emergency Contacts

- DevOps Engineer: [Contact Info]
- Backend Developer: [Contact Info]
- Database Admin: [Contact Info]
- Security Team: [Contact Info]

## Success Criteria

- [ ] Zero critical errors in first hour
- [ ] Response time < 200ms
- [ ] Error rate < 0.1%
- [ ] All health checks passing
- [ ] No security alerts
- [ ] Monitoring showing green status

---

**Deployment Date**: __________
**Deployed By**: __________
**Version**: v1.0.0
**Status**: ☐ Success  ☐ Rollback Required
