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
import { getStoreTimeZone, localDate, YMD } from './kpi/dates';
import { auditService } from './auditService';
import { openFindingOnce } from './findingService';

export const FEE_OUTCOMES: readonly FeeOutcome[] = ['delivered', 'failed', 'returned'];

/** The outcome an order status stands for, or null when the status carries no delivery fee. */
export function feeOutcomeOf(status: OrderStatus): FeeOutcome | null {
  if (status === 'delivered') return 'delivered';
  if (status === 'failed_delivery') return 'failed';
  if (status === 'returned') return 'returned';
  return null;
}

export interface FeeRuleInput {
  outcome?: unknown;
  basis?: unknown;
  amount?: unknown;
  /** YYYY-MM-DD. Defaults to today in the store time zone. */
  validFrom?: unknown;
}

const dateOf = (ymd: string): Date => new Date(`${ymd}T00:00:00.000Z`);

/** One rule as the API returns it. */
const ruleView = (r: { id: number; outcome: FeeOutcome; basis: FeeBasis; amount: Prisma.Decimal; validFrom: Date; createdById: number | null; createdAt: Date }) => ({
  id: r.id,
  outcome: r.outcome,
  basis: r.basis,
  amount: Money.toApi(r.amount),
  validFrom: r.validFrom.toISOString().slice(0, 10),
  createdById: r.createdById,
  createdAt: r.createdAt,
});

async function requirePartner(partnerId: number): Promise<void> {
  const partner = await prisma.user.findFirst({ where: { id: partnerId, role: 'delivery_agent' }, select: { id: true } });
  if (!partner) throw new AppError('Delivery partner not found', 404);
}

/** All rules of a partner (history, newest first) and the rule in force today for each outcome. */
export async function listFeeRules(partnerId: number) {
  await requirePartner(partnerId);
  const rules = await prisma.feeRule.findMany({
    where: { partnerUserId: partnerId },
    orderBy: [{ outcome: 'asc' }, { validFrom: 'desc' }],
  });
  const today = dateOf(localDate(new Date(), getStoreTimeZone(resolveTenantId())));
  const current: Record<FeeOutcome, ReturnType<typeof ruleView> | null> = { delivered: null, failed: null, returned: null };
  for (const rule of rules) {
    if (rule.validFrom <= today && !current[rule.outcome]) current[rule.outcome] = ruleView(rule);
  }
  return { rules: rules.map(ruleView), current };
}

/** Validates and stores one rule. Percent above 100 and a second rule with the same valid-from are rejected. */
export async function createFeeRule(requester: Requester, partnerId: number, input: FeeRuleInput) {
  await requirePartner(partnerId);
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
  const parsed = YMD.exec(ymd);
  if (!parsed || Number.isNaN(dateOf(ymd).getTime()) || dateOf(ymd).toISOString().slice(0, 10) !== ymd) {
    throw new AppError('Valid from must be a date written YYYY-MM-DD', 400, 'INVALID_DATE');
  }

  try {
    const rule = await prisma.$transaction(async (tx) => {
      const created = await tx.feeRule.create({
        data: { tenantId, partnerUserId: partnerId, outcome, basis, amount, validFrom: dateOf(ymd), createdById: requester.id },
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

export interface ResolvedFee {
  fee: Money.Money;
  /** False when the partner has no rule at all in force on the date (the fee is 0 and a Finding is raised). */
  hasRule: boolean;
}

/** The fee for one outcome on one date: the latest rule on or before the date; a percent rule applies to the order total. */
export async function resolveFee(
  db: Pick<TransactionClient, 'feeRule'>,
  partnerId: number,
  outcome: FeeOutcome,
  on: Date,
  orderTotal: Money.MoneyInput,
  tenantId?: string | null,
): Promise<ResolvedFee> {
  const day = dateOf(localDate(on, getStoreTimeZone(tenantId)));
  const rules = await db.feeRule.findMany({
    where: { partnerUserId: partnerId, validFrom: { lte: day }, ...(tenantId ? { tenantId } : {}) },
    orderBy: { validFrom: 'desc' },
    select: { outcome: true, basis: true, amount: true },
  });
  const rule = rules.find((r) => r.outcome === outcome);
  if (!rule) return { fee: Money.ZERO, hasRule: rules.length > 0 };
  const fee = rule.basis === 'percent' ? Money.roundHalfUp(Money.mul(orderTotal, Money.div(rule.amount, 100)), 2) : Money.parse(rule.amount);
  return { fee, hasRule: true };
}

type StampOrder = { id: number; tenantId?: string | null; deliveryAgentId?: number | null; totalAmount: Prisma.Decimal | number | string };

/**
 * Stamps `Order.deliveryFee` and `deliveryFeeSource` for the outcome the order just reached, in the move's transaction.
 * Moving to the same status again is not a move, so a repeat never gets here and never changes the fee.
 * A partner with no rule stamps 0 and raises `fee_rule_missing`, once per partner per day.
 * Leaving `delivered` for a status with no outcome clears the stamp (the delivered fee entry is reversed with the revenue).
 */
export async function stampDeliveryFee(
  tx: TransactionClient,
  order: StampOrder,
  from: OrderStatus,
  to: OrderStatus,
  on: Date,
): Promise<{ outcome: FeeOutcome; fee: Money.Money } | null> {
  const outcome = feeOutcomeOf(to);
  if (!outcome) {
    if (from === 'delivered') await tx.order.update({ where: { id: order.id }, data: { deliveryFee: null, deliveryFeeSource: null } });
    return null;
  }

  let fee: Money.Money = Money.ZERO;
  if (order.deliveryAgentId != null) {
    const resolved = await resolveFee(tx, order.deliveryAgentId, outcome, on, order.totalAmount, order.tenantId);
    fee = resolved.fee;
    if (!resolved.hasRule) {
      const day = localDate(on, getStoreTimeZone(order.tenantId));
      await openFindingOnce({
        tenantId: resolveTenantId(order.tenantId),
        type: 'fee_rule_missing',
        subjectType: 'delivery_partner',
        subjectId: `${order.deliveryAgentId}:${day}`,
        note: 'This delivery partner has no fee rule. Orders closed today were stamped with a delivery fee of 0.',
      }, { includeClosed: true }, tx);
    }
  }
  await tx.order.update({ where: { id: order.id }, data: { deliveryFee: fee, deliveryFeeSource: 'rule' } });
  return { outcome, fee };
}
