import prisma from '../utils/prisma';
import logger from '../utils/logger';
import appEvents, { AppEvent } from '../utils/appEvents';
import { resolveTenantId } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { fullName } from '../utils/nameUtils';
import { OPEN_COLLECTION_STATUSES, outstandingOf } from '../utils/collectionCash';
import { DAY_MS, getStoreTimeZone, localDate, utcDateOfYmd } from './kpi/dates';
import { openFindingOnce } from './findingService';

/** The four age buckets (F-910): days since delivery. A delivery of today is 0 days, so it falls in the first. */
export const AGE_BUCKETS = [
  { key: '0-3', label: '0-3 days', from: 0, to: 3 },
  { key: '4-7', label: '4-7 days', from: 4, to: 7 },
  { key: '8-14', label: '8-14 days', from: 8, to: 14 },
  { key: '15+', label: '15+ days', from: 15, to: Infinity },
] as const;
export type AgeBucketKey = typeof AGE_BUCKETS[number]['key'];

export const bucketIndexOf = (days: number): number => AGE_BUCKETS.findIndex((b) => days <= b.to);

/** Used when the partner has no days to pay and Settings has no default (F-309, owner to confirm). */
export const FALLBACK_DAYS_TO_PAY = 8;

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

export interface PartnerAging {
  agentId: number;
  name: string;
  email: string | null;
  /** AgentBalance.currentBalance: can be negative (a deposit above what was collected). */
  cashHeld: Money.Money;
  daysToPay: number;
  unpaidOrders: number;
  unpaidAmount: Money.Money;
  /** Net amount and order count per bucket, in AGE_BUCKETS order. */
  buckets: Array<{ orders: number; amount: Money.Money }>;
  overdueOrders: number;
  overdueAmount: Money.Money;
  oldestUnpaidDays: number | null;
  oldestDeliveredOn: string | null;
  isBlocked: boolean;
}

const emptyBuckets = () => AGE_BUCKETS.map(() => ({ orders: 0, amount: Money.ZERO }));

export class AgingService {
  constructor() {
    this.setupEventListeners();
  }

  private handlers: { [key: string]: (...args: any[]) => void } = {};

  private setupEventListeners() {
    this.handlers[AppEvent.AGENT_COLLECTION_RECONCILED] = () => {
      this.refreshAll().catch(err =>
        logger.error('Proactive aging refresh failed after reconciliation:', err)
      );
    };

    this.handlers[AppEvent.BULK_ORDERS_IMPORTED] = () => {
      this.refreshAll().catch(err =>
        logger.error('Proactive aging refresh failed after bulk import:', err)
      );
    };

    this.handlers[AppEvent.ORDERS_DELETED] = () => {
      this.refreshAll().catch(err =>
        logger.error('Proactive aging refresh failed after order deletion:', err)
      );
    };

    // Register listeners
    Object.entries(this.handlers).forEach(([event, handler]) => {
      appEvents.on(event as any, handler);
    });
  }

  /**
   * Cleanup event listeners to prevent memory leaks.
   * Call this when the service is no longer needed (e.g., in tests or server shutdown).
   */
  public destroy() {
    Object.entries(this.handlers).forEach(([event, handler]) => {
      appEvents.off(event as any, handler);
    });
    this.handlers = {};
    logger.info('AgingService destroyed and listeners removed');
  }

  /** The tenant's default days to pay (Settings), else 8. The Settings screen stores it in `features.defaultDaysToPay`. */
  private async defaultDaysToPay(tenantId: string): Promise<number> {
    const config = await prisma.systemConfig.findUnique({ where: { tenantId }, select: { features: true } });
    const stored = Number((config?.features as Record<string, unknown> | null)?.defaultDaysToPay);
    return Number.isInteger(stored) && stored > 0 ? stored : FALLBACK_DAYS_TO_PAY;
  }

