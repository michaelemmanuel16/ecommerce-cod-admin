/**
 * An Admin (base role 'admin') key can list and call `orders_update_status`: the base role holds the
 * `orders:update_status` cell. A tenant whose stored role permissions predate the cell gets it once from the backfill (grantAdminUpdateStatus); a normal seed leaves stored permissions alone.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import { prismaBase } from '../../utils/prisma';
import { allowedTools, runTool } from '../../tools/registry';
import '../../tools';
import { hasPermission } from '../../middleware/auth';
import { grantAdminUpdateStatus, seedTenantDefaults } from '../../services/tenantDefaultsService';
import { runInTenant } from '../../utils/tenantContext';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';

let pair: TwoTenants;

beforeAll(async () => {
  pair = await createTwoTenants('adminupd');
  await prismaBase.order.update({ where: { id: pair.a.ids.order }, data: { status: 'confirmed' } });
}, 30000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('Admin role and orders_update_status', () => {
  it('an Admin key (Owner tool list) lists the tool and can call it', async () => {
    const ctx = { tenantId: pair.a.id, actorId: pair.a.users.admin.id, actorKind: 'ai_agent' as const, roleId: pair.a.ids.role, channel: 'mcp' as const };
    const listed = await runInTenant(pair.a.id, () => allowedTools(ctx));
    expect(listed.map((t) => t.name)).toContain('orders_update_status');
    const res = await runTool('orders_update_status', { orderId: pair.a.ids.order, status: 'preparing' }, ctx);
    expect(res.status).toBe('ok');
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: pair.a.ids.order } })).status).toBe('preparing');
  });

  it('the backfill adds the cell to older stored permissions once and removes nothing; a normal seed does not add it', async () => {
    const stored = { admin: { orders: ['view', 'update'], users: ['view'] }, manager: { orders: ['view'] } };
    await prismaBase.systemConfig.upsert({
      where: { tenantId: pair.b.id }, update: { rolePermissions: stored }, create: { tenantId: pair.b.id, rolePermissions: stored },
    });
    const read = async () => (await prismaBase.systemConfig.findUniqueOrThrow({ where: { tenantId: pair.b.id } })).rolePermissions as any;

    await seedTenantDefaults(pair.b.id);
    expect(await read()).toEqual(stored);

    await grantAdminUpdateStatus(pair.b.id);
    const after = await read();
    expect(after.admin.orders).toEqual(['view', 'update', 'update_status']);
    expect(after.admin.users).toEqual(['view']);
    expect(after.manager).toEqual({ orders: ['view'] });

    await grantAdminUpdateStatus(pair.b.id);
    expect(await read()).toEqual(after);
    expect(await runInTenant(pair.b.id, () => hasPermission({ role: 'admin' }, 'orders', 'update_status'))).toBe(true);
  });
});
