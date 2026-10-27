import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { resolveTenantId } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { fullName } from '../utils/nameUtils';
import { OPEN_COLLECTION_STATUSES, outstandingOf } from '../utils/collectionCash';
import { DAY_MS, getStoreTimeZone, localDate, shiftYmd, startOfDay, utcDateOfYmd } from './kpi/dates';
import { openFindingOnce } from './findingService';
import { resolveDaysToPay } from './orderPaymentTag';
import { getCurrency } from '../utils/currency';
import { AppError } from '../middleware/errorHandler';
import whatsappService from './whatsappService';

/**
 * The four age buckets (F-910): days since delivery. A delivery of today is 0 days, so it falls in the first. `late` marks
 * the buckets of 8 days and older: the screens draw them coral, and the critical amount of the daily job counts them.
 */
export const AGE_BUCKETS = [
  { key: '0-3', label: '0-3 days', from: 0, to: 3, late: false },
  { key: '4-7', label: '4-7 days', from: 4, to: 7, late: false },
  { key: '8-14', label: '8-14 days', from: 8, to: 14, late: true },
  { key: '15+', label: '15+ days', from: 15, to: Infinity, late: true },
] as const;

export const bucketIndexOf = (days: number): number => AGE_BUCKETS.findIndex((b) => days <= b.to);

/** One delivered order whose cash the partner still holds. `amount` is net of the delivery fee the partner keeps. */
export interface UnpaidOrder {
  orderId: number;
  agentId: number;
  amount: Money.Money;
  /** Whole days from delivery to today, store time zone. */
  ageDays: number;
  deliveredOn: string;
  daysToPay: number;
  overdue: boolean;
  bucket: number;
}

interface Tally { orders: number; amount: Money.Money }

/** Buckets, total and overdue of a set of unpaid orders, in one pass. The card, the partner table and the summary all use it. */
export function summarize(rows: UnpaidOrder[]) {
  const buckets: Tally[] = AGE_BUCKETS.map(() => ({ orders: 0, amount: Money.ZERO }));
  const total: Tally = { orders: 0, amount: Money.ZERO };
  const overdue: Tally = { orders: 0, amount: Money.ZERO };
  let oldest: UnpaidOrder | null = null;
  for (const o of rows) {
    const b = buckets[o.bucket];
    b.orders += 1; b.amount = b.amount.plus(o.amount);
    total.orders += 1; total.amount = total.amount.plus(o.amount);
    if (o.overdue) { overdue.orders += 1; overdue.amount = overdue.amount.plus(o.amount); }
    if (!oldest || o.ageDays > oldest.ageDays) oldest = o;
  }
  return { buckets, total, overdue, oldest };
}

const bucketView = (buckets: Tally[]) => AGE_BUCKETS.map((b, i) => ({ key: b.key, label: b.label, late: b.late, orders: buckets[i].orders, amount: Money.toApi(buckets[i].amount) }));

/** Whole days between the store-local calendar day of `at` and today. */
const ageInDays = (at: Date, zone: string, todayMs: number): number =>
  Math.max(Math.round((todayMs - utcDateOfYmd(localDate(at, zone)).getTime()) / DAY_MS), 0);

export class AgingService {
  /** Days to pay per partner profile of the tenant (`own`, keyed by partner); a partner with no profile or no value gets the default. */
  private async loadDaysToPay() {
    const profiles = await prisma.deliveryPartnerProfile.findMany({ select: { userId: true, daysToPay: true } });
    const own = new Map(profiles.map((p) => [p.userId, resolveDaysToPay(p)]));
    return { own, daysToPayOf: (agentId: number): number => own.get(agentId) ?? resolveDaysToPay() };
  }

