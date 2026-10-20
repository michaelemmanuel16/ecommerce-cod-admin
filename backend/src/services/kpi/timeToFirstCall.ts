/**
 * Time to first call (M1-T22, F-755). Median of workingMinutesBetween(createdAt, firstContactAt) over orders
 * placed in [from, to) that have a firstContactAt.
 *
 * Auto-confirmed orders are counted apart (R10): an order whose earliest Call row has source `auto_confirm` was
 * closed by the customer's YES, not by a rep. They are left out of the median and reported in detail.autoConfirmed.
 * Orders with no firstContactAt are left out too (detail.noContact; they are still waiting or the history is missing).
 * Digital and deleted orders are out of scope, as in rates.ts.
 *
 * Hours come from SystemConfig.operatingHours (workingTime.ts). With no hours set, every minute counts and the
 * result carries `operatingHoursSet: false` so the page can show "Set operating hours".
 * Filters: repId = Order.customerRepId (the rep the order is assigned to); partnerId = Order.deliveryAgentId.
 */
import prisma from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { getStoreTimeZone } from './dates';
import { medianRounded } from './median';
import { DIGITAL } from './rates';
import { readOperatingHours, workingMinutesBetween } from './workingTime';
import { kpiMeta, type KpiResult } from './types';

export interface TimeToFirstCallOptions {
  repId?: number;
  partnerId?: number;
}

export interface TimeToFirstCall extends KpiResult<number | null> {
  /** False when no operating hours are set: minutes are wall minutes, show "Set operating hours". */
  operatingHoursSet: boolean;
  /** Target and alert from the settings, when set. */
  targetMinutes: number | null;
  alertMinutes: number | null;
}

export async function timeToFirstCall(tenantId: string, from: Date, to: Date, options: TimeToFirstCallOptions = {}): Promise<TimeToFirstCall> {
  const zone = getStoreTimeZone(tenantId);
  return runInTenant(tenantId, async () => {
    const [config, orders] = await Promise.all([
      prisma.systemConfig.findUnique({ where: { tenantId }, select: { operatingHours: true } }),
      prisma.order.findMany({
        where: {
          deletedAt: null,
          status: { notIn: DIGITAL },
          createdAt: { gte: from, lt: to },
          ...(options.repId !== undefined ? { customerRepId: options.repId } : {}),
          ...(options.partnerId !== undefined ? { deliveryAgentId: options.partnerId } : {}),
        },
        select: {
          id: true, createdAt: true, firstContactAt: true,
          calls: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 1, select: { source: true } },
        },
      }),
    ]);
    const hours = readOperatingHours(config?.operatingHours);

    const minutes: number[] = [];
    let autoConfirmed = 0;
    let noContact = 0;
    for (const o of orders) {
      if (!o.firstContactAt) { noContact += 1; continue; }
      if (o.calls[0]?.source === 'auto_confirm') { autoConfirmed += 1; continue; }
      minutes.push(workingMinutesBetween(o.createdAt, o.firstContactAt, hours, zone));
    }
    return {
      name: 'Time to first call',
      value: medianRounded(minutes, 1),
      unit: 'minutes',
      dateBasis: 'createdAt',
      formulaId: 'rep.timeToFirstCall.v1',
      ...kpiMeta(from, to),
      detail: { measured: minutes.length, autoConfirmed, noContact, placed: orders.length },
      operatingHoursSet: hours !== null,
      targetMinutes: hours?.firstCallTargetMinutes ?? null,
      alertMinutes: hours?.queueWaitAlertMinutes ?? null,
    };
  });
}
