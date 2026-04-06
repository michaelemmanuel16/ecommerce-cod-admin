# Platform Dashboard & Performance Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a super-admin platform dashboard (MAN-46) with tenant metrics, CRUD, and announcements, plus performance hardening (MAN-47) with per-tenant rate limiting, tenant-aware caching, pool tuning, and request timeouts.

**Architecture:** Separate `/api/platform/*` route namespace with `platformController.ts`, `platformService.ts`, and `platformAuth.ts`. Performance middleware as standalone files. Frontend pages under `/platform/*` with dedicated Zustand store and service layer.

**Tech Stack:** Express, Prisma/PostgreSQL, Redis (ioredis), React, Zustand, Shadcn UI, Recharts, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-04-02-platform-dashboard-performance-design.md`

---

## Task 0: Branch Setup

**Files:** None (git only)

- [ ] **Step 1: Create feature branch from develop**

```bash
git checkout develop && git pull origin develop
git checkout -b feature/man-46-47-platform-dashboard
```

- [ ] **Step 2: Verify clean state**

```bash
git status
```

Expected: clean working tree on `feature/man-46-47-platform-dashboard`

---

## Task 1: Database Schema — PlatformAnnouncement + Tenant Rate Limit Fields

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: migration via `prisma migrate`

- [ ] **Step 1: Add PlatformAnnouncement model and Tenant rate limit fields**

In `backend/prisma/schema.prisma`, add the PlatformAnnouncement model after the existing Plan model, and add two new fields to the Tenant model:

```prisma
model PlatformAnnouncement {
  id        String    @id @default(uuid())
  title     String
  body      String
  type      String    @default("info")
  isActive  Boolean   @default(true) @map("is_active")
  expiresAt DateTime? @map("expires_at")
  createdBy Int?      @map("created_by")
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  @@map("platform_announcements")
}
```

Add to the Tenant model (after `trialEndsAt`):

```prisma
  rateLimitEnabled  Boolean  @default(false) @map("rate_limit_enabled")
  rateLimitConfig   Json?    @map("rate_limit_config")
```

- [ ] **Step 2: Generate migration**

```bash
cd backend && npx prisma migrate dev --name add_platform_announcements_and_tenant_rate_limits
```

Expected: Migration created and applied successfully.

- [ ] **Step 3: Generate Prisma client**

```bash
npx prisma generate
```

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/
git commit -m "feat(db): add PlatformAnnouncement model and tenant rate limit fields"
```

---

## Task 2: Platform Auth Middleware

**Files:**
- Create: `backend/src/middleware/platformAuth.ts`

- [ ] **Step 1: Create platformAuth.ts**

```typescript
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { tenantStorage } from '../utils/tenantContext';

/**
 * Requires super_admin role and nullifies tenant context
 * so Prisma queries return cross-tenant data.
 */
export const requirePlatformAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (req.user.role !== 'super_admin') {
    res.status(403).json({ error: 'Forbidden: Platform admin access required' });
    return;
  }

  // Run with null tenantId so queries are cross-tenant
  tenantStorage.run({ tenantId: null }, next);
};
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/middleware/platformAuth.ts
git commit -m "feat(auth): add requirePlatformAdmin middleware for cross-tenant access"
```

---

## Task 3: Platform Service — Metrics, Tenant CRUD, Announcements, Health

**Files:**
- Create: `backend/src/services/platformService.ts`

- [ ] **Step 1: Create platformService.ts**

