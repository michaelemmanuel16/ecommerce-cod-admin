import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';

// Mock Redis before importing the service
const mockRedisInfo = jest.fn<() => Promise<string>>();
jest.mock('../../middleware/cache.middleware', () => ({
  redis: { info: mockRedisInfo },
}));

import {
  getPlatformMetrics,
  listTenants,
  getTenantDetail,
  createTenant,
  suspendTenant,
  deleteTenant,
  getActiveAnnouncements,
  createAnnouncement,
  getSystemHealth,
} from '../../services/platformService';
import { AppError } from '../../middleware/errorHandler';

beforeEach(() => {
  mockRedisInfo.mockReset();
});

// ── getPlatformMetrics ────────────────────────────────────

describe('getPlatformMetrics', () => {
  it('should return correct shape with computed mrr', async () => {
    prismaMock.tenant.count
      .mockResolvedValueOnce(10)  // totalTenants
      .mockResolvedValueOnce(7)   // activeTenants
      .mockResolvedValueOnce(2);  // suspendedTenants

    prismaMock.user.count.mockResolvedValueOnce(42); // activeUsers

    prismaMock.plan.findMany.mockResolvedValueOnce([
      { id: 'plan-1', name: 'starter', priceGHS: 50, isActive: true } as any,
      { id: 'plan-2', name: 'pro', priceGHS: 150, isActive: true } as any,
    ]);

    prismaMock.tenant.groupBy.mockResolvedValueOnce([
      { currentPlanId: 'plan-1', _count: 3 } as any,
      { currentPlanId: 'plan-2', _count: 2 } as any,
    ]);

    const result = await getPlatformMetrics();

    expect(result.totalTenants).toBe(10);
    expect(result.activeTenants).toBe(7);
    expect(result.suspendedTenants).toBe(2);
    expect(result.activeUsers).toBe(42);
    // MRR = (3 * 50) + (2 * 150) = 150 + 300 = 450
    expect(result.mrr).toBe(450);
  });

  it('should return zero mrr when no active tenants with plans', async () => {
    prismaMock.tenant.count.mockResolvedValue(0);
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.plan.findMany.mockResolvedValueOnce([]);
    prismaMock.tenant.groupBy.mockResolvedValueOnce([]);

    const result = await getPlatformMetrics();

    expect(result.totalTenants).toBe(0);
    expect(result.mrr).toBe(0);
  });
});

// ── listTenants ───────────────────────────────────────────

