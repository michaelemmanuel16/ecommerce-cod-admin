/**
 * Delivery partners, read side (M4-T18; F-700, F-701, F-702, F-705, F-715).
 *
 * One list for agents and 3PLs. A partner is a `delivery_agent` user; kind `company` is a 3PL, anything else an agent.
 * Rates and timings come from kpi/partners.ts `partnerRates` (the formula lives there). The row adds what that file
 * does not return: the "out now" count and the profile and fee-rule fields.
 *
 * Row identity: assigned = delivered + failed or returned + out now. "Assigned" means dispatched to the partner (F-700):
 * an order the partner holds that has not gone out yet (still confirmed, preparing or ready for pickup, or cancelled
 * before dispatch) is not in it. `notYetDispatched` shows how many such orders the partner holds, so nothing disappears silently.
 * Cash held and oldest unpaid are null until M5 (F-704).
 */
import { FailureReason, FeeOutcome, OrderStatus, PartnerDataSource, UserKind } from '@prisma/client';
import prisma from '../utils/prisma';
import { withSoftDeleted } from '../utils/prismaExtensions';
import { runInTenant } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { DAY_MS } from './kpi/dates';
import { partnerRates } from './kpi/partners';
import { closedOutcomeResult, DIGITAL, ratePercent, rates } from './kpi/rates';
import { deliveredRevenue } from './kpi/revenue';
import { outForDelivery, waitingToDispatch, WAITING } from './kpi/outcomes';
import { kpiMeta, type KpiResult } from './kpi/types';

export type PartnerType = 'agent' | '3pl';
export type PartnerTypeFilter = PartnerType | 'all';

/** A company is a 3PL; a person (and anything else) is an agent. */
export const partnerTypeOf = (kind: UserKind): PartnerType => (kind === 'company' ? '3pl' : 'agent');

/** Default delivery success target when the tenant has no `delivery_success_rate` target row (same default as leadership.ts). */
const DEFAULT_SUCCESS_TARGET = 60;
/** A waiting order older than this many days is marked (F-715, GUESS in the PRD). */
const WAITING_OVERDUE_DAYS = 2;

export type FeeRuleView = Record<FeeOutcome, string | null>;

export interface PartnerRow {
  partnerId: number;
  name: string;
  type: PartnerType;
  isActive: boolean;
  isAvailable: boolean;
  isTrial: boolean;
  baseTown: string | null;
  assigned: number;
  delivered: number;
  failed: number;
  returned: number;
  /** failed + returned (the column "Failed or returned"). */
  failedOrReturned: number;
  outNow: number;
  /** Orders the partner holds that have not been dispatched yet. Not part of `assigned`. */
  notYetDispatched: number;
  deliverySuccessRate: KpiResult<number | null>;
  confirmedToDispatchedDays: number | null;
  dispatchedToDeliveredDays: number | null;
  dataSource: PartnerDataSource;
  daysToPay: number | null;
  /** The partner's fee rule, read from FeeRule (amounts per outcome). Left out for a role that may not see money. */
  feeRule?: FeeRuleView | null;
  /** M5 (F-704). */
  cashHeld: null;
  oldestUnpaidDays: null;
}

export interface PartnerTotal {
  assigned: number;
  delivered: number;
  failed: number;
  returned: number;
  failedOrReturned: number;
  outNow: number;
  notYetDispatched: number;
  deliverySuccessRate: KpiResult<number | null>;
}

export interface PartnerList {
  from: string;
  to: string;
  type: PartnerTypeFilter;
  /** Rows per tab, whatever tab is open: All, Agents, 3PLs. */
  counts: { all: number; agent: number; '3pl': number };
  rows: PartnerRow[];
  total: PartnerTotal;
}

interface ViewOptions {
  /** The caller may see money (financial:view). Fee rules and revenue are left out when false. */
  showMoney: boolean;
}

const sum = (rows: PartnerRow[], pick: (r: PartnerRow) => number) => rows.reduce((s, r) => s + pick(r), 0);

