# Production Deployment Checklist

Use this checklist to ensure all optimizations are properly configured before deploying to production.

---

## Pre-Deployment Verification

### 1. Security Configuration

- [ ] **Environment Variables Set**
  ```bash
  # Verify all required variables are set
  cd backend
  node -e "require('dotenv').config(); require('./src/config/validateEnv').validateEnvironment()"
  ```

- [ ] **Strong Secrets Generated**
  - [ ] JWT_SECRET is 32+ characters
  - [ ] JWT_REFRESH_SECRET is 32+ characters
  - [ ] WEBHOOK_SECRET is 32+ characters
  - [ ] All secrets are unique (not the same)

- [ ] **Password Validation Active**
  - [ ] Backend validation in `/backend/src/utils/validators.ts`
  - [ ] Frontend validation in `/frontend/src/pages/Register.tsx`
  - [ ] Test registration with weak password (should fail)

- [ ] **.env Files NOT in Git**
  ```bash
  # Verify .env is in .gitignore
  git status
  # .env should not appear in tracked files
  ```

### 2. Database Configuration

- [ ] **PostgreSQL Ready**
  - [ ] Database created
  - [ ] Connection string correct in DATABASE_URL
  - [ ] Migrations run: `npm run prisma:migrate`
  - [ ] Prisma client generated: `npm run prisma:generate`

- [ ] **Connection Pooling Configured**
  - [ ] Pool size in connection string (recommended: 10-20)
  - [ ] Example: `postgresql://...?connection_limit=10`

- [ ] **Performance Logging Active**
  - [ ] Check `/backend/src/utils/prisma.ts` has query logging
  - [ ] Test: Run app and verify query logs appear

### 3. Redis Configuration

- [ ] **Redis Server Running**
  ```bash
  redis-cli ping
  # Should return: PONG
  ```

- [ ] **Cache Middleware Installed**
  - [ ] File exists: `/backend/src/middleware/cache.middleware.ts`
  - [ ] Redis connection configured with REDIS_HOST and REDIS_PORT

- [ ] **Cache Testing**
  ```bash
  # Start app, make API call twice, check for X-Cache header
  curl -I http://localhost:3000/api/orders
  # Second call should show: X-Cache: HIT
  ```

### 4. Frontend Build Optimization

- [ ] **Vite Config Updated**
  - [ ] Manual chunk splitting configured
  - [ ] Terser minification enabled
  - [ ] Console.log removal active
  - [ ] File: `/frontend/vite.config.ts`

- [ ] **Code Splitting Implemented**
  - [ ] React.lazy in `/frontend/src/App.tsx`
  - [ ] Suspense boundaries with skeletons
  - [ ] ErrorBoundary wrapping routes

- [ ] **Build Test**
  ```bash
  cd frontend
  npm run build
  # Check output for chunk sizes (<500KB initial)
  ```

- [ ] **Bundle Size Verification**
  - [ ] Initial bundle <500KB gzipped
  - [ ] Vendor chunks separated
  - [ ] Lazy chunks loading on-demand

### 5. Error Handling

- [ ] **Error Boundary Active**
  - [ ] Component exists: `/frontend/src/components/common/ErrorBoundary.tsx`
  - [ ] App.tsx wrapped with ErrorBoundary
  - [ ] Test: Trigger error and verify fallback UI

- [ ] **Error Logging Service**
  - [ ] Service exists: `/frontend/src/services/errorLogging.service.ts`
  - [ ] Global error handlers registered
  - [ ] Test: Check console for error logs

- [ ] **Backend Error Handling**
  - [ ] Query performance logging active
  - [ ] Slow queries logged (>100ms)
  - [ ] Error middleware in place

### 6. Loading States

- [ ] **Skeleton Components Created**
  - [ ] File exists: `/frontend/src/components/ui/Skeleton.tsx`
  - [ ] Used in Suspense fallbacks
  - [ ] Test: Navigate between routes, see skeletons

- [ ] **Loading Indicators**
  - [ ] Dashboard skeleton
  - [ ] Table skeleton
  - [ ] Form skeleton
  - [ ] Kanban skeleton

---

## Build Process

### Backend Build

```bash
cd backend

# 1. Install production dependencies
npm ci --production

# 2. Build TypeScript
npm run build

# 3. Generate Prisma Client
npm run prisma:generate

# 4. Run migrations (production)
npm run prisma:migrate

# 5. Verify build
ls -lh dist/
```

### Frontend Build

```bash
cd frontend

# 1. Install dependencies
npm ci

# 2. Build for production
npm run build

# 3. Verify bundle sizes
ls -lh dist/assets/

# 4. Test production build locally
npx serve -s dist
```

---

## Performance Testing

### 1. API Performance

```bash
# Test API response times
curl -w "@curl-format.txt" -o /dev/null -s http://localhost:3000/api/orders

# Create curl-format.txt:
cat > curl-format.txt << 'END'
    time_namelookup:  %{time_namelookup}\n
       time_connect:  %{time_connect}\n
    time_appconnect:  %{time_appconnect}\n
      time_redirect:  %{time_redirect}\n
   time_pretransfer:  %{time_pretransfer}\n
 time_starttransfer:  %{time_starttransfer}\n
                    ----------\n
         time_total:  %{time_total}\n
END
```