```typescript
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { redis } from '../middleware/cache.middleware';
import logger from '../utils/logger';

// ── Metrics ──────────────────────────────────────────────

export async function getPlatformMetrics() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [totalTenants, activeTenants, activeUsers, ordersThisMonth, plans] = await Promise.all([
    prisma.tenant.count(),
    prisma.tenant.count({ where: { subscriptionStatus: 'active' } }),
    prisma.user.count({ where: { lastLogin: { gte: thirtyDaysAgo }, isActive: true } }),
    prisma.order.count({ where: { createdAt: { gte: monthStart } } }),
    prisma.plan.findMany({ where: { isActive: true } }),
  ]);

  // MRR: count active tenants per plan, multiply by price
  const tenantsByPlan = await prisma.tenant.groupBy({
    by: ['currentPlanId'],
    where: { subscriptionStatus: 'active', currentPlanId: { not: null } },
    _count: true,
  });

  const planMap = new Map(plans.map(p => [p.id, p]));
  const mrr = tenantsByPlan.reduce((sum, group) => {
    const plan = planMap.get(group.currentPlanId!);
    return sum + (plan ? Number(plan.priceGHS) * group._count : 0);
  }, 0);

  return { totalTenants, activeTenants, mrr, activeUsers, ordersThisMonth };
}

export async function getPlatformTrends(period: string) {
  const days = period === '90d' ? 90 : period === '1y' ? 365 : 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [tenants, orders] = await Promise.all([
    prisma.tenant.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.order.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, totalAmount: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  // Group by date
  const dataMap = new Map<string, { date: string; newTenants: number; revenue: number; orders: number }>();
  const toDateKey = (d: Date) => d.toISOString().split('T')[0];

  for (const t of tenants) {
    const key = toDateKey(t.createdAt);
    const entry = dataMap.get(key) || { date: key, newTenants: 0, revenue: 0, orders: 0 };
    entry.newTenants++;
    dataMap.set(key, entry);
  }

  for (const o of orders) {
    const key = toDateKey(o.createdAt);
    const entry = dataMap.get(key) || { date: key, newTenants: 0, revenue: 0, orders: 0 };
    entry.orders++;
    entry.revenue += Number(o.totalAmount);
    dataMap.set(key, entry);
  }

  return { data: Array.from(dataMap.values()).sort((a, b) => a.date.localeCompare(b.date)) };
}

// ── Tenant Management ────────────────────────────────────

export async function listTenants(params: {
  search?: string;
  plan?: string;
  status?: string;
  page?: number;
  limit?: number;
}) {
  const { search, plan, status, page = 1, limit = 20 } = params;
  const where: any = {};

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { slug: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (plan) where.currentPlan = { name: plan };
  if (status) where.subscriptionStatus = status;

  const [tenants, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      include: {
        currentPlan: { select: { name: true, displayName: true } },
        _count: { select: { users: true, orders: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.tenant.count({ where }),
  ]);

  return { tenants, total, page, totalPages: Math.ceil(total / limit) };
}

export async function getTenantDetail(id: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: {
      currentPlan: true,
      _count: { select: { users: true, orders: true } },
    },
  });
  if (!tenant) throw new AppError('Tenant not found', 404);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [ordersThisMonth, revenue] = await Promise.all([
    prisma.order.count({ where: { tenantId: id, createdAt: { gte: monthStart } } }),
    prisma.order.aggregate({
      where: { tenantId: id, createdAt: { gte: monthStart } },
      _sum: { totalAmount: true },
    }),
  ]);

  return {
    ...tenant,
    usage: {
      ordersThisMonth,
      revenueThisMonth: Number(revenue._sum.totalAmount || 0),
      totalUsers: tenant._count.users,
    },
  };
}

export async function createTenant(data: {
  name: string;
  slug: string;
  planName?: string;
  region?: string;
  currency?: string;
}) {
  const existing = await prisma.tenant.findUnique({ where: { slug: data.slug } });
  if (existing) throw new AppError('Tenant slug already exists', 409);

  let currentPlanId: string | undefined;
  if (data.planName) {
    const plan = await prisma.plan.findUnique({ where: { name: data.planName } });
    if (!plan) throw new AppError(`Plan '${data.planName}' not found`, 404);
    currentPlanId = plan.id;
  }

  const tenant = await prisma.tenant.create({
    data: {
      name: data.name,
      slug: data.slug,
      region: data.region,
      currency: data.currency || 'GHS',
      currentPlanId,
      subscriptionStatus: 'active',
    },
    include: { currentPlan: true },
  });

  // Create default SystemConfig for the tenant
  await prisma.systemConfig.create({
    data: { tenantId: tenant.id, currency: data.currency || 'GHS' },
  });

  return tenant;
}

export async function updateTenant(id: string, data: {
  name?: string;
  slug?: string;
  region?: string;
  currency?: string;
  currentPlanId?: string;
  rateLimitEnabled?: boolean;
  rateLimitConfig?: { requestsPer15Min: number; burstPerSec: number } | null;
}) {
  const tenant = await prisma.tenant.findUnique({ where: { id } });
  if (!tenant) throw new AppError('Tenant not found', 404);

  if (data.slug && data.slug !== tenant.slug) {
    const existing = await prisma.tenant.findUnique({ where: { slug: data.slug } });
    if (existing) throw new AppError('Slug already in use', 409);
  }

  return prisma.tenant.update({
    where: { id },
    data,
    include: { currentPlan: true },
  });
}

export async function suspendTenant(id: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id } });
  if (!tenant) throw new AppError('Tenant not found', 404);
  if (tenant.subscriptionStatus === 'suspended') throw new AppError('Tenant is already suspended', 400);

  return prisma.tenant.update({
    where: { id },
    data: { subscriptionStatus: 'suspended' },
  });
}

export async function reactivateTenant(id: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id } });
  if (!tenant) throw new AppError('Tenant not found', 404);
  if (tenant.subscriptionStatus !== 'suspended') throw new AppError('Tenant is not suspended', 400);

  return prisma.tenant.update({
    where: { id },
    data: { subscriptionStatus: 'active' },
  });
}

export async function deleteTenant(id: string, confirmSlug: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id } });
  if (!tenant) throw new AppError('Tenant not found', 404);
  if (tenant.slug !== confirmSlug) throw new AppError('Slug confirmation does not match', 400);

  // Delete all tenant-scoped data in dependency order
  const tenantFilter = { where: { tenantId: id } };
  await prisma.workflowExecution.deleteMany(tenantFilter);
  await prisma.workflow.deleteMany(tenantFilter);
  await prisma.notification.deleteMany(tenantFilter);
  await prisma.webhookConfig.deleteMany(tenantFilter);
  await prisma.accountTransaction.deleteMany(tenantFilter);
  await prisma.journalEntry.deleteMany(tenantFilter);
  await prisma.account.deleteMany(tenantFilter);
  await prisma.delivery.deleteMany(tenantFilter);
  await prisma.order.deleteMany(tenantFilter);
  await prisma.customer.deleteMany(tenantFilter);
  await prisma.product.deleteMany(tenantFilter);
  await prisma.transaction.deleteMany(tenantFilter);
  await prisma.expense.deleteMany(tenantFilter);
  await prisma.checkoutForm.deleteMany(tenantFilter);
  await prisma.agentBalance.deleteMany(tenantFilter);
  await prisma.agentStock.deleteMany(tenantFilter);
  await prisma.inventoryShipment.deleteMany(tenantFilter);
  await prisma.inventoryTransfer.deleteMany(tenantFilter);
  await prisma.messageLogs.deleteMany(tenantFilter);
  await prisma.systemConfig.deleteMany(tenantFilter);
  await prisma.user.deleteMany(tenantFilter);
  await prisma.tenant.delete({ where: { id } });

  return { deleted: true };
}

// ── Announcements ────────────────────────────────────────

export async function listAnnouncements() {
  return prisma.platformAnnouncement.findMany({ orderBy: { createdAt: 'desc' } });
}

export async function getActiveAnnouncements() {
  const now = new Date();
  return prisma.platformAnnouncement.findMany({
    where: {
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createAnnouncement(data: {
  title: string;
  body: string;
  type?: string;
  expiresAt?: string;
  createdBy?: number;
}) {
  return prisma.platformAnnouncement.create({
    data: {
      title: data.title,
      body: data.body,
      type: data.type || 'info',
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      createdBy: data.createdBy,
    },
  });
}

export async function deleteAnnouncement(id: string) {
  const announcement = await prisma.platformAnnouncement.findUnique({ where: { id } });
  if (!announcement) throw new AppError('Announcement not found', 404);
  await prisma.platformAnnouncement.delete({ where: { id } });
  return { deleted: true };
}

// ── System Health ────────────────────────────────────────

export async function getSystemHealth() {
  const uptime = process.uptime();

  let dbStatus = 'healthy';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = 'unhealthy';
  }

  let redisStatus = 'healthy';
  let redisInfo: any = {};
  try {
    const info = await redis.info('memory');
    const clientInfo = await redis.info('clients');
    redisInfo = {
      memoryUsage: info.match(/used_memory_human:(.+)/)?.[1]?.trim(),
      connectedClients: clientInfo.match(/connected_clients:(\d+)/)?.[1],
    };
  } catch {
    redisStatus = 'unhealthy';
  }

  return {
    uptime: Math.round(uptime),
    database: { status: dbStatus },
    redis: { status: redisStatus, ...redisInfo },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/services/platformService.ts
git commit -m "feat(platform): add platformService with metrics, tenant CRUD, announcements, health"
```