describe('listTenants', () => {
  const mockTenants = [
    {
      id: 'tenant-1',
      name: 'Acme Corp',
      slug: 'acme',
      subscriptionStatus: 'active',
      currentPlan: { name: 'starter', displayName: 'Starter' },
      _count: { users: 5, orders: 20 },
    },
  ];

  it('should use default page=1 when page not provided', async () => {
    prismaMock.tenant.findMany.mockResolvedValueOnce(mockTenants as any);
    prismaMock.tenant.count.mockResolvedValueOnce(1);

    const result = await listTenants({});

    expect(result.page).toBe(1);
    expect(result.tenants).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('should pass search filter to where clause as OR on name and slug', async () => {
    prismaMock.tenant.findMany.mockResolvedValueOnce(mockTenants as any);
    prismaMock.tenant.count.mockResolvedValueOnce(1);

    await listTenants({ search: 'acme' });

    const findManyCall = (prismaMock.tenant.findMany as jest.Mock).mock.calls[0][0] as any;
    expect(findManyCall.where.OR).toBeDefined();
    expect(findManyCall.where.OR[0].name.contains).toBe('acme');
    expect(findManyCall.where.OR[1].slug.contains).toBe('acme');
  });

  it('should pass plan filter to where clause', async () => {
    prismaMock.tenant.findMany.mockResolvedValueOnce(mockTenants as any);
    prismaMock.tenant.count.mockResolvedValueOnce(1);

    await listTenants({ plan: 'pro' });

    const findManyCall = (prismaMock.tenant.findMany as jest.Mock).mock.calls[0][0] as any;
    expect(findManyCall.where.currentPlan).toEqual({ name: 'pro' });
  });

  it('should pass status filter to where clause', async () => {
    prismaMock.tenant.findMany.mockResolvedValueOnce(mockTenants as any);
    prismaMock.tenant.count.mockResolvedValueOnce(1);

    await listTenants({ status: 'suspended' });

    const findManyCall = (prismaMock.tenant.findMany as jest.Mock).mock.calls[0][0] as any;
    expect(findManyCall.where.subscriptionStatus).toBe('suspended');
  });

  it('should paginate correctly with skip and take', async () => {
    prismaMock.tenant.findMany.mockResolvedValueOnce(mockTenants as any);
    prismaMock.tenant.count.mockResolvedValueOnce(45);

    const result = await listTenants({ page: 3, limit: 10 });

    const findManyCall = (prismaMock.tenant.findMany as jest.Mock).mock.calls[0][0] as any;
    expect(findManyCall.skip).toBe(20); // (3-1)*10
    expect(findManyCall.take).toBe(10);
    expect(result.totalPages).toBe(5); // ceil(45/10)
  });
});

// ── getTenantDetail ───────────────────────────────────────

describe('getTenantDetail', () => {
  it('should return tenant with usage data when found', async () => {
    const mockTenant = {
      id: 'tenant-1',
      name: 'Acme',
      slug: 'acme',
      subscriptionStatus: 'active',
      currentPlan: { id: 'plan-1', name: 'starter', priceGHS: 50 },
      _count: { users: 4, orders: 10 },
    };

    prismaMock.tenant.findUnique.mockResolvedValueOnce(mockTenant as any);
    prismaMock.order.count.mockResolvedValueOnce(8);
    prismaMock.order.aggregate.mockResolvedValueOnce({
      _sum: { totalAmount: 3200 },
    } as any);

    const result = await getTenantDetail('tenant-1');

    expect(result.id).toBe('tenant-1');
    expect(result.usage.ordersThisMonth).toBe(8);
    expect(result.usage.revenueThisMonth).toBe(3200);
    expect(result.usage.totalUsers).toBe(4);
  });

  it('should throw AppError 404 when tenant not found', async () => {
    prismaMock.tenant.findUnique.mockResolvedValueOnce(null);

    await expect(getTenantDetail('nonexistent')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Tenant not found',
    });
  });
});

// ── createTenant ──────────────────────────────────────────

describe('createTenant', () => {
  it('should create and return tenant on success', async () => {
    prismaMock.tenant.findUnique.mockResolvedValueOnce(null); // no existing slug

    const createdTenant = {
      id: 'new-tenant',
      name: 'New Corp',
      slug: 'new-corp',
      currency: 'GHS',
      subscriptionStatus: 'active',
      currentPlan: null,
    };
    prismaMock.tenant.create.mockResolvedValueOnce(createdTenant as any);

    const result = await createTenant({ name: 'New Corp', slug: 'new-corp' });

    expect(result.id).toBe('new-tenant');
    expect(result.slug).toBe('new-corp');
  });

  it('should throw AppError 409 when slug already exists', async () => {
    prismaMock.tenant.findUnique.mockResolvedValueOnce({
      id: 'existing',
      slug: 'taken-slug',
    } as any);

    await expect(
      createTenant({ name: 'Dupe Corp', slug: 'taken-slug' })
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Tenant slug already exists',
    });
  });
});

// ── suspendTenant ─────────────────────────────────────────

describe('suspendTenant', () => {
  it('should update subscriptionStatus to suspended', async () => {
    prismaMock.tenant.findUnique.mockResolvedValueOnce({
      id: 'tenant-1',
      subscriptionStatus: 'active',
    } as any);

    const updated = { id: 'tenant-1', subscriptionStatus: 'suspended' };
    prismaMock.tenant.update.mockResolvedValueOnce(updated as any);

    const result = await suspendTenant('tenant-1');

    expect((prismaMock.tenant.update as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { id: 'tenant-1' },
      data: { subscriptionStatus: 'suspended' },
    });
    expect(result.subscriptionStatus).toBe('suspended');
  });

  it('should throw AppError 400 when tenant is already suspended', async () => {
    prismaMock.tenant.findUnique.mockResolvedValueOnce({
      id: 'tenant-1',
      subscriptionStatus: 'suspended',
    } as any);

    await expect(suspendTenant('tenant-1')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Tenant is already suspended',
    });
  });
});

// ── deleteTenant ──────────────────────────────────────────

