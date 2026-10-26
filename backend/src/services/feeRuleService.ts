/**
 * Delivery fee rules and fee stamping (M5-T05; F-703, F-936).
 *
 * A partner has one rule per outcome (delivered, failed, returned): a flat amount or a percent of the order total.
 * Rules are versioned by `validFrom`: the latest rule on or before the outcome date applies, and a new rule never
 * changes a fee already stamped on an order. No rule means fee 0. The return fee stays 0 until the owner enters one.
 * `stampDeliveryFee` runs inside the order state machine, so every path (screen, agent app, MCP, import) stamps the fee.
 */
import { FeeBasis, FeeOutcome, OrderStatus, Prisma } from '@prisma/client';
import prisma, { TransactionClient } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { Requester } from '../utils/authUtils';
import { resolveTenantId } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { getStoreTimeZone, localDate, parseYmd, utcDateOfYmd, ymdOfUtc } from './kpi/dates';
import { auditService } from './auditService';
import { openFindingOnce } from './findingService';
import { loadPartner } from './deliveryPartnerAdminService';

const FEE_OUTCOMES: readonly FeeOutcome[] = ['delivered', 'failed', 'returned'];

/** The outcome an order status stands for, or null when the status carries no delivery fee. */
function feeOutcomeOf(status: OrderStatus): FeeOutcome | null {
  if (status === 'delivered') return 'delivered';
  if (status === 'failed_delivery') return 'failed';
  if (status === 'returned') return 'returned';
  return null;
}

interface FeeRuleInput {
  outcome?: unknown;
  basis?: unknown;
  amount?: unknown;
  /** YYYY-MM-DD. Defaults to today in the store time zone. */
  validFrom?: unknown;
}

/** Today in the store zone, as the DATE value a rule's `validFrom` is compared with. */
export const storeToday = (tenantId?: string | null): Date => utcDateOfYmd(localDate(new Date(), getStoreTimeZone(tenantId)));

/** The rule in force on `day` for each outcome: the latest `validFrom` on or before it. An outcome with no rule in force is absent. */
export function currentFeeRules<T extends { outcome: FeeOutcome; validFrom: Date }>(rules: T[], day: Date): Partial<Record<FeeOutcome, T>> {
  const current: Partial<Record<FeeOutcome, T>> = {};
  for (const rule of rules) {
    const held = current[rule.outcome];
    if (rule.validFrom <= day && (!held || rule.validFrom > held.validFrom)) current[rule.outcome] = rule;
  }
  return current;
}

/** What a partner keeps from the cash it collects on an order: the gross minus the fee stamped on the order (F-936). */
export const partnerNetCash = (order: { deliveryFee?: Money.MoneyInput | null }, gross: Money.MoneyInput): Money.Money =>
  Money.sub(gross, Money.orZero(order.deliveryFee));

/** One rule as the API returns it. */
const ruleView = (r: { id: number; outcome: FeeOutcome; basis: FeeBasis; amount: Prisma.Decimal; validFrom: Date; createdById: number | null; createdAt: Date }) => ({
  id: r.id,
  outcome: r.outcome,
  basis: r.basis,
  amount: Money.toApi(r.amount),
  validFrom: ymdOfUtc(r.validFrom),
  createdById: r.createdById,
  createdAt: r.createdAt,
});

/** All rules of a partner (history, newest first), the rule in force today for each outcome, and the weighted fee over its delivered orders. */
export async function listFeeRules(partnerId: number) {
  await loadPartner(partnerId);
  const rules = await prisma.feeRule.findMany({
    where: { partnerUserId: partnerId },
    orderBy: [{ outcome: 'asc' }, { validFrom: 'desc' }],
  });
  const inForce = currentFeeRules(rules, storeToday(resolveTenantId()));
  const current = Object.fromEntries(FEE_OUTCOMES.map((o) => [o, inForce[o] ? ruleView(inForce[o]!) : null])) as
    Record<FeeOutcome, ReturnType<typeof ruleView> | null>;
  // The fee actually stamped on this partner's delivered orders, averaged (decision R5): what the fee costs in practice
  const delivered = await prisma.order.aggregate({
    where: { deliveryAgentId: partnerId, status: 'delivered', deletedAt: null, deliveryFee: { not: null } },
    _avg: { deliveryFee: true },
    _count: { _all: true },
  });
  const weightedFee = delivered._count._all > 0 && delivered._avg.deliveryFee ? Money.toApi(delivered._avg.deliveryFee) : null;
  return { rules: rules.map(ruleView), current, weightedFee, deliveredOrders: delivered._count._all };
}

