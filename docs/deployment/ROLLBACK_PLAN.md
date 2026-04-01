# CodAdmin v2.0.0-launch Rollback Plan

## Trigger Criteria

Initiate rollback if ANY of the following occur within 72 hours of launch:
- Error rate > 5% sustained for 10+ minutes
- p95 API latency > 5 seconds for 10+ minutes
- Authentication failures > 10% of login attempts
- Database connection pool exhausted
- Critical data integrity issue discovered (orders lost, tenant data leaked)

## Pre-Rollback Checklist

Before rolling back, confirm:
- [ ] Issue is not transient (retry failed, not a spike)
- [ ] Root cause is NOT fixable with a hotfix in < 30 minutes
- [ ] CEO/on-call notified of rollback decision

---

## Rollback Procedure

### Step 1 — Notify (< 2 minutes)

Post in team channel:
```
🚨 ROLLBACK INITIATED — CodAdmin v2.0.0-launch
Reason: [brief description]
ETA: ~15 minutes
Status page: staging.codadminpro.com (update if applicable)
```

### Step 2 — Revert Production Deploy (< 5 minutes)

**If deployed via DigitalOcean App Platform:**
```bash
# Go to DigitalOcean App Platform dashboard
# Apps → ecommerce-cod-admin → Activity
# Click on last stable deploy → "Rollback to this deploy"
```

**If deployed via Docker/manual:**
```bash
# SSH into production server
ssh deploy@codadminpro.com

# List recent image tags
docker images | grep ecommerce-cod-admin

# Roll back to previous tag (e.g., v1.x.x)
docker-compose down
docker-compose up -d --no-deps --build
# OR pull specific tag
docker pull ghcr.io/michaelemmanuel16/ecommerce-cod-admin:v1.x.x
docker-compose up -d
```

**If deployed via Git (Render/Railway/etc):**
```bash
# Revert main to last stable commit
git checkout main
git revert HEAD --no-edit
git push origin main
```

### Step 3 — Revert Database Migrations (if needed)

Only required if the issue is migration-related. For v2.0.0, the new migrations are:
- `20260330120000_add_tenant_model`
- `20260330160000_add_tenant_config_fields`
- `20260330170000_add_tenant_id_to_financial_and_inventory`
- `20260330180000_add_plans_and_billing`
- `20260330190000_remove_plan_string_add_enums`
- `20260330195000_add_tenant_id_to_gl_tables`

**Migration rollback (DESTRUCTIVE — last resort only):**
```sql
-- Run in order, newest first:
-- Drop tenant_id from GL tables
ALTER TABLE journal_entries DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE accounts DROP COLUMN IF EXISTS tenant_id;

-- (Continue for each migration in reverse order)
-- WARNING: This destroys all multi-tenant data created since launch
```

> **⚠️ Only roll back migrations if instructed by engineering lead.
> All new tenant registrations and their data will be lost.**

### Step 4 — Restore Environment Variables (if rotated)

If secrets were rotated as part of launch:
```bash
# Restore previous JWT_SECRET value from secure vault
# Restore previous DB passwords
# Note: All active user sessions will be invalidated
```

### Step 5 — Verify Rollback Success (< 5 minutes)

```bash
# Check error rate is back to baseline
curl https://codadminpro.com/api/health

# Test login flow
curl -X POST https://codadminpro.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"..."}'

# Verify Sentry shows error rate dropping
# Check DigitalOcean metrics dashboard
```

### Step 6 — Post-Rollback Communication

```
✅ ROLLBACK COMPLETE — CodAdmin reverted to v1.x
All systems operational on previous version.
Investigation ongoing. Updates to follow.
```

---

## Post-Incident

1. Create incident report within 24 hours
2. Root cause analysis in Linear as new `critical` issue
3. Fix forward on a feature branch — do NOT re-deploy until fix is verified on staging
4. Re-deploy only with CEO sign-off

---

## Contact During Rollback

| Role | Action |
|------|--------|
| CTO | Executes rollback, owns technical decision |
| CEO | Final go/no-go, customer communications |
| On-call | First responder, escalates to CTO |
