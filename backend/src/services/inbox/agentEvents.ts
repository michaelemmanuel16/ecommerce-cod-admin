import { notify } from './inboxService';

/**
 * One helper per agent event (M9-T20). Each calls `notify` with the agent as the only recipient; the event
 * defaults (in-app on) and the agent's own preferences decide the channels. Used by the services that change the thing.
 */

const money = (amount: { toString(): string } | number | string) => String(amount);

/** A payout was recorded for the person. `recordedById` is the actor: someone paying themselves is not told. */
export function notifyPayoutPaid(input: {
  tenantId: string; payeeId: number; payoutId: number; amount: { toString(): string } | number | string; method: string; recordedById?: number | null;
}) {
  return notify({
    tenantId: input.tenantId,
    event: 'payout_paid',
    subject: { type: 'payout', id: input.payoutId },
    recipients: [input.payeeId],
    actorId: input.recordedById ?? null,
    title: 'Payout paid',
    message: `A payout of ${money(input.amount)} was paid to you by ${input.method}.`,
    data: { payoutId: input.payoutId },
  });
}

/** The scheduled time of a delivery changed. */
export function notifyDeliveryRescheduled(input: {
  tenantId: string; agentId: number; orderId: number; deliveryId: number; scheduledTime: Date | null; actorId?: number | null;
}) {
  return notify({
    tenantId: input.tenantId,
    event: 'delivery_rescheduled',
    subject: { type: 'order', id: input.orderId },
    recipients: [input.agentId],
    actorId: input.actorId ?? null,
    title: 'Delivery rescheduled',
    message: input.scheduledTime
      ? `Order #${input.orderId} is now planned for ${input.scheduledTime.toISOString()}.`
      : `The planned time for order #${input.orderId} was removed.`,
    data: { deliveryId: input.deliveryId, scheduledTime: input.scheduledTime?.toISOString() ?? null },
  });
}

/**
 * Stock is on its way to the agent. No caller yet: the stock transfer to an agent arrives with M10 (agent app).
 */
export function notifyStockIncoming(input: {
  tenantId: string; agentId: number; productName: string; quantity: number; actorId?: number | null;
}) {
  return notify({
    tenantId: input.tenantId,
    event: 'stock_incoming',
    recipients: [input.agentId],
    actorId: input.actorId ?? null,
    title: 'Stock is on its way',
    message: `${input.quantity} x ${input.productName} is on its way to you.`,
    data: { productName: input.productName, quantity: input.quantity },
  });
}
