/**
 * Partner settlements (M5-T10, T11; F-906): the one generic "record partner payout" action.
 *
 * An outside agent (or a person) sends the paid-order list and the payout for any delivery partner. The same service
 * runs behind `POST /api/partner-settlements` and the MCP tool `partner_payout_record`. There is no partner-specific
 * code here: a partner is a user with the delivery_agent role, nothing more.
 *
 * One payout is one transaction: the settlement row is inserted first (its unique key makes a repeated reference wait
 * and then return the first result), then the partner's balance row is locked (so two payouts or deposits of one partner
 * run one after the other), then lines are matched, fees trued up, collections claimed and reconciled, one deposit posted
 * through the same cover path as a verified deposit, and Findings opened for every gap.
 */
import { AgentDeposit, FeeOutcome, Prisma, PartnerSettlement, PartnerSettlementLine } from '@prisma/client';
import prisma, { TransactionClient } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import appEvents, { AppEvent } from '../utils/appEvents';
import { TRANSACTION_CONFIG } from '../config/transactionConfig';
import { resolveTenantId } from '../utils/tenantContext';
import { getCurrency } from '../utils/currency';
import { looksLikePhone, phoneLookupVariants } from '../utils/phone';
import { OPEN_COLLECTION_STATUSES } from '../utils/collectionCash';
import * as Money from '../utils/money';
import { loadPartner } from './deliveryPartnerAdminService';
import agentReconciliationService, { OpenCollection, planCover } from './agentReconciliationService';
import { closeClearedShortPays, openFindingOnce } from './findingService';
import { isChargeVariance, matchLine, MatchIndex, OrderCandidate, parseOrderNumber, settlementOutcome } from './settlementMatching';
import { PartnerPayoutInput, partnerPayoutSchema } from '../validators/partnerPayoutSchema';
import { formatIssues } from '../tools/shared';

/** Who records the payout: the signed-in user, or the AI agent user behind an MCP key. */
export interface SettlementActor { id: number }

/** Parse the one input format. A bad payload is a 400 that names each problem. */
export function parsePartnerPayout(raw: unknown): PartnerPayoutInput {
  const parsed = partnerPayoutSchema.safeParse(raw ?? {});
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400, 'INVALID_PAYOUT');
  return parsed.data;
}

type SettlementWithLines = PartnerSettlement & { lines: PartnerSettlementLine[] };
type FindingRef = { id: number; type: string };

const lineView = (l: PartnerSettlementLine) => ({
  id: l.id,
  externalOrderRef: l.externalOrderRef,
  orderId: l.orderId,
  expAmount: Money.toApi(l.expAmount),
  charge: Money.toApi(l.charge),
  outcome: l.outcome,
  matched: l.matched,
  matchedBy: l.matchedBy,
  note: l.note,
});

/** One settlement as the API and the tool return it. */
export function settlementView(s: SettlementWithLines, extra: { replayed?: boolean; findings?: FindingRef[]; warnings?: string[] } = {}) {
  return {
    id: s.id,
    partnerId: s.partnerId,
    reference: s.reference,
    payoutDate: s.payoutDate.toISOString().slice(0, 10),
    payoutAmount: Money.toApi(s.payoutAmount),
    expectedNet: Money.toApi(s.expectedNet),
    shortAmount: Money.toApi(s.shortAmount),
    unappliedAmount: Money.toApi(s.unappliedAmount),
    status: s.status,
    needsReview: s.needsReview,
    isManual: s.isManual,
    depositId: s.depositId,
    matchedLines: s.lines.filter((l) => l.matched).length,
    unmatchedLines: s.lines.filter((l) => !l.matched).length,
    lines: s.lines.map(lineView),
    findings: extra.findings ?? [],
    warnings: extra.warnings ?? [],
    replayed: extra.replayed ?? false,
  };
}

export type SettlementView = ReturnType<typeof settlementView>;

const findExisting = (partnerId: number, reference: string) =>
  prisma.partnerSettlement.findFirst({ where: { partnerId, reference }, include: { lines: { orderBy: { id: 'asc' } } } });

