# MAN-46 + MAN-47: Platform Dashboard & Performance Hardening

**Date:** 2026-04-02
**Branch:** `feature/man-46-47-platform-dashboard` (from develop)
**Linear Issues:** MAN-46, MAN-47

## Overview

Two features shipped together in one branch:
1. **MAN-46** — Super-admin dashboard with platform metrics, tenant CRUD, and global announcements
2. **MAN-47** — Performance hardening with per-tenant rate limiting, tenant-aware Redis caching, Prisma pool tuning, and request timeouts

## Architecture: Approach C — Separate Service Layer

New `/api/platform/*` route namespace with dedicated controller, service, and middleware. Separate from tenant-scoped `/api/admin/*`. Platform routes require `super_admin` role and run queries without tenant context (cross-tenant).

---

## MAN-46: Super-Admin Dashboard

### Backend

#### New Files
- `backend/src/routes/platformRoutes.ts`
- `backend/src/controllers/platformController.ts`
- `backend/src/services/platformService.ts`
- `backend/src/middleware/platformAuth.ts`

#### Authorization Middleware

`requirePlatformAdmin` middleware:
- Checks JWT for `super_admin` role
- Sets tenant context to `null` via AsyncLocalStorage so Prisma queries return cross-tenant data
- Returns 403 for non-super_admin users

#### API Endpoints

**Metrics:**
```
GET /api/platform/metrics
  Response: {
    totalTenants: number,
    activeTenants: number,
    mrr: number,           // Sum of active tenants' plan prices
    activeUsers: number,   // Users who logged in within 30 days
    ordersThisMonth: number,
    revenueThisMonth: number
  }

GET /api/platform/metrics/trends
  Query: ?period=30d|90d|1y
  Response: {
    data: [{ date, newTenants, revenue, orders }]
  }
```

**Tenant Management:**
```
GET    /api/platform/tenants
  Query: ?search=&plan=&status=&page=1&limit=20
  Response: { tenants: [...], total, page, totalPages }
  Each tenant includes: id, name, slug, plan, subscriptionStatus,
    _count.users, _count.orders, createdAt

GET    /api/platform/tenants/:id
  Response: Full tenant + usage stats (orders this month, revenue, user count)

POST   /api/platform/tenants
  Body: { name, slug, planName?, region?, currency? }
  Creates tenant + default SystemConfig

PUT    /api/platform/tenants/:id
  Body: { name?, slug?, region?, currency?, currentPlanId?,
          rateLimitEnabled?, rateLimitConfig? }

POST   /api/platform/tenants/:id/suspend
  Sets subscriptionStatus = 'suspended'
  Logs audit entry

POST   /api/platform/tenants/:id/reactivate
  Sets subscriptionStatus = 'active'
  Logs audit entry

DELETE /api/platform/tenants/:id
  Requires confirmation: body { confirmSlug: "tenant-slug" }
  Cascades delete all tenant data
  Logs audit entry
```

**Announcements:**
```
GET    /api/platform/announcements
  Response: All announcements (for management page)

GET    /api/platform/announcements/active
  Auth: any authenticated user (not just super_admin)
  Response: Active, non-expired announcements only
  Used by AnnouncementBanner component

POST   /api/platform/announcements
  Body: { title, body, type: 'info'|'warning'|'maintenance', expiresAt? }

DELETE /api/platform/announcements/:id
```

**System Health:**
```
GET /api/platform/health
  Response: {
    uptime: number,
    database: { status, poolSize, activeConnections },
    redis: { status, memoryUsage, connectedClients },
    queues: { workflow: { waiting, active, completed, failed } }
  }
```

#### Database Changes

New model in `schema.prisma`:

```prisma
model PlatformAnnouncement {
  id        String    @id @default(uuid())
  title     String
  body      String
  type      String    @default("info")   // info, warning, maintenance
  isActive  Boolean   @default(true)
  expiresAt DateTime?
  createdBy Int?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
}
```

New fields on Tenant model:

```prisma
model Tenant {
  // ... existing fields ...
  rateLimitEnabled   Boolean  @default(false)
  rateLimitConfig    Json?    // { requestsPer15Min: number, burstPerSec: number }
}
```

