# Environment Variables Audit — v2.0.0-launch

Last updated: 2026-03-31

## Status Key

| Symbol | Meaning |
|--------|---------|
| ✅ | Confirmed configured |
| ⚠️ | Needs verification or action |
| ❌ | Missing — must be set before launch |

---

## Required Variables (All Environments)

| Variable | Staging | Production | Notes |
|----------|---------|------------|-------|
| `NODE_ENV` | ✅ `production` | ✅ `production` | Must NOT be `development` |
| `PORT` | ✅ | ✅ | |
| `DATABASE_URL` | ✅ | ✅ | Add `?connection_limit=30&pool_timeout=10` in prod |
| `JWT_SECRET` | ✅ | ⚠️ Rotate before launch | Must be 64+ hex chars, unique per env |
| `JWT_REFRESH_SECRET` | ✅ | ⚠️ Rotate before launch | Must differ from JWT_SECRET |
| `WEBHOOK_SECRET` | ✅ | ⚠️ Rotate before launch | |
| `FRONTEND_URL` | ✅ `https://staging.codadminpro.com` | ✅ `https://codadminpro.com` | Used for CORS |
| `REDIS_HOST` | ✅ | ✅ | |
| `REDIS_PORT` | ✅ | ✅ | |
| `REDIS_PASSWORD` | ⚠️ Verify set | ⚠️ Must be set | Do not leave empty in production |

## Email (Required for onboarding/password reset)

| Variable | Staging | Production | Notes |
|----------|---------|------------|-------|
| `RESEND_API_KEY` | ✅ | ✅ | Use production key for prod |
| `RESEND_FROM_EMAIL` | ✅ | ✅ | Verify domain is verified in Resend |

## Bootstrap Admin (One-time setup)

| Variable | Staging | Production | Notes |
|----------|---------|------------|-------|
| `BOOTSTRAP_ADMIN_EMAIL` | ✅ | ⚠️ Set for initial deploy only | Remove after first deploy |
| `BOOTSTRAP_ADMIN_PASSWORD` | ✅ | ⚠️ Use strong password | Remove after first deploy |

## Observability (Sprint 3)

| Variable | Staging | Production | Notes |
|----------|---------|------------|-------|
| `SENTRY_DSN` | ❌ **NOT SET** | ❌ **NOT SET** | **Critical blocker** — must be configured before launch |
| `LOG_LEVEL` | ⚠️ Set to `info` | ⚠️ Set to `warn` or `error` | Avoid `debug` in prod |

## Provider Encryption (For WhatsApp/SMS integrations)

| Variable | Staging | Production | Notes |
|----------|---------|------------|-------|
| `PROVIDER_ENCRYPTION_KEY` | ⚠️ Verify | ⚠️ Must be set if using integrations | 64-char hex, unique per env |

## Optional (Meta/WhatsApp OAuth)

| Variable | Staging | Production | Notes |
|----------|---------|------------|-------|
| `META_APP_ID` | Optional | Optional | Only if WhatsApp OAuth flow is live |
| `META_APP_SECRET` | Optional | Optional | |
| `BACKEND_URL` | Optional | Optional | Needed for OAuth callback URL |

---

## Secrets Rotation Checklist (Before Launch)

Run these commands to generate new secrets:

```bash
# JWT_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# JWT_REFRESH_SECRET (run again for different value)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# WEBHOOK_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# PROVIDER_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**After rotating JWT secrets:** All active user sessions will be invalidated. Users will need to log in again. Schedule this rotation during a low-traffic window.

---

## DATABASE_URL Production Recommendation

```
postgresql://USER:STRONG_PASSWORD@HOST:5432/ecommerce_cod?schema=public&connection_limit=30&pool_timeout=10&connect_timeout=10&sslmode=require
```

Key differences from development:
- `connection_limit=30` (up from default 10)
- `sslmode=require` (enforce SSL for prod DB connections)
- Strong, rotated password

---

## Action Items for Launch

- [ ] **Board: Get Sentry DSN** from sentry.io and set `SENTRY_DSN` on staging AND production
- [ ] **Board: Rotate JWT secrets** on production before launch
- [ ] **Board: Rotate DB passwords** on production before launch
- [ ] **Board: Set REDIS_PASSWORD** if not already configured
- [ ] **Board: Set PROVIDER_ENCRYPTION_KEY** on production
- [ ] **CTO: Verify staging FRONTEND_URL** is set to staging domain (not localhost)
- [ ] **CTO: Confirm `NODE_ENV=production`** is set on staging and production