  /**
   * The one query behind the aging card, the partner table and the Orders "Unpaid by agent" tab (F-309, F-910).
   * A delivered order counts while its collection is still open (no verified deposit or settlement covers it); a
   * part-covered collection counts for what is left. Amounts are the collection amount, already net of the fee
   * stamped on the order. Runs in the current tenant context.
   */
  async loadUnpaidOrders(): Promise<UnpaidOrder[]> {
    const tenantId = resolveTenantId();
    const zone = getStoreTimeZone(tenantId);
    const today = utcDateOfYmd(localDate(new Date(), zone)).getTime();

    const [collections, fallback] = await Promise.all([
      prisma.agentCollection.findMany({
        where: { status: { in: [...OPEN_COLLECTION_STATUSES] }, order: { status: 'delivered', deletedAt: null } },
        select: { agentId: true, amount: true, allocatedAmount: true, collectionDate: true, orderId: true, order: { select: { deliveryDate: true } } },
      }),
      this.defaultDaysToPay(tenantId),
    ]);
    const profiles = await prisma.deliveryPartnerProfile.findMany({
      where: { userId: { in: [...new Set(collections.map((c) => c.agentId))] } },
      select: { userId: true, daysToPay: true },
    });
    const dueIn = new Map(profiles.map((p) => [p.userId, p.daysToPay > 0 ? p.daysToPay : fallback]));

    const unpaid: UnpaidOrder[] = [];
    for (const c of collections) {
      const amount = outstandingOf(c);
      if (amount.lte(0)) continue;
      const deliveredOn = localDate(c.order.deliveryDate ?? c.collectionDate, zone);
      const ageDays = Math.max(Math.round((utcDateOfYmd(deliveredOn).getTime() - today) / -DAY_MS), 0);
      const daysToPay = dueIn.get(c.agentId) ?? fallback;
      unpaid.push({ orderId: c.orderId, agentId: c.agentId, amount, ageDays, deliveredOn, daysToPay, overdue: ageDays > daysToPay, bucket: bucketIndexOf(ageDays) });
    }
    return unpaid;
  }

  /** The orders past their partner's days to pay: the Orders "Unpaid by agent" tab. Oldest first. */
  async overdueOrders(): Promise<UnpaidOrder[]> {
    return (await this.loadUnpaidOrders()).filter((o) => o.overdue).sort((a, b) => b.ageDays - a.ageDays || a.orderId - b.orderId);
  }