  /**
   * The one read behind the aging card, the partner table and the CSV (F-309, F-910): delivered orders whose collection is
   * still open (no verified deposit or settlement covers it), each with its age and whether it is past the partner's days to
   * pay. A part-covered collection counts for what is left. Amounts are the collection amount, already net of the fee.
   * The partner balances come with it. `agentIds` limits the read to those partners. Runs in the current tenant context.
   */
  private async loadAging(agentIds?: number[]) {
    const tenantId = resolveTenantId();
    const zone = getStoreTimeZone(tenantId);
    const todayMs = utcDateOfYmd(localDate(new Date(), zone)).getTime();

    const [collections, { daysToPayOf }, balances] = await Promise.all([
      prisma.agentCollection.findMany({
        where: {
          status: { in: [...OPEN_COLLECTION_STATUSES] }, order: { status: 'delivered', deletedAt: null, deliveryDate: { not: null } },
          ...(agentIds ? { agentId: { in: agentIds } } : {}),
        },
        select: { agentId: true, amount: true, allocatedAmount: true, orderId: true, order: { select: { deliveryDate: true } } },
      }),
      this.loadDaysToPay(),
      prisma.agentBalance.findMany({ where: agentIds ? { agentId: { in: agentIds } } : undefined, select: { agentId: true, currentBalance: true, isBlocked: true } }),
    ]);

    const unpaid: UnpaidOrder[] = [];
    for (const c of collections) {
      const amount = outstandingOf(c);
      if (amount.lte(0)) continue;
      const ageDays = ageInDays(c.order.deliveryDate!, zone, todayMs);
      const daysToPay = daysToPayOf(c.agentId);
      unpaid.push({
        orderId: c.orderId, agentId: c.agentId, amount, ageDays, deliveredOn: localDate(c.order.deliveryDate!, zone),
        daysToPay, overdue: ageDays > daysToPay, bucket: bucketIndexOf(ageDays),
      });
    }
    return { unpaid, balances, daysToPayOf };
  }

  /**
   * The rule "past the partner's days to pay" as a database filter on the open collections of delivered orders: one
   * clause per partner profile with its cutoff day, and one for the partners with none. Same rule as `loadAging`, so the
   * Orders tab, the Dashboard count and the aging card agree. `daysToPayOf` and `ageOf` serve the row flag.
   */
  async overdueFilter() {
    const tenantId = resolveTenantId();
    const zone = getStoreTimeZone(tenantId);
    const todayYmd = localDate(new Date(), zone);
    const todayMs = utcDateOfYmd(todayYmd).getTime();
    // Delivered before the start of (today - days to pay) means more than that many days old
    const cutoff = (days: number) => startOfDay(shiftYmd(todayYmd, -days), zone);

    const { own, daysToPayOf } = await this.loadDaysToPay();
    const late = (agentId: Prisma.AgentCollectionWhereInput['agentId'], days: number): Prisma.AgentCollectionWhereInput =>
      ({ agentId, order: { deliveryDate: { lt: cutoff(days) } } });

    const where: Prisma.AgentCollectionWhereInput = {
      status: { in: [...OPEN_COLLECTION_STATUSES] },
      // amount above what a deposit already covered
      amount: { gt: prisma.agentCollection.fields.allocatedAmount },
      order: { status: 'delivered', deletedAt: null },
      OR: [
        ...[...own].map(([agentId, days]) => late(agentId, days)),
        late({ notIn: [...own.keys()] }, resolveDaysToPay()),
      ],
    };
    return {
      where,
      daysToPayOf,
      ageOf: (deliveredAt: Date) => ageInDays(deliveredAt, zone, todayMs),
    };
  }

  /** The unpaid delivered orders of these partners only, oldest first (the rows behind a short payout on the Finance overview). */
  async getUnpaidOrdersOf(agentIds: number[]): Promise<UnpaidOrder[]> {
    const { unpaid } = await this.loadAging(agentIds);
    return unpaid.sort((a, b) => b.ageDays - a.ageDays || a.orderId - b.orderId);
  }

  /** How many open collections are past their partner's days to pay (the Dashboard "orders over" count). */
  async countOverdue(): Promise<number> {
    return prisma.agentCollection.count({ where: (await this.overdueFilter()).where });
  }

