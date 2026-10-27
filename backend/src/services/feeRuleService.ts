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
import { OPEN_COLLECTION_STATUSES } from '../utils/collectionCash';
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
  const [, rules, delivered] = await Promise.all([
    loadPartner(partnerId),
    prisma.feeRule.findMany({ where: { partnerUserId: partnerId }, orderBy: [{ outcome: 'asc' }, { validFrom: 'desc' }] }),
    // The fee actually stamped on this partner's delivered orders, averaged (decision R5): what the fee costs in practice
    prisma.order.aggregate({
      where: { deliveryAgentId: partnerId, status: 'delivered', deletedAt: null, deliveryFee: { not: null } },
      _avg: { deliveryFee: true },
      _count: { _all: true },
    }),
  ]);
  const inForce = currentFeeRules(rules, storeToday(resolveTenantId()));
  const current = Object.fromEntries(FEE_OUTCOMES.map((o) => [o, inForce[o] ? ruleView(inForce[o]!) : null])) as
    Record<FeeOutcome, ReturnType<typeof ruleView> | null>;
  const weightedFee = delivered._count._all > 0 && delivered._avg.deliveryFee ? Money.toApi(delivered._avg.deliveryFee) : null;
  return { rules: rules.map(ruleView), current, weightedFee, deliveredOrders: delivered._count._all };
}

/** One rule input, checked: outcome, basis, amount (percent up to 100) and the YYYY-MM-DD it starts on (today when left out). */
function parseRule(input: FeeRuleInput, tenantId: string) {
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
  return { outcome, basis, amount, ymd };
}

const sameDateMessage = (outcome: FeeOutcome, ymd: string) => `This partner already has a ${outcome} fee rule from ${ymd}`;

/** The create and its audit row, in the caller's transaction. */
async function insertRule(
  tx: TransactionClient, requester: Requester, tenantId: string, partnerId: number,
  r: { outcome: FeeOutcome; basis: FeeBasis; amount: Money.Money; ymd: string },
) {
  const created = await tx.feeRule.create({
    data: { tenantId, partnerUserId: partnerId, outcome: r.outcome, basis: r.basis, amount: r.amount, validFrom: utcDateOfYmd(r.ymd), createdById: requester.id },
  });
  await auditService.record({
    actorId: requester.id, actorKind: 'person', channel: 'app',
    action: 'create', resource: 'fee_rule', resourceId: String(created.id),
    metadata: { partnerId, outcome: r.outcome, basis: r.basis, amount: Money.toApi(r.amount), validFrom: r.ymd },
    tx,
  });
  return created;
}

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** Validates and stores one rule. Percent above 100 and a second rule with the same valid-from are rejected. */
export async function createFeeRule(requester: Requester, partnerId: number, input: FeeRuleInput) {
  await loadPartner(partnerId);
  const tenantId = resolveTenantId();
  const rule = parseRule(input, tenantId);
  try {
    return ruleView(await prisma.$transaction((tx) => insertRule(tx, requester, tenantId, partnerId, rule)));
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError(sameDateMessage(rule.outcome, rule.ymd), 409, 'FEE_RULE_EXISTS');
    throw error;
  }
}

/**
 * Stores the changed outcomes of one partner together, all or none, and returns the list as GET gives it (rules, rule in
 * force per outcome, weighted fee). Problems come back per outcome in `errors` (a bad value, a second rule with the same
 * valid-from, the same outcome twice); when there is any, nothing is stored.
 */
