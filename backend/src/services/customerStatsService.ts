import { Prisma } from '@prisma/client';
import { prismaBase } from '../utils/prisma';
import logger from '../utils/logger';
import {
  AppEvent, OrderCreatedEvent, OrderDeletedEvent, OrderStatusChangedEvent, onOrderEvent,
} from '../utils/appEvents';

/**
 * Customer stats (F-350, F-351, F-357). `recompute` rebuilds the stored columns from the customer's orders, so the counts never
 * drift. One SQL rule serves the single-customer path and the backfill. The rows are written only when a value differs, so a
 * second run changes nothing.
 *   totalOrders     all orders that are not deleted
 *   deliveredOrders status delivered
 *   refusedOrders   status failed_delivery or returned with failureReason refused (one order counts once)
 *   deliveredValue  sum of totalAmount of delivered orders
 *   lastOrderAt     newest createdAt among the orders that are not deleted
 * The refusal rule itself (risk level, COD block, override) is M7. It reads the base client (raw SQL by customer id), so it
 * needs no tenant context.
 */

/** `scope` is a WHERE condition on the customers table `c`; its parameters follow `$1`. */
function statsSql(action: 'update' | 'count', scope: Prisma.Sql): Prisma.Sql {
  const fresh = Prisma.sql`
    SELECT c.id,
           COUNT(o.id)::int AS total_orders,
           COUNT(o.id) FILTER (WHERE o.status = 'delivered')::int AS delivered_orders,
           COUNT(o.id) FILTER (WHERE o.status IN ('failed_delivery', 'returned') AND o.failure_reason = 'refused')::int AS refused_orders,
           COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = 'delivered'), 0) AS delivered_value,
           MAX(o.created_at) AS last_order_at
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id AND o.deleted_at IS NULL
    WHERE ${scope}
    GROUP BY c.id`;
  const changed = Prisma.sql`
    (c.total_orders, c.delivered_orders, c.refused_orders, c.delivered_value, c.last_order_at)
    IS DISTINCT FROM (s.total_orders, s.delivered_orders, s.refused_orders, s.delivered_value, s.last_order_at)`;
  if (action === 'count') {
    return Prisma.sql`SELECT COUNT(*)::int AS n FROM customers c JOIN (${fresh}) s ON s.id = c.id WHERE ${changed}`;
  }
  return Prisma.sql`
    UPDATE customers c
    SET total_orders = s.total_orders, delivered_orders = s.delivered_orders, refused_orders = s.refused_orders,
        delivered_value = s.delivered_value, last_order_at = s.last_order_at
    FROM (${fresh}) s
    WHERE s.id = c.id AND ${changed}`;
}

const tenantScope = (tenantId: string | null) =>
  tenantId === null ? Prisma.sql`c.tenant_id IS NULL` : Prisma.sql`c.tenant_id = ${tenantId}`;

export const customerStatsService = {
  /** Rebuild one customer's stats from their orders. Returns true when a stored value changed. */
  async recompute(customerId: number): Promise<boolean> {
    const changed = await prismaBase.$executeRaw(statsSql('update', Prisma.sql`c.id = ${customerId}`));
    return changed > 0;
  },

  /**
   * Rebuild every customer of one tenant (`null` = rows with no tenant). With `dryRun` it only counts the customers
   * whose stored values differ. Returns how many customers it looked at and how many it changed (or would change).
   */
  async recomputeTenant(tenantId: string | null, opts: { dryRun?: boolean } = {}): Promise<{ customers: number; changed: number }> {
    const scope = tenantScope(tenantId);
    const [{ n: customers }] = await prismaBase.$queryRaw<Array<{ n: number }>>(
      Prisma.sql`SELECT COUNT(*)::int AS n FROM customers c WHERE ${scope}`);
    if (opts.dryRun) {
      const [{ n }] = await prismaBase.$queryRaw<Array<{ n: number }>>(statsSql('count', scope));
      return { customers, changed: n };
    }
    const changed = await prismaBase.$executeRaw(statsSql('update', scope));
    return { customers, changed };
  },

  async customerIdOf(orderId: number): Promise<number | null> {
    const row = await prismaBase.order.findUnique({ where: { id: orderId }, select: { customerId: true } });
    return row?.customerId ?? null;
  },

  /** Listener for `order.created` and `order.status_changed`. Never throws: the order is already saved. */
  async onOrderEvent(evt: OrderCreatedEvent | OrderStatusChangedEvent): Promise<void> {
    try {
      const customerId = evt.customerId ?? await this.customerIdOf(evt.orderId);
      if (customerId !== null) await this.recompute(customerId);
    } catch (error: any) {
      logger.error('Customer stats recompute failed', { orderId: evt.orderId, error: error?.message });
    }
  },

  /** Listener for `order.deleted`. The event carries the customer. */
  async onOrderDeleted(evt: OrderDeletedEvent): Promise<void> {
    try {
      await this.recompute(evt.customerId);
    } catch (error: any) {
      logger.error('Customer stats recompute failed', { orderId: evt.orderId, error: error?.message });
    }
  },
};

let registered = false;
/** Listen to the order events. Idempotent; the server calls it at bootstrap (tests call it too). */
export function registerCustomerStatsListeners(): void {
  if (registered) return;
  registered = true;
  onOrderEvent(AppEvent.ORDER_CREATED, (evt) => { void customerStatsService.onOrderEvent(evt); });
  onOrderEvent(AppEvent.ORDER_STATUS_CHANGED, (evt) => { void customerStatsService.onOrderEvent(evt); });
  onOrderEvent(AppEvent.ORDER_DELETED, (evt) => { void customerStatsService.onOrderDeleted(evt); });
}

export default customerStatsService;