export async function listPartners(
  tenantId: string,
  from: Date,
  to: Date,
  opts: ViewOptions & { type?: PartnerTypeFilter },
): Promise<PartnerList> {
  const type = opts.type ?? 'all';
  const meta = kpiMeta(from, to);

  const [rated, users, outGroups, feeRules] = await Promise.all([
    partnerRates(tenantId, from, to),
    runInTenant(tenantId, () => withSoftDeleted(() => prisma.user.findMany({
      where: { role: 'delivery_agent', kind: { in: ['person', 'company'] } },
      select: {
        id: true, firstName: true, lastName: true, kind: true, isActive: true, isAvailable: true,
        partnerProfile: { select: { isTrial: true, dataSource: true, daysToPay: true, baseTown: true } },
      },
      orderBy: [{ firstName: 'asc' }, { id: 'asc' }],
    }))),
    runInTenant(tenantId, () => prisma.order.groupBy({
      by: ['deliveryAgentId'],
      where: { deletedAt: null, status: 'out_for_delivery', deliveryAgentId: { not: null }, createdAt: { gte: from, lt: to } },
      _count: { _all: true },
    })),
    opts.showMoney ? runInTenant(tenantId, () => prisma.feeRule.findMany()) : Promise.resolve([]),
  ]);

  const ratedBy = new Map(rated.map((r) => [r.partnerId, r]));
  const outBy = new Map(outGroups.map((g) => [g.deliveryAgentId as number, g._count._all]));
  const rulesBy = new Map<number, FeeRuleView>();
  for (const rule of feeRules) {
    const view = rulesBy.get(rule.partnerUserId) ?? { delivered: null, failed: null, returned: null };
    view[rule.outcome] = Money.toApi(rule.amount);
    rulesBy.set(rule.partnerUserId, view);
  }

  const all: PartnerRow[] = [];
  for (const u of users) {
    const r = ratedBy.get(u.id);
    // A deactivated partner shows only when it has orders in the period (F-700)
    if (!u.isActive && !r) continue;

    const detail = r?.deliverySuccessRate.detail;
    const delivered = detail?.delivered ?? 0;
    const failed = detail?.failed ?? 0;
    const returned = detail?.returned ?? 0;
    const outNow = outBy.get(u.id) ?? 0;
    const assigned = delivered + failed + returned + outNow;
    const profile = u.partnerProfile;
    all.push({
      partnerId: u.id,
      name: `${u.firstName} ${u.lastName}`.trim(),
      type: partnerTypeOf(u.kind),
      isActive: u.isActive,
      isAvailable: u.isAvailable,
      isTrial: profile?.isTrial ?? false,
      baseTown: profile?.baseTown ?? null,
      assigned, delivered, failed, returned, failedOrReturned: failed + returned, outNow,
      notYetDispatched: (r?.assigned ?? 0) - assigned,
      deliverySuccessRate: r?.deliverySuccessRate
        ?? closedOutcomeResult('Delivery success rate', 'partner.deliverySuccess.cohort.v1', 'cohort', { delivered: 0, failed: 0, returned: 0 }, meta),
      confirmedToDispatchedDays: r?.confirmedToDispatchedDays.value ?? null,
      dispatchedToDeliveredDays: r?.dispatchedToDeliveredDays.value ?? null,
      // No profile yet: a person with a login uses the app, a company sends a file (F-700 default)
      dataSource: profile?.dataSource ?? (u.kind === 'company' ? 'csv' : 'app'),
      daysToPay: profile?.daysToPay ?? null,
      ...(opts.showMoney ? { feeRule: rulesBy.get(u.id) ?? null } : {}),
      cashHeld: null,
      oldestUnpaidDays: null,
    });
  }

  const rows = type === 'all' ? all : all.filter((r) => r.type === type);
  const delivered = sum(rows, (r) => r.delivered);
  const failed = sum(rows, (r) => r.failed);
  const returned = sum(rows, (r) => r.returned);
  return {
    from: meta.from,
    to: meta.to,
    type,
    counts: { all: all.length, agent: all.filter((r) => r.type === 'agent').length, '3pl': all.filter((r) => r.type === '3pl').length },
    rows,
    total: {
      assigned: sum(rows, (r) => r.assigned),
      delivered, failed, returned, failedOrReturned: failed + returned,
      outNow: sum(rows, (r) => r.outNow),
      notYetDispatched: sum(rows, (r) => r.notYetDispatched),
      deliverySuccessRate: closedOutcomeResult('Delivery success rate', 'partner.deliverySuccess.cohort.v1', 'cohort', { delivered, failed, returned }, meta),
    },
  };
}

export interface PartnerSummary {
  outNow: { orders: number; partners: number };
  waiting: { orders: number; oldestDays: number | null };
  delivered: { orders: number; /** Delivered revenue, left out for a role that may not see money. */ revenue?: string; currency?: string };
  deliverySuccess: { rate: KpiResult<number | null>; target: number; /** Points under the target; negative above it; null with no closed order. */ gapPoints: number | null };
  /** M5 (F-704). */
  cashWithPartners: { amount: null; overdueOrders: null };
}

/** The five tiles above the partner table (F-701). */
export async function partnerSummary(tenantId: string, from: Date, to: Date, opts: ViewOptions): Promise<PartnerSummary> {
  const [out, waiting, revenue, rate, target] = await Promise.all([
    outForDelivery(tenantId),
    waitingToDispatch(tenantId),
    deliveredRevenue(tenantId, from, to),
    rates(tenantId, from, to),
    runInTenant(tenantId, () => prisma.target.findFirst({
      where: { metric: 'delivery_success_rate', roleId: null, userId: null, periodStart: { lte: from }, periodEnd: { gte: from } },
      select: { value: true },
    })),
  ]);
  const targetPct = target ? Money.parse(target.value).toNumber() : DEFAULT_SUCCESS_TARGET;
  const value = rate.deliverySuccessRate.value;
  return {
    outNow: { orders: out.total, partners: out.byPartner.size },
    waiting: { orders: waiting.count.value, oldestDays: waiting.oldestDays },
    delivered: {
      orders: revenue.deliveredOrders.value,
      ...(opts.showMoney ? { revenue: revenue.total.value, currency: revenue.total.currency } : {}),
    },
    deliverySuccess: {
      rate: rate.deliverySuccessRate,
      target: targetPct,
      gapPoints: value === null ? null : Money.roundHalfUp(Money.sub(targetPct, value), 1).toNumber(),
    },
    cashWithPartners: { amount: null, overdueOrders: null },
  };
}

