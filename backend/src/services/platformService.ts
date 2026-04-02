import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { redis } from '../middleware/cache.middleware';

// ── Metrics ──────────────────────────────────────────────

export async function getPlatformMetrics() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [totalTenants, activeTenants, suspendedTenants, activeUsers, plans] = await Promise.all([
    prisma.tenant.count(),
    prisma.tenant.count({ where: { subscriptionStatus: 'active' } }),
    prisma.tenant.count({ where: { subscriptionStatus: 'suspended' } }),
    prisma.user.count({ where: { lastLogin: { gte: thirtyDaysAgo }, isActive: true } }),
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

  return { totalTenants, activeTenants, suspendedTenants, mrr, activeUsers };
}

export async function getPlatformTrends(period: string) {
  const days = period === '90d' ? 90 : period === '1y' ? 365 : 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Get all tenants (including those created before the period for cumulative count)
  const [tenantsBeforePeriod, tenantsDuringPeriod] = await Promise.all([
    prisma.tenant.count({ where: { createdAt: { lt: since } } }),
    prisma.tenant.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  // Group new tenants by date
  const dataMap = new Map<string, { date: string; newTenants: number; totalTenants: number }>();
  const toDateKey = (d: Date) => d.toISOString().split('T')[0];

  for (const t of tenantsDuringPeriod) {
    const key = toDateKey(t.createdAt);
    const entry = dataMap.get(key) || { date: key, newTenants: 0, totalTenants: 0 };
    entry.newTenants++;
    dataMap.set(key, entry);
  }

  // Fill cumulative tenant count
  const sorted = Array.from(dataMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  let running = tenantsBeforePeriod;
  for (const entry of sorted) {
    running += entry.newTenants;
    entry.totalTenants = running;
  }

  return { data: sorted };
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

  const updateData: any = { ...data };
  return prisma.tenant.update({
    where: { id },
    data: updateData,
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
  await prisma.$transaction(async (tx) => {
    const tenantFilter = { where: { tenantId: id } };
    await tx.workflowExecution.deleteMany(tenantFilter);
    await tx.workflow.deleteMany(tenantFilter);
    await tx.notification.deleteMany(tenantFilter);
    await tx.webhookConfig.deleteMany(tenantFilter);
    await tx.accountTransaction.deleteMany(tenantFilter);
    await tx.journalEntry.deleteMany(tenantFilter);
    await tx.account.deleteMany(tenantFilter);
    await tx.delivery.deleteMany(tenantFilter);
    await tx.order.deleteMany(tenantFilter);
    await tx.customer.deleteMany(tenantFilter);
    await tx.product.deleteMany(tenantFilter);
    await tx.transaction.deleteMany(tenantFilter);
    await tx.expense.deleteMany(tenantFilter);
    await tx.checkoutForm.deleteMany(tenantFilter);
    await tx.agentBalance.deleteMany(tenantFilter);
    await tx.agentStock.deleteMany(tenantFilter);
    await tx.inventoryShipment.deleteMany(tenantFilter);
    await tx.inventoryTransfer.deleteMany(tenantFilter);
    await tx.messageLog.deleteMany(tenantFilter);
    await tx.user.deleteMany(tenantFilter);
    await tx.tenant.delete({ where: { id } });
  });

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