/** The first result again, for a repeated reference: the same findings and warning the first call returned. */
async function replayView(s: SettlementWithLines, currency: string) {
  const lineIds = s.lines.map((l) => String(l.id));
  const found = await prisma.finding.findMany({
    where: {
      OR: [
        { subjectType: 'partner_settlement', subjectId: String(s.id) },
        { subjectType: 'settlement_line', subjectId: { in: lineIds } },
        ...(s.depositId ? [{ type: 'excess_deposit' as const, subjectType: 'agent_deposit', subjectId: String(s.depositId) }] : []),
      ],
    },
    select: { id: true, type: true },
    orderBy: { id: 'asc' },
  });
  const unapplied = Money.parse(s.unappliedAmount);
  const warnings = unapplied.gt(0) ? [unappliedWarning(currency, unapplied, 'of the payout matched no open order and is')] : [];
  return settlementView(s, { replayed: true, findings: found, warnings });
}

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const unappliedWarning = (currency: string, amount: Money.Money, verb: string) =>
  `${currency} ${Money.toApi(amount)} ${verb} held as unapplied (account 2040)`;

// ---- Reading the candidate orders ----

/** The partner's orders the lines may point at, in the shape the pure matcher wants. */
async function loadMatchIndex(tx: TransactionClient, partnerId: number, lines: PartnerPayoutInput['lines']): Promise<MatchIndex> {
  const ids = new Set<number>();
  const refs = new Set<string>();
  const variants = new Set<string>();
  for (const line of lines) {
    if (line.orderId !== undefined) ids.add(line.orderId);
    const number = parseOrderNumber(line.externalOrderRef);
    if (number !== null) ids.add(number);
    refs.add(line.externalOrderRef.trim());
    if (looksLikePhone(line.externalOrderRef)) phoneLookupVariants(line.externalOrderRef).forEach((v) => variants.add(v));
  }

  const include = { customer: { select: { phoneNumber: true } }, agentCollection: true } satisfies Prisma.OrderInclude;
  const orders = await tx.order.findMany({
    where: {
      deletedAt: null,
      OR: [
        ...(ids.size ? [{ id: { in: [...ids] } }] : []),
        { deliveryAgentId: partnerId, externalOrderId: { in: [...refs] } },
        ...(variants.size ? [{ deliveryAgentId: partnerId, status: 'delivered' as const, customer: { phoneNumber: { in: [...variants] } } }] : []),
      ],
    },
    include,
  });

  const index: MatchIndex = { byId: new Map(), byExternalId: new Map(), byPhone: new Map() };
  for (const o of orders) {
    const c = o.agentCollection;
    const candidate: OrderCandidate = {
      id: o.id,
      deliveryAgentId: o.deliveryAgentId,
      status: o.status,
      gross: Money.parse(o.codAmount ?? o.totalAmount),
      deliveryFee: o.deliveryFee === null ? null : Money.parse(o.deliveryFee),
      externalOrderId: o.externalOrderId,
      phone: o.customer?.phoneNumber ?? null,
      collection: c ? { id: c.id, status: c.status, amount: Money.parse(c.amount), allocatedAmount: Money.orZero(c.allocatedAmount), collectionDate: c.collectionDate } : null,
    };
    index.byId.set(o.id, candidate);
    if (o.externalOrderId) index.byExternalId.set(o.externalOrderId, [...(index.byExternalId.get(o.externalOrderId) ?? []), candidate]);
    if (candidate.phone) {
      for (const v of phoneLookupVariants(candidate.phone)) index.byPhone.set(v, [...(index.byPhone.get(v) ?? []), candidate]);
    }
  }
  return index;
}

// ---- The shared money path: claim covers, reconcile, post the deposit ----

interface DepositPost {
  settlement: PartnerSettlement;
  partnerId: number;
  amount: Money.Money;
  depositDate: Date;
  method: 'partner_payout' | 'manual';
  actorId: number;
}

/**
 * Match `amount` FIFO over `open`, claim the covers (conditional, so cash is never covered twice), and return the plan
 * with the covers that cleared their collection completely. Throws 409 when a row was changed by someone else.
 */