  /** Cash, buckets, oldest unpaid and days to pay per partner (F-704, F-911), from the shared unpaid-orders query. */
  private async partnerAging(): Promise<PartnerAging[]> {
    const unpaid = await this.loadUnpaidOrders();
    const balances = await prisma.agentBalance.findMany({ select: { agentId: true, currentBalance: true, isBlocked: true } });
    const ids = [...new Set([...unpaid.map((o) => o.agentId), ...balances.filter((b) => !Money.orZero(b.currentBalance).isZero()).map((b) => b.agentId)])];
    if (ids.length === 0) return [];

    const [users, profiles, fallback] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, email: true } }),
      prisma.deliveryPartnerProfile.findMany({ where: { userId: { in: ids } }, select: { userId: true, daysToPay: true } }),
      this.defaultDaysToPay(resolveTenantId()),
    ]);
    const userOf = new Map(users.map((u) => [u.id, u]));
    const balanceOf = new Map(balances.map((b) => [b.agentId, b]));
    const dueIn = new Map(profiles.map((p) => [p.userId, p.daysToPay > 0 ? p.daysToPay : fallback]));

    return ids.map((agentId): PartnerAging => {
      const mine = unpaid.filter((o) => o.agentId === agentId);
      const buckets = emptyBuckets();
      for (const o of mine) {
        buckets[o.bucket].orders += 1;
        buckets[o.bucket].amount = buckets[o.bucket].amount.plus(o.amount);
      }
      const overdue = mine.filter((o) => o.overdue);
      const oldest = mine.reduce<UnpaidOrder | null>((a, o) => (!a || o.ageDays > a.ageDays ? o : a), null);
      const user = userOf.get(agentId);
      return {
        agentId,
        name: fullName(user) || `Partner #${agentId}`,
        email: user?.email ?? null,
        cashHeld: Money.orZero(balanceOf.get(agentId)?.currentBalance),
        daysToPay: dueIn.get(agentId) ?? fallback,
        unpaidOrders: mine.length,
        unpaidAmount: Money.sum(mine.map((o) => o.amount)),
        buckets,
        overdueOrders: overdue.length,
        overdueAmount: Money.sum(overdue.map((o) => o.amount)),
        oldestUnpaidDays: oldest?.ageDays ?? null,
        oldestDeliveredOn: oldest?.deliveredOn ?? null,
        isBlocked: balanceOf.get(agentId)?.isBlocked ?? false,
      };
    });
  }

  /**
   * Rebuilds the stored buckets of the current tenant and keeps the "negative cash held" Findings (F-704, F-911).
   * Runs inside a tenant context (the aging queue calls it once per tenant) and touches only that tenant: every
   * read and write below is tenant-scoped, and with no context it throws instead of reaching every tenant.
   */
  async refreshAll(): Promise<void> {
    const tenantId = resolveTenantId();
    logger.info('Starting agent aging refresh...');
    try {
      const partners = await this.partnerAging();
      const withOrders = partners.filter((p) => p.unpaidOrders > 0);

      await prisma.$transaction(async (tx) => {
        await tx.agentAgingBucket.deleteMany({ where: { tenantId, agentId: { notIn: withOrders.map((p) => p.agentId) } } });
        for (const p of withOrders) {
          const data = {
            bucket_0_3: p.buckets[0].amount, bucket_4_7: p.buckets[1].amount, bucket_8_14: p.buckets[2].amount, bucket_15_plus: p.buckets[3].amount,
            totalBalance: p.unpaidAmount,
            oldestCollectionDate: p.oldestDeliveredOn ? utcDateOfYmd(p.oldestDeliveredOn) : null,
          };
          await tx.agentAgingBucket.upsert({ where: { agentId: p.agentId }, update: data, create: { tenantId, agentId: p.agentId, ...data } });
        }
      });

      await this.syncNegativeCashFindings(tenantId, partners);
      logger.info('Agent aging refresh completed successfully.');
    } catch (error) {
      logger.error('Error refreshing agent aging:', error);
      throw error;
    }
  }

  /** A Finding per partner whose cash held is below zero; it closes when the balance is back at zero or above. */
  private async syncNegativeCashFindings(tenantId: string, partners: PartnerAging[]): Promise<void> {
    for (const p of partners.filter((x) => x.cashHeld.lt(0))) {
      await openFindingOnce({
        tenantId,
        type: 'negative_cash_held',
        subjectType: 'delivery_partner',
        subjectId: String(p.agentId),
        amount: p.cashHeld.abs(),
        note: `${p.name} has deposited ${Money.toApi(p.cashHeld.abs())} more than it collected.`,
      }, { updateAmount: true });
    }
    const negative = new Set(partners.filter((x) => x.cashHeld.lt(0)).map((x) => String(x.agentId)));
    const open = await prisma.finding.findMany({ where: { type: 'negative_cash_held', subjectType: 'delivery_partner', status: 'open' }, select: { id: true, subjectId: true } });
    const cleared = open.filter((f) => !negative.has(f.subjectId)).map((f) => f.id);
    if (cleared.length > 0) {
      await prisma.finding.updateMany({
        where: { id: { in: cleared }, status: 'open' },
        data: { status: 'closed', explanation: 'Cash held is no longer below zero', resolvedAt: new Date() },
      });
    }
  }

  /** The card "Unpaid delivered orders" (F-910): four buckets and a total, net of the delivery fee. */
  async getUnpaidByAge() {
    const unpaid = await this.loadUnpaidOrders();
    const buckets = AGE_BUCKETS.map((b, i) => {
      const rows = unpaid.filter((o) => o.bucket === i);
      return { key: b.key, label: b.label, orders: rows.length, amount: Money.toApi(Money.sum(rows.map((o) => o.amount))) };
    });
    const overdue = unpaid.filter((o) => o.overdue);
    return {
      basis: 'net_of_delivery_fee' as const,
      total: { orders: unpaid.length, amount: Money.toApi(Money.sum(unpaid.map((o) => o.amount))) },
      overdue: { orders: overdue.length, amount: Money.toApi(Money.sum(overdue.map((o) => o.amount))) },
      buckets,
    };
  }

  /** The partner table with its summary tiles (F-911). Live from the shared query, so it always matches the card and the tab. */
  async getAgingReport() {
    const partners = await this.partnerAging();
    const findings = partners.some((p) => p.cashHeld.lt(0))
      ? await prisma.finding.findMany({ where: { type: 'negative_cash_held', subjectType: 'delivery_partner', status: 'open' }, select: { id: true, subjectId: true } })
      : [];
    const findingOf = new Map(findings.map((f) => [f.subjectId, f.id]));

    const rows = partners
      .sort((a, b) => b.overdueAmount.comparedTo(a.overdueAmount) || b.unpaidAmount.comparedTo(a.unpaidAmount) || a.agentId - b.agentId)
      .map((p) => ({
        agentId: p.agentId,
        name: p.name,
        email: p.email,
        cashHeld: Money.toApi(p.cashHeld),
        negativeCashHeld: p.cashHeld.lt(0),
        findingId: findingOf.get(String(p.agentId)) ?? null,
        daysToPay: p.daysToPay,
        unpaidOrders: p.unpaidOrders,
        unpaidAmount: Money.toApi(p.unpaidAmount),
        buckets: AGE_BUCKETS.map((b, i) => ({ key: b.key, label: b.label, orders: p.buckets[i].orders, amount: Money.toApi(p.buckets[i].amount) })),
        overdueOrders: p.overdueOrders,
        overdueAmount: Money.toApi(p.overdueAmount),
        oldestUnpaidDays: p.oldestUnpaidDays,
        oldestDeliveredOn: p.oldestDeliveredOn,
        isBlocked: p.isBlocked,
      }));

    return {
      summary: {
        basis: 'net_of_delivery_fee' as const,
        totalOutstandingAmount: Money.toApi(Money.sum(partners.map((p) => p.unpaidAmount))),
        totalOrders: partners.reduce((n, p) => n + p.unpaidOrders, 0),
        overdueAmount: Money.toApi(Money.sum(partners.map((p) => p.overdueAmount))),
        overdueOrders: partners.reduce((n, p) => n + p.overdueOrders, 0),
        overduePartners: partners.filter((p) => p.overdueOrders > 0).length,
        partnersWithCash: partners.filter((p) => p.cashHeld.gt(0)).length,
        negativeCashPartners: partners.filter((p) => p.cashHeld.lt(0)).length,
        blockedPartners: partners.filter((p) => p.isBlocked).length,
      },
      partners: rows,
    };
  }

  /** CSV of the partner table. The columns follow the page (F-911). */
  async generateAgingCSV(): Promise<string> {
    const { partners } = await this.getAgingReport();
    const header = ['Partner', 'Cash held', '0-3 days', '4-7 days', '8-14 days', '15+ days', 'Oldest unpaid (days)', 'Days to pay'];
    const lines = partners.map((p) => [
      `"${p.name.replace(/"/g, '""')}"`, p.cashHeld, ...p.buckets.map((b) => b.amount), p.oldestUnpaidDays ?? '', p.daysToPay,
    ].join(','));
    return [header.join(','), ...lines].join('\n') + '\n';
  }

  /** Partners with orders past their days to pay (the daily notification job). */
  async getOverdueAgents(): Promise<{ agentId: number; agentName: string; totalBalance: Money.Money; warningAmount: Money.Money; criticalAmount: Money.Money }[]> {
    const overdue = await this.overdueOrders();
    const byPartner = new Map<number, UnpaidOrder[]>();
    for (const o of overdue) byPartner.set(o.agentId, [...(byPartner.get(o.agentId) ?? []), o]);
    if (byPartner.size === 0) return [];

    const users = await prisma.user.findMany({ where: { id: { in: [...byPartner.keys()] } }, select: { id: true, firstName: true, lastName: true } });
    const nameOf = new Map(users.map((u) => [u.id, fullName(u)]));
    return [...byPartner].map(([agentId, rows]) => {
      const total = Money.sum(rows.map((o) => o.amount));
      const critical = Money.sum(rows.filter((o) => o.ageDays >= 8).map((o) => o.amount));
      return { agentId, agentName: nameOf.get(agentId) || `Partner #${agentId}`, totalBalance: total, warningAmount: total.minus(critical), criticalAmount: critical };
    });
  }
}

export default new AgingService();