  /** A Finding per partner whose cash held is below zero (F-704); it closes when the balance is back at zero or above. */
  async syncNegativeCashFindings(): Promise<void> {
    const tenantId = resolveTenantId();
    const negative = await prisma.agentBalance.findMany({
      where: { currentBalance: { lt: 0 } },
      select: { agentId: true, currentBalance: true, agent: { select: { firstName: true, lastName: true } } },
    });
    for (const b of negative) {
      const owed = Money.parse(b.currentBalance).abs();
      await openFindingOnce({
        tenantId,
        type: 'negative_cash_held',
        subjectType: 'delivery_partner',
        subjectId: String(b.agentId),
        amount: owed,
        note: `${fullName(b.agent) || `Partner #${b.agentId}`} has deposited ${Money.toApi(owed)} more than it collected.`,
      }, { updateAmount: true });
    }
    const still = new Set(negative.map((b) => String(b.agentId)));
    const open = await prisma.finding.findMany({ where: { type: 'negative_cash_held', subjectType: 'delivery_partner', status: 'open' }, select: { id: true, subjectId: true } });
    const cleared = open.filter((f) => !still.has(f.subjectId)).map((f) => f.id);
    if (cleared.length > 0) {
      await prisma.finding.updateMany({
        where: { id: { in: cleared }, status: 'open' },
        data: { status: 'closed', explanation: 'Cash held is no longer below zero', resolvedAt: new Date() },
      });
    }
    logger.info(`Cash held Findings synced: ${negative.length} partner(s) below zero.`);
  }

  /** The card "Unpaid delivered orders" (F-910): four buckets and a total, net of the delivery fee. */
  async getUnpaidByAge() {
    const { unpaid } = await this.loadAging();
    const { buckets, total, overdue } = summarize(unpaid);
    return {
      basis: 'net_of_delivery_fee' as const,
      total: { orders: total.orders, amount: Money.toApi(total.amount) },
      overdue: { orders: overdue.orders, amount: Money.toApi(overdue.amount) },
      buckets: bucketView(buckets),
    };
  }

