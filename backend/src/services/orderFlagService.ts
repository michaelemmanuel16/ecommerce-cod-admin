import { OrderStatus, Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

/**
 * Order flags (F-312). Computed from the order's own data, never stored. Each flag is one `where` rule: the list
 * filter and the flag line on a row both read it, so they cannot disagree. M11 adds the problem finders here.
 */

export type OrderFlagCode = 'no_call_rep' | 'waiting_too_long' | 'digital_delivery_failed';

export interface OrderFlag {
  code: OrderFlagCode;
  label: string;
}

/** Most urgent first: the Orders cell shows the first flag and "+n". */
const FLAGS: Array<OrderFlag & { where: (now: Date) => Prisma.OrderWhereInput }> = [
  {
    code: 'digital_delivery_failed',
    label: 'Digital delivery failed',
    // A paid digital order still at `confirmed` with no download link made after 5 minutes.
    where: (now) => {
      const cutoff = new Date(now.getTime() - DIGITAL_LINK_MINUTES * MINUTE);
      return {
        orderType: 'digital',
        status: 'confirmed',
        paymentStatus: { not: 'pending' },
        downloadTokens: { none: {} },
        OR: [{ confirmedAt: { lt: cutoff } }, { confirmedAt: null, createdAt: { lt: cutoff } }],
      };
    },
  },
  {
    code: 'no_call_rep',
    label: 'No call rep',
    where: () => ({ status: 'pending_confirmation', customerRepId: null }),
  },
  {
    code: 'waiting_too_long',
    label: 'Waiting to dispatch too long',
    where: (now) => ({
      status: { in: PRE_DISPATCH },
      createdAt: { lt: new Date(now.getTime() - WAITING_LIMIT_DAYS * DAY) },
    }),
  },
];

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** Fixed until Settings → Operations (area C) holds the waiting limit. */
export const WAITING_LIMIT_DAYS = 2;
const DIGITAL_LINK_MINUTES = 5;
const PRE_DISPATCH: OrderStatus[] = ['confirmed', 'preparing', 'ready_for_pickup'];

export const ORDER_FLAG_CODES = FLAGS.map((f) => f.code);

export const orderFlagService = {
  /** The order `where` for one flag, or for any flag. */
  where(flag: OrderFlagCode | 'any', now: Date = new Date()): Prisma.OrderWhereInput {
    if (flag === 'any') return { OR: FLAGS.map((f) => f.where(now)) };
    return FLAGS.find((f) => f.code === flag)!.where(now);
  },

  /** Flags of each order id, most urgent first. Orders with no flag have no entry. One query per flag. */
  async forOrders(orderIds: number[], now: Date = new Date()): Promise<Map<number, OrderFlag[]>> {
    const result = new Map<number, OrderFlag[]>();
    if (!orderIds.length) return result;
    const hits = await Promise.all(FLAGS.map((f) =>
      prisma.order.findMany({ where: { id: { in: orderIds }, deletedAt: null, ...f.where(now) }, select: { id: true } })));
    FLAGS.forEach((f, i) => {
      for (const { id } of hits[i]) result.set(id, [...(result.get(id) ?? []), { code: f.code, label: f.label }]);
    });
    return result;
  },
};

export default orderFlagService;