### Frontend

#### New Files
- `frontend/src/pages/PlatformDashboard.tsx`
- `frontend/src/pages/PlatformTenants.tsx`
- `frontend/src/pages/PlatformTenantDetail.tsx`
- `frontend/src/pages/PlatformAnnouncements.tsx`
- `frontend/src/services/platform.service.ts`
- `frontend/src/stores/platformStore.ts`
- `frontend/src/components/announcements/AnnouncementBanner.tsx`

#### Routing

New routes in `App.tsx`, protected by `super_admin` role:

```
/platform                  → PlatformDashboard
/platform/tenants          → PlatformTenants
/platform/tenants/:id      → PlatformTenantDetail
/platform/announcements    → PlatformAnnouncements
```

#### Sidebar Changes

Add "Platform" section at the TOP of sidebar, only visible to `super_admin`:

```
PLATFORM
  Dashboard       → /platform
  Tenants         → /platform/tenants
  Announcements   → /platform/announcements
─────────────────
TENANT (existing)
  Dashboard       → /
  Orders          → /orders
  ...
```

#### Page Designs

**Platform Dashboard (`/platform`):**
- 4 stat cards: Total Tenants, MRR (GHS), Active Users, Orders This Month
- Trends chart: 30-day line chart (revenue + new tenants), period selector
- Recent tenant activity table: latest signups, plan changes, suspensions

**Tenants List (`/platform/tenants`):**
- Search by name/slug
- Filter by plan (Free/Starter/Pro) and status (active/suspended/trialing)
- Table: name, slug, plan badge, status badge, users count, orders count, created date
- Row actions: View, Suspend/Reactivate, Delete
- Create Tenant button opens modal with name, slug, plan selector

**Tenant Detail (`/platform/tenants/:id`):**
- Summary card: name, slug, plan, status, region, currency, created date
- Usage section: orders this month (with limit if applicable), revenue, user count
- Plan management: dropdown to change plan + save button
- Rate limiting section: toggle on/off, custom inputs for requestsPer15Min and burstPerSec
- Danger zone (red border): Suspend/Reactivate button, Delete button with slug confirmation modal

**Announcements Management (`/platform/announcements`):**
- Table: title, type badge, active status, expiry date, created date
- Create button opens modal: title, body textarea, type selector, optional expiry date
- Delete action with confirmation

#### Announcement Banner Component

`AnnouncementBanner` added to main layout (above page content, below header):
- Fetches `GET /api/platform/announcements/active` on mount
- Renders colored bar per announcement type:
  - info: blue background (`bg-blue-50 text-blue-800 border-blue-200`)
  - warning: yellow background (`bg-yellow-50 text-yellow-800 border-yellow-200`)
  - maintenance: red background (`bg-red-50 text-red-800 border-red-200`)
- Dismiss button stores announcement ID in sessionStorage
- Multiple announcements stack vertically
- Re-fetches every 5 minutes

---

## MAN-47: Performance Hardening

### Per-Tenant Rate Limiting

**New file:** `backend/src/middleware/tenantRateLimiter.ts`

**Behavior:**
- Rate limiting is OFF by default for all tenants (`rateLimitEnabled: false`)
- When enabled, uses Redis sliding window counter per tenant
- Redis key: `ratelimit:tenant:{tenantId}:{windowStart}`
- TTL: 15 minutes (auto-expires)
- Applied after `authenticate` middleware (needs tenantId from JWT)
- Unauthenticated routes use existing IP-based limiter (unchanged)

**Response headers:**
- `X-RateLimit-Limit`: max requests for this window
- `X-RateLimit-Remaining`: requests left
- `X-RateLimit-Reset`: window reset timestamp
- Returns 429 with `Retry-After` header when exceeded

**Configuration flow:**
1. Pre-launch: all tenants have `rateLimitEnabled: false`, no throttling
2. Launch: platform admin enables per-tenant via tenant detail page or sets global defaults
3. Custom: per-tenant overrides via `rateLimitConfig` JSON field

