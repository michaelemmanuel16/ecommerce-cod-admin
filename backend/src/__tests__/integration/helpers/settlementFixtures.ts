import { CollectionStatus, OrderStatus } from '@prisma/client';
import { prismaBase } from '../../../utils/prisma';
import { runInTenant } from '../../../utils/tenantContext';
import { transitionOrder } from '../../../services/orderStateMachine';
import { FinancialSyncService } from '../../../services/financialSyncService';
import { mkUser } from './twoTenants';

/**
 * Fixtures of the partner settlement suites (M5-T10 to T17): partners with fee rules, customers, orders, delivered orders
 * with their draft collection, collections and deposits. Rows are written through the un-extended client with an explicit
 * tenant; delivery goes through the state machine, as in the app. Pair with deleteTenantRows.
 */
export interface SettlementWorld {
  tenantId: string;
  /** The customer new orders belong to. */
  customerId: number;
  /** The user who moves orders (an owner of the tenant). */
  actorId: number;
}

export const mkCustomer = async (tenantId: string, phoneNumber: string) =>
  (await prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'Mensah', phoneNumber, address: '3 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId },
  })).id;

/** A delivery partner of the tenant, with a flat fee rule per outcome when `fees` says so. Returns its id (and its API token). */
export async function mkPartner(
  tenantId: string,
  label: string,
  opts: { kind?: 'person' | 'company'; fees?: { delivered?: number; failed?: number } } = {},
) {
  const partner = await mkUser(tenantId, label, 'delivery_agent', { kind: opts.kind ?? 'person' });
  const validFrom = new Date('2026-01-01');
  if (opts.fees?.delivered !== undefined) await prismaBase.feeRule.create({ data: { tenantId, partnerUserId: partner.id, outcome: 'delivered', amount: opts.fees.delivered, validFrom } });
  if (opts.fees?.failed !== undefined) await prismaBase.feeRule.create({ data: { tenantId, partnerUserId: partner.id, outcome: 'failed', amount: opts.fees.failed, validFrom } });
  return partner;
}

/** An order of the world's customer in `status`, assigned to `partnerId`. COD, amount `total`. */
export async function mkOrder(
  w: SettlementWorld,
  partnerId: number | null,
  status: OrderStatus,
  extra: { total?: number; customerId?: number } & Record<string, unknown> = {},
) {
  const { total = 200, customerId = w.customerId, ...rest } = extra;
  return (await prismaBase.order.create({
    data: { customerId, status, subtotal: total, totalAmount: total, codAmount: total, deliveryAgentId: partnerId, tenantId: w.tenantId, ...rest } as never,
  })).id;
}

/** An order delivered through the state machine, then synced the way the post-delivery queue does: it has its draft collection. */
export async function mkDeliveredOrder(w: SettlementWorld, partnerId: number, total = 200, customerId = w.customerId) {
  const id = await mkOrder(w, partnerId, 'out_for_delivery', { total, customerId });
  await runInTenant(w.tenantId, () => transitionOrder(id, 'delivered', { kind: 'user', userId: w.actorId, role: 'super_admin' }));
  await runInTenant(w.tenantId, () => FinancialSyncService.batchSyncOrders([id], w.actorId));
  return id;
}

/** A collection written by hand, for a test that needs a state the sync does not make. */
export const mkCollection = (tenantId: string, orderId: number, agentId: number, amount: number, status: CollectionStatus = 'draft', collectionDate = new Date()) =>
  prismaBase.agentCollection.create({ data: { tenantId, orderId, agentId, amount, status, collectionDate } });

/** A pending deposit of a partner. */
export const mkDeposit = (tenantId: string, agentId: number, amount: number, referenceNumber: string) =>
  prismaBase.agentDeposit.create({ data: { tenantId, agentId, amount, depositDate: new Date(), depositMethod: 'momo', referenceNumber } });