export interface WaitingOrder {
  orderId: number;
  orderNumber: string | null;
  status: OrderStatus;
  customerName: string;
  region: string | null;
  area: string | null;
  /** Whole days since the order was confirmed (placed, when it was never confirmed). */
  ageDays: number;
  overdue: boolean;
  /** The partner that would take it: the one already assigned, if any. */
  partner: { id: number; name: string } | null;
  total?: string;
}

export interface WaitingList {
  orders: number;
  oldestDays: number | null;
  overdueAfterDays: number;
  list: WaitingOrder[];
}

/** Orders confirmed but not dispatched, oldest first (F-715). */
export async function waitingList(tenantId: string, opts: ViewOptions & { limit?: number }): Promise<WaitingList> {
  const now = Date.now();
  const [waiting, rows] = await Promise.all([
    waitingToDispatch(tenantId),
    runInTenant(tenantId, () => prisma.order.findMany({
      where: { deletedAt: null, status: { in: WAITING } },
      orderBy: [{ confirmedAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }, { id: 'asc' }],
      take: opts.limit ?? 200,
      select: {
        id: true, externalOrderId: true, status: true, confirmedAt: true, createdAt: true, deliveryState: true, deliveryArea: true, totalAmount: true,
        customer: { select: { firstName: true, lastName: true } },
        deliveryAgent: { select: { id: true, firstName: true, lastName: true } },
      },
    })),
  ]);
  return {
    orders: waiting.count.value,
    oldestDays: waiting.oldestDays,
    overdueAfterDays: WAITING_OVERDUE_DAYS,
    list: rows.map((o) => {
      const ageDays = Math.floor((now - (o.confirmedAt ?? o.createdAt).getTime()) / DAY_MS);
      return {
        orderId: o.id,
        orderNumber: o.externalOrderId,
        status: o.status,
        customerName: `${o.customer.firstName} ${o.customer.lastName}`.trim(),
        region: o.deliveryState,
        area: o.deliveryArea,
        ageDays,
        overdue: ageDays > WAITING_OVERDUE_DAYS,
        partner: o.deliveryAgent ? { id: o.deliveryAgent.id, name: `${o.deliveryAgent.firstName} ${o.deliveryAgent.lastName}`.trim() } : null,
        ...(opts.showMoney ? { total: Money.toApi(Money.orZero(o.totalAmount)) } : {}),
      };
    }),
  };
}

export interface FailureReasons {
  from: string;
  to: string;
  /** failed_delivery + returned orders placed in the range. */
  total: number;
  failed: number;
  returned: number;
  /** The fixed list, in list order, zeros included. A failed order with no reason counts as `other`. */
  reasons: Array<{ reason: FailureReason; count: number; percent: number | null }>;
}

const REASON_ORDER: FailureReason[] = ['not_reachable', 'refused', 'wrong_address', 'rescheduled', 'other'];

/** Failed and returned orders by reason, failed and returned counted apart (F-705). Optional filter by partner. */
export async function failureReasonBreakdown(tenantId: string, from: Date, to: Date, partnerId?: number): Promise<FailureReasons> {
  const groups = await runInTenant(tenantId, () => prisma.order.groupBy({
    by: ['failureReason', 'status'],
    where: {
      deletedAt: null,
      status: { in: ['failed_delivery', 'returned'], notIn: DIGITAL },
      createdAt: { gte: from, lt: to },
      ...(partnerId !== undefined ? { deliveryAgentId: partnerId } : {}),
    },
    _count: { _all: true },
  }));
  const byReason = new Map<FailureReason, number>(REASON_ORDER.map((r) => [r, 0]));
  let failed = 0;
  let returned = 0;
  for (const g of groups) {
    const reason = g.failureReason ?? 'other';
    byReason.set(reason, (byReason.get(reason) ?? 0) + g._count._all);
    if (g.status === 'returned') returned += g._count._all; else failed += g._count._all;
  }
  const total = failed + returned;
  return {
    ...kpiRange(from, to),
    total, failed, returned,
    reasons: REASON_ORDER.map((reason) => ({ reason, count: byReason.get(reason)!, percent: ratePercent(byReason.get(reason)!, total) })),
  };
}

function kpiRange(from: Date, to: Date) {
  const { from: f, to: t } = kpiMeta(from, to);
  return { from: f, to: t };
}
