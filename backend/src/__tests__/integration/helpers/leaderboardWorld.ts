/** Shared by the M6 leaderboard tests (T11, T23): a small world of users, targets and orders for one tenant. */
import { prismaBase } from '../../../utils/prisma';
import { generateAccessToken } from '../../../utils/jwt';

const SUFFIX = Date.now();
let seq = 0;

/** A small world for one tenant: users, targets and orders by helper. */
export function world(tenantId: string, customerId: () => number, callRepRoleId: () => number, deliveryRoleId: () => number) {
  const user = async (label: string, role: 'sales_rep' | 'delivery_agent', kind: 'person' | 'ai_agent' | 'company', roleId: number, hold = true) => {
    const name = `${label}${SUFFIX}x${seq++}`;
    const u = await prismaBase.user.create({
      data: { email: `${name}@codadmin.test`, password: 'x', firstName: kind === 'person' ? name : name, lastName: kind === 'person' ? 'Lb' : 'Lb', role, kind, tenantId },
    });
    if (hold) await prismaBase.roleAssignment.create({ data: { tenantId, roleId, holderId: u.id, fromDate: new Date('2026-01-01') } });
    return { ...u, name: kind === 'person' ? `${name} Lb` : name, token: generateAccessToken({ id: u.id, email: u.email, role, tenantId }) };
  };
  const target = (userId: number, roleId: number, month: { start: Date; end: Date }, metric: string, value: number) =>
    prismaBase.target.create({ data: { tenantId, scope: 'person', metric, unit: metric === 'delivery_success_rate' ? 'percent' : 'count', periodStart: month.start, periodEnd: month.end, value, roleId, userId } });
  const order = (extra: Record<string, unknown>) => prismaBase.order.create({
    data: {
      tenantId, customerId: customerId(), status: 'delivered', subtotal: '10', totalAmount: '10', codAmount: '10',
      deliveryAddress: 'x', deliveryState: 'Greater Accra', deliveryArea: 'Accra', ...extra,
    } as never,
  });
  /** n delivered orders confirmed by the rep, delivered on `on`, placed on `on` too. */
  const repDelivered = async (repId: number, n: number, on: string) => {
    for (let i = 0; i < n; i++) await order({ confirmedById: repId, customerRepId: repId, confirmedAt: new Date(on), deliveryDate: new Date(on), createdAt: new Date(on) });
  };
  /** n orders that closed as `status` for a delivery partner. */
  const closed = async (partnerId: number, n: number, status: 'delivered' | 'returned', on: string, extra: Record<string, unknown> = {}) => {
    const rows = [];
    for (let i = 0; i < n; i++) {
      rows.push(await order({
        deliveryAgentId: partnerId, status, createdAt: new Date(on),
        ...(status === 'delivered' ? { deliveryDate: new Date(on) } : { returnedAt: new Date(on) }), ...extra,
      }));
    }
    return rows;
  };
  return { user, target, order, repDelivered, closed, callRepRoleId, deliveryRoleId };
}