/** Validates and stores one rule. Percent above 100 and a second rule with the same valid-from are rejected. */
export async function createFeeRule(requester: Requester, partnerId: number, input: FeeRuleInput) {
  await loadPartner(partnerId);
  const tenantId = resolveTenantId();

  if (!FEE_OUTCOMES.includes(input.outcome as FeeOutcome)) throw new AppError('Outcome must be delivered, failed or returned', 400, 'INVALID_OUTCOME');
  const outcome = input.outcome as FeeOutcome;
  const basis = (input.basis ?? 'flat') as FeeBasis;
  if (basis !== 'flat' && basis !== 'percent') throw new AppError('Basis must be flat or percent', 400, 'INVALID_BASIS');
  const amount = Money.tryParse(input.amount);
  if (!amount || amount.lt(0)) throw new AppError('Amount must be a number of 0 or more', 400, 'INVALID_AMOUNT');
  if (basis === 'percent' && amount.gt(100)) throw new AppError('A percent fee cannot be above 100', 400, 'PERCENT_TOO_HIGH');

  const ymd = input.validFrom === undefined || input.validFrom === null || input.validFrom === ''
    ? localDate(new Date(), getStoreTimeZone(tenantId))
    : String(input.validFrom);
  try {
    parseYmd(ymd);
  } catch {
    throw new AppError('Valid from must be a date written YYYY-MM-DD', 400, 'INVALID_DATE');
  }

  try {
    const rule = await prisma.$transaction(async (tx) => {
      const created = await tx.feeRule.create({
        data: { tenantId, partnerUserId: partnerId, outcome, basis, amount, validFrom: utcDateOfYmd(ymd), createdById: requester.id },
      });
      await auditService.record({
        actorId: requester.id, actorKind: 'person', channel: 'app',
        action: 'create', resource: 'fee_rule', resourceId: String(created.id),
        metadata: { partnerId, outcome, basis, amount: Money.toApi(amount), validFrom: ymd },
        tx,
      });
      return created;
    });
    return ruleView(rule);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(`This partner already has a ${outcome} fee rule from ${ymd}`, 409, 'FEE_RULE_EXISTS');
    }
    throw error;
  }
}

interface ResolvedFee {
  fee: Money.Money;
  /** False when the partner has no rule at all in force on the date (the fee is 0 and a Finding is raised). */
  hasRule: boolean;
}

/** The fee for one outcome on one date: the latest rule on or before the date; a percent rule applies to the order total. */
async function resolveFee(
  db: Pick<TransactionClient, 'feeRule'>,
  partnerId: number,
  outcome: FeeOutcome,
  on: Date,
  orderTotal: Money.MoneyInput,
  tenantId?: string | null,
): Promise<ResolvedFee> {
  const scope = { partnerUserId: partnerId, validFrom: { lte: utcDateOfYmd(localDate(on, getStoreTimeZone(tenantId))) }, ...(tenantId ? { tenantId } : {}) };
  const rule = await db.feeRule.findFirst({ where: { ...scope, outcome }, orderBy: { validFrom: 'desc' }, select: { basis: true, amount: true } });
  if (rule) {
    const fee = rule.basis === 'percent' ? Money.roundHalfUp(Money.mul(orderTotal, Money.div(rule.amount, 100)), 2) : Money.parse(rule.amount);
    return { fee, hasRule: true };
  }
  // No rule for this outcome: it is only "missing" when the partner has no rule in force at all
  return { fee: Money.ZERO, hasRule: !!(await db.feeRule.findFirst({ where: scope, select: { id: true } })) };
}

export interface DeliveryFeeStamp { outcome: FeeOutcome; fee: Money.Money; on: Date }

type StampOrder = { id: number; tenantId?: string | null; deliveryAgentId?: number | null; totalAmount: Prisma.Decimal | number | string };

/**
 * The delivery fee for the outcome an order just reached: `{ outcome, fee, on }`, or null when the status carries no
 * delivery fee. The state machine writes `fee` to `Order.deliveryFee` (source `rule`) in the same update as the status,
 * and posts it. Moving to the same status again is not a move, so a repeat never gets here and never changes the fee.
 * A partner with no rule gives 0 and raises `fee_rule_missing`, once per partner per day.
 */
export async function stampDeliveryFee(
  tx: TransactionClient,
  order: StampOrder,
  to: OrderStatus,
  on: Date,
): Promise<DeliveryFeeStamp | null> {
  const outcome = feeOutcomeOf(to);
  if (!outcome) return null;

  let fee: Money.Money = Money.ZERO;
  if (order.deliveryAgentId != null) {
    const resolved = await resolveFee(tx, order.deliveryAgentId, outcome, on, order.totalAmount, order.tenantId);
    fee = resolved.fee;
    if (!resolved.hasRule) {
      await openFindingOnce({
        tenantId: resolveTenantId(order.tenantId),
        type: 'fee_rule_missing',
        subjectType: 'delivery_partner',
        subjectId: `${order.deliveryAgentId}:${localDate(on, getStoreTimeZone(order.tenantId))}`,
        note: 'This delivery partner has no fee rule. Orders closed today were stamped with a delivery fee of 0.',
      }, { includeClosed: true }, tx);
    }
  }
  return { outcome, fee, on };
}
