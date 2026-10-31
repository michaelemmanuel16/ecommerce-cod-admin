/**
 * M6-T01 (COD-56): the roles, targets and rewards schema. The new tables exist with a required tenant_id,
 * keep their unique keys, store money as Decimal, and go with the tenant when it is purged.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { purgeTenantRows } from '../../services/platformService';
import { createTwoTenants, createTenant, mkUser, TwoTenants } from './helpers/twoTenants';

let pair: TwoTenants;

beforeAll(async () => {
  pair = await createTwoTenants('m6schema');
}, 30000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

type ColumnRow = { table_name: string; column_name: string; is_nullable: string; data_type: string; numeric_precision: number | null; numeric_scale: number | null };

async function columns(tables: string[]): Promise<ColumnRow[]> {
  return prismaBase.$queryRaw<ColumnRow[]>`
    SELECT table_name, column_name, is_nullable, data_type, numeric_precision, numeric_scale
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY(${tables})`;
}

describe('M6 schema', () => {
  it('every new table has tenant_id NOT NULL', async () => {
    const tables = ['reward_tiers', 'badge_awards', 'assignment_cursors'];
    const rows = (await columns(tables)).filter((c) => c.column_name === 'tenant_id');
    expect(rows.map((r) => r.table_name).sort()).toEqual([...tables].sort());
    expect(rows.every((r) => r.is_nullable === 'NO')).toBe(true);
  });

  it('the reward amount is numeric(19,4)', async () => {
    const col = (await columns(['reward_tiers'])).find((r) => r.column_name === 'amount')!;
    expect(col.data_type).toBe('numeric');
    expect([col.numeric_precision, col.numeric_scale]).toEqual([19, 4]);
  });

  it('reward tier is unique per (tenant, role, threshold) and keeps the amount exactly', async () => {
    const { a } = pair;
    const tier = await prismaBase.rewardTier.findFirstOrThrow({ where: { tenantId: a.id } });
    expect(tier.amount.toString()).toBe('300');
    await expect(
      prismaBase.rewardTier.create({ data: { tenantId: a.id, roleId: tier.roleId, threshold: tier.threshold, amount: '1' } }),
    ).rejects.toThrow();
    const higher = await prismaBase.rewardTier.create({
      data: { tenantId: a.id, roleId: tier.roleId, threshold: 120, amount: '500.5', dayOff: true },
    });
    expect(higher.amount.toString()).toBe('500.5');
    expect(higher.payout).toBe(true);
  });

  it('a badge cannot be awarded twice for one period', async () => {
    const { a } = pair;
    const data = { tenantId: a.id, userId: a.users.admin.id, key: 'beat_target_20', period: '2026-10' };
    await prismaBase.badgeAward.create({ data });
    await expect(prismaBase.badgeAward.create({ data })).rejects.toThrow();
    const next = await prismaBase.badgeAward.create({ data: { ...data, period: '2026-11' } });
    expect(next.period).toBe('2026-11');
  });

  it('the assignment cursor is unique per (tenant, scope, role) and starts at position 0', async () => {
    const { a, b } = pair;
    const data = { tenantId: a.id, scope: 'workflow-7', role: 'sales_rep' as const };
    const cursor = await prismaBase.assignmentCursor.create({ data });
    expect(cursor.position).toBe(0);
    await expect(prismaBase.assignmentCursor.create({ data })).rejects.toThrow();
    // the same scope and role in another tenant is a different cursor
    await prismaBase.assignmentCursor.create({ data: { ...data, tenantId: b.id } });
  });

  it('a month-close reward entry is unique per (tenant, user, kind, month, role); base entries are not blocked', async () => {
    const { a } = pair;
    const userId = a.users.salesRep.id;
    const reward = { tenantId: a.id, userId, kind: 'reward' as const, status: 'earned' as const, amount: '300', period: '2026-10', roleId: a.ids.role };
    await prismaBase.commissionEntry.create({ data: reward });
    await expect(prismaBase.commissionEntry.create({ data: reward })).rejects.toThrow();
    // another month is a new reward
    await prismaBase.commissionEntry.create({ data: { ...reward, period: '2026-11' } });
    // base entries carry no period or role, so two of them for one person never collide
    const base = { tenantId: a.id, userId, kind: 'base' as const, status: 'earned' as const, amount: '8' };
    await prismaBase.commissionEntry.create({ data: base });
    await prismaBase.commissionEntry.create({ data: base });
  });

  it('role, role assignment, target and user take the new columns', async () => {
    const { a } = pair;
    const role = await prismaBase.role.update({
      where: { id: a.ids.role },
      data: { permissions: { orders: ['view'] }, targetMetric: 'confirmed_delivered_orders', presetRole: 'super_admin' },
    });
    expect(role.permissions).toEqual({ orders: ['view'] });
    expect(role.targetMetric).toBe('confirmed_delivered_orders');
    expect(role.presetRole).toBe('super_admin');

    const target = await prismaBase.target.create({
      data: {
        tenantId: a.id, scope: 'role', metric: 'planned_aov', unit: 'GHS', value: '249',
        periodStart: new Date('2026-10-01'), periodEnd: new Date('2026-10-31'), roleId: role.id,
      },
    });
    expect(target.source).toBe('auto');
    expect(target.roleId).toBe(role.id);

    await prismaBase.user.update({
      where: { id: a.users.salesRep.id },
      data: { invitedAt: new Date(), inviteTokenHash: `hash-${a.id}`, inviteExpiresAt: new Date(Date.now() + 7 * 864e5) },
    });
    // the invite hash is unique: one link, one person
    await expect(
      prismaBase.user.update({ where: { id: a.users.deliveryAgent.id }, data: { inviteTokenHash: `hash-${a.id}` } }),
    ).rejects.toThrow();
  });

  it('the tenant purge removes the new tables with the tenant', async () => {
    // A small tenant of its own: purgeTenantRows on a fully seeded tenant stops earlier, on journal entries (not part of M6).
    const { id: tenantId } = await createTenant('m6 purge');
    const { id: userId } = await mkUser(tenantId, 'purge', 'admin');
    const role = await prismaBase.role.create({ data: { tenantId, name: 'Purge role' } });
    const roleId = role.id;
    const period = { periodStart: new Date('2026-10-01'), periodEnd: new Date('2026-10-31') };
    await Promise.all([
      prismaBase.roleAssignment.create({ data: { tenantId, roleId, holderId: userId, fromDate: new Date() } }),
      prismaBase.rewardTier.create({ data: { tenantId, roleId, threshold: 100, amount: '300' } }),
      prismaBase.badgeAward.create({ data: { tenantId, userId, key: 'top_of_month', period: '2026-10' } }),
      prismaBase.assignmentCursor.create({ data: { tenantId, scope: 'workflow-1', role: 'sales_rep' } }),
      prismaBase.target.create({ data: { tenantId, scope: 'role', metric: 'delivery_success_rate', unit: 'percent', value: '60', roleId, ...period } }),
      prismaBase.commissionEntry.create({ data: { tenantId, userId, kind: 'reward', status: 'earned', amount: '300', period: '2026-10', roleId } }),
    ]);

    await prismaBase.$transaction((tx) => purgeTenantRows(tx, tenantId));

    const tables = ['reward_tiers', 'badge_awards', 'assignment_cursors', 'targets', 'roles', 'role_assignments', 'commission_entries'];
    const counts = await Promise.all(
      tables.map((table) => prismaBase.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM ${table} WHERE tenant_id = $1`, tenantId)),
    );
    expect(counts.map(([{ n }]) => Number(n))).toEqual(tables.map(() => 0));
    expect(await prismaBase.tenant.count({ where: { id: tenantId } })).toBe(0);
  });
});