---

## Task 4: Platform Controller

**Files:**
- Create: `backend/src/controllers/platformController.ts`

- [ ] **Step 1: Create platformController.ts**

```typescript
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as platformService from '../services/platformService';

// ── Metrics ──────────────────────────────────────────────

export const getMetrics = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const metrics = await platformService.getPlatformMetrics();
    res.json(metrics);
  } catch (err) { next(err); }
};

export const getTrends = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const period = (req.query.period as string) || '30d';
    const trends = await platformService.getPlatformTrends(period);
    res.json(trends);
  } catch (err) { next(err); }
};

// ── Tenants ──────────────────────────────────────────────

export const listTenants = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { search, plan, status, page, limit } = req.query;
    const result = await platformService.listTenants({
      search: search as string,
      plan: plan as string,
      status: status as string,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json(result);
  } catch (err) { next(err); }
};

export const getTenant = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenant = await platformService.getTenantDetail(req.params.id);
    res.json(tenant);
  } catch (err) { next(err); }
};

export const createTenant = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenant = await platformService.createTenant(req.body);
    res.status(201).json(tenant);
  } catch (err) { next(err); }
};

export const updateTenant = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenant = await platformService.updateTenant(req.params.id, req.body);
    res.json(tenant);
  } catch (err) { next(err); }
};

export const suspendTenant = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenant = await platformService.suspendTenant(req.params.id);
    res.json({ message: 'Tenant suspended', tenant });
  } catch (err) { next(err); }
};

export const reactivateTenant = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenant = await platformService.reactivateTenant(req.params.id);
    res.json({ message: 'Tenant reactivated', tenant });
  } catch (err) { next(err); }
};

export const removeTenant = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { confirmSlug } = req.body;
    await platformService.deleteTenant(req.params.id, confirmSlug);
    res.json({ message: 'Tenant deleted' });
  } catch (err) { next(err); }
};

// ── Announcements ────────────────────────────────────────

export const listAnnouncements = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const announcements = await platformService.listAnnouncements();
    res.json({ announcements });
  } catch (err) { next(err); }
};

export const getActiveAnnouncements = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const announcements = await platformService.getActiveAnnouncements();
    res.json({ announcements });
  } catch (err) { next(err); }
};

export const addAnnouncement = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const announcement = await platformService.createAnnouncement({
      ...req.body,
      createdBy: req.user?.id,
    });
    res.status(201).json(announcement);
  } catch (err) { next(err); }
};

export const removeAnnouncement = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await platformService.deleteAnnouncement(req.params.id);
    res.json({ message: 'Announcement deleted' });
  } catch (err) { next(err); }
};

// ── Health ───────────────────────────────────────────────

export const getHealth = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const health = await platformService.getSystemHealth();
    res.json(health);
  } catch (err) { next(err); }
};
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/controllers/platformController.ts
git commit -m "feat(platform): add platformController with all endpoint handlers"
```