async function claimPlan(tx: TransactionClient, open: OpenCollection[], amount: Money.Money) {
  const plan = planCover(open, amount);
  const { byCollection } = await agentReconciliationService.claimCovers(tx, plan.covers);
  if (byCollection.size !== plan.covers.length) throw new AppError('Collections were changed by someone else. Reload and try again.', 409, 'COLLECTIONS_CHANGED');
  const full = plan.covers.filter((c) => c.allocated.plus(c.take).gte(c.amount));
  return { plan, full };
}

/** Fully covered collections become `reconciled` (never stay `deposited`), their orders `reconciled`, and each points at its line. */
async function reconcileCollections(tx: TransactionClient, items: Array<{ collectionId: number; orderId: number; lineId: number }>, actorId: number) {
  const now = new Date();
  for (const item of items) {
    await tx.agentCollection.update({
      where: { id: item.collectionId },
      data: { status: 'reconciled', settlementLineId: item.lineId, verifiedAt: now, verifiedById: actorId, approvedAt: now, approvedById: actorId },
    });
  }
  if (items.length > 0) await tx.order.updateMany({ where: { id: { in: items.map((i) => i.orderId) } }, data: { paymentStatus: 'reconciled' } });
}

/** One verified deposit for the payout, posted by the same entry as a verified agent deposit (DR 1010, CR 1015, excess CR 2040). */
async function postDeposit(tx: TransactionClient, p: DepositPost, plan: ReturnType<typeof planCover>): Promise<AgentDeposit> {
  const deposit = await tx.agentDeposit.create({
    data: {
      tenantId: p.settlement.tenantId,
      agentId: p.partnerId,
      amount: p.amount,
      status: 'verified',
      depositDate: p.depositDate,
      depositMethod: p.method,
      referenceNumber: `PS${p.settlement.id}-${p.settlement.reference}`,
      verifiedAt: new Date(),
      verifiedById: p.actorId,
      settlementId: p.settlement.id,
      allocations: plan.allocations,
      notes: plan.remaining.isZero() ? null : `Unallocated remainder: ${plan.remaining.toString()}`,
    },
  });
  const { GLAutomationService } = await import('./glAutomationService');
  await GLAutomationService.createAgentDepositEntry(tx as unknown as Prisma.TransactionClient, deposit, p.actorId, plan);
  return deposit;
}

/** The partner's balance row, locked for the rest of the transaction. Two payouts or deposits of one partner run one after the other. */
async function lockBalance(tx: TransactionClient, partnerId: number) {
  const balance = await agentReconciliationService.getOrCreateBalance(partnerId, tx);
  await tx.agentBalance.update({ where: { id: balance.id }, data: { lastSettlementDate: new Date() } });
  return balance as { id: number };
}

// ---- Record partner payout (the paid-order list) ----

interface PayoutContext { tenantId: string; currency: string; actor: SettlementActor; input: PartnerPayoutInput }