**Tenant model fields:**
```
rateLimitEnabled: Boolean @default(false)
rateLimitConfig: Json?
  // { requestsPer15Min: number, burstPerSec: number }
  // null = use global default (when global default is set)
```

### Redis Cache Partitioning

**Modified file:** `backend/src/middleware/cache.middleware.ts`

**Changes:**
- Cache key pattern changes from `cache:{route}:{queryHash}` to `cache:tenant:{tenantId}:{route}:{queryHash}`
- Platform routes (no tenant) use `cache:platform:{route}:{queryHash}`
- `invalidateCache` scoped: `invalidateCache('tenant:{tenantId}:orders:*')`
- No change to TTLs or cache strategy, just key namespacing
- Existing in-memory cache at `cache.ts` already has tenant awareness (no change needed)

### Prisma Connection Pool Tuning

**Modified file:** `.env.example`

Add pool parameters to DATABASE_URL documentation:
```
DATABASE_URL="postgresql://user:pass@host:5432/db?connection_limit=20&pool_timeout=10&connect_timeout=5"
```

- `connection_limit=20`: max connections in pool (Prisma default is 10, tune based on backend replicas)
- `pool_timeout=10`: seconds to wait for available connection before erroring
- `connect_timeout=5`: seconds to wait for new connection to be established

Update CLAUDE.md with pool tuning guidance.

### Request Timeout Middleware

**New file:** `backend/src/middleware/requestTimeout.ts`

- Default: 30 seconds for all API requests
- Configurable per-route via middleware option: `requestTimeout(60000)` for long operations
- On timeout: aborts response with 408 status, logs warning
- Applied globally in `server.ts`, before route handlers

---

## Testing Strategy

### Backend Tests
- `platformController.test.ts`: unit tests for all platform endpoints
- `tenantRateLimiter.test.ts`: rate limit calculation, Redis interaction, bypass when disabled
- `platformService.test.ts`: cross-tenant aggregation queries, tenant CRUD

### Frontend Tests
- Component tests for PlatformDashboard, PlatformTenants, AnnouncementBanner
- Service tests for platform.service.ts API calls

### Manual QA
- Login as super_admin, verify platform nav appears
- Login as tenant admin, verify platform nav is hidden but announcement banner shows
- Create/suspend/reactivate/delete tenant via UI
- Verify rate limit toggle works (enable, set limits, verify 429 response)
- Verify announcement banner renders and dismisses correctly

---

## Migration Plan

1. Add PlatformAnnouncement model + Tenant rate limit fields via Prisma migration
2. Generate Prisma client
3. Implement backend (routes, controller, service, middleware)
4. Implement frontend (pages, store, services, sidebar, banner)
5. Update server.ts to mount platform routes
6. Update App.tsx with platform routes
7. Run full test suite
8. Docker rebuild and verify

---

## Files Changed Summary

### New Files (13)
```
backend/src/routes/platformRoutes.ts
backend/src/controllers/platformController.ts
backend/src/services/platformService.ts
backend/src/middleware/platformAuth.ts
backend/src/middleware/tenantRateLimiter.ts
backend/src/middleware/requestTimeout.ts
backend/src/__tests__/unit/platformController.test.ts
frontend/src/pages/PlatformDashboard.tsx
frontend/src/pages/PlatformTenants.tsx
frontend/src/pages/PlatformTenantDetail.tsx
frontend/src/pages/PlatformAnnouncements.tsx
frontend/src/services/platform.service.ts
frontend/src/stores/platformStore.ts
frontend/src/components/announcements/AnnouncementBanner.tsx
```

### Modified Files (7)
```
backend/prisma/schema.prisma          — PlatformAnnouncement model, Tenant rate limit fields
backend/src/server.ts                 — mount platform routes, request timeout middleware
backend/src/middleware/cache.middleware.ts — tenant-aware cache keys
frontend/src/App.tsx                  — platform routes
frontend/src/components/layout/Sidebar.tsx (or equivalent) — platform nav section
frontend/src/layouts/MainLayout.tsx (or equivalent) — AnnouncementBanner
.env.example                          — connection pool params
```