---

## Task 5: Platform Routes + Server Mount

**Files:**
- Create: `backend/src/routes/platformRoutes.ts`
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Create platformRoutes.ts**

```typescript
import { Router } from 'express';
import { apiLimiter } from '../middleware/rateLimiter';
import { authenticate } from '../middleware/auth';
import { requirePlatformAdmin } from '../middleware/platformAuth';
import * as pc from '../controllers/platformController';

const router = Router();

// All platform routes require authentication
router.use(apiLimiter, authenticate);

// Active announcements — any authenticated user (for banner display)
router.get('/announcements/active', pc.getActiveAnnouncements);

// Everything below requires platform admin (super_admin + null tenant context)
router.use(requirePlatformAdmin);

// Metrics
router.get('/metrics', pc.getMetrics);
router.get('/metrics/trends', pc.getTrends);

// Tenant management
router.get('/tenants', pc.listTenants);
router.post('/tenants', pc.createTenant);
router.get('/tenants/:id', pc.getTenant);
router.put('/tenants/:id', pc.updateTenant);
router.post('/tenants/:id/suspend', pc.suspendTenant);
router.post('/tenants/:id/reactivate', pc.reactivateTenant);
router.delete('/tenants/:id', pc.removeTenant);

// Announcements management
router.get('/announcements', pc.listAnnouncements);
router.post('/announcements', pc.addAnnouncement);
router.delete('/announcements/:id', pc.removeAnnouncement);

// System health
router.get('/health', pc.getHealth);

export default router;
```

- [ ] **Step 2: Mount in server.ts**

In `backend/src/server.ts`, add the import alongside other route imports:

```typescript
import platformRoutes from './routes/platformRoutes';
```

Add the mount alongside other `app.use` lines:

```typescript
app.use('/api/platform', platformRoutes);
```

- [ ] **Step 3: Verify backend builds**

```bash
cd backend && npm run build
```

Expected: No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/platformRoutes.ts backend/src/server.ts
git commit -m "feat(platform): add platform routes and mount in server"
```

---

## Task 6: Backend Unit Tests

**Files:**
- Create: `backend/src/__tests__/unit/platformService.test.ts`

- [ ] **Step 1: Create platformService.test.ts**

Write unit tests mocking Prisma for the key service functions. Follow the pattern in existing test files (e.g., `billingController.test.ts`). Test:

- `getPlatformMetrics` — returns correct shape with mocked tenant/order/user counts
- `listTenants` — pagination, search filter, plan filter
- `getTenantDetail` — found vs not found (404)
- `createTenant` — success, duplicate slug (409)
- `suspendTenant` — success, already suspended (400)
- `deleteTenant` — success, wrong confirmSlug (400)
- `getActiveAnnouncements` — filters expired and inactive
- `createAnnouncement` — creates with correct fields
- `getSystemHealth` — returns uptime, db status, redis status

- [ ] **Step 2: Run tests**

```bash
cd backend && npm test -- platformService.test
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/src/__tests__/unit/platformService.test.ts
git commit -m "test(platform): add unit tests for platformService"
```

---

## Task 7: Request Timeout Middleware

**Files:**
- Create: `backend/src/middleware/requestTimeout.ts`
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Create requestTimeout.ts**

```typescript
import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

/**
 * Request timeout middleware.
 * @param ms - Timeout in milliseconds (default: 30000)
 */
export const requestTimeout = (ms = 30000) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn(`Request timeout after ${ms}ms: ${req.method} ${req.path}`);
        res.status(408).json({ error: 'Request timeout' });
      }
    }, ms);

    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));

    next();
  };
};
```

- [ ] **Step 2: Apply globally in server.ts**

In `backend/src/server.ts`, import and apply before route handlers:

```typescript
import { requestTimeout } from './middleware/requestTimeout';
```

Add after the CORS/body-parser middleware, before route mounts:

```typescript
app.use(requestTimeout(30000));
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/middleware/requestTimeout.ts backend/src/server.ts
git commit -m "feat(perf): add request timeout middleware (30s default)"
```

---

## Task 8: Per-Tenant Rate Limiter

**Files:**
- Create: `backend/src/middleware/tenantRateLimiter.ts`

- [ ] **Step 1: Create tenantRateLimiter.ts**

```typescript
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { redis } from './cache.middleware';
import prisma from '../utils/prisma';
import logger from '../utils/logger';

/**
 * Per-tenant rate limiting middleware using Redis sliding window.
 * Only active when tenant.rateLimitEnabled is true.
 * Applied after authenticate middleware (needs req.user.tenantId).
 */
