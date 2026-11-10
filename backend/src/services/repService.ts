import { OrderStatus, Prisma, UpsellStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import { resolveTenantId } from '../utils/tenantContext';
import { AppError } from '../middleware/errorHandler';
import { Requester, isManagerUp } from '../utils/authUtils';
import { getCurrency } from '../utils/currency';
import { fullName } from '../utils/nameUtils';
import * as Money from '../utils/money';
import {
  workingMinutesBetween,
  readOperatingHours, readOperatingSettings,
  DEFAULT_FIRST_CALL_TARGET_MINUTES,
  DEFAULT_QUEUE_WAIT_ALERT_MINUTES,
} from './kpi/workingTime';
import { timeToFirstCall } from './kpi/timeToFirstCall';
import { repRates } from './kpi/reps';
import { upsellService } from './upsellService';
import { BASE_COMMISSION_AMOUNT, UPSELL_COMMISSION_RATE } from './commissionService';

import { leaderboard } from './leaderboardService';
import * as rewardService from './rewardService';
import { hasPermission } from './permissionService';
import payoutService, { summarize } from './payoutService';
import { teamReport } from './teamReportService';
import { CONFIRMED, ratePercent, wholeRate } from './kpi/rates';
import {
  currentMonth,
  endOfDay,
  getStoreTimeZone,
  localDate,
  monthRange,
  parseMonth,
  shiftYmd,
  startOfDay,
  weekRange,
} from './kpi/dates';

/**
 * M7-T11 (COD-65, F-753, F-760, F-761, F-762, F-769): Rep API part 2.
 *
 * Provides:
 * - Orders: rep orders with status filter and search by id, phone, name.
 * - Numbers: confirmed, rates, upsell and the breakdown count orders the rep finished this month (by action date);
 *   time to first call and target from teamReport; calls by store-local date; ranks from leaderboard.
 * - Earnings: summary via payoutService summarize(); base + upsell lines; reversal line on returned/failed.
 * - Reward progress: M6 cash reward tiers via rewardService by attainment roleId.
 * - Payouts: payout history the rep owns.
 */

const VALID_ORDER_STATUSES = new Set(Object.values(OrderStatus));

export function resolveTargetRepId(actor: Requester, requestedRepId?: number): number {
  if (!isManagerUp(actor)) {
    if (requestedRepId !== undefined && requestedRepId !== actor.id) {
      throw new AppError('You can only see your own data', 403);
    }
    return actor.id;
  }
  return requestedRepId ?? actor.id;
}

/** Another rep's money (earnings, pay ledger) also needs payouts:view, so a tenant that removes it hides the money here too. */
async function assertCanSeeMoneyOf(actor: Requester, targetRepId: number): Promise<void> {
  if (targetRepId !== actor.id && !(await hasPermission(actor, 'payouts', 'view'))) {
    throw new AppError("You cannot see another rep's earnings", 403);
  }
}

export interface RepOrdersQuery {
  repId?: number;
  q?: string;
  status?: string;
  page?: number;
  limit?: number;
  sortOrder?: 'asc' | 'desc';
}

export async function getOrders(actor: Requester, query: RepOrdersQuery = {}) {
  const targetRepId = resolveTargetRepId(actor, query.repId);
  const tenantId = resolveTenantId();
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 25));

  // The rep's own orders: the same row scope as orderScope() for a sales_rep. A reassigned order leaves the list.
  const repCondition: Prisma.OrderWhereInput = { customerRepId: targetRepId };

  const and: Prisma.OrderWhereInput[] = [
    { tenantId, deletedAt: null },
    repCondition,
  ];

  if (query.status) {
    const rawParts = query.status.split(',').map((p) => p.trim()).filter(Boolean);
    if (rawParts.length > 0) {
      for (const part of rawParts) {
        if (!VALID_ORDER_STATUSES.has(part as OrderStatus)) {
          throw new AppError(`Invalid status: ${part}`, 400);
        }
      }
      and.push({ status: { in: rawParts as OrderStatus[] } });
    }
  }

  const rawSearch = query.q?.trim();
  if (rawSearch) {
    const searchOr: Prisma.OrderWhereInput[] = [];
    const isHashed = rawSearch.startsWith('#');
    const cleanDigits = isHashed ? rawSearch.slice(1).trim() : rawSearch;
    if (/^\d+$/.test(cleanDigits) && cleanDigits.length <= 9) {
      const numericId = parseInt(cleanDigits, 10);
      if (numericId > 0 && numericId <= 2147483647) {
        searchOr.push({ id: numericId });
      }
    }
    searchOr.push(
      { customer: { firstName: { contains: rawSearch, mode: 'insensitive' } } },
      { customer: { lastName: { contains: rawSearch, mode: 'insensitive' } } },
      { customer: { phoneNumber: { contains: rawSearch } } },
      { customer: { alternatePhone: { contains: rawSearch } } },
    );
    and.push({ OR: searchOr });
  }

  const where: Prisma.OrderWhereInput = { AND: and };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: query.sortOrder === 'asc' ? 'asc' : 'desc' },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true,
            alternatePhone: true,
            address: true,
            area: true,
            state: true,
          },
        },
        customerRep: { select: { id: true, firstName: true, lastName: true } },
        orderItems: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
          },
        },
        upsellLines: { where: { status: 'active' } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  const rows = orders.map((o) => ({
    id: o.id,
    createdAt: o.createdAt,
    status: o.status,
    totalAmount: Money.toApi(o.totalAmount),
    customer: o.customer ? {
      id: o.customer.id,
      firstName: o.customer.firstName,
      lastName: o.customer.lastName,
      phone: o.customer.phoneNumber,
      alternatePhone: o.customer.alternatePhone,
      address: o.customer.address || o.deliveryAddress,
      area: o.customer.area || o.deliveryArea,
      state: o.customer.state || o.deliveryState,
    } : null,
    customerRep: o.customerRep ? {
      id: o.customerRep.id,
      firstName: o.customerRep.firstName,
      lastName: o.customerRep.lastName,
    } : null,
    items: o.orderItems.map((i) => ({
      productId: i.productId,
      productName: i.product?.name ?? 'Product',
      quantity: i.quantity,
      unitPrice: Money.toApi(i.unitPrice),
      totalPrice: Money.toApi(i.totalPrice),
    })),
    upsellExtraValue: Money.toApi(Money.sum(o.upsellLines.map((l) => l.extraValue))),
  }));

  return {
    orders: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0,
    },
  };
}

