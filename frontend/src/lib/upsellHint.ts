// "35% of buyers also buy this." under an upsell (F-415). Shown only once the form has enough orders to mean something.
export const MIN_ORDERS_FOR_HINT = 30;

/** The hint sentence, or null when there are too few orders or the upsell has no count. */
export function upsellHint(ordersTotal: number, orders: number | undefined): string | null {
  if (orders === undefined || ordersTotal < MIN_ORDERS_FOR_HINT) return null;
  return `${Math.round((orders / ordersTotal) * 100)}% of buyers also buy this.`;
}
