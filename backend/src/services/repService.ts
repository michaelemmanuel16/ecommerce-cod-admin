import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { formatOrderNumber } from '../utils/orderNumber';
import { workingMinutesBetween, readOperatingHours } from './kpi/workingTime';
import { timeToFirstCall } from './kpi/timeToFirstCall';
import { computeAttainment } from './rewardService';
import { repRates } from './kpi/reps';
import { getStoreTimeZone, localDate, startOfDay, endOfDay } from './kpi/dates';
import { upsellService } from './upsellService';
import * as Money from '../utils/money';

function formatWaitMinutes(mins: number): string {
  const m = Math.max(0, Math.floor(mins));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${h} h ${rem.toString().padStart(2, '0')} min`;
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
    prisma.notification
      .count({
        where: {
          tenantId,
          userId: repId,
          isRead: false,
        },
      })
      .catch(() => 0),
    prisma.call
      .count({
        where: {
          tenantId,
          salesRepId: repId,
          outcome: 'confirmed',
          createdAt: {
            gte: startOfDay(localDate(new Date(), getStoreTimeZone(tenantId)), getStoreTimeZone(tenantId)),
          },
        },
      })
      .catch(() => 0),
  ]);

  return {
    queue: queueCount,
    pending: queueCount,
    queueCount,
    inbox: unreadInbox,
    unreadInbox,
    todayConfirmed: confirmedToday,
  };
}

/**
 * Today page: calls done, confirmed, upsell extra, time to first call, target progress from M6 targets.
 */
export async function getToday(tenantId: string, repId: number) {
  const zone = getStoreTimeZone(tenantId);
  const todayYmd = localDate(new Date(), zone);
  const dayStart = startOfDay(todayYmd, zone);
  const dayEnd = endOfDay(todayYmd, zone);

  const currentMonthStr = todayYmd.slice(0, 7);
  const monthFrom = startOfDay(`${currentMonthStr}-01`, zone);
  const [yr, mo] = currentMonthStr.split('-').map(Number);
  const nextMoYmd = mo === 12 ? `${yr + 1}-01-01` : `${yr}-${String(mo + 1).padStart(2, '0')}-01`;
  const monthTo = startOfDay(nextMoYmd, zone);

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
        status: { not: 'void' as any },
        createdAt: { gte: dayStart, lte: dayEnd },
      },
      select: { extraValue: true },
    }),
    timeToFirstCall(tenantId, monthFrom, monthTo, { repId }).catch(() => null),
    repRates(tenantId, monthFrom, monthTo).catch(() => null),
    computeAttainment(currentMonthStr, { userId: repId }).catch(() => null),
  ]);

  const upsellExtra = Money.sum(upsellLines.map((u) => u.extraValue));

  const repAttainment = attainmentRows?.results?.find(
    (r: any) => r.userId === repId && (r.roleName.toLowerCase().includes('rep') || r.userId === repId)
  );

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

/**
 * Queue: orders waiting for rep's call, categorized into tabs:
 * New, Call back, Said NO, Not reachable.
 */
export async function getQueue(
  tenantId: string,
  repId: number,
  options: { tab?: string; q?: string } = {}
) {
  const zone = getStoreTimeZone(tenantId);
  const now = new Date();

  const config = await prisma.systemConfig.findUnique({
    where: { tenantId },
    select: { operatingHours: true },
  });
  const hours = readOperatingHours(config?.operatingHours);
  const targetMinutes = hours?.firstCallTargetMinutes ?? 15;
  const alertMinutes = hours?.queueWaitAlertMinutes ?? 30;

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
        include: { product: true },
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
    let callbackDueFormatted: string | null = null;
    let callbackSeverity: 'normal' | 'gold' | 'coral' | null = null;
    let callbackAt: Date | null = null;

    if (latestCall?.callbackAt) {
      callbackAt = latestCall.callbackAt;
      const cb = new Date(latestCall.callbackAt);
      const diffMinutes = Math.round((cb.getTime() - now.getTime()) / 60000);
      callbackDue = cb <= now;
      if (diffMinutes < 0) {
        callbackDueFormatted = `Overdue ${Math.abs(diffMinutes)} min`;
        callbackSeverity = 'coral';
      } else if (diffMinutes === 0) {
        callbackDueFormatted = 'Due now';
        callbackSeverity = 'coral';
      } else if (diffMinutes < 30) {
        callbackDueFormatted =
          diffMinutes >= 60
            ? `In ${Math.floor(diffMinutes / 60)} h ${String(diffMinutes % 60).padStart(2, '0')}`
            : `In ${diffMinutes} min`;
        callbackSeverity = 'gold';
      } else {
        callbackDueFormatted =
          diffMinutes >= 60
            ? `In ${Math.floor(diffMinutes / 60)} h ${String(diffMinutes % 60).padStart(2, '0')}`
            : `In ${diffMinutes} min`;
        callbackSeverity = 'normal';
      }
    }

    const itemsSummary = o.orderItems.map((item) => `${item.quantity}x ${item.product.name}`).join(', ');
    const customerName = `${o.customer.firstName} ${o.customer.lastName}`.trim();
    const area = o.deliveryArea || o.customer.area || o.deliveryState || o.customer.state || '';

    return {
      id: o.id,
      orderNumber: formatOrderNumber(o.id),
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
      totalAmount: o.totalAmount,
      saidNo: o.saidNo,
      tab,
      waitMinutes: Math.round(waitMinutes * 10) / 10,
      waitTimerFormatted: formatWaitMinutes(waitMinutes),
      waitTimerSeverity,
      callbackAt,
      callbackDue,
      callbackDueFormatted,
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
  if (options.tab && options.tab !== 'all') {
    const rawTab = options.tab.toLowerCase().replace(/[\s-]/g, '_');
    const targetTab =
      rawTab === 'callback' || rawTab === 'callbacks' || rawTab === 'call_back'
        ? 'call_back'
        : rawTab === 'saidno' || rawTab === 'said_no'
        ? 'said_no'
        : rawTab === 'notreachable' || rawTab === 'not_reachable'
        ? 'not_reachable'
        : rawTab === 'new'
        ? 'new'
        : null;

    if (targetTab) {
      filtered = filtered.filter((i) => i.tab === targetTab);
    }
  }

  if (options.q && options.q.trim()) {
    const qLower = options.q.trim().toLowerCase();
    filtered = filtered.filter((i) => {
      const matchName = i.customer.name.toLowerCase().includes(qLower);
      const matchPhone =
        (i.customer.phoneNumber || '').toLowerCase().includes(qLower) ||
        (i.customer.alternatePhone || '').toLowerCase().includes(qLower);
      const matchArea = i.area.toLowerCase().includes(qLower);
      const matchId = String(i.id).includes(qLower) || i.orderNumber.toLowerCase().includes(qLower);
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
    counts: tabCounts,
    orders: filtered,
    total: filtered.length,
  };
}

/**
 * Call card: order, customer with risk fields, items, packages for upsell,
 * last calls, next queue order id.
 */
export async function getCallCard(
  tenantId: string,
  orderId: number,
  requester: { id: number; role: string }
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
  if (requester.role === 'sales_rep') {
    if (order.customerRepId !== requester.id) {
      throw new AppError("You cannot view another rep's order", 403, 'FORBIDDEN');
    }
  }

  let packages = null;
  try {
    packages = await upsellService.getUpsellOptions(order.id, tenantId);
  } catch {
    // Non-fatal if upsell options cannot be retrieved
  }

  const previousOrders = await prisma.order.findMany({
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
  });

  const nextOrder = await prisma.order.findFirst({
    where: {
      tenantId,
      customerRepId: order.customerRepId,
      status: 'pending_confirmation',
      id: { not: order.id },
      deletedAt: null,
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    select: { id: true },
  });

  return {
    order: {
      id: order.id,
      orderNumber: formatOrderNumber(order.id),
      status: order.status,
      totalAmount: order.totalAmount,
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      customerRepId: order.customerRepId,
      deliveryAgentId: order.deliveryAgentId,
      deliveryAgent: order.deliveryAgent
        ? {
            id: order.deliveryAgent.id,
            name: `${order.deliveryAgent.firstName} ${order.deliveryAgent.lastName}`.trim(),
            phoneNumber: order.deliveryAgent.phoneNumber,
          }
        : null,
      customerRep: order.customerRep
        ? {
            id: order.customerRep.id,
            name: `${order.customerRep.firstName} ${order.customerRep.lastName}`.trim(),
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
      name: `${order.customer.firstName} ${order.customer.lastName}`.trim(),
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
        orderNumber: formatOrderNumber(po.id),
        createdAt: po.createdAt,
        totalAmount: po.totalAmount,
        status: po.status,
      })),
    },
    items: order.orderItems.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.product?.name ?? 'Unknown',
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
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
            name: `${c.salesRep.firstName} ${c.salesRep.lastName}`.trim(),
          }
        : null,
    })),
    nextOrderId: nextOrder?.id ?? null,
  };
}
