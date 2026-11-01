import { ordersService, type OrderListParams } from '../../services/orders.service';
import type { StaffRow } from '../../services/staff.service';

/** Open orders: everything from waiting for a call to out for delivery. */
const OPEN: NonNullable<OrderListParams['status']> = ['pending_confirmation', 'confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery'];
const MOST = 500;

/**
 * Gives the open orders of a person to another person, with the existing bulk assign (orders:assign). A call rep's orders go to
 * the new call rep and a delivery partner's to the new partner. Returns how many moved.
 */
export async function reassignOpenOrders(from: StaffRow, toId: number): Promise<number> {
  const asAgent = from.role === 'delivery_agent';
  const { rows } = await ordersService.listOrders({ status: OPEN, limit: MOST, ...(asAgent ? { deliveryAgentId: from.id } : { customerRepId: from.id }) }, true);
  if (rows.length === 0) return 0;
  const result = await ordersService.bulkAssign({ orderIds: rows.map((o) => o.id), ...(asAgent ? { deliveryAgentId: toId } : { customerRepId: toId }) });
  return result.succeeded.length;
}