  /** Cash, buckets, oldest unpaid and days to pay per partner (F-704, F-911), with the summary tiles. */
  async getAgingReport() {
    const { unpaid, balances, daysToPayOf } = await this.loadAging();

    const byPartner = new Map<number, UnpaidOrder[]>();
    for (const o of unpaid) {
      const list = byPartner.get(o.agentId);
      if (list) list.push(o); else byPartner.set(o.agentId, [o]);
    }
    const balanceOf = new Map(balances.map((b) => [b.agentId, b]));
    // Partners with unpaid orders, and those whose cash held is not zero
    const ids = [...new Set([...byPartner.keys(), ...balances.filter((b) => !Money.orZero(b.currentBalance).isZero()).map((b) => b.agentId)])];

    const [users, findings] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, email: true } }),
      prisma.finding.findMany({ where: { type: 'negative_cash_held', subjectType: 'delivery_partner', status: 'open' }, select: { id: true, subjectId: true } }),
    ]);
    const userOf = new Map(users.map((u) => [u.id, u]));
    const findingOf = new Map(findings.map((f) => [f.subjectId, f.id]));

    const partners = ids.map((agentId) => {
      const s = summarize(byPartner.get(agentId) ?? []);
      const cashHeld = Money.orZero(balanceOf.get(agentId)?.currentBalance);
      const user = userOf.get(agentId);
      return {
        agentId,
        name: fullName(user) || `Partner #${agentId}`,
        email: user?.email ?? null,
        cashHeld: Money.toApi(cashHeld),
        negativeCashHeld: cashHeld.lt(0),
        findingId: findingOf.get(String(agentId)) ?? null,
        daysToPay: daysToPayOf(agentId),
        unpaidOrders: s.total.orders,
        unpaidAmount: Money.toApi(s.total.amount),
        buckets: bucketView(s.buckets),
        overdueOrders: s.overdue.orders,
        overdueAmount: Money.toApi(s.overdue.amount),
        oldestUnpaidDays: s.oldest?.ageDays ?? null,
        oldestDeliveredOn: s.oldest?.deliveredOn ?? null,
        isBlocked: balanceOf.get(agentId)?.isBlocked ?? false,
        _overdue: s.overdue.amount,
        _unpaid: s.total.amount,
        _cash: cashHeld,
      };
    }).sort((a, b) => b._overdue.comparedTo(a._overdue) || b._unpaid.comparedTo(a._unpaid) || a.agentId - b.agentId);

    const all = summarize(unpaid);
    return {
      summary: {
        basis: 'net_of_delivery_fee' as const,
        totalOutstandingAmount: Money.toApi(all.total.amount),
        totalOrders: all.total.orders,
        overdueAmount: Money.toApi(all.overdue.amount),
        overdueOrders: all.overdue.orders,
        overduePartners: partners.filter((p) => p.overdueOrders > 0).length,
        partnersWithCash: partners.filter((p) => p._cash.gt(0)).length,
        negativeCashPartners: partners.filter((p) => p.negativeCashHeld).length,
        blockedPartners: partners.filter((p) => p.isBlocked).length,
        bucketTotals: bucketView(all.buckets),
      },
      partners: partners.map(({ _overdue, _unpaid, _cash, ...row }) => row),
    };
  }

  /**
   * "Send reminder" on the collections screen (F-911): a WhatsApp text to the partner with what it still holds and how much is
   * past its days to pay. `sent` is false when the WhatsApp connection is off: the text is still saved in the message log.
   */
  async remindPartner(agentId: number): Promise<{ sent: boolean; unpaidOrders: number; overdueOrders: number }> {
    const [partner, { unpaid, daysToPayOf }, currency] = await Promise.all([
      prisma.user.findFirst({ where: { id: agentId, role: 'delivery_agent' }, select: { id: true, firstName: true, phoneNumber: true } }),
      this.loadAging([agentId]),
      getCurrency(),
    ]);
    if (!partner) throw new AppError('Delivery partner not found', 404);
    const mine = summarize(unpaid);
    if (mine.total.orders === 0) throw new AppError('This partner has no unpaid orders to remind about', 409, 'NOTHING_UNPAID');
    if (!partner.phoneNumber) throw new AppError(`${partner.firstName} has no phone number saved`, 400, 'NO_PHONE');

    const daysToPay = daysToPayOf(agentId);
    const orders = `${mine.total.orders} delivered ${mine.total.orders === 1 ? 'order' : 'orders'}`;
    const late = mine.overdue.orders > 0 ? ` ${mine.overdue.orders} of them ${mine.overdue.orders === 1 ? 'is' : 'are'} past your ${daysToPay}-day payment term.` : '';
    const body = `Hello ${partner.firstName}, you still hold ${Money.format(mine.total.amount, currency)} from ${orders}.${late} Please send the payment and reply with the reference. Thank you.`;
    const result = await whatsappService.sendText({ to: partner.phoneNumber, body });
    return { sent: Boolean(result.providerMessageId), unpaidOrders: mine.total.orders, overdueOrders: mine.overdue.orders };
  }

  /** Partners with orders past their days to pay (the daily notification job). */
  async getOverdueAgents(): Promise<{ agentId: number; agentName: string; totalBalance: Money.Money; warningAmount: Money.Money; criticalAmount: Money.Money }[]> {
    const { unpaid } = await this.loadAging();
    const byPartner = new Map<number, { total: Money.Money; critical: Money.Money }>();
    for (const o of unpaid) {
      if (!o.overdue) continue;
      const t = byPartner.get(o.agentId) ?? { total: Money.ZERO, critical: Money.ZERO };
      t.total = t.total.plus(o.amount);
      if (AGE_BUCKETS[o.bucket].late) t.critical = t.critical.plus(o.amount);
      byPartner.set(o.agentId, t);
    }
    if (byPartner.size === 0) return [];

    const users = await prisma.user.findMany({ where: { id: { in: [...byPartner.keys()] } }, select: { id: true, firstName: true, lastName: true } });
    const nameOf = new Map(users.map((u) => [u.id, fullName(u)]));
    const out: { agentId: number; agentName: string; totalBalance: Money.Money; warningAmount: Money.Money; criticalAmount: Money.Money }[] = [];
    for (const [agentId, t] of byPartner) {
      out.push({ agentId, agentName: nameOf.get(agentId) || `Partner #${agentId}`, totalBalance: t.total, warningAmount: t.total.minus(t.critical), criticalAmount: t.critical });
    }
    return out;
  }
}

export default new AgingService();