export const tenantRateLimiter = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return next(); // No tenant context (platform admin or unauthenticated)

    // Check if rate limiting is enabled for this tenant (cached 60s)
    const cacheKey = `ratelimit:config:${tenantId}`;
    let configStr = await redis.get(cacheKey);

    if (configStr === null) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { rateLimitEnabled: true, rateLimitConfig: true },
      });

      if (!tenant || !tenant.rateLimitEnabled) {
        // Cache the "disabled" state for 60s to avoid DB hit every request
        await redis.setex(cacheKey, 60, JSON.stringify({ enabled: false }));
        return next();
      }

      const config = (tenant.rateLimitConfig as any) || { requestsPer15Min: 5000, burstPerSec: 50 };
      configStr = JSON.stringify({ enabled: true, ...config });
      await redis.setex(cacheKey, 60, configStr);
    }

    const config = JSON.parse(configStr);
    if (!config.enabled) return next();

    const windowMs = 15 * 60 * 1000;
    const maxRequests = config.requestsPer15Min || 5000;
    const windowKey = `ratelimit:tenant:${tenantId}:${Math.floor(Date.now() / windowMs)}`;

    const current = await redis.incr(windowKey);
    if (current === 1) {
      await redis.expire(windowKey, Math.ceil(windowMs / 1000));
    }

    const remaining = Math.max(0, maxRequests - current);
    const resetTime = Math.ceil((Math.floor(Date.now() / windowMs) + 1) * windowMs / 1000);

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetTime);

    if (current > maxRequests) {
      const retryAfter = Math.ceil((resetTime * 1000 - Date.now()) / 1000);
      res.setHeader('Retry-After', retryAfter);
      logger.warn(`Tenant ${tenantId} rate limited: ${current}/${maxRequests}`);
      res.status(429).json({ error: 'Too many requests. Please try again later.' });
      return;
    }

    next();
  } catch (err) {
    // On Redis failure, don't block the request
    logger.error('Tenant rate limiter error:', err);
    next();
  }
};
```

- [ ] **Step 2: Apply in server.ts after authenticate on API routes**

In `backend/src/server.ts`, import:

```typescript
import { tenantRateLimiter } from './middleware/tenantRateLimiter';
```

Apply globally after body parsing, before routes (it safely no-ops when no tenant context):

```typescript
app.use(tenantRateLimiter);
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/middleware/tenantRateLimiter.ts backend/src/server.ts
git commit -m "feat(perf): add per-tenant rate limiter with Redis sliding window"
```

---

## Task 9: Tenant-Aware Redis Cache Keys

**Files:**
- Modify: `backend/src/middleware/cache.middleware.ts`

- [ ] **Step 1: Update cache key generation to include tenant context**

In `backend/src/middleware/cache.middleware.ts`, import `getTenantId`:

```typescript
import { getTenantId } from '../utils/tenantContext';
```

Update the `cacheMiddleware` function's key generation (replace the existing `const cacheKey = ...` line):

```typescript
const tenantId = getTenantId();
const tenantPrefix = tenantId ? `tenant:${tenantId}` : 'platform';
const cacheKey = `${keyPrefix}:${tenantPrefix}:${req.path}${queryString}`;
```

- [ ] **Step 2: Verify backend builds**

```bash
cd backend && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/middleware/cache.middleware.ts
git commit -m "feat(perf): add tenant-aware Redis cache key partitioning"
```

---

## Task 10: Connection Pool Tuning + Documentation

**Files:**
- Modify: `backend/.env.example`

- [ ] **Step 1: Update .env.example with pool params**

Add a comment block above or replacing the existing DATABASE_URL line:

```bash
# Database — connection pool params (tune for production):
#   connection_limit=20  (max pool connections, Prisma default is num_cpus * 2 + 1)
#   pool_timeout=10      (seconds to wait for available connection)
#   connect_timeout=5    (seconds to wait for new connection)
DATABASE_URL="postgresql://user:password@localhost:5432/ecommerce_cod?connection_limit=20&pool_timeout=10&connect_timeout=5"
```

- [ ] **Step 2: Commit**

```bash
git add backend/.env.example
git commit -m "docs(perf): add connection pool tuning params to .env.example"
```

---

## Task 11: Frontend — Platform Service + Store

**Files:**
- Create: `frontend/src/services/platform.service.ts`
- Create: `frontend/src/stores/platformStore.ts`

- [ ] **Step 1: Create platform.service.ts**

```typescript
import { apiClient } from './api';

export interface PlatformMetrics {
  totalTenants: number;
  activeTenants: number;
  mrr: number;
  activeUsers: number;
  ordersThisMonth: number;
}

export interface TrendData {
  date: string;
  newTenants: number;
  revenue: number;
  orders: number;
}

export interface TenantListItem {
  id: string;
  name: string;
  slug: string;
  subscriptionStatus: string;
  createdAt: string;
  rateLimitEnabled: boolean;
  rateLimitConfig: { requestsPer15Min: number; burstPerSec: number } | null;
  currentPlan: { name: string; displayName: string } | null;
  _count: { users: number; orders: number };
}

