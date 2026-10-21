/**
 * M1-T08 / M1-T09: order state machine against the test DB. One history row and one version bump per move,
 * the optimistic lock, the delivery-agent rule and the verified-collection block.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import prisma, { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { transitionOrder, OrderTransitionError, TransitionActor } from '../../services/orderStateMachine';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';

const SUFFIX = Date.now();
const ADMIN: TransitionActor = { kind: 'user', userId: undefined, role: 'admin' };
let tenantId: string;
let customerId: number;
let agentId: number;

const mk = async (status: any, extra: Record<string, unknown> = {}) =>
  (await prismaBase.order.create({ data: { customerId, status, subtotal: 10, totalAmount: 10, tenantId, ...extra } as any })).id;
const version = async (id: number) => (await prismaBase.order.findUniqueOrThrow({ where: { id } })).statusVersion;
const history = (id: number) => prismaBase.orderHistory.findMany({ where: { orderId: id } });
const inTenant = <T>(fn: () => Promise<T>) => runInTenant(tenantId, fn);

beforeAll(async () => {
  tenantId = (await createTenant('OSM Tenant')).id;
  customerId = (await prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'Mensah', phoneNumber: `+2332${String(SUFFIX).slice(-8)}`, address: '3 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId },
  })).id;
  agentId = (await prismaBase.user.create({
    data: { email: `osm-agent-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Kofi', lastName: 'Agent', role: 'delivery_agent', tenantId },
  })).id;
  ADMIN.userId = (await prismaBase.user.create({
    data: { email: `osm-admin-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Ada', lastName: 'Admin', role: 'admin', tenantId },
  })).id;
}, 30000);

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('transitionOrder (real DB)', () => {
  it('a real move writes one history row and bumps statusVersion by 1', async () => {
    const id = await mk('pending_confirmation');
    const before = await version(id);
    const res = await inTenant(() => transitionOrder(id, 'confirmed', ADMIN, { note: 'called, confirmed' }));
    expect(res.changed).toBe(true);
    expect(await version(id)).toBe(before + 1);
    const rows = await history(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'confirmed', fromStatus: 'pending_confirmation', actorKind: 'user', changedBy: ADMIN.userId, forced: false, notes: 'called, confirmed' });
    const order = await prismaBase.order.findUniqueOrThrow({ where: { id } });
    expect(order.confirmedAt).toBeInstanceOf(Date);
    expect(order.confirmedById).toBe(ADMIN.userId);
  });

  it('same status writes nothing and keeps the version', async () => {
    const id = await mk('confirmed');
    const res = await inTenant(() => transitionOrder(id, 'confirmed', ADMIN));
    expect(res.changed).toBe(false);
    expect(await version(id)).toBe(0);
    expect(await history(id)).toHaveLength(0);
  });

  it('a writer that commits between the read and the write gives STALE_ORDER and no history row', async () => {
    const id = await mk('confirmed');
    const err = await inTenant(() =>
      prisma.$transaction(async (tx) => {
        const racing: any = new Proxy(tx as any, {
          get(target, prop) {
            if (prop !== 'order') return target[prop];
            return {
              findFirst: (a: any) => target.order.findFirst(a),
              update: (a: any) => target.order.update(a),
              updateMany: async (a: any) => {
                // another connection moves the order after our read
                await prismaBase.$executeRaw`UPDATE orders SET status = 'preparing' WHERE id = ${id}`;
                return target.order.updateMany(a);
              },
            };
          },
        });
        return transitionOrder(id, 'cancelled', ADMIN, { tx: racing });
      }).then(() => null, (e) => e),
    );
    expect(err).toBeInstanceOf(OrderTransitionError);
    expect(err.code).toBe('STALE_ORDER');
    expect(err.statusCode).toBe(409);
    expect(await history(id)).toHaveLength(0);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id } })).status).toBe('preparing');
  });

  it('two parallel moves of one order: one wins, history has one row, version rises by 1', async () => {
    const id = await mk('confirmed');
    const results = await inTenant(() =>
      Promise.allSettled([
        transitionOrder(id, 'preparing', ADMIN),
        transitionOrder(id, 'cancelled', ADMIN),
      ]),
    );
    const ok = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof transitionOrder>>> => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed.length === 1) {
      // The loser lost the lock (STALE_ORDER) or read after the winner committed and the table refused it.
      expect(['STALE_ORDER', 'INVALID_TRANSITION']).toContain(failed[0].reason.code);
    } else {
      // The second move read after the first committed; preparing -> cancelled is legal, so both apply in turn.
      expect(failed).toHaveLength(0);
      expect(ok.map((r) => r.value.from).sort()).toEqual(['confirmed', 'preparing']);
    }
    // No lost update: one history row and one version step for each move that applied.
    expect(await history(id)).toHaveLength(ok.length);
    expect(await version(id)).toBe(ok.length);
  });

  it('out_for_delivery without a delivery agent is denied; with one it works and sets dispatchedAt', async () => {
    const noAgent = await mk('ready_for_pickup');
    await expect(inTenant(() => transitionOrder(noAgent, 'out_for_delivery', ADMIN))).rejects.toMatchObject({
      code: 'INVALID_TRANSITION', message: 'Assign a delivery agent first',
    });
    expect(await history(noAgent)).toHaveLength(0);

    const withAgent = await mk('ready_for_pickup', { deliveryAgentId: agentId });
    await inTenant(() => transitionOrder(withAgent, 'out_for_delivery', ADMIN));
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: withAgent } })).dispatchedAt).toBeInstanceOf(Date);
  });

  it('leaving delivered with a verified collection gives COLLECTION_VERIFIED (409)', async () => {
    const id = await mk('delivered', { deliveryAgentId: agentId, deliveryDate: new Date() });
    await prismaBase.agentCollection.create({
      data: { orderId: id, agentId, amount: 10, status: 'verified', collectionDate: new Date(), tenantId },
    });
    await expect(inTenant(() => transitionOrder(id, 'returned', ADMIN))).rejects.toMatchObject({
      code: 'COLLECTION_VERIFIED', statusCode: 409, message: 'Reverse the collection first',
    });
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id } })).status).toBe('delivered');
    expect(await history(id)).toHaveLength(0);
  });

  it('leaving delivered with a draft collection works and clears deliveryDate', async () => {
    const id = await mk('delivered', { deliveryAgentId: agentId, deliveryDate: new Date() });
    await prismaBase.agentCollection.create({
      data: { orderId: id, agentId, amount: 10, status: 'draft', collectionDate: new Date(), tenantId },
    });
    await inTenant(() => transitionOrder(id, 'returned', ADMIN));
    const order = await prismaBase.order.findUniqueOrThrow({ where: { id } });
    expect(order.status).toBe('returned');
    expect(order.deliveryDate).toBeNull();
    expect(order.returnedAt).toBeInstanceOf(Date);
  });

  it('integration jump to delivered writes metadata.jump and dispatchedAt', async () => {
    const id = await mk('preparing');
    await inTenant(() => transitionOrder(id, 'delivered', { kind: 'integration' }));
    const [row] = await history(id);
    expect(row).toMatchObject({ actorKind: 'integration', forced: false, fromStatus: 'preparing' });
    expect((row.metadata as any).jump).toBe(true);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id } })).dispatchedAt).toBeInstanceOf(Date);
  });

  it('force by super_admin writes a forced history row and one AuditLog row', async () => {
    const id = await mk('cancelled');
    const sa = await prismaBase.user.create({
      data: { email: `osm-sa-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Su', lastName: 'Per', role: 'super_admin', tenantId },
    });
    await inTenant(() => transitionOrder(id, 'confirmed', { kind: 'user', userId: sa.id, role: 'super_admin' }, { force: true, reason: 'cancelled by mistake' }));
    const [row] = await history(id);
    expect(row).toMatchObject({ forced: true, notes: 'cancelled by mistake' });
    const audits = await prismaBase.auditLog.findMany({ where: { resource: 'order', resourceId: String(id), tenantId } });
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toMatchObject({ from: 'cancelled', to: 'confirmed', reason: 'cancelled by mistake', forced: true });
  });
});