export async function createFeeRules(requester: Requester, partnerId: number, inputs: FeeRuleInput[]) {
  await loadPartner(partnerId);
  const tenantId = resolveTenantId();
  if (inputs.length === 0) throw new AppError('Send at least one fee rule', 400, 'NO_RULES');

  const errors: Partial<Record<FeeOutcome, string>> = {};
  const rules: Array<ReturnType<typeof parseRule>> = [];
  for (const input of inputs) {
    try {
      const rule = parseRule(input, tenantId);
      if (rules.some((r) => r.outcome === rule.outcome)) errors[rule.outcome] = `Send ${rule.outcome} only once`;
      else rules.push(rule);
    } catch (e) {
      const outcome = FEE_OUTCOMES.includes(input.outcome as FeeOutcome) ? (input.outcome as FeeOutcome) : null;
      if (!outcome || !(e instanceof AppError)) throw e;
      errors[outcome] = e.message;
    }
  }
  if (rules.length > 0) {
    const taken = await prisma.feeRule.findMany({
      where: { partnerUserId: partnerId, OR: rules.map((r) => ({ outcome: r.outcome, validFrom: utcDateOfYmd(r.ymd) })) },
      select: { outcome: true },
    });
    for (const t of taken) errors[t.outcome] = sameDateMessage(t.outcome, rules.find((r) => r.outcome === t.outcome)!.ymd);
  }
  const fail = (conflict: boolean) => {
    const error = new AppError(Object.values(errors)[0]!, conflict ? 409 : 400, conflict ? 'FEE_RULE_EXISTS' : 'INVALID_FEE_RULE');
    error.details = { errors };
    return error;
  };
  if (Object.keys(errors).length > 0) throw fail(Object.values(errors).every((m) => m!.startsWith('This partner already has')));

  try {
    await prisma.$transaction(async (tx) => {
      for (const rule of rules) await insertRule(tx, requester, tenantId, partnerId, rule);
    });
  } catch (error) {
    // Two saves at the same moment: the unique key answers the second
    if (isUniqueViolation(error)) {
      for (const r of rules) errors[r.outcome] = sameDateMessage(r.outcome, r.ymd);
      throw fail(true);
    }
    throw error;
  }
  return listFeeRules(partnerId);
}

interface ResolvedFee {
  fee: Money.Money;
  /** False when the partner has no rule at all in force on the date (the fee is 0 and a Finding is raised). */
  hasRule: boolean;
}

/** A rule as `pickFee` reads it. */
export interface PickableRule { outcome: FeeOutcome; basis: FeeBasis; amount: Money.MoneyInput; validFrom: Date }

/**
 * The fee for one outcome from a partner's rules, the one place the rule is applied: the latest rule of the outcome on or
 * before `day` (the rule DATE, 00:00 UTC of the store day); a percent rule applies to the order total. No rule for the
 * outcome gives 0, and `hasRule` says whether the partner has any rule at all in force on `day`.
 */
export function pickFee(rules: PickableRule[], outcome: FeeOutcome, day: Date, orderTotal: Money.MoneyInput): ResolvedFee {
  const inForce = rules.filter((r) => r.validFrom <= day);
  const rule = currentFeeRules(inForce, day)[outcome];
  if (!rule) return { fee: Money.ZERO, hasRule: inForce.length > 0 };
  const fee = rule.basis === 'percent' ? Money.roundHalfUp(Money.mul(orderTotal, Money.div(rule.amount, 100)), 2) : Money.parse(rule.amount);
  return { fee, hasRule: true };
}

/** The rule date of an instant: the store day it falls on, as the DATE value `validFrom` is compared with. */
export const ruleDayOf = (on: Date, tenantId?: string | null): Date => utcDateOfYmd(localDate(on, getStoreTimeZone(tenantId)));

/** The fee for one outcome on one date: the latest rule on or before the date; a percent rule applies to the order total. */
export async function resolveFee(
  db: Pick<TransactionClient, 'feeRule'>,
  partnerId: number,
  outcome: FeeOutcome,
  on: Date,
  orderTotal: Money.MoneyInput,
  tenantId?: string | null,
): Promise<ResolvedFee> {
  const day = ruleDayOf(on, tenantId);
  const rules = await db.feeRule.findMany({
    where: { partnerUserId: partnerId, validFrom: { lte: day }, ...(tenantId ? { tenantId } : {}) },
    select: { outcome: true, basis: true, amount: true, validFrom: true },
  });
  return pickFee(rules, outcome, day, orderTotal);
}

/**
 * The partner keeps the fee from the cash: an open collection is held net of it, like a new one. The collection goes down
 * to `max(amount - fee, 0)`, and the partner's `totalCollected` and cash held go down by the cut. Runs in the caller's
 * transaction. No open collection on the order, no change.
 */
export async function netOpenCollectionByFee(tx: TransactionClient, orderId: number, agentId: number, fee: Money.MoneyInput): Promise<void> {
  const coll = await tx.agentCollection.findFirst({ where: { orderId, status: { in: [...OPEN_COLLECTION_STATUSES] } }, select: { id: true, amount: true } });
  if (!coll) return;
  const net = Prisma.Decimal.max(Money.sub(coll.amount, fee), Money.ZERO);
  const cut = Money.sub(coll.amount, net);
  await tx.agentCollection.update({ where: { id: coll.id }, data: { amount: net } });
  await tx.agentBalance.updateMany({ where: { agentId }, data: { totalCollected: { decrement: cut }, currentBalance: { decrement: cut } } });
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
