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
 *   refusedOrders   status failed_delivery or returned with failureReason refused (one order counts once; restarts after codOverrideAt)
 *   deliveredValue  sum of totalAmount of delivered orders
 *   lastOrderAt     newest createdAt among the orders that are not deleted
 * The refusal rule (M7-T06, COD-64):
 *   1 refusal: no change (riskLevel normal, codBlocked false)
 *   2 refusals: riskLevel = high
 *   3 refusals: codBlocked = true
 *   Owner override resets the refusal count and clears the block.
 */

// The per-customer aggregate runs once (`AS MATERIALIZED`). As a plain subquery the planner may nest it in a loop over the
// customers and run the whole aggregate again for every row. For a tenant with no statistics yet (a new tenant id) the row
// estimate is 1, which invites that plan: on CI this UPDATE ran for 8+ minutes on CPU with no lock wait (COD-76).
/** `scope` is a WHERE condition on the customers table `c`; its parameters follow `$1`. */
function statsSql(action: 'update' | 'count', scope: Prisma.Sql): Prisma.Sql {
  const fresh = Prisma.sql`
    SELECT c.id,
           COUNT(o.id)::int AS total_orders,
           COUNT(o.id) FILTER (WHERE o.status = 'delivered')::int AS delivered_orders,
           COUNT(o.id) FILTER (
             WHERE o.status IN ('failed_delivery', 'returned')
               AND o.failure_reason = 'refused'
               AND (c.cod_override_at IS NULL OR o.created_at > c.cod_override_at)
           )::int AS refused_orders,
           COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = 'delivered'), 0) AS delivered_value,
           MAX(o.created_at) AS last_order_at
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id AND o.deleted_at IS NULL
    WHERE ${scope}
    GROUP BY c.id, c.cod_override_at`;
  const changed = Prisma.sql`
    (c.total_orders, c.delivered_orders, c.refused_orders, c.delivered_value, c.last_order_at, c.risk_level, c.cod_blocked)
    IS DISTINCT FROM (
      s.total_orders,
      s.delivered_orders,
      s.refused_orders,
      s.delivered_value,
      s.last_order_at,
      CASE
        WHEN s.refused_orders >= 2 THEN 'high'::"CustomerRiskLevel"
        ELSE 'normal'::"CustomerRiskLevel"
      END,
      CASE
        WHEN s.refused_orders >= 3 THEN TRUE
        WHEN c.cod_override IS TRUE THEN FALSE
        WHEN c.cod_override_at IS NOT NULL AND c.cod_override IS FALSE THEN TRUE
        ELSE FALSE
      END
    )`;
  if (action === 'count') {
    return Prisma.sql`WITH s AS MATERIALIZED (${fresh}) SELECT COUNT(*)::int AS n FROM customers c JOIN s ON s.id = c.id WHERE ${changed}`;
  }
  return Prisma.sql`
    WITH s AS MATERIALIZED (${fresh})
    UPDATE customers c
    SET total_orders = s.total_orders,
        delivered_orders = s.delivered_orders,
        refused_orders = s.refused_orders,
        delivered_value = s.delivered_value,
        last_order_at = s.last_order_at,
        risk_level = CASE
          WHEN s.refused_orders >= 2 THEN 'high'::"CustomerRiskLevel"
          ELSE 'normal'::"CustomerRiskLevel"
        END,
        cod_blocked = CASE
          WHEN s.refused_orders >= 3 THEN TRUE
          WHEN c.cod_override IS TRUE THEN FALSE
          WHEN c.cod_override_at IS NOT NULL AND c.cod_override IS FALSE THEN TRUE
          ELSE FALSE
        END
    FROM s
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