export interface RepTargetHit {
  target: number;
  actual: number;
  percent: number | null;
}

export interface RepNumbersQuery {
  repId?: number;
  period?: string;
}

export interface RepNumbersResult {
  repId: number;
  period: string;
  confirmed: number;
  confirmationRate: number | null;
  confirmationRateDetail: Record<string, number>;
  deliveredFromConfirmedRate: number | null;
  deliveredFromConfirmedDetail: Record<string, number>;
  upsellRate: number;
  extraValueAdded: string;
  timeToFirstCall: number | null;
  targetHit: RepTargetHit | null;
  ranks: {
    callRep: { rank: number | null; total: number } | null;
    upsell: { rank: number | null; total: number } | null;
  };
  orderBreakdown: {
    confirmed: number;
    delivered: number;
    failedOrReturned: number;
    stillOpen: number;
  };
  calls: {
    today: number;
    thisWeek: number;
    thisMonth: number;
    averagePerDay: number;
  };
  callOutcomes: Record<string, number>;
  callsPerDay: { date: string; count: number; isToday: boolean }[];
}

export async function getNumbers(actor: Requester, query: RepNumbersQuery = {}): Promise<RepNumbersResult> {
  const targetRepId = resolveTargetRepId(actor, query.repId);
  const tenantId = resolveTenantId();
  const zone = getStoreTimeZone(tenantId);

  const period = query.period ?? currentMonth(new Date(), zone);
  const parsed = parseMonth(period);
  if (!parsed) {
    throw new AppError('Invalid period, expected YYYY-MM', 400);
  }
  const { year, month } = parsed;
  const range = monthRange(year, month, zone);
  const fromDate = range.from;
  const toDate = range.to;

  // 1. Reuse teamReport: provides confirmation %, delivered-from-confirmed %, time to first call, upsellRate, extraValue, targetHit
  const report = await teamReport(tenantId, fromDate, toDate);
  const repRow = report.reps.find((r) => r.repId === targetRepId);

  // 2. Leaderboard ranks for the period (do not catch errors; let them fail the request)
  const callRepBoard = await leaderboard(actor, { role: 'call_rep', period });
  const myCallRepRow = callRepBoard.rows.find((r: any) => r.userId === targetRepId) as any;
  const callRepRankVal = myCallRepRow && typeof myCallRepRow.rank === 'number' ? myCallRepRow.rank : null;
  const callRepRank = { rank: callRepRankVal, total: callRepBoard.rows.length };

  const upsellBoard = await leaderboard(actor, { role: 'upsell', period });
  const myUpsellRow = upsellBoard.rows.find((r: any) => r.userId === targetRepId) as any;
  const upsellRankVal = myUpsellRow && typeof myUpsellRow.rank === 'number' ? myUpsellRow.rank : null;
  const upsellRank = { rank: upsellRankVal, total: upsellBoard.rows.length };

  // 3. Orders the rep FINISHED this month (owner 2026-11-10), counted by the date of the rep's action, not the date the
  //    order was placed (the team report keeps its placed-in-range rule).
  //    finished  = orders the rep confirmed this month (Order.confirmedAt) + orders the rep declined or marked wrong
  //                number this month (the rep's Call rows), each order once.
  //    confirmed = of the orders the rep confirmed this month, those still in a confirmed status (an order cancelled
  //                after the confirm counts as finished, not confirmed; same rule as kpi/rates CONFIRMED).
  //    Delivery success, upsell rate, extra value and the breakdown read the same confirmed orders.
  const [confirmedByRep, declinedCalls] = await Promise.all([
    prisma.order.findMany({
      where: { tenantId, deletedAt: null, confirmedById: targetRepId, confirmedAt: { gte: fromDate, lt: toDate } },
      select: { id: true, status: true, upsellLines: { where: { status: 'active', repId: targetRepId }, select: { extraValue: true } } },
    }),
    prisma.call.findMany({
      where: { tenantId, salesRepId: targetRepId, outcome: { in: ['declined', 'wrong_number'] }, createdAt: { gte: fromDate, lt: toDate }, orderId: { not: null } },
      select: { orderId: true },
      distinct: ['orderId'],
    }),
  ]);
  const finishedIds = new Set<number>(confirmedByRep.map((o) => o.id));
  for (const c of declinedCalls) if (c.orderId !== null) finishedIds.add(c.orderId);
  const confirmedOrders = confirmedByRep.filter((o) => CONFIRMED.includes(o.status));
  const confirmedCount = confirmedOrders.length;
  const countStatus = (st: OrderStatus) => confirmedOrders.filter((o) => o.status === st).length;
  const deliveredCount = countStatus('delivered');
  const failedCount = countStatus('failed_delivery');
  const returnedCount = countStatus('returned');
  const failedOrReturned = failedCount + returnedCount;
  const stillOpen = Math.max(0, confirmedCount - (deliveredCount + failedOrReturned));
  const upsoldCount = confirmedOrders.filter((o) => o.upsellLines.length > 0).length;
  const extraValue = Money.sum(
    confirmedOrders.filter((o) => o.status === 'delivered').flatMap((o) => o.upsellLines.map((l) => l.extraValue)),
  );

  // 4. Calls: today, this week (store time zone), this month, avg/day
  const now = new Date();
  const todayStr = localDate(now, zone);
  const todayStart = startOfDay(todayStr, zone);
  const todayEnd = endOfDay(todayStr, zone);

  const week = weekRange(todayStr, zone);
  const weekStart = week.from;

  const [callsToday, callsThisWeek, callsThisMonth, callOutcomeGroups] = await Promise.all([
    prisma.call.count({ where: { tenantId, salesRepId: targetRepId, createdAt: { gte: todayStart, lt: todayEnd } } }),
    prisma.call.count({ where: { tenantId, salesRepId: targetRepId, createdAt: { gte: weekStart, lt: week.to } } }),
    prisma.call.count({ where: { tenantId, salesRepId: targetRepId, createdAt: { gte: fromDate, lt: toDate } } }),
    prisma.call.groupBy({
      by: ['outcome'],
      where: { tenantId, salesRepId: targetRepId, createdAt: { gte: fromDate, lt: toDate } },
      _count: { _all: true },
    }),
  ]);

  const outcomes: Record<string, number> = {
    confirmed: 0,
    not_reachable: 0,
    declined: 0,
    call_back_later: 0,
    wrong_number: 0,
    total: callsThisMonth,
  };
  for (const g of callOutcomeGroups) {
    outcomes[g.outcome] = g._count._all;
  }

  const daysElapsed = Math.max(1, Math.ceil((now.getTime() - fromDate.getTime()) / (24 * 3600 * 1000)));
  const averageCallsPerDay = callsThisMonth > 0 ? Math.round(callsThisMonth / daysElapsed) : 0;

  // 5. Calls per day: one query for the 14 days, bucket by store-local date
  const oldestDateStr = shiftYmd(todayStr, -13);
  const rangeStart14 = startOfDay(oldestDateStr, zone);
  const rangeEnd14 = endOfDay(todayStr, zone);

  const calls14Days = await prisma.call.findMany({
    where: {
      tenantId,
      salesRepId: targetRepId,
      createdAt: { gte: rangeStart14, lt: rangeEnd14 },
    },
    select: { createdAt: true },
  });

  const dailyCounts = new Map<string, number>();
  for (const call of calls14Days) {
    const dStr = localDate(call.createdAt, zone);
    dailyCounts.set(dStr, (dailyCounts.get(dStr) ?? 0) + 1);
  }

  const callsPerDay: { date: string; count: number; isToday: boolean }[] = [];
  for (let i = 13; i >= 0; i--) {
    const dStr = shiftYmd(todayStr, -i);
    callsPerDay.push({
      date: dStr,
      count: dailyCounts.get(dStr) ?? 0,
      isToday: i === 0,
    });
  }

  return {
    repId: targetRepId,
    period,
    confirmed: confirmedCount,
    confirmationRate: ratePercent(confirmedCount, finishedIds.size),
    confirmationRateDetail: { confirmed: confirmedCount, finished: finishedIds.size },
    deliveredFromConfirmedRate: ratePercent(deliveredCount, deliveredCount + failedOrReturned),
    deliveredFromConfirmedDetail: { delivered: deliveredCount, failed: failedCount, returned: returnedCount, closed: deliveredCount + failedOrReturned },
    upsellRate: wholeRate(upsoldCount, confirmedCount) ?? 0,
    extraValueAdded: Money.toApi(extraValue),
    timeToFirstCall: repRow?.timeToFirstCallMinutes ?? null,
    targetHit: repRow?.targetHit ? {
      target: repRow.targetHit.target,
      actual: repRow.targetHit.actual,
      percent: repRow.targetHit.percent,
    } : null,
    ranks: {
      callRep: callRepRank,
      upsell: upsellRank,
    },
    orderBreakdown: {
      confirmed: confirmedCount,
      delivered: deliveredCount,
      failedOrReturned,
      stillOpen,
    },
    calls: {
      today: callsToday,
      thisWeek: callsThisWeek,
      thisMonth: callsThisMonth,
      averagePerDay: averageCallsPerDay,
    },
    callOutcomes: outcomes,
    callsPerDay,
  };
}

