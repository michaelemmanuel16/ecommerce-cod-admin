# Support and Maintenance Guide

> **E-Commerce COD Admin Dashboard - Operations & Support Manual**
> **Version:** 1.0.0
> **Last Updated:** October 8, 2025

---

## Table of Contents

1. [Support Overview](#support-overview)
2. [Common Issues & Fixes](#common-issues--fixes)
3. [Operations Runbook](#operations-runbook)
4. [Monitoring & Alerting](#monitoring--alerting)
5. [Backup & Recovery](#backup--recovery)
6. [Performance Optimization](#performance-optimization)
7. [Security Maintenance](#security-maintenance)
8. [Database Maintenance](#database-maintenance)
9. [Incident Response](#incident-response)
10. [Maintenance Schedule](#maintenance-schedule)

---

## Support Overview

### Support Tiers

#### Tier 1 - User Support
- **Scope**: User questions, basic troubleshooting
- **Response Time**: 1-4 hours
- **Channels**: Email, chat, knowledge base
- **Handled By**: Support team

#### Tier 2 - Technical Support
- **Scope**: Application issues, bugs, configuration
- **Response Time**: 30 minutes - 2 hours
- **Channels**: Support ticket, phone
- **Handled By**: Technical team

#### Tier 3 - Engineering Support
- **Scope**: Critical issues, system failures, code bugs
- **Response Time**: 15 minutes - 1 hour
- **Channels**: On-call, escalation
- **Handled By**: Engineering team

### Contact Information

| Role | Email | Phone | Hours |
|------|-------|-------|-------|
| User Support | support@example.com | +1-XXX-XXX-XXXX | 24/7 |
| Technical Support | tech@example.com | +1-XXX-XXX-XXXX | 24/7 |
| Engineering | oncall@example.com | +1-XXX-XXX-XXXX | 24/7 |
| Management | admin@example.com | +1-XXX-XXX-XXXX | Business hours |

---

## Common Issues & Fixes

### 1. Application Issues

#### Issue: Users Cannot Log In

**Symptoms:**
- Login page shows "Invalid credentials" even with correct password
- Login button not responding
- Redirect loop after login

**Diagnosis:**
```bash
# Check backend logs
tail -f backend/logs/error.log

# Verify JWT secret is set
echo $JWT_SECRET

# Check database connectivity
psql -U postgres -d ecommerce_cod -c "SELECT 1"
```

**Solutions:**

1. **Invalid credentials (common user error)**
   ```bash
   # Reset user password in database
   psql -U postgres ecommerce_cod
   # Update password hash for user
   UPDATE users SET password = '$2b$10$...' WHERE email = 'user@example.com';
   ```

2. **JWT secret mismatch**
   ```bash
   # Verify environment variable
   echo $JWT_SECRET
   # If missing, set it
   export JWT_SECRET="your-secret-key"
   # Restart backend
   pm2 restart backend
   ```

3. **Session/cookie issues**
   - Clear browser cache and cookies
   - Use incognito mode to test
   - Check CORS settings in backend

#### Issue: Orders Not Updating in Kanban

**Symptoms:**
- Drag and drop not working
- Orders don't move between columns
- Status updates fail

**Diagnosis:**
```bash
# Check WebSocket connection
curl http://localhost:3000/socket.io/

# Check backend logs
tail -f backend/logs/combined.log | grep "socket"

# Verify Redis is running (if used)
redis-cli ping
```

**Solutions:**

1. **WebSocket connection failed**
   ```bash
   # Restart Socket.io server
   pm2 restart backend

   # Check firewall rules
   sudo ufw status
   ```

2. **Database update failed**
   ```bash
   # Check database logs
   tail -f /var/log/postgresql/postgresql-15-main.log

   # Test order update
   curl -X PATCH http://localhost:3000/api/orders/ORDER_ID/status \
     -H "Authorization: Bearer TOKEN" \
     -d '{"status": "confirmed"}'
   ```

3. **Frontend caching issue**
   - Hard refresh browser (Ctrl+Shift+R)
   - Clear application cache
   - Rebuild frontend

#### Issue: Workflow Not Executing

**Symptoms:**
- Workflows don't trigger on events
- No execution logs
- Actions not performed

**Diagnosis:**
```bash
# Check workflow queue
redis-cli
KEYS workflow:*

# Check Bull queue status
curl http://localhost:3000/api/workflows/queue-status

# Check logs
tail -f backend/logs/workflow.log
```

**Solutions:**

1. **Queue not running**
   ```bash
   # Restart workflow processor
   pm2 restart workflow-worker

   # Check queue connection
   redis-cli ping
   ```

2. **Workflow disabled**
   ```sql
   -- Check workflow status
   SELECT id, name, active FROM workflows WHERE id = 'WORKFLOW_ID';

   -- Enable workflow
   UPDATE workflows SET active = true WHERE id = 'WORKFLOW_ID';
   ```

3. **Event trigger not firing**
   ```bash
   # Check event emissions
   tail -f backend/logs/events.log

   # Manually trigger workflow
   curl -X POST http://localhost:3000/api/workflows/WORKFLOW_ID/execute \
     -H "Authorization: Bearer TOKEN"
   ```

### 2. Performance Issues

#### Issue: Slow API Response Times

**Symptoms:**
- API responses taking >1 second
- Timeouts on requests
- High server load

**Diagnosis:**
```bash
# Check server resources
top
htop

# Check database performance
psql -U postgres ecommerce_cod
SELECT * FROM pg_stat_activity;

# Check slow queries
SELECT query, mean_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

**Solutions:**

1. **Database query optimization**
   ```sql
   -- Add missing indexes
   CREATE INDEX idx_orders_status ON orders(status);
   CREATE INDEX idx_orders_created_at ON orders(created_at);

   -- Analyze tables
   ANALYZE orders;
   ANALYZE customers;
   ```

2. **Enable caching**
   ```bash
   # Start Redis
   redis-server

   # Update backend config to use cache
   export REDIS_URL="redis://localhost:6379"
   pm2 restart backend
   ```

3. **Scale resources**
   ```bash
   # Add more workers (PM2)
   pm2 scale backend 4

   # Increase database connections
   # Edit postgresql.conf
   max_connections = 200
   ```

#### Issue: Frontend Loading Slow

**Symptoms:**
- Long initial load time (>5 seconds)
- White screen on first visit
- Large bundle sizes

**Diagnosis:**
```bash
# Check bundle size
cd frontend
npm run build
ls -lh dist/assets/

# Run Lighthouse audit
lighthouse http://localhost:5173 --view
```

**Solutions:**

1. **Optimize bundle**
   ```bash
   # Analyze bundle
   npm run build -- --analyze

   # Code splitting already implemented
   # Check for heavy dependencies
   npm ls --all --json | jq '.dependencies | keys'
   ```

2. **Enable compression**
   ```nginx
   # nginx.conf
   gzip on;
   gzip_vary on;
   gzip_min_length 1024;
   gzip_types text/plain text/css application/json application/javascript;
   ```

3. **Use CDN for assets**
   ```bash
   # Upload assets to CDN
   aws s3 sync dist/assets s3://your-cdn-bucket/

   # Update vite.config.ts
   base: 'https://cdn.example.com/'
   ```

### 3. Database Issues

#### Issue: Database Connection Pool Exhausted

**Symptoms:**
- "Too many connections" errors
- Application hangs
- Cannot connect to database

**Diagnosis:**
```sql
-- Check active connections
SELECT count(*) FROM pg_stat_activity;

-- Check connection limit
SHOW max_connections;

-- See who's connected
SELECT pid, usename, application_name, state
FROM pg_stat_activity;
```

**Solutions:**

1. **Kill idle connections**
   ```sql
   -- Kill idle connections
   SELECT pg_terminate_backend(pid)
   FROM pg_stat_activity
   WHERE state = 'idle'
   AND state_change < now() - interval '5 minutes';
   ```

2. **Increase connection limit**
   ```bash
   # Edit postgresql.conf
   max_connections = 200

   # Restart PostgreSQL
   sudo systemctl restart postgresql
   ```

3. **Configure connection pooling**
   ```bash
   # Use PgBouncer
   sudo apt install pgbouncer

   # Configure pgbouncer.ini
   [databases]
   ecommerce_cod = host=localhost dbname=ecommerce_cod

   [pgbouncer]
   pool_mode = transaction
   max_client_conn = 1000
   default_pool_size = 25
   ```

### 4. Deployment Issues

#### Issue: Docker Container Won't Start

**Symptoms:**
- Container exits immediately
- "Error: Cannot find module" errors
- Port already in use

**Diagnosis:**
```bash
# Check container logs
docker logs backend-container

# Check running containers
docker ps -a

# Check port usage
lsof -i :3000
```

**Solutions:**

1. **Port conflict**
   ```bash
   # Kill process on port
   kill -9 $(lsof -ti:3000)

   # Or use different port
   docker run -p 3001:3000 backend-image
   ```

2. **Missing environment variables**
   ```bash
   # Check env vars in container
   docker exec backend-container env | grep DATABASE_URL

   # Pass env file
   docker run --env-file .env.production backend-image
   ```

3. **Dependencies not installed**
   ```bash
   # Rebuild image
   docker build --no-cache -t backend-image ./backend

   # Verify node_modules
   docker run backend-image ls -la node_modules
   ```

---

## Operations Runbook

### Daily Operations

#### Morning Checks (9:00 AM)

```bash
#!/bin/bash
# daily-morning-check.sh

echo "=== Daily Morning Health Check ==="

# 1. Check application status
echo "Checking application status..."
pm2 status

# 2. Check database
echo "Checking database..."
psql -U postgres -d ecommerce_cod -c "SELECT COUNT(*) FROM orders WHERE created_at >= CURRENT_DATE;"

# 3. Check disk space
echo "Checking disk space..."
df -h

# 4. Check error logs
echo "Checking for errors in last 24 hours..."
grep -i "error" backend/logs/error.log | tail -20

# 5. Check backup status
echo "Checking backup status..."
ls -lht /backups/ | head -5

# 6. System resources
echo "System resources..."
free -h
uptime

echo "=== Health Check Complete ==="
```

#### Evening Checks (6:00 PM)

```bash
#!/bin/bash
# daily-evening-check.sh

echo "=== Daily Evening Summary ==="

# 1. Today's order count
echo "Today's orders:"
psql -U postgres -d ecommerce_cod -c \
  "SELECT COUNT(*) as total_orders,
   SUM(total_amount) as total_revenue
   FROM orders
   WHERE created_at >= CURRENT_DATE;"

# 2. Performance metrics
echo "API performance today:"
grep "GET\|POST\|PUT\|DELETE" backend/logs/access.log | \
  awk '{print $10}' | \
  awk '{sum+=$1; count++} END {print "Avg response time: " sum/count "ms"}'

# 3. Error summary
echo "Errors today:"
grep -c "ERROR" backend/logs/error.log

# 4. Active users
echo "Active users:"
psql -U postgres -d ecommerce_cod -c \
  "SELECT COUNT(DISTINCT user_id)
   FROM sessions
   WHERE last_activity >= CURRENT_DATE;"

echo "=== Evening Summary Complete ==="
```

### Weekly Maintenance

#### Sunday Maintenance (2:00 AM)

```bash
#!/bin/bash
# weekly-maintenance.sh

echo "=== Weekly Maintenance Started ==="

# 1. Database vacuum
echo "Running database vacuum..."
psql -U postgres -d ecommerce_cod -c "VACUUM ANALYZE;"

# 2. Clear old logs (keep 30 days)
echo "Cleaning old logs..."
find backend/logs/ -name "*.log" -mtime +30 -delete

# 3. Clear old uploads (keep 90 days)
echo "Cleaning old uploads..."
find backend/uploads/ -mtime +90 -delete

# 4. Update statistics
echo "Updating database statistics..."
psql -U postgres -d ecommerce_cod -c "ANALYZE;"

# 5. Check for updates
echo "Checking for security updates..."
npm audit

# 6. Restart services
echo "Restarting services..."
pm2 restart all

echo "=== Weekly Maintenance Complete ==="
```

### Monthly Operations

#### First Sunday of Month (3:00 AM)

```bash
#!/bin/bash
# monthly-maintenance.sh

echo "=== Monthly Maintenance Started ==="

# 1. Full database backup
echo "Creating full database backup..."
pg_dump -U postgres ecommerce_cod | gzip > \
  /backups/monthly/ecommerce_cod_$(date +%Y%m).sql.gz

# 2. Archive old orders (>6 months)
echo "Archiving old orders..."
psql -U postgres -d ecommerce_cod <<EOF
  INSERT INTO orders_archive
  SELECT * FROM orders
  WHERE created_at < NOW() - INTERVAL '6 months';

  DELETE FROM orders
  WHERE created_at < NOW() - INTERVAL '6 months';
EOF

# 3. Generate monthly report
echo "Generating monthly report..."
node scripts/generate-monthly-report.js

# 4. Security audit
echo "Running security audit..."
npm audit --audit-level=moderate

# 5. Performance review
echo "Reviewing performance metrics..."
psql -U postgres -d ecommerce_cod -c \
  "SELECT query, calls, mean_exec_time
   FROM pg_stat_statements
   ORDER BY mean_exec_time DESC
   LIMIT 10;"

echo "=== Monthly Maintenance Complete ==="
```

---

## Monitoring & Alerting

### Key Metrics to Monitor

#### Application Metrics

| Metric | Threshold | Alert Level |
|--------|-----------|-------------|
| Response Time | >500ms | Warning |
| Response Time | >1000ms | Critical |
| Error Rate | >1% | Warning |
| Error Rate | >5% | Critical |
| CPU Usage | >70% | Warning |
| CPU Usage | >90% | Critical |
| Memory Usage | >80% | Warning |
| Memory Usage | >95% | Critical |

#### Database Metrics

| Metric | Threshold | Alert Level |
|--------|-----------|-------------|
| Connection Pool | >80% | Warning |
| Connection Pool | >95% | Critical |
| Query Time | >100ms avg | Warning |
| Query Time | >500ms avg | Critical |
| Disk Usage | >80% | Warning |
| Disk Usage | >95% | Critical |
| Replication Lag | >10s | Warning |
| Replication Lag | >60s | Critical |

### Prometheus Alerts

```yaml
# alerts.yml
groups:
  - name: application
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value }}%"

      - alert: SlowResponseTime
        expr: http_request_duration_seconds{quantile="0.95"} > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Slow response time"
          description: "95th percentile is {{ $value }}s"

      - alert: DatabaseConnectionPool
        expr: pg_connections_active / pg_connections_max > 0.9
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Database connection pool nearly exhausted"
          description: "{{ $value }}% of connections in use"
```

### Alert Channels

```yaml
# alertmanager.yml
route:
  receiver: 'team-notifications'
  group_by: ['alertname', 'severity']
  group_wait: 10s
  group_interval: 5m
  repeat_interval: 3h

  routes:
    - match:
        severity: critical
      receiver: 'pagerduty'
    - match:
        severity: warning
      receiver: 'slack'

receivers:
  - name: 'team-notifications'
    email_configs:
      - to: 'team@example.com'

  - name: 'pagerduty'
    pagerduty_configs:
      - service_key: '<pagerduty-key>'

  - name: 'slack'
    slack_configs:
      - api_url: '<slack-webhook-url>'
        channel: '#alerts'
```

---

## Backup & Recovery

### Backup Strategy

#### Database Backups

**Daily Backups (2:00 AM)**
```bash
#!/bin/bash
# database-backup.sh

DATE=$(date +%Y%m%d)
BACKUP_DIR="/backups/daily"
DB_NAME="ecommerce_cod"

# Create backup
pg_dump -U postgres $DB_NAME | gzip > $BACKUP_DIR/${DB_NAME}_${DATE}.sql.gz

# Keep last 7 days
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete

# Upload to S3
aws s3 cp $BACKUP_DIR/${DB_NAME}_${DATE}.sql.gz \
  s3://backup-bucket/database/daily/

echo "Backup complete: ${DB_NAME}_${DATE}.sql.gz"
```

**Weekly Backups (Sunday 3:00 AM)**
```bash
# Copy Sunday backup to weekly folder
cp /backups/daily/${DB_NAME}_${DATE}.sql.gz \
   /backups/weekly/

# Keep last 4 weeks
find /backups/weekly -name "*.sql.gz" -mtime +28 -delete
```

**Monthly Backups (1st of month 4:00 AM)**
```bash
# Copy to monthly folder
cp /backups/daily/${DB_NAME}_${DATE}.sql.gz \
   /backups/monthly/

# Keep last 12 months
find /backups/monthly -name "*.sql.gz" -mtime +365 -delete
```

#### Application Backups

**Files to Backup:**
- Uploaded files: `/backend/uploads/`
- Configuration: `.env files (encrypted)`
- Certificates: `/etc/ssl/certs/`
- Logs: `/backend/logs/` (if needed)

```bash
#!/bin/bash
# app-backup.sh

DATE=$(date +%Y%m%d)
BACKUP_DIR="/backups/application"

# Backup uploads
tar -czf $BACKUP_DIR/uploads_${DATE}.tar.gz backend/uploads/

# Backup configs (encrypted)
tar -czf - config/ | \
  openssl enc -aes-256-cbc -salt -out $BACKUP_DIR/config_${DATE}.tar.gz.enc

# Upload to S3
aws s3 sync $BACKUP_DIR/ s3://backup-bucket/application/
```

### Recovery Procedures

#### Database Recovery

**Full Database Restore:**
```bash
#!/bin/bash
# database-restore.sh

BACKUP_FILE=$1  # e.g., ecommerce_cod_20251008.sql.gz

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: ./database-restore.sh <backup-file>"
  exit 1
fi

# Stop application
pm2 stop all

# Drop existing database
psql -U postgres -c "DROP DATABASE IF EXISTS ecommerce_cod;"
psql -U postgres -c "CREATE DATABASE ecommerce_cod;"

# Restore backup
gunzip < $BACKUP_FILE | psql -U postgres ecommerce_cod

# Run migrations if needed
cd backend
npx prisma migrate deploy

# Start application
pm2 start all

echo "Database restored from: $BACKUP_FILE"
```

**Point-in-Time Recovery (PITR):**
```bash
# Requires WAL archiving enabled

# Restore to specific time
pg_restore --target-time '2025-10-08 14:30:00' \
  -d ecommerce_cod /backups/base_backup

# Update recovery.conf
restore_command = 'cp /backups/wal/%f %p'
recovery_target_time = '2025-10-08 14:30:00'
recovery_target_action = 'promote'
```

---

## Maintenance Schedule

### Daily Schedule

| Time | Task | Duration | Script |
|------|------|----------|--------|
| 02:00 | Database Backup | 15 min | `database-backup.sh` |
| 02:30 | Application Backup | 10 min | `app-backup.sh` |
| 09:00 | Morning Health Check | 5 min | `morning-check.sh` |
| 18:00 | Evening Summary | 5 min | `evening-check.sh` |

### Weekly Schedule

| Day | Time | Task | Duration | Script |
|-----|------|------|----------|--------|
| Sunday | 02:00 | Database Vacuum | 30 min | `weekly-maintenance.sh` |
| Sunday | 03:00 | Log Cleanup | 15 min | `cleanup-logs.sh` |
| Sunday | 04:00 | Security Audit | 20 min | `security-audit.sh` |
| Wednesday | 22:00 | Update Dependencies | 30 min | `update-deps.sh` |

### Monthly Schedule

| Date | Time | Task | Duration | Script |
|------|------|------|----------|--------|
| 1st | 03:00 | Archive Old Orders | 1 hour | `archive-orders.sh` |
| 1st | 04:00 | Monthly Backup | 1 hour | `monthly-backup.sh` |
| 1st | 05:00 | Performance Review | 30 min | `perf-review.sh` |
| 15th | 22:00 | Security Patch Check | 30 min | `security-updates.sh` |

### Quarterly Schedule

| Month | Task | Owner |
|-------|------|-------|
| Jan/Apr/Jul/Oct | Infrastructure Review | DevOps Team |
| Jan/Apr/Jul/Oct | Security Assessment | Security Team |
| Jan/Apr/Jul/Oct | Capacity Planning | Engineering Team |
| Jan/Apr/Jul/Oct | DR Test | Operations Team |

---

**Document Version:** 1.0.0
**Last Updated:** October 8, 2025
**Next Review:** Quarterly or after major incidents
