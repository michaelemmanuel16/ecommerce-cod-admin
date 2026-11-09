import { OrderStatus, Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { resolveTenantId } from '../utils/tenantContext';
import { AppError } from '../middleware/errorHandler';
import { Requester, isManagerUp } from '../utils/authUtils';
import { getCurrency } from '../utils/currency';
import { fullName } from '../utils/nameUtils';
import * as Money from '../utils/money';
import { repRates } from './kpi/reps';
import { timeToFirstCall } from './kpi/timeToFirstCall';
import { leaderboard } from './leaderboardService';
import * as rewardService from './rewardService';
import payoutService from './payoutService';
import { currentMonth, endOfDay, getStoreTimeZone, localDate, monthRange, parseBound, startOfDay } from './kpi/dates';

/**
 * M7-T11 (COD-65, F-753, F-760, F-761, F-762, F-769): Rep API part 2.
 *
 * Provides:
 * - Orders: rep orders with status filter and search by id, phone, name.
 * - Numbers: rates from M1 KPI service (repRates) only — no second formula (R3 contract), rank, upsell, calls.
 * - Earnings: base + upsell - paid per order line; reversal line on return; overpaid if owed < 0.
 * - Reward progress: M6 cash reward tiers via rewardService; target reached shows "Paid after month close".
 * - Pay ledger: payout history the rep owns.
 */

export function resolveTargetRepId(actor: Requester, requestedRepId?: number): number {
  if (!isManagerUp(actor)) {
    if (requestedRepId !== undefined && requestedRepId !== actor.id) {
      throw new AppError('You can only see your own data', 403);
    }
    return actor.id;
  }
  return requestedRepId ?? actor.id;
}

export function statusToLabel(status: OrderStatus): string {
  switch (status) {
    case 'confirmed':
    case 'preparing':
    case 'ready_for_pickup':
      return 'Waiting to dispatch';
    case 'out_for_delivery':
      return 'Out for delivery';
    case 'delivered':
    case 'digital_delivered':
      return 'Delivered';
    case 'failed_delivery':
      return 'Failed';
    case 'returned':
      return 'Returned';
    case 'cancelled':
      return 'Declined';
    case 'pending_confirmation':
      return 'Pending confirmation';
    case 'payment_pending':
      return 'Payment pending';
    case 'payment_failed':
      return 'Payment failed';
    default:
      return status;
  }
}

export interface RepOrdersQuery {
  repId?: number;
  q?: string;
  search?: string;
  status?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  from?: string;
  to?: string;
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
    const s = query.status.toLowerCase().trim();
    if (s === 'waiting_to_dispatch') {
      and.push({ status: { in: ['confirmed', 'preparing', 'ready_for_pickup'] } });
    } else if (s === 'out_for_delivery') {
      and.push({ status: 'out_for_delivery' });
    } else if (s === 'delivered') {
      and.push({ status: { in: ['delivered', 'digital_delivered'] } });
    } else if (s === 'failed') {
      and.push({ status: { in: ['failed_delivery', 'returned'] } });
    } else if (s === 'declined') {
      and.push({ status: 'cancelled' });
    } else {
      const parts = s.split(',').map((p) => p.trim()) as OrderStatus[];
      and.push({ status: { in: parts } });
    }
  }

  const rawSearch = (query.q ?? query.search)?.trim();
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
      { customer: { area: { contains: rawSearch, mode: 'insensitive' } } },
      { deliveryArea: { contains: rawSearch, mode: 'insensitive' } },
    );
    and.push({ OR: searchOr });
  }

  if (query.from || query.to) {
    const dateRange: Prisma.DateTimeFilter = {};
    if (query.from) dateRange.gte = new Date(query.from);
    if (query.to) dateRange.lte = new Date(query.to);
    and.push({ createdAt: dateRange });
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
    orderNumber: `#${o.id}`,
    createdAt: o.createdAt,
    status: o.status,
    statusLabel: statusToLabel(o.status),
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

export interface RepNumbersQuery {
  repId?: number;
  from?: string;
  to?: string;
  period?: string;
}

export async function getNumbers(actor: Requester, query: RepNumbersQuery = {}) {
  const targetRepId = resolveTargetRepId(actor, query.repId);
  const tenantId = resolveTenantId();
  const zone = getStoreTimeZone(tenantId);

  let fromDate: Date;
  let toDate: Date;
  if (query.from && query.to) {
    fromDate = parseBound(query.from, 'from', zone);
    toDate = parseBound(query.to, 'to', zone);
  } else {
    const period = query.period ?? currentMonth();
    const [year, month] = period.split('-').map(Number);
    const range = monthRange(year, month, zone);
    fromDate = range.from;
    toDate = range.to;
  }

  // 1. M1 KPI rates: strictly from repRates (services/kpi/reps.ts) — NO second formula
  const ratesResult = await repRates(tenantId, fromDate, toDate);
  const repRatesData = ratesResult.rep(targetRepId);

  const confirmationRate = repRatesData.confirmationRate.value;
  const confirmationDetail = repRatesData.confirmationRate.detail;
  const deliveredFromConfirmedRate = repRatesData.deliveredFromConfirmedRate.value;
  const deliveredDetail = repRatesData.deliveredFromConfirmedRate.detail;

  // 2. Time to first call
  const ttfcResult = await timeToFirstCall(tenantId, fromDate, toDate, { repId: targetRepId });
  const ttfcMinutes = ttfcResult.value;

  // 3. Upsell metrics on confirmed orders in range
  const upsellLines = await prisma.upsellLine.findMany({
    where: {
      tenantId,
      repId: targetRepId,
      status: 'active',
      order: {
        deletedAt: null,
        confirmedById: targetRepId,
        createdAt: { gte: fromDate, lt: toDate },
      },
    },
    include: { order: { select: { status: true } } },
  });

  const deliveredUpsellLines = upsellLines.filter((l) => l.order.status === 'delivered');
  const extraValueDelivered = Money.sum(deliveredUpsellLines.map((l) => l.extraValue));
  const confirmedCount = confirmationDetail.confirmed ?? 0;
  const ordersWithUpsell = new Set(upsellLines.map((l) => l.orderId)).size;
  const upsellRate = confirmedCount > 0 ? Math.round((ordersWithUpsell / confirmedCount) * 100) : 0;

  // 4. Target progress
  const attainment = await rewardService.computeAttainment(query.period ?? currentMonth(), { userId: targetRepId });
  const myAttainment = attainment.results.find((r) => r.userId === targetRepId);

  // 5. Ranks from leaderboard
  let callRepRank: { rank: number | null; total: number } | null = null;
  let upsellRank: { rank: number | null; total: number } | null = null;
  try {
    const callRepBoard = await leaderboard(actor, { role: 'call_rep', period: query.period ?? 'month' });
    const myRow = callRepBoard.rows.find((r: any) => r.userId === targetRepId) as any;
    const rankVal = myRow && typeof myRow.rank === 'number' ? myRow.rank : null;
    callRepRank = { rank: rankVal, total: callRepBoard.rows.length };
  } catch {
    callRepRank = null;
  }
  try {
    const upsellBoard = await leaderboard(actor, { role: 'upsell', period: query.period ?? 'month' });
    const myRow = upsellBoard.rows.find((r: any) => r.userId === targetRepId) as any;
    const rankVal = myRow && typeof myRow.rank === 'number' ? myRow.rank : null;
    upsellRank = { rank: rankVal, total: upsellBoard.rows.length };
  } catch {
    upsellRank = null;
  }

  // 6. Order breakdown ("Where my confirmed orders are")
  const deliveredCount = deliveredDetail.delivered ?? 0;
  const failedCount = deliveredDetail.failed ?? 0;
  const returnedCount = deliveredDetail.returned ?? 0;
  const failedOrReturned = failedCount + returnedCount;
  const stillOpen = Math.max(0, confirmedCount - (deliveredCount + failedOrReturned));

  // 7. My calls: today, this week, this month, avg/day
  const now = new Date();
  const todayStr = localDate(now, zone);
  const todayStart = startOfDay(todayStr, zone);
  const todayEnd = endOfDay(todayStr, zone);

  const dayOfWeek = (now.getUTCDay() + 6) % 7; // Mon = 0
  const weekStart = new Date(now.getTime() - dayOfWeek * 24 * 60 * 60 * 1000);
  weekStart.setUTCHours(0, 0, 0, 0);

  const [callsToday, callsThisWeek, callsThisMonth, callOutcomeGroups] = await Promise.all([
    prisma.call.count({ where: { tenantId, salesRepId: targetRepId, createdAt: { gte: todayStart, lte: todayEnd } } }),
    prisma.call.count({ where: { tenantId, salesRepId: targetRepId, createdAt: { gte: weekStart, lte: toDate } } }),
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

  // 8. Calls per day (last 14 days)
  const callsPerDay: { date: string; count: number; isToday: boolean }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 3600 * 1000);
    const dateStr = localDate(d, zone);
    const dStart = startOfDay(dateStr, zone);
    const dEnd = endOfDay(dateStr, zone);
    const count = await prisma.call.count({
      where: { tenantId, salesRepId: targetRepId, createdAt: { gte: dStart, lte: dEnd } },
    });
    callsPerDay.push({ date: dateStr, count, isToday: i === 0 });
  }

  return {
    repId: targetRepId,
    period: query.period ?? currentMonth(),
    confirmed: confirmedCount,
    confirmationRate,
    confirmationRateDetail: confirmationDetail,
    deliveredFromConfirmedRate,
    deliveredFromConfirmedDetail: deliveredDetail,
    upsellRate,
    extraValueAdded: Money.toApi(extraValueDelivered),
    timeToFirstCall: ttfcMinutes,
    targetProgress: {
      target: myAttainment?.target ? parseInt(myAttainment.target, 10) : null,
      actual: myAttainment?.actual ?? deliveredCount,
      percent: myAttainment?.percent ?? null,
      tier: myAttainment?.tier ?? 'none',
    },
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
  const currency = await getCurrency();

  const rep = await prisma.user.findFirst({
    where: { id: targetRepId, tenantId },
    select: { id: true, firstName: true, lastName: true, role: true, kind: true },
  });
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

  let commission = Money.ZERO;
  let upsellReward = Money.ZERO;
  let targetReward = Money.ZERO;

  for (const e of entries) {
    if (e.status === 'earned' || e.status === 'paid') {
      const amt = Money.parse(e.amount);
      if (e.kind === 'base') commission = commission.plus(amt);
      else if (e.kind === 'upsell') upsellReward = upsellReward.plus(amt);
      else if (e.kind === 'reward') targetReward = targetReward.plus(amt);
    }
  }
  const earned = commission.plus(upsellReward).plus(targetReward);
  const paid = Money.sum(payouts.map((p) => p.amount));

  const netOwed = earned.minus(paid);
  const isOverpaid = netOwed.lt(0);
  const overpaid = isOverpaid ? Money.toApi(netOwed.abs()) : null;
  const owed = isOverpaid ? '0.00' : Money.toApi(netOwed);

  const openOrdersCount = await prisma.order.count({
    where: {
      tenantId,
      deletedAt: null,
      confirmedById: targetRepId,
      status: { in: ['confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery'] },
    },
  });
  const openOrdersNote = `${openOrdersCount} of your confirmed orders are still open, each adds GH₵8 when delivered.`;

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
    const isReturned = o?.status === 'returned';
    const hasVoid = oEntries.some((e) => e.status === 'void');

    const baseAmt = Money.sum(oEntries.filter((e) => e.kind === 'base' && e.status !== 'void').map((e) => e.amount));
    const upsellAmt = Money.sum(oEntries.filter((e) => e.kind === 'upsell' && e.status !== 'void').map((e) => e.amount));
    const paidAmt = Money.sum(oEntries.filter((e) => e.status === 'paid').map((e) => e.amount));
    const voidAmt = Money.sum(oEntries.filter((e) => e.status === 'void').map((e) => e.amount));

    const isReversal = isReturned || hasVoid;
    const reversalAmt = isReversal ? (voidAmt.gt(0) ? voidAmt : baseAmt.plus(upsellAmt)) : null;
    const net = baseAmt.plus(upsellAmt).minus(paidAmt);

    return {
      orderId,
      orderNumber: `#${orderId}`,
      date: o?.createdAt ?? oEntries[0].createdAt,
      customerName: o?.customer ? fullName(o.customer) : null,
      status: o?.status ?? (isReturned ? 'returned' : 'delivered'),
      base: Money.toApi(baseAmt),
      upsell: Money.toApi(upsellAmt),
      earned: Money.toApi(baseAmt.plus(upsellAmt)),
      paid: Money.toApi(paidAmt),
      reversal: reversalAmt ? Money.toApi(reversalAmt) : null,
      isReversal,
      net: Money.toApi(net),
    };
  });

  const formattedPayouts = payouts.map((p) => ({
    id: p.id,
    payoutDate: p.payoutDate,
    amount: Money.toApi(p.amount),
    method: p.method,
    reference: p.reference,
    status: p.status,
    notes: p.notes,
    for: p.notes ?? `${p.method} payout`,
  }));

  return {
    currency,
    commission: Money.toApi(commission),
    upsellReward: Money.toApi(upsellReward),
    targetReward: Money.toApi(targetReward),
    earned: Money.toApi(earned),
    paid: Money.toApi(paid),
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
  payout: boolean;
}

export async function getRewardProgress(actor: Requester, query: RepRewardProgressQuery = {}): Promise<RewardProgressResult> {
  const targetRepId = resolveTargetRepId(actor, query.repId);
  const tenantId = resolveTenantId();
  const period = query.period ?? currentMonth();

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
      payout: false,
    };
  }

  const repAttainment = attainmentResult.results.find((r) => r.userId === targetRepId);
  const repRoleTiers = settings.tiers.find((t) => t.roleName === 'Call rep' || t.roleId === repAttainment?.roleId);

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
    payout: true,
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
      payoutDate: p.payoutDate,
      amount: Money.toApi(p.amount),
      method: p.method,
      reference: p.reference,
      status: p.status,
      notes: p.notes,
      for: p.notes ?? `${p.method} payout`,
    })),
    total: result.total,
    page: result.page,
    limit: result.limit,
  };
}