describe('deleteTenant', () => {
  it('should delete tenant when confirmSlug matches', async () => {
    prismaMock.tenant.findUnique.mockResolvedValueOnce({
      id: 'tenant-1',
      slug: 'acme',
    } as any);

    // Mock $transaction to execute the callback with a tx proxy (uses $executeRaw)
    (prismaMock.$transaction as jest.Mock).mockImplementationOnce(
      async (fn: (tx: any) => Promise<any>) => {
        const txMock = {
          $executeRaw: jest.fn<() => Promise<number>>().mockResolvedValue(0),
        };
        return fn(txMock);
      }
    );

    const result = await deleteTenant('tenant-1', 'acme');

    expect(result).toEqual({ deleted: true });
  });

  it('should throw AppError 400 when confirmSlug does not match', async () => {
    prismaMock.tenant.findUnique.mockResolvedValueOnce({
      id: 'tenant-1',
      slug: 'acme',
    } as any);

    await expect(deleteTenant('tenant-1', 'wrong-slug')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Slug confirmation does not match',
    });
  });
});

// ── getActiveAnnouncements ────────────────────────────────

describe('getActiveAnnouncements', () => {
  it('should pass isActive: true filter to prisma', async () => {
    prismaMock.platformAnnouncement.findMany.mockResolvedValueOnce([
      { id: 'ann-1', title: 'Maintenance', isActive: true } as any,
    ]);

    const result = await getActiveAnnouncements();

    const findManyCall = (prismaMock.platformAnnouncement.findMany as jest.Mock).mock.calls[0][0] as any;
    expect(findManyCall.where.isActive).toBe(true);
    expect(result).toHaveLength(1);
  });

  it('should include expiresAt filter in where clause', async () => {
    prismaMock.platformAnnouncement.findMany.mockResolvedValueOnce([]);

    await getActiveAnnouncements();

    const findManyCall = (prismaMock.platformAnnouncement.findMany as jest.Mock).mock.calls[0][0] as any;
    expect(findManyCall.where.OR).toBeDefined();
    expect(findManyCall.where.OR[0]).toEqual({ expiresAt: null });
  });
});

// ── createAnnouncement ────────────────────────────────────

describe('createAnnouncement', () => {
  it('should create announcement with correct fields', async () => {
    const created = {
      id: 'ann-new',
      title: 'New Feature',
      body: 'We launched something cool',
      type: 'info',
      expiresAt: null,
      createdBy: undefined,
    };
    prismaMock.platformAnnouncement.create.mockResolvedValueOnce(created as any);

    const result = await createAnnouncement({
      title: 'New Feature',
      body: 'We launched something cool',
    });

    const createCall = (prismaMock.platformAnnouncement.create as jest.Mock).mock.calls[0][0] as any;
    expect(createCall.data.title).toBe('New Feature');
    expect(createCall.data.body).toBe('We launched something cool');
    expect(createCall.data.type).toBe('info'); // default
    expect(createCall.data.expiresAt).toBeNull();
    expect(result.id).toBe('ann-new');
  });

  it('should use provided type and expiresAt when given', async () => {
    prismaMock.platformAnnouncement.create.mockResolvedValueOnce({} as any);

    await createAnnouncement({
      title: 'Outage',
      body: 'System down',
      type: 'warning',
      expiresAt: '2026-12-31T00:00:00.000Z',
      createdBy: 1,
    });

    const createCall = (prismaMock.platformAnnouncement.create as jest.Mock).mock.calls[0][0] as any;
    expect(createCall.data.type).toBe('warning');
    expect(createCall.data.expiresAt).toBeInstanceOf(Date);
    expect(createCall.data.createdBy).toBe(1);
  });
});

// ── getSystemHealth ───────────────────────────────────────

describe('getSystemHealth', () => {
  it('should return uptime as a number', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }] as any);
    mockRedisInfo.mockResolvedValue('used_memory_human:1.00M\nconnected_clients:1\n');

    const result = await getSystemHealth();

    expect(typeof result.uptime).toBe('number');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
  });

  it('should return database status healthy on successful query', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }] as any);
    mockRedisInfo.mockResolvedValue('used_memory_human:512.00K\nconnected_clients:2\n');

    const result = await getSystemHealth();

    expect(result.database.status).toBe('healthy');
  });

  it('should return database status unhealthy when prisma query throws', async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error('DB connection failed'));
    mockRedisInfo.mockResolvedValue('');

    const result = await getSystemHealth();

    expect(result.database.status).toBe('unhealthy');
  });

  it('should return redis status healthy when redis.info succeeds', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }] as any);
    mockRedisInfo.mockResolvedValue('used_memory_human:256.00K\nconnected_clients:5\n');

    const result = await getSystemHealth();

    expect(result.redis.status).toBe('healthy');
  });

  it('should return redis status unhealthy when redis.info throws', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }] as any);
    mockRedisInfo.mockRejectedValueOnce(new Error('Redis down'));

    const result = await getSystemHealth();

    expect(result.redis.status).toBe('unhealthy');
  });
});
