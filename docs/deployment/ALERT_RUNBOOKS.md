# CodAdmin On-Call Alert Runbooks

## Severity Definitions

| Level | Description | Response Time |
|-------|-------------|---------------|
| P0 | Full outage, data loss risk | Immediate — wake anyone |
| P1 | Partial outage, major feature broken | < 15 minutes |
| P2 | Degraded performance or non-critical feature broken | < 1 hour |
| P3 | Minor issue, workaround exists | Next business day |

---

## Runbook 1: High Error Rate

**Alert condition:** Error rate > 2% for 5 minutes, or > 5% for any duration

**Immediate steps:**

1. Check Sentry for the dominant error type:
   - Go to sentry.io → CodAdmin project → Issues (sort by volume)
   - Note: error class, endpoint, and first occurrence time

2. Check if issue is auth-related (401/403):
   ```bash
   # Test public endpoint
   curl https://codadminpro.com/api/health
   # Test auth
   curl -X POST https://codadminpro.com/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@test.com","password":"xxx"}'
   ```

3. Check if issue is database-related (500s):
   ```bash
   # Check DB connection pool on DigitalOcean → Databases → Connection pools
   # Look for: "too many connections" or "ECONNREFUSED"
   ```

4. Check recent deploys:
   - Was there a deploy in the last 30 minutes? → Consider rollback
   - No deploy? → Likely infrastructure issue

**Escalate to P0** if error rate > 10% or if `/api/health` returns non-200.

---

## Runbook 2: High API Latency

**Alert condition:** p95 latency > 2 seconds for 10 minutes

**Immediate steps:**

1. Identify slow endpoints via Sentry performance or server logs:
   ```bash
   # Check server logs (adjust path for your deployment)
   tail -f /var/log/app/backend.log | grep "response_time" | awk '$NF > 2000'
   ```

2. Check database query performance:
   - DigitalOcean → Databases → Insights → Slow queries
   - Look for queries > 1 second

3. Check for N+1 query patterns or missing indexes:
   - Common culprits: `/api/orders`, `/api/dashboard`, `/api/reports`

4. If DB is the bottleneck:
   - Check active connections count vs pool limit (default: 10)
   - Consider increasing `connection_limit` in `DATABASE_URL`

5. If CPU is maxed (> 90%):
   - Scale up the server (DigitalOcean → App Platform → App Spec → instance size)

---

## Runbook 3: Authentication Failures / JWT Errors

**Alert condition:** 401 error rate > 5% of requests, or Sentry showing JWT errors

**Common causes and fixes:**

| Cause | Symptom | Fix |
|-------|---------|-----|
| JWT_SECRET changed | All sessions invalidated | Restore secret or force re-login |
| Token expiry too short | Frequent 401s | Check `ACCESS_TOKEN_EXPIRY` env var |
| Clock skew | Random JWT invalid errors | Sync server clock: `sudo ntpdate -s time.nist.gov` |
| Stale refresh tokens | "Invalid refresh token" | Users must log in again — expected after secret rotation |

**For mass auth failure:**
```bash
# Verify JWT_SECRET is set correctly
echo $JWT_SECRET | wc -c  # should be > 32 chars

# Check if refresh tokens are being stored
# (PostgreSQL)
SELECT COUNT(*) FROM users WHERE refresh_token IS NOT NULL;
```

---

## Runbook 4: Database Connection Exhaustion

**Alert condition:** "too many clients" error in Sentry, or 503s on DB-dependent endpoints

**Immediate steps:**

1. Check current connection count:
   ```sql
   SELECT COUNT(*) FROM pg_stat_activity WHERE datname = 'ecommerce_cod';
   ```

2. Kill idle connections:
   ```sql
   SELECT pg_terminate_backend(pid)
   FROM pg_stat_activity
   WHERE datname = 'ecommerce_cod'
     AND state = 'idle'
     AND query_start < NOW() - INTERVAL '5 minutes';
   ```

3. Verify Prisma connection pool limit matches DB max connections:
   - `DATABASE_URL` should include `?connection_limit=5&pool_timeout=20`
   - DB max connections (DigitalOcean basic): 25
   - With 2 app instances × 5 pool = 10 connections (safe)

4. If connection leaks suspected — restart the app:
   ```bash
   # DigitalOcean App Platform → force restart
   # OR Docker:
   docker-compose restart backend
   ```

---

## Runbook 5: Tenant Data Isolation Breach

**Alert condition:** User reports seeing another company's data, or Sentry logs `tenantId mismatch`

> **This is a P0 incident — wake the CTO immediately.**

**Immediate steps:**

1. **Take the affected endpoint offline** if possible:
   ```bash
   # Return 503 for affected route while investigating
   # nginx: add `return 503;` to the route in nginx.conf
   ```

2. Identify scope:
   - Which user? Which endpoint?
   - How many records exposed?
   - Was it read-only or could data be modified?

3. Check Prisma middleware is active:
   ```bash
   grep -r "tenantIsolationExtension" backend/src/utils/prisma.ts
   # Should be applied in the Prisma client initialization
   ```

4. Check if the route bypasses tenant middleware:
   - All routes under `/api/` (except `/api/auth/*` and `/api/public/*`) should have `authenticate` middleware applied

5. Preserve logs for audit:
   ```bash
   # Export relevant logs before rotation
   docker logs backend > incident-$(date +%Y%m%d-%H%M).log
   ```

6. Notify CEO — regulatory disclosure may be required.

---

## Runbook 6: High Memory / OOM

**Alert condition:** App restarts unexpectedly, or memory > 90% for 10 minutes

**Steps:**

1. Check memory usage trend (DigitalOcean → App → Metrics)
2. Common causes:
   - Memory leak in long-running requests (check for unbounded arrays)
   - Too many concurrent load test runs (stop `npm run test:load`)
   - Large CSV/import operations (consider streaming)
3. Immediate fix: restart the app container
4. Long-term: review heap snapshots in Node.js profiler

---

## Weekly Health Check (Every Monday)

- [ ] Check Sentry: resolve all P1+ issues from the prior week
- [ ] Review error trends: any new recurring patterns?
- [ ] Check DB storage growth (alert if > 80% full)
- [ ] Verify backup job ran successfully (DigitalOcean → Databases → Backups)
- [ ] Review load test results if run
- [ ] Check SSL cert expiry: `echo | openssl s_client -connect codadminpro.com:443 2>/dev/null | openssl x509 -noout -dates`

---

## Escalation Path

```
On-call engineer
    ↓ (if unresolved in 15 min)
CTO
    ↓ (if P0 or data breach)
CEO
    ↓ (if regulatory / customer comms needed)
Legal / Customer Success
```