export interface TenantDetail extends TenantListItem {
  region: string | null;
  currency: string;
  usage: {
    ordersThisMonth: number;
    revenueThisMonth: number;
    totalUsers: number;
  };
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  type: string;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export const platformService = {
  // Metrics
  async getMetrics(): Promise<PlatformMetrics> {
    const res = await apiClient.get('/api/platform/metrics');
    return res.data;
  },

  async getTrends(period = '30d'): Promise<{ data: TrendData[] }> {
    const res = await apiClient.get('/api/platform/metrics/trends', { params: { period } });
    return res.data;
  },

  // Tenants
  async listTenants(params?: { search?: string; plan?: string; status?: string; page?: number; limit?: number }): Promise<{
    tenants: TenantListItem[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const res = await apiClient.get('/api/platform/tenants', { params });
    return res.data;
  },

  async getTenant(id: string): Promise<TenantDetail> {
    const res = await apiClient.get(`/api/platform/tenants/${id}`);
    return res.data;
  },

  async createTenant(data: { name: string; slug: string; planName?: string; region?: string; currency?: string }): Promise<TenantListItem> {
    const res = await apiClient.post('/api/platform/tenants', data);
    return res.data;
  },

  async updateTenant(id: string, data: Record<string, any>): Promise<TenantDetail> {
    const res = await apiClient.put(`/api/platform/tenants/${id}`, data);
    return res.data;
  },

  async suspendTenant(id: string): Promise<void> {
    await apiClient.post(`/api/platform/tenants/${id}/suspend`);
  },

  async reactivateTenant(id: string): Promise<void> {
    await apiClient.post(`/api/platform/tenants/${id}/reactivate`);
  },

  async deleteTenant(id: string, confirmSlug: string): Promise<void> {
    await apiClient.delete(`/api/platform/tenants/${id}`, { data: { confirmSlug } });
  },

  // Announcements
  async listAnnouncements(): Promise<{ announcements: Announcement[] }> {
    const res = await apiClient.get('/api/platform/announcements');
    return res.data;
  },

  async getActiveAnnouncements(): Promise<{ announcements: Announcement[] }> {
    const res = await apiClient.get('/api/platform/announcements/active');
    return res.data;
  },

  async createAnnouncement(data: { title: string; body: string; type?: string; expiresAt?: string }): Promise<Announcement> {
    const res = await apiClient.post('/api/platform/announcements', data);
    return res.data;
  },

  async deleteAnnouncement(id: string): Promise<void> {
    await apiClient.delete(`/api/platform/announcements/${id}`);
  },

  // Health
  async getHealth(): Promise<any> {
    const res = await apiClient.get('/api/platform/health');
    return res.data;
  },
};
```

- [ ] **Step 2: Create platformStore.ts**

```typescript
import { create } from 'zustand';
import { platformService, PlatformMetrics, TrendData, TenantListItem, TenantDetail, Announcement } from '../services/platform.service';
import toast from 'react-hot-toast';

interface PlatformState {
  metrics: PlatformMetrics | null;
  trends: TrendData[];
  tenants: TenantListItem[];
  tenantsTotal: number;
  tenantsPage: number;
  tenantsTotalPages: number;
  currentTenant: TenantDetail | null;
  announcements: Announcement[];
  isLoading: boolean;

  fetchMetrics: () => Promise<void>;
  fetchTrends: (period?: string) => Promise<void>;
  fetchTenants: (params?: { search?: string; plan?: string; status?: string; page?: number }) => Promise<void>;
  fetchTenant: (id: string) => Promise<void>;
  createTenant: (data: { name: string; slug: string; planName?: string; region?: string; currency?: string }) => Promise<void>;
  updateTenant: (id: string, data: Record<string, any>) => Promise<void>;
  suspendTenant: (id: string) => Promise<void>;
  reactivateTenant: (id: string) => Promise<void>;
  deleteTenant: (id: string, confirmSlug: string) => Promise<void>;
  fetchAnnouncements: () => Promise<void>;
  createAnnouncement: (data: { title: string; body: string; type?: string; expiresAt?: string }) => Promise<void>;
  deleteAnnouncement: (id: string) => Promise<void>;
}

export const usePlatformStore = create<PlatformState>((set, get) => ({
  metrics: null,
  trends: [],
  tenants: [],
  tenantsTotal: 0,
  tenantsPage: 1,
  tenantsTotalPages: 1,
  currentTenant: null,
  announcements: [],
  isLoading: false,

  fetchMetrics: async () => {
    try {
      const metrics = await platformService.getMetrics();
      set({ metrics });
    } catch { toast.error('Failed to load platform metrics'); }
  },

  fetchTrends: async (period = '30d') => {
    try {
      const { data } = await platformService.getTrends(period);
      set({ trends: data });
    } catch { toast.error('Failed to load trends'); }
  },

  fetchTenants: async (params) => {
    set({ isLoading: true });
    try {
      const result = await platformService.listTenants(params);
      set({ tenants: result.tenants, tenantsTotal: result.total, tenantsPage: result.page, tenantsTotalPages: result.totalPages });
    } catch { toast.error('Failed to load tenants'); }
    finally { set({ isLoading: false }); }
  },

  fetchTenant: async (id) => {
    set({ isLoading: true });
    try {
      const tenant = await platformService.getTenant(id);
      set({ currentTenant: tenant });
    } catch { toast.error('Failed to load tenant'); }
    finally { set({ isLoading: false }); }
  },

  createTenant: async (data) => {
    await platformService.createTenant(data);
    toast.success('Tenant created');
    get().fetchTenants();
  },

  updateTenant: async (id, data) => {
    await platformService.updateTenant(id, data);
    toast.success('Tenant updated');
    get().fetchTenant(id);
  },

  suspendTenant: async (id) => {
    await platformService.suspendTenant(id);
    toast.success('Tenant suspended');
    get().fetchTenant(id);
  },

  reactivateTenant: async (id) => {
    await platformService.reactivateTenant(id);
    toast.success('Tenant reactivated');
    get().fetchTenant(id);
  },

  deleteTenant: async (id, confirmSlug) => {
    await platformService.deleteTenant(id, confirmSlug);
    toast.success('Tenant deleted');
  },

  fetchAnnouncements: async () => {
    try {
      const { announcements } = await platformService.listAnnouncements();
      set({ announcements });
    } catch { toast.error('Failed to load announcements'); }
  },

  createAnnouncement: async (data) => {
    await platformService.createAnnouncement(data);
    toast.success('Announcement created');
    get().fetchAnnouncements();
  },

  deleteAnnouncement: async (id) => {
    await platformService.deleteAnnouncement(id);
    toast.success('Announcement deleted');
    get().fetchAnnouncements();
  },
}));
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/platform.service.ts frontend/src/stores/platformStore.ts
git commit -m "feat(platform): add frontend service and Zustand store for platform API"
```

---

## Task 12: Frontend — Platform Dashboard Page

**Files:**
- Create: `frontend/src/pages/PlatformDashboard.tsx`

- [ ] **Step 1: Create PlatformDashboard.tsx**

Build the dashboard page with:
- 4 stat cards (Total Tenants, MRR, Active Users, Orders This Month) using the Card component
- Trends chart using Recharts (LineChart with revenue and newTenants lines)
- Period selector (30d / 90d / 1y)
- Uses `usePlatformStore` to fetch data on mount

Follow the existing Dashboard.tsx pattern for stat cards and chart layout. Use Shadcn Card, Tailwind grid layout (`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4`).

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/PlatformDashboard.tsx
git commit -m "feat(platform): add PlatformDashboard page with metrics and trends"
```

---

## Task 13: Frontend — Tenants List + Detail Pages

**Files:**
- Create: `frontend/src/pages/PlatformTenants.tsx`
- Create: `frontend/src/pages/PlatformTenantDetail.tsx`

- [ ] **Step 1: Create PlatformTenants.tsx**

Tenant list page with:
- Search input, plan filter dropdown, status filter dropdown
- Table with columns: Name, Slug, Plan (badge), Status (badge), Users, Orders, Created
- Pagination controls
- Create Tenant button + modal (name, slug, plan selector)
- Row click navigates to `/platform/tenants/:id`

- [ ] **Step 2: Create PlatformTenantDetail.tsx**

Tenant detail page with:
- Back link to `/platform/tenants`
- Summary card (name, slug, plan badge, status badge, region, currency, created date)
- Usage section (orders this month, revenue, users)
- Plan management: select dropdown with plans, Save button
- Rate limiting section: toggle switch, requestsPer15Min input, burstPerSec input, Save button
- Danger zone (red border): Suspend/Reactivate button, Delete button with slug confirmation dialog

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/PlatformTenants.tsx frontend/src/pages/PlatformTenantDetail.tsx
git commit -m "feat(platform): add PlatformTenants list and TenantDetail pages"
```

---

## Task 14: Frontend — Announcements Page + Banner Component

**Files:**
- Create: `frontend/src/pages/PlatformAnnouncements.tsx`
- Create: `frontend/src/components/announcements/AnnouncementBanner.tsx`

- [ ] **Step 1: Create PlatformAnnouncements.tsx**

Announcements management page with:
- Table: title, type badge (info=blue, warning=yellow, maintenance=red), active status, expires, created
- Create button + modal (title, body textarea, type selector, optional expiry date picker)
- Delete action with confirmation

- [ ] **Step 2: Create AnnouncementBanner.tsx**

```typescript
import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { platformService, Announcement } from '../../services/platform.service';

const typeStyles: Record<string, string> = {
  info: 'bg-blue-50 text-blue-800 border-blue-200',
  warning: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  maintenance: 'bg-red-50 text-red-800 border-red-200',
};

export const AnnouncementBanner: React.FC = () => {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  useEffect(() => {
    const fetchAnnouncements = async () => {
      try {
        const { announcements } = await platformService.getActiveAnnouncements();
        const dismissed = JSON.parse(sessionStorage.getItem('dismissed-announcements') || '[]');
        setAnnouncements(announcements.filter(a => !dismissed.includes(a.id)));
      } catch { /* silent — banner is non-critical */ }
    };

    fetchAnnouncements();
    const interval = setInterval(fetchAnnouncements, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const dismiss = (id: string) => {
    const dismissed = JSON.parse(sessionStorage.getItem('dismissed-announcements') || '[]');
    sessionStorage.setItem('dismissed-announcements', JSON.stringify([...dismissed, id]));
    setAnnouncements(prev => prev.filter(a => a.id !== id));
  };

  if (announcements.length === 0) return null;

  return (
    <div className="space-y-1">
      {announcements.map(a => (
        <div key={a.id} className={`flex items-center justify-between px-4 py-2 border rounded-lg text-sm ${typeStyles[a.type] || typeStyles.info}`}>
          <span><strong>{a.title}</strong> — {a.body}</span>
          <button onClick={() => dismiss(a.id)} className="ml-4 p-1 hover:opacity-70">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/PlatformAnnouncements.tsx frontend/src/components/announcements/AnnouncementBanner.tsx
git commit -m "feat(platform): add Announcements page and AnnouncementBanner component"
```

---

## Task 15: Frontend — Routing, Sidebar, Layout Integration

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`
- Modify: Layout component that wraps page content (find the component that renders `<Outlet />`)

- [ ] **Step 1: Add lazy imports in App.tsx**

```typescript
const PlatformDashboard = lazy(() => import('./pages/PlatformDashboard').then(m => ({ default: m.PlatformDashboard })));
const PlatformTenants = lazy(() => import('./pages/PlatformTenants').then(m => ({ default: m.PlatformTenants })));
const PlatformTenantDetail = lazy(() => import('./pages/PlatformTenantDetail').then(m => ({ default: m.PlatformTenantDetail })));
const PlatformAnnouncements = lazy(() => import('./pages/PlatformAnnouncements').then(m => ({ default: m.PlatformAnnouncements })));
```

- [ ] **Step 2: Add routes inside the main layout Route**

```typescript
<Route path="platform" element={<Suspense fallback={<Loading />}><PlatformDashboard /></Suspense>} />
<Route path="platform/tenants" element={<Suspense fallback={<Loading />}><PlatformTenants /></Suspense>} />
<Route path="platform/tenants/:id" element={<Suspense fallback={<Loading />}><PlatformTenantDetail /></Suspense>} />
<Route path="platform/announcements" element={<Suspense fallback={<Loading />}><PlatformAnnouncements /></Suspense>} />
```

- [ ] **Step 3: Add Platform section to Sidebar.tsx**

In `frontend/src/components/layout/Sidebar.tsx`, add platform menu items before the existing `menuItems` array. Conditionally render a "PLATFORM" section header + platform links only when `user?.role === 'super_admin'`. Use icons: `LayoutGrid` for Dashboard, `Building2` for Tenants, `Megaphone` for Announcements (from lucide-react).

- [ ] **Step 4: Add AnnouncementBanner to the main layout**

Find the layout component that wraps page content (the component with `<Outlet />`). Add `<AnnouncementBanner />` above the `<Outlet />` so it appears on every page for all authenticated users.

- [ ] **Step 5: Verify frontend builds**

```bash
cd frontend && npm run build
```

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/layout/Sidebar.tsx
git commit -m "feat(platform): integrate platform routes, sidebar nav, and announcement banner"
```

---

## Task 16: Docker Rebuild + Full Verification

**Files:** None (verification only)

- [ ] **Step 1: Rebuild Docker containers**

```bash
cd /Users/mac/Downloads/claude/ecommerce-cod-admin
docker compose -f docker-compose.dev.yml build
docker compose -f docker-compose.dev.yml up -d
```

- [ ] **Step 2: Run backend tests**

```bash
docker compose -f docker-compose.dev.yml exec backend npm test
```

Expected: All tests pass.

- [ ] **Step 3: Run frontend build**

```bash
docker compose -f docker-compose.dev.yml build frontend
```

Expected: Build succeeds.

- [ ] **Step 4: Manual QA via browser**

1. Login as super_admin (admin@codadmin.com / password123)
2. Verify "Platform" section appears in sidebar
3. Navigate to `/platform` — metrics cards load
4. Navigate to `/platform/tenants` — tenant list loads
5. Click a tenant — detail page loads with usage stats
6. Navigate to `/platform/announcements` — create an announcement
7. Verify announcement banner appears on dashboard page
8. Login as a non-super_admin — verify Platform section is hidden but banner shows

- [ ] **Step 5: Commit any fixes and push**

```bash
git push -u origin feature/man-46-47-platform-dashboard
```

---

## Verification Checklist

- [ ] Backend builds without TypeScript errors
- [ ] All backend tests pass
- [ ] Frontend builds without errors
- [ ] Platform routes return correct data (test with curl or browser)
- [ ] Sidebar shows Platform section for super_admin only
- [ ] Announcement banner renders for all authenticated users
- [ ] Rate limiting toggle works in tenant detail (check Redis keys)
- [ ] Cache keys include tenant prefix (check Redis with `redis-cli keys 'cache:*'`)
- [ ] Request timeout returns 408 for slow requests (test with a sleep endpoint if needed)