async function applyPayout(tx: TransactionClient, { tenantId, currency, actor, input }: PayoutContext): Promise<SettlementView> {
  const { partnerId } = input;
  const settlement = await tx.partnerSettlement.create({
    data: {
      tenantId, partnerId, payoutDate: input.payoutDate, payoutAmount: input.payoutAmount, currency, reference: input.reference,
      status: 'unmatched', recordedById: actor.id, notes: input.notes, payload: input as unknown as Prisma.InputJsonValue,
    },
  });
  const balance = await lockBalance(tx, partnerId);

  // 1. Match every line to an order and its open collection
  const index = await loadMatchIndex(tx, partnerId, input.lines);
  const taken = new Set<number>();
  const verdicts = input.lines.map((line) => {
    const verdict = matchLine({ orderId: line.orderId, externalOrderRef: line.externalOrderRef, expAmount: line.expAmount, charge: line.charge ?? Money.ZERO }, partnerId, index, taken);
    if (verdict.order) taken.add(verdict.order.id);
    return verdict;
  });
  await tx.partnerSettlementLine.createMany({
    data: input.lines.map((line, i) => ({
      tenantId, settlementId: settlement.id, externalOrderRef: line.externalOrderRef,
      expAmount: line.expAmount, charge: line.charge ?? Money.ZERO,
      orderId: verdicts[i].order?.id ?? null, matched: verdicts[i].order !== null, matchedBy: verdicts[i].matchedBy,
      note: verdicts[i].note, outcome: (verdicts[i].order ? 'delivered' : null) as FeeOutcome | null,
    })),
  });
  const lines = await tx.partnerSettlementLine.findMany({ where: { settlementId: settlement.id }, orderBy: { id: 'asc' } });
  const matched = lines.flatMap((line, i) => (verdicts[i].order ? [{ line, order: verdicts[i].order! }] : []));

  // 2. True up each order's fee: the real charge replaces the fee booked at delivery. The collection holds cash net of the fee, so it moves by the difference.
  let trueUp: Money.Money = Money.ZERO;
  let feeBooked: Money.Money = Money.ZERO;
  let feeCharged: Money.Money = Money.ZERO;
  const variances: Array<{ lineId: number; orderId: number; booked: Money.Money; charge: Money.Money }> = [];
  for (const { line, order } of matched) {
    const booked = order.deliveryFee ?? Money.ZERO;
    const charge = Money.parse(line.charge);
    feeBooked = feeBooked.plus(booked);
    feeCharged = feeCharged.plus(charge);
    if (isChargeVariance(booked, charge)) variances.push({ lineId: line.id, orderId: order.id, booked, charge });
    const diff = charge.minus(booked);
    if (diff.isZero()) continue;

    const c = order.collection!;
    const claim = await tx.agentCollection.updateMany({
      where: { id: c.id, status: { in: [...OPEN_COLLECTION_STATUSES] }, amount: c.amount, allocatedAmount: c.allocatedAmount },
      data: { amount: c.amount.minus(diff) },
    });
    if (claim.count !== 1) throw new AppError('Collections were changed by someone else. Reload and try again.', 409, 'COLLECTIONS_CHANGED');
    c.amount = c.amount.minus(diff);
    await tx.order.update({ where: { id: order.id }, data: { deliveryFee: charge, deliveryFeeSource: 'settlement' } });
    trueUp = trueUp.plus(diff);
  }
  const { GLAutomationService } = await import('./glAutomationService');
  await GLAutomationService.createFeeTrueUpEntry(tx as unknown as Prisma.TransactionClient, settlement, trueUp, actor.id, input.payoutDate);

  // 3. Cover the matched collections FIFO with the payout, reconcile what is paid in full, post one deposit
  const byCollection = new Map(matched.map((m) => [m.order.collection!.id, m]));
  const open: OpenCollection[] = matched
    .map((m) => m.order.collection!)
    .sort((a, b) => a.collectionDate.getTime() - b.collectionDate.getTime() || a.id - b.id)
    .map((c) => ({ id: c.id, agentId: partnerId, amount: c.amount, allocatedAmount: c.allocatedAmount }));
  const { plan, full } = await claimPlan(tx, open, input.payoutAmount);
  await reconcileCollections(tx, full.map((c) => ({ collectionId: c.id, orderId: byCollection.get(c.id)!.order.id, lineId: byCollection.get(c.id)!.line.id })), actor.id);
  const deposit = await postDeposit(tx, { settlement, partnerId, amount: input.payoutAmount, depositDate: input.payoutDate, method: 'partner_payout', actorId: actor.id }, plan);
  await tx.agentBalance.update({
    where: { id: balance.id },
    data: {
      totalCollected: { decrement: trueUp },
      totalDeposited: { increment: plan.matched },
      currentBalance: { decrement: trueUp.plus(plan.matched) },
    },
  });

  // 4. Status, and a Finding for every gap
  // What the list expects from this payout: each line's net less what an earlier payout already paid on its collection
  const expectedNet = Money.sum(matched.map((m) => Prisma.Decimal.max(Money.sub(Money.sub(m.line.expAmount, m.line.charge), m.order.collection!.allocatedAmount), Money.ZERO)));
  const unmatchedLines = lines.filter((l) => !l.matched);
  const outcome = settlementOutcome({ unmatchedLines: unmatchedLines.length, payout: input.payoutAmount, expectedNet });
  const needsReview = isChargeVariance(feeBooked, feeCharged);
  const updated = await tx.partnerSettlement.update({
    where: { id: settlement.id },
    data: { expectedNet, shortAmount: outcome.shortAmount, unappliedAmount: plan.remaining, status: outcome.status, needsReview, depositId: deposit.id },
    include: { lines: { orderBy: { id: 'asc' } } },
  });

  // Earlier short payments this payout clears are closed first, so this settlement's own Finding is not closed by itself
  await closeClearedShortPays(tx, partnerId, input.reference);

  const findings: FindingRef[] = [];
  const open1 = async (type: Prisma.FindingUncheckedCreateInput['type'], subjectType: string, subjectId: number, amount: Money.Money, note: string) =>
    findings.push({ type, id: await openFindingOnce({ tenantId, type, subjectType, subjectId: String(subjectId), amount, note }, { includeClosed: true }, tx) });
  if (outcome.shortAmount.gt(0)) {
    await open1('short_pay', 'partner_settlement', settlement.id, outcome.shortAmount,
      `Settlement ${input.reference}: the payout of ${Money.toApi(input.payoutAmount)} is ${Money.toApi(outcome.shortAmount)} less than the ${Money.toApi(expectedNet)} the list expects.`);
  }
  // Cash above the open collections is already reported by the deposit entry as excess_deposit
  if (outcome.overAmount.gt(0) && plan.remaining.isZero()) {
    await open1('over_pay', 'partner_settlement', settlement.id, outcome.overAmount,
      `Settlement ${input.reference}: the payout of ${Money.toApi(input.payoutAmount)} is ${Money.toApi(outcome.overAmount)} more than the ${Money.toApi(expectedNet)} the list expects.`);
  }
  for (const line of unmatchedLines) {
    await open1('unmatched_line', 'settlement_line', line.id, Money.sub(line.expAmount, line.charge),
      `Settlement ${input.reference}, line "${line.externalOrderRef}": ${line.note ?? 'no order matches'}.`);
  }
  for (const v of variances) {
    await open1('charge_variance', 'settlement_line', v.lineId, v.charge.minus(v.booked).abs(),
      `Settlement ${input.reference}, order #${v.orderId}: the partner charged ${Money.toApi(v.charge)}, the fee booked was ${Money.toApi(v.booked)}.`);
  }
  const excess = await tx.finding.findFirst({ where: { type: 'excess_deposit', subjectType: 'agent_deposit', subjectId: String(deposit.id) }, select: { id: true } });
  if (excess) findings.push({ type: 'excess_deposit', id: excess.id });

  const warnings = plan.remaining.gt(0) ? [unappliedWarning(currency, plan.remaining, 'of the payout matched no open order and is')] : [];
  return settlementView(updated, { findings: findings.sort((x, y) => x.id - y.id), warnings });
}