export interface RepEarningsQuery {
  repId?: number;
  month?: string;
}

export async function getEarnings(actor: Requester, query: RepEarningsQuery = {}) {
  const targetRepId = resolveTargetRepId(actor, query.repId);
  await assertCanSeeMoneyOf(actor, targetRepId);
  const tenantId = resolveTenantId();

  const [rep, currency] = await Promise.all([
    prisma.user.findFirst({
      where: { id: targetRepId, tenantId },
      select: { id: true, firstName: true, lastName: true, role: true, kind: true },
    }),
    getCurrency(),
  ]);

  if (!rep) throw new AppError('Rep not found', 404);

  if (rep.kind === 'ai_agent') {
    return {
      currency,
      commission: '0.00',
      upsellReward: '0.00',
      targetReward: '0.00',
      earned: '0.00',
      paid: '0.00',
      owed: '0.00',
      overpaid: null,
      isOverpaid: false,
      openOrdersCount: 0,
      openOrdersNote: '',
      message: 'No payout for AI agents',
      lines: [],
      payouts: [],
    };
  }

  // Same entries as payoutService.getOwed (status: earned or paid) plus void entries for order reversal lines
  const [entries, payouts, openOrdersCount] = await Promise.all([
    prisma.commissionEntry.findMany({
      // Pending entries (confirmed, not yet delivered) are not earnings and get no line.
      where: { tenantId, userId: targetRepId, status: { in: ['earned', 'paid', 'void'] } },
      include: {
        order: {
          select: {
            id: true,
            status: true,
            createdAt: true,
            customer: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: [{ earnedAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.payout.findMany({
      where: { tenantId, payeeId: targetRepId },
      orderBy: [{ payoutDate: 'desc' }, { id: 'desc' }],
    }),
    prisma.order.count({
      where: {
        tenantId,
        deletedAt: null,
        confirmedById: targetRepId,
        status: { in: ['confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery'] },
      },
    }),
  ]);

  // The one owed rule from payoutService: summarize()
  const summary = summarize(entries);
  const isOverpaid = summary.owed.lt(0);
  const overpaid = isOverpaid ? Money.toApi(summary.owed.abs()) : null;
  const owed = Money.toApi(summary.owed);

  const formattedBaseCommission = Money.formatWithSign(BASE_COMMISSION_AMOUNT, currency);
  const openOrdersNote = `${openOrdersCount} of your confirmed orders are still open, each adds ${formattedBaseCommission} when delivered.`;

  // Build lines per order
  const orderEntriesMap = new Map<number, typeof entries>();
  for (const e of entries) {
    if (e.orderId) {
      const list = orderEntriesMap.get(e.orderId) ?? [];
      list.push(e);
      orderEntriesMap.set(e.orderId, list);
    }
  }

  const lines = [...orderEntriesMap.entries()].map(([orderId, oEntries]) => {
    const o = oEntries[0].order;
    const isOrderReturnedOrFailed = o?.status === 'returned' || o?.status === 'failed_delivery';

    const baseAmt = Money.sum(oEntries.filter((e) => e.kind === 'base' && e.status !== 'void').map((e) => e.amount));
    const upsellAmt = Money.sum(oEntries.filter((e) => e.kind === 'upsell' && e.status !== 'void').map((e) => e.amount));
    const paidAmt = Money.sum(oEntries.filter((e) => e.status === 'paid').map((e) => e.amount));
    const voidAmt = Money.sum(oEntries.filter((e) => e.status === 'void').map((e) => e.amount));

    const reversal = isOrderReturnedOrFailed ? Money.toApi(voidAmt) : null;
    const isReversal = isOrderReturnedOrFailed && voidAmt.gt(0);

    return {
      orderId,
      date: o?.createdAt ?? oEntries[0].createdAt,
      customerName: o?.customer ? fullName(o.customer) : null,
      status: o?.status ?? (isOrderReturnedOrFailed ? 'returned' : 'delivered'),
      base: Money.toApi(baseAmt),
      upsell: Money.toApi(upsellAmt),
      earned: Money.toApi(baseAmt.plus(upsellAmt)),
      paid: Money.toApi(paidAmt),
      reversal,
      isReversal,
    };
  });

  const formattedPayouts = payouts.map((p) => ({
    id: p.id,
    date: p.payoutDate,
    amount: Money.toApi(p.amount),
    status: p.status,
    notes: p.notes,
    method: p.method,
    reference: p.reference,
  }));

  return {
    currency,
    commission: Money.toApi(summary.base),
    upsellReward: Money.toApi(summary.upsell),
    targetReward: Money.toApi(summary.reward),
    earned: Money.toApi(summary.earned),
    paid: Money.toApi(summary.paid),
    owed,
    overpaid,
    isOverpaid,
    openOrdersCount,
    openOrdersNote,
    lines,
    payouts: formattedPayouts,
  };
}

export interface RepRewardProgressQuery {
  repId?: number;
  period?: string;
}

export interface RewardDistance {
  next: '100' | '120';
  amount: number | null;
  unit: string;
  message: string;
}

export interface RewardProgressResult {
  period: string;
  currency: string;
  target: string | null;
  actual: number;
  percent: number | null;
  tier: 'none' | '100' | '120';
  tiers: {
    tier100: { amount: string; dayOff: boolean; payout: boolean } | null;
    tier120: { amount: string; dayOff: boolean; payout: boolean } | null;
  } | null;
  reward: { amount: string; dayOff: boolean } | null;
  distance: RewardDistance | null;
  message: string;
  note: string;
  targetReached: boolean;
  earned: boolean;
}

export async function getRewardProgress(actor: Requester, query: RepRewardProgressQuery = {}): Promise<RewardProgressResult> {
  const targetRepId = resolveTargetRepId(actor, query.repId);
  const tenantId = resolveTenantId();
  const period = query.period ?? currentMonth(new Date(), getStoreTimeZone(tenantId));

  const [settings, attainmentResult, currency, rep] = await Promise.all([
    rewardService.getRewardSettings(),
    rewardService.computeAttainment(period, { userId: targetRepId }),
    getCurrency(),
    prisma.user.findFirst({
      where: { id: targetRepId, tenantId },
      select: { id: true, kind: true },
    }),
  ]);

  if (rep?.kind === 'ai_agent') {
    return {
      period,
      currency,
      target: null,
      actual: 0,
      percent: null,
      tier: 'none',
      tiers: null,
      reward: null,
      distance: null,
      message: 'No payout for AI agents',
      note: 'No payout for AI agents',
      targetReached: false,
      earned: false,
    };
  }

  const repAttainment = attainmentResult.results.find((r) => r.userId === targetRepId);
  const repRoleTiers = repAttainment?.roleId ? settings.tiers.find((t) => t.roleId === repAttainment.roleId) : null;

  const target = repAttainment?.target ?? null;
  const actual = repAttainment?.actual ?? 0;
  const percent = repAttainment?.percent ?? null;
  const tier = repAttainment?.tier ?? 'none';
  const targetReached = tier === '100' || tier === '120';

  let message: string;
  if (targetReached) {
    message = `You reached ${tier}%. Paid after month close.`;
  } else if (!target) {
    message = 'No target set';
  } else {
    message = repAttainment?.message ?? 'The reward is paid after month close.';
  }

  return {
    period,
    currency,
    target,
    actual,
    percent,
    tier,
    tiers: repRoleTiers ? {
      tier100: repRoleTiers.tier100,
      tier120: repRoleTiers.tier120,
    } : null,
    reward: repAttainment?.reward ?? null,
    distance: repAttainment?.distance ?? null,
    message,
    note: targetReached ? 'Paid after month close' : 'The reward is paid after month close.',
    targetReached,
    earned: repAttainment?.earned ?? false,
  };
}

export interface RepPayoutsQuery {
  repId?: number;
  page?: number;
  limit?: number;
}

export async function getPayouts(actor: Requester, query: RepPayoutsQuery = {}) {
  const targetRepId = resolveTargetRepId(actor, query.repId);
  await assertCanSeeMoneyOf(actor, targetRepId);
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 50));

  const result = await payoutService.list({ payeeId: targetRepId, page, limit });
  return {
    payouts: result.payouts.map((p) => ({
      id: p.id,
      date: p.payoutDate,
      amount: Money.toApi(p.amount),
      status: p.status,
      notes: p.notes,
      method: p.method,
      reference: p.reference,
    })),
    total: result.total,
    page: result.page,
    limit: result.limit,
  };
}


/**
 * Shell summary: badge counts for the nav (queue pill, unread inbox, today's confirmed).
 */
export async function getShellSummary(tenantId: string, repId: number) {
  const [queueCount, unreadInbox, confirmedToday] = await Promise.all([
    prisma.order.count({
      where: {
        tenantId,
        customerRepId: repId,
        status: 'pending_confirmation',
        deletedAt: null,
      },
    }),
    prisma.notification.count({
      where: {
        tenantId,
        userId: repId,
        isRead: false,
      },
    }),
    prisma.call.count({
      where: {
        tenantId,
        salesRepId: repId,
        outcome: 'confirmed',
        createdAt: {
          gte: startOfDay(localDate(new Date(), getStoreTimeZone(tenantId)), getStoreTimeZone(tenantId)),
        },
      },
    }),
  ]);

  return {
    queue: queueCount,
    inbox: unreadInbox,
    todayConfirmed: confirmedToday,
  };
}

/**
 * Today page: calls done, confirmed, upsell extra, time to first call, target progress from M6 targets.
 */
export async function getToday(tenantId: string, repId: number) {
  const zone = getStoreTimeZone(tenantId);
  const now = new Date();
  const todayYmd = localDate(now, zone);
  const dayStart = startOfDay(todayYmd, zone);
  const dayEnd = endOfDay(todayYmd, zone);

  const currentMonthStr = currentMonth(now, zone);
  const { year, month } = parseMonth(currentMonthStr)!;
  const { from: monthFrom, to: monthTo } = monthRange(year, month, zone);

  const [callsDone, confirmedCalls, upsellLines, ttfcResult, ratesResult, attainmentRows] = await Promise.all([
    prisma.call.count({
      where: {
        tenantId,
        salesRepId: repId,
        createdAt: { gte: dayStart, lte: dayEnd },
      },
    }),
    prisma.call.count({
      where: {
        tenantId,
        salesRepId: repId,
        outcome: 'confirmed',
        createdAt: { gte: dayStart, lte: dayEnd },
      },
    }),
    prisma.upsellLine.findMany({
      where: {
        tenantId,
        repId,
        status: { not: UpsellStatus.void },
        createdAt: { gte: dayStart, lte: dayEnd },
      },
      select: { extraValue: true },
    }),
    timeToFirstCall(tenantId, monthFrom, monthTo, { repId }),
    repRates(tenantId, monthFrom, monthTo),
    rewardService.computeAttainment(currentMonthStr, { userId: repId }),
  ]);

  const upsellExtra = Money.sum(upsellLines.map((u) => u.extraValue));

  const repAttainment = attainmentRows?.results?.find((r) => r.userId === repId);

  let targetProgress;
  if (!repAttainment || repAttainment.target === null) {
    targetProgress = {
      hasTarget: false,
      message: 'No target set',
      target: null,
      actual: null,
      percent: null,
      metric: null,
      unit: null,
      tier: 'none',
    };
  } else {
    targetProgress = {
      hasTarget: true,
      message: repAttainment.message,
      target: repAttainment.target,
      actual: repAttainment.actual,
      percent: repAttainment.percent,
      tier: repAttainment.tier,
      metric: repAttainment.metric,
      unit: repAttainment.unit,
      reward: repAttainment.reward,
      distance: repAttainment.distance,
    };
  }

  const rates = ratesResult ? ratesResult.rep(repId) : null;

  return {
    callsDone,
    confirmed: confirmedCalls,
    upsellExtra: Money.toApi(upsellExtra),
    timeToFirstCall: {
      medianMinutes: ttfcResult?.value ?? null,
      operatingHoursSet: ttfcResult?.operatingHoursSet ?? false,
      targetMinutes: ttfcResult?.targetMinutes ?? null,
      alertMinutes: ttfcResult?.alertMinutes ?? null,
    },
    targetProgress,
    confirmationRate: rates?.confirmationRate ?? null,
    deliveredFromConfirmed: rates?.deliveredFromConfirmedRate ?? null,
  };
}

const VALID_QUEUE_TABS = new Set(['new', 'call_back', 'said_no', 'not_reachable']);

/**
 * Queue: orders waiting for rep's call, categorized into tabs:
 * New, Call back, Said NO, Not reachable.
 */
export async function getQueue(
  tenantId: string,
  repId: number,
  options: { tab?: string; q?: string } = {}
) {
  if (options.tab !== undefined && options.tab !== null && options.tab !== '') {
    if (!VALID_QUEUE_TABS.has(options.tab)) {
      throw new AppError(`Invalid tab: ${options.tab}`, 400, 'INVALID_TAB');
    }
  }

  const zone = getStoreTimeZone(tenantId);
  const now = new Date();

  const config = await prisma.systemConfig.findUnique({
    where: { tenantId },
    select: { operatingHours: true },
  });
  const hours = readOperatingHours(config?.operatingHours);
  const settings = readOperatingSettings(config?.operatingHours);
  const targetMinutes = settings?.firstCallTargetMinutes ?? DEFAULT_FIRST_CALL_TARGET_MINUTES;
  const alertMinutes = settings?.queueWaitAlertMinutes ?? DEFAULT_QUEUE_WAIT_ALERT_MINUTES;

  const orders = await prisma.order.findMany({
    where: {
      tenantId,
      customerRepId: repId,
      status: 'pending_confirmation',
      deletedAt: null,
    },
    include: {
      customer: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phoneNumber: true,
          alternatePhone: true,
          area: true,
          state: true,
          riskLevel: true,
          refusedOrders: true,
          deliveredOrders: true,
          codBlocked: true,
          wrongNumber: true,
        },
      },
      orderItems: {
        select: {
          quantity: true,
          product: {
            select: { name: true },
          },
        },
      },
      calls: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: {
          outcome: true,
          callbackAt: true,
          createdAt: true,
        },
      },
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  });

  const queueItems = orders.map((o) => {
    const latestCall = o.calls[0] ?? null;
    let tab: 'said_no' | 'call_back' | 'not_reachable' | 'new' = 'new';
    if (o.saidNo) {
      tab = 'said_no';
    } else if (latestCall?.outcome === 'call_back_later' || latestCall?.callbackAt) {
      tab = 'call_back';
    } else if (latestCall?.outcome === 'not_reachable') {
      tab = 'not_reachable';
    } else {
      tab = 'new';
    }

    const waitMinutes = workingMinutesBetween(o.createdAt, now, hours, zone);
    const waitTimerSeverity: 'normal' | 'gold' | 'coral' =
      waitMinutes >= alertMinutes ? 'coral' : waitMinutes >= targetMinutes ? 'gold' : 'normal';

    let callbackDue = false;
    let callbackSeverity: 'normal' | 'gold' | 'coral' | null = null;
    let callbackAt: Date | null = null;

    if (latestCall?.callbackAt) {
      callbackAt = latestCall.callbackAt;
      const cb = new Date(latestCall.callbackAt);
      const diffMinutes = Math.round((cb.getTime() - now.getTime()) / 60000);
      callbackDue = cb <= now;
      if (diffMinutes <= 0) {
        callbackSeverity = 'coral';
      } else if (diffMinutes < 30) {
        callbackSeverity = 'gold';
      } else {
        callbackSeverity = 'normal';
      }
    }

    const itemsSummary = o.orderItems.map((item) => `${item.quantity}x ${item.product.name}`).join(', ');
    const customerName = fullName(o.customer);
    const area = o.deliveryArea || o.customer.area || o.deliveryState || o.customer.state || '';

    return {
      id: o.id,
      status: o.status,
      customer: {
        id: o.customer.id,
        name: customerName,
        phoneNumber: o.customer.phoneNumber,
        alternatePhone: o.customer.alternatePhone,
        area,
        riskLevel: o.customer.riskLevel,
        refusedOrders: o.customer.refusedOrders,
        deliveredOrders: o.customer.deliveredOrders,
        codBlocked: o.customer.codBlocked,
        wrongNumber: o.customer.wrongNumber,
      },
      area,
      itemsSummary,
      totalAmount: Money.toApi(o.totalAmount),
      saidNo: o.saidNo,
      tab,
      waitMinutes: Math.round(waitMinutes * 10) / 10,
      waitTimerSeverity,
      callbackAt,
      callbackDue,
      callbackSeverity,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      priority: o.priority,
    };
  });

  const tabCounts = {
    new: queueItems.filter((i) => i.tab === 'new').length,
    call_back: queueItems.filter((i) => i.tab === 'call_back').length,
    said_no: queueItems.filter((i) => i.tab === 'said_no').length,
    not_reachable: queueItems.filter((i) => i.tab === 'not_reachable').length,
    total: queueItems.length,
  };

  let filtered = queueItems;
  if (options.tab) {
    filtered = filtered.filter((i) => i.tab === options.tab);
  }

  if (options.q && options.q.trim()) {
    const rawSearch = options.q.trim();
    const qLower = rawSearch.toLowerCase();
    const cleanId = rawSearch.startsWith('#') ? rawSearch.slice(1).trim() : rawSearch;
    filtered = filtered.filter((i) => {
      const matchName = i.customer.name.toLowerCase().includes(qLower);
      const matchPhone =
        (i.customer.phoneNumber || '').toLowerCase().includes(qLower) ||
        (i.customer.alternatePhone || '').toLowerCase().includes(qLower);
      const matchArea = i.area.toLowerCase().includes(qLower);
      const matchId = cleanId && /^\d+$/.test(cleanId) ? i.id === Number(cleanId) : false;
      return matchName || matchPhone || matchArea || matchId;
    });
  }

  if (options.tab === 'call_back') {
    filtered.sort((a, b) => {
      const timeA = a.callbackAt ? new Date(a.callbackAt).getTime() : 0;
      const timeB = b.callbackAt ? new Date(b.callbackAt).getTime() : 0;
      return timeA - timeB;
    });
  } else {
    filtered.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  return {
    tabs: tabCounts,
    orders: filtered,
    total: filtered.length,
    firstCallTargetMinutes: targetMinutes,
    queueWaitAlertMinutes: alertMinutes,
  };
}

/**
 * Call card: order, customer with risk fields, items, packages for upsell,
 * last calls, next queue order id.
 */
export async function getCallCard(
  tenantId: string,
  orderId: number,
  requester: Requester
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: true,
      orderItems: {
        include: { product: true },
      },
      deliveryAgent: {
        select: { id: true, firstName: true, lastName: true, phoneNumber: true },
      },
      customerRep: {
        select: { id: true, firstName: true, lastName: true },
      },
      calls: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10,
        include: {
          salesRep: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      },
    },
  });

  if (!order || order.tenantId !== tenantId || order.deletedAt) {
    throw new AppError('Order not found', 404, 'ORDER_NOT_FOUND');
  }

  // Row scope check: sales rep sees only their own assigned orders
  if (!isManagerUp(requester)) {
    if (order.customerRepId !== requester.id) {
      throw new AppError("You cannot view another rep's order", 403, 'FORBIDDEN');
    }
  }

  const [packages, previousOrders, nextOrder] = await Promise.all([
    upsellService.getUpsellOptions(order.id, tenantId),
    prisma.order.findMany({
      where: {
        tenantId,
        customerId: order.customerId,
        id: { not: order.id },
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        createdAt: true,
        totalAmount: true,
        status: true,
      },
    }),
    prisma.order.findFirst({
      where: {
        tenantId,
        customerRepId: order.customerRepId,
        status: 'pending_confirmation',
        id: { not: order.id },
        deletedAt: null,
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      select: { id: true },
    }),
  ]);

  return {
    order: {
      id: order.id,
      status: order.status,
      totalAmount: Money.toApi(order.totalAmount),
      subtotal: order.subtotal != null ? Money.toApi(order.subtotal) : Money.toApi(order.totalAmount),
      deliveryFee: order.deliveryFee != null ? Money.toApi(order.deliveryFee) : null,
      customerRepId: order.customerRepId,
      deliveryAgentId: order.deliveryAgentId,
      deliveryAgent: order.deliveryAgent
        ? {
            id: order.deliveryAgent.id,
            name: fullName(order.deliveryAgent),
            phoneNumber: order.deliveryAgent.phoneNumber,
          }
        : null,
      customerRep: order.customerRep
        ? {
            id: order.customerRep.id,
            name: fullName(order.customerRep),
          }
        : null,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      firstContactAt: order.firstContactAt,
      saidNo: order.saidNo,
      customerResponse: order.customerResponse,
      requiresManualCall: order.requiresManualCall,
      notes: order.notes,
      declineReason: order.declineReason,
      failureReason: order.failureReason,
      statusVersion: order.statusVersion,
    },
    customer: {
      id: order.customer.id,
      firstName: order.customer.firstName,
      lastName: order.customer.lastName,
      name: fullName(order.customer),
      phoneNumber: order.customer.phoneNumber,
      alternatePhone: order.customer.alternatePhone,
      email: order.customer.email,
      address: order.deliveryAddress || order.customer.address,
      area: order.deliveryArea || order.customer.area || order.deliveryState || order.customer.state || '',
      state: order.deliveryState || order.customer.state || '',
      riskLevel: order.customer.riskLevel,
      refusedOrders: order.customer.refusedOrders,
      deliveredOrders: order.customer.deliveredOrders,
      codBlocked: order.customer.codBlocked,
      wrongNumber: order.customer.wrongNumber,
      previousOrders: previousOrders.map((po) => ({
        id: po.id,
        createdAt: po.createdAt,
        totalAmount: Money.toApi(po.totalAmount),
        status: po.status,
      })),
    },
    items: order.orderItems.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.product?.name ?? 'Unknown',
      quantity: item.quantity,
      unitPrice: Money.toApi(item.unitPrice),
      totalPrice: Money.toApi(item.totalPrice),
    })),
    packages,
    lastCalls: order.calls.map((c) => ({
      id: c.id,
      outcome: c.outcome,
      duration: c.duration,
      notes: c.notes,
      startedAt: c.startedAt,
      callbackAt: c.callbackAt,
      declineReason: c.declineReason,
      createdAt: c.createdAt,
      salesRep: c.salesRep
        ? {
            id: c.salesRep.id,
            name: fullName(c.salesRep),
          }
        : null,
    })),
    nextOrderId: nextOrder?.id ?? null,
    pay: {
      baseCommission: Money.toApi(BASE_COMMISSION_AMOUNT),
      upsellPercent: UPSELL_COMMISSION_RATE.mul(100).toNumber(),
    },
  };
}