**Target:** time_total <200ms

### 2. Frontend Performance

```bash
# Install Lighthouse
npm install -g lighthouse

# Run audit
lighthouse http://localhost:5173 --view

# Check metrics:
# - Performance score: >90
# - First Contentful Paint: <1s
# - Time to Interactive: <3s
# - Total Blocking Time: <300ms
```

### 3. Load Testing

```bash
# Install K6 (https://k6.io/docs/getting-started/installation/)

# Create basic load test
cat > load-test.js << 'END'
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 100,
  duration: '30s',
};

export default function () {
  const res = http.get('http://localhost:3000/api/orders');
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}
END

# Run test
k6 run load-test.js

# Target: p95 response time <200ms
```

---

## Monitoring Setup

### 1. Health Check

- [ ] **Endpoint Active**
  ```bash
  curl http://localhost:3000/health
  # Should return: {"status":"healthy",...}
  ```

### 2. Cache Metrics

- [ ] **Redis Monitoring**
  ```bash
  redis-cli INFO stats
  # Check: keyspace_hits, keyspace_misses
  # Target hit ratio: >70%
  ```

### 3. Database Monitoring

- [ ] **Slow Query Log**
  ```bash
  # Check logs for slow queries
  tail -f backend/logs/app.log | grep "Slow query"
  ```

- [ ] **Connection Pool**
  ```bash
  # Monitor active connections in PostgreSQL
  psql -c "SELECT count(*) FROM pg_stat_activity;"
  ```

### 4. Error Tracking

- [ ] **Set up error tracking service** (optional but recommended)
  - [ ] Sentry integration
  - [ ] Error dashboard configured
  - [ ] Alerts set up

---

## Security Audit

### 1. Dependencies

```bash
# Backend
cd backend
npm audit
npm audit fix

# Frontend
cd frontend
npm audit
npm audit fix
```

### 2. Security Headers

- [ ] **Helmet.js Configured**
  - [ ] Check `/backend/src/server.ts` for `app.use(helmet())`

### 3. CORS Configuration

- [ ] **CORS Properly Set**
  ```typescript
  // In server.ts
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true
  })
  ```

### 4. Rate Limiting

- [ ] **Rate Limiter Active**
  - [ ] Check `/backend/src/middleware/rateLimiter.ts`
  - [ ] Applied to API routes

---

## Production Environment

### 1. Environment Variables

Create production `.env`:

```bash
# Backend Production
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://...
JWT_SECRET=<production-secret>
JWT_REFRESH_SECRET=<production-secret>
WEBHOOK_SECRET=<production-secret>
REDIS_HOST=<production-redis>
REDIS_PORT=6379
REDIS_PASSWORD=<if-applicable>
FRONTEND_URL=https://yourdomain.com
```

### 2. Reverse Proxy (Nginx)

Example configuration:

```nginx
# /etc/nginx/sites-available/ecommerce-admin

# Frontend
server {
    listen 80;
    server_name yourdomain.com;
    root /path/to/frontend/dist;
    index index.html;

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    # Static assets cache
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}

# Backend API
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 3. SSL/TLS Setup

```bash
# Using Let's Encrypt (Certbot)
sudo certbot --nginx -d yourdomain.com -d api.yourdomain.com
```

### 4. Process Manager (PM2)

```bash
# Install PM2
npm install -g pm2

# Start backend
cd backend
pm2 start dist/server.js --name ecommerce-api

# Save PM2 config
pm2 save

# Start on boot
pm2 startup
```

---

## Post-Deployment Validation

### 1. Smoke Tests

- [ ] **Homepage loads** (https://yourdomain.com)
- [ ] **Login works** (authentication flow)
- [ ] **API responds** (https://api.yourdomain.com/health)
- [ ] **Dashboard loads** (after login)
- [ ] **Create order** (core functionality)

### 2. Performance Validation

- [ ] **API response times <200ms** (check monitoring)
- [ ] **Frontend loads <3s** (Lighthouse)
- [ ] **Cache hit ratio >70%** (Redis stats)
- [ ] **No errors in logs** (check for 24 hours)

### 3. Monitoring Alerts

- [ ] **Set up alerts for:**
  - [ ] API response time >500ms
  - [ ] Error rate >1%
  - [ ] Server CPU >80%
  - [ ] Server memory >90%
  - [ ] Database connections >80% of pool

---

## Rollback Plan

If issues occur:

1. **Database Rollback**
   ```bash
   npm run prisma:migrate rollback
   ```

2. **Application Rollback**
   ```bash
   pm2 stop ecommerce-api
   # Deploy previous version
   pm2 start ecommerce-api
   ```

3. **Frontend Rollback**
   ```bash
   # Replace dist folder with previous build
   # Or use Git: git checkout previous-tag
   ```

---

## Success Criteria

Application is ready for production when:

- ✅ All security checks passed
- ✅ All performance targets met
- ✅ Zero critical errors in logs
- ✅ Monitoring and alerts configured
- ✅ SSL/TLS certificate active
- ✅ Backup and rollback plan tested
- ✅ Load testing completed successfully
- ✅ Documentation updated

---

**Checklist Version:** 1.0
**Last Updated:** 2025-10-08
**Status:** Ready for Production Deployment
