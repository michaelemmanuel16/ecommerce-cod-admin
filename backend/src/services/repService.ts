import { OrderStatus, Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { resolveTenantId } from '../utils/tenantContext';
import { AppError } from '../middleware/errorHandler';
import { Requester, isManagerUp } from '../utils/authUtils';
import { getCurrency } from '../utils/currency';
import { fullName } from '../utils/nameUtils';
import * as Money from '../utils/money';
import { leaderboard } from './leaderboardService';
import * as rewardService from './rewardService';
import payoutService, { summarize } from './payoutService';
import { teamReport } from './teamReportService';
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
 * - Numbers: rates from teamReport; calls bucketed by store-local date; ranks from leaderboard.
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

  // Orders owned, confirmed or called by the rep
  const repCondition: Prisma.OrderWhereInput = {
    OR: [
      { customerRepId: targetRepId },
      { confirmedById: targetRepId },
      { calls: { some: { salesRepId: targetRepId } } },
    ],
  };

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

  // 3. Order breakdown from the rep's deliveredFromConfirmedRate detail
  const confirmedCount = repRow?.confirmationRate.detail.confirmed ?? 0;
  const deliveredDetail = repRow?.deliveredFromConfirmedRate.detail ?? { delivered: 0, failed: 0, returned: 0, closed: 0 };
  const deliveredCount = deliveredDetail.delivered ?? 0;
  const failedCount = deliveredDetail.failed ?? 0;
  const returnedCount = deliveredDetail.returned ?? 0;
  const failedOrReturned = failedCount + returnedCount;
  const stillOpen = Math.max(0, confirmedCount - (deliveredCount + failedOrReturned));

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
    confirmed: repRow?.confirmed ?? 0,
    confirmationRate: repRow?.confirmationRate.value ?? null,
    confirmationRateDetail: repRow?.confirmationRate.detail ?? { confirmed: 0, placed: 0, autoConfirmed: 0 },
    deliveredFromConfirmedRate: repRow?.deliveredFromConfirmedRate.value ?? null,
    deliveredFromConfirmedDetail: repRow?.deliveredFromConfirmedRate.detail ?? { delivered: 0, failed: 0, returned: 0, closed: 0 },
    upsellRate: repRow?.upsellRate ?? 0,
    extraValueAdded: repRow?.extraValue ?? '0.00',
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
  const tenantId = resolveTenantId();

  const [rep, settings, currency] = await Promise.all([
    prisma.user.findFirst({
      where: { id: targetRepId, tenantId },
      select: { id: true, firstName: true, lastName: true, role: true, kind: true },
    }),
    rewardService.getRewardSettings(),
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
  const [entries, payouts] = await Promise.all([
    prisma.commissionEntry.findMany({
      where: { tenantId, userId: targetRepId },
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
  ]);

  // The one owed rule from payoutService: summarize()
  const summary = summarize(entries);
  const isOverpaid = summary.owed.lt(0);
  const overpaid = isOverpaid ? Money.toApi(summary.owed.abs()) : null;
  const owed = Money.toApi(summary.owed);

  const openOrdersCount = await prisma.order.count({
    where: {
      tenantId,
      deletedAt: null,
      confirmedById: targetRepId,
      status: { in: ['confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery'] },
    },
  });

  const baseCommission = settings.repPay?.baseCommission ?? '8.00';
  const formattedBaseCommission = Money.formatWithSign(baseCommission, currency);
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

  const [settings, attainmentResult, currency] = await Promise.all([
    rewardService.getRewardSettings(),
    rewardService.computeAttainment(period, { userId: targetRepId }),
    getCurrency(),
  ]);

  const rep = await prisma.user.findFirst({
    where: { id: targetRepId, tenantId },
    select: { id: true, kind: true },
  });

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
