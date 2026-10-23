import { FailureReason, Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { runInTenant } from '../utils/tenantContext';
import { mapFailureText } from '../utils/failureReasonText';

/**
 * Backfill of Order.failureReason (F-705, M4-T18). Failure text lives in three places: the note and the `reason` / `reschedule`
 * metadata of the order's latest failed_delivery or returned history row, and Delivery.notes ("Failed delivery attempt: ...").
 * Only failed_delivery and returned orders with no reason yet are read, so a second run changes nothing (idempotent).
 * Obvious words map to the FailureReason list (mapFailureText); a reschedule flag maps to `rescheduled`; the rest is `other`.
 * Runs inside the tenant's context. `dryRun` counts and writes nothing.
 */

const BATCH = 500;

export type ReasonCounts = Record<FailureReason, number>;

const emptyCounts = (): ReasonCounts => ({ not_reachable: 0, refused: 0, wrong_address: 0, rescheduled: 0, other: 0 });

interface FailedOrder {
  id: number;
  orderHistory: Array<{ notes: string | null; metadata: Prisma.JsonValue }>;
  delivery: { notes: string | null } | null;
}

/** The reason for one order from the text it carries. */
export function reasonOf(order: FailedOrder): FailureReason {
  const row = order.orderHistory[0];
  const meta = row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {};
  if (meta.reschedule === true) return 'rescheduled';
  const text = [row?.notes, typeof meta.reason === 'string' ? meta.reason : null, order.delivery?.notes].filter(Boolean).join(' ');
  return mapFailureText(text);
}

export async function backfillFailureReasons(tenantId: string, opts: { dryRun?: boolean } = {}): Promise<{ orders: number; counts: ReasonCounts }> {
  return runInTenant(tenantId, async () => {
    const counts = emptyCounts();
    let orders = 0;
    let after = 0;
    for (;;) {
      const rows = (await prisma.order.findMany({
        where: { id: { gt: after }, deletedAt: null, status: { in: ['failed_delivery', 'returned'] }, failureReason: null },
        orderBy: { id: 'asc' },
        take: BATCH,
        select: {
          id: true,
          delivery: { select: { notes: true } },
          orderHistory: {
            where: { status: { in: ['failed_delivery', 'returned'] } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { notes: true, metadata: true },
          },
        },
      })) as FailedOrder[];
      if (rows.length === 0) break;

      const byReason = new Map<FailureReason, number[]>();
      for (const row of rows) {
        const reason = reasonOf(row);
        counts[reason] += 1;
        byReason.set(reason, [...(byReason.get(reason) ?? []), row.id]);
      }
      orders += rows.length;
      if (!opts.dryRun) {
        for (const [reason, ids] of byReason) {
          await prisma.order.updateMany({ where: { id: { in: ids } }, data: { failureReason: reason } });
        }
      }
      after = rows[rows.length - 1].id;
    }
    return { orders, counts };
  });
}