/**
 * Record a partner payout from a paid-order list (already parsed with `partnerPayoutSchema`). Checks the currency and the
 * partner, then runs `applyPayout` in one transaction. A repeat of (partner, reference) returns the first result with
 * `replayed: true` and changes nothing.
 */
export async function recordPartnerPayout(actor: SettlementActor, input: PartnerPayoutInput): Promise<SettlementView> {
  const tenantId = resolveTenantId();
  const currency = await getCurrency();
  if (input.currency && input.currency !== currency) {
    throw new AppError(`This store is paid in ${currency}. A payout in ${input.currency} cannot be recorded.`, 400, 'CURRENCY_MISMATCH');
  }
  await loadPartner(input.partnerId);

  const first = await findExisting(input.partnerId, input.reference);
  if (first) return replayView(first, currency);

  try {
    const result = await prisma.$transaction((tx) => applyPayout(tx, { tenantId, currency, actor, input }), TRANSACTION_CONFIG);
    appEvents.emit(AppEvent.AGENT_COLLECTION_RECONCILED);
    return result;
  } catch (error) {
    // Two calls with one reference: the loser's insert waits for the winner, then hits the unique key. It gets the winner's result.
    if (isUniqueViolation(error)) {
      const winner = await findExisting(input.partnerId, input.reference);
      if (winner) return replayView(winner, currency);
    }
    throw error;
  }
}
