/**
 * Partner settlements (M5-T10, T11, T12; F-906, F-908): the one generic "record partner payout" action.
 *
 * An outside agent (or a person) sends the paid-order list and the payout for any delivery partner. The same service
 * runs behind `POST /api/partner-settlements` and the MCP tool `partner_payout_record`. There is no partner-specific
 * code here: a partner is a user with the delivery_agent role, nothing more.
 *
 * One payout is one transaction: the settlement row is inserted first (its unique key makes a repeated reference wait
 * and then return the first result), the partner's balance row is updated next (that lock makes two payouts or deposits
 * of one partner run one after the other), then the path-specific part runs: matching lines and fee true-up for a paid
 * list, nothing for a manual payout. Both end in `settle`: FIFO plan over the open collections, one deposit through the
 * same cover path as a verified deposit, reconcile what is paid in full, close the short_pay Findings this clears.
 */
import { AuditChannel, FeeOutcome, Prisma, PartnerSettlement, PartnerSettlementLine } from '@prisma/client';
import { z } from 'zod';
import prisma, { TransactionClient } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import appEvents, { AppEvent } from '../utils/appEvents';
import { TRANSACTION_CONFIG } from '../config/transactionConfig';
import { resolveTenantId } from '../utils/tenantContext';
import { getCurrency } from '../utils/currency';
import { phoneLookupVariants } from '../utils/phone';
import { parseOrderNumber } from '../utils/orderNumber';
import { loadOrdersByRefs } from '../utils/orderLookup';
import { isUniqueViolation } from '../utils/prismaErrors';
import { OPEN_COLLECTION_STATUSES, outstandingOf } from '../utils/collectionCash';
import * as Money from '../utils/money';
import { loadPartner } from './deliveryPartnerAdminService';
import agentReconciliationService, { OpenCollection, planCover } from './agentReconciliationService';
import { GLAutomationService } from './glAutomationService';
import { closeClearedShortPays, openFindingsOnce } from './findingService';
import { auditService } from './auditService';
import { isChargeVariance, matchLine, MatchIndex, OrderCandidate, settlementOutcome } from './settlementMatching';
import {
  ManualPayoutInput, ManualPreviewInput, manualPayoutSchema, manualPreviewSchema, PartnerPayoutInput, partnerPayoutSchema,
} from '../validators/partnerPayoutSchema';
import { formatIssues } from '../tools/shared';
import { ymdOfUtc } from './kpi/dates';

/**
 * Who records the payout. `auditChannel` is set by the API route, which writes the one audit row of the call here;
 * a registry tool leaves it out because `runTool` writes that row.
 */
export interface SettlementActor { id: number; auditChannel?: AuditChannel }

function parseWith<S extends z.ZodType>(schema: S, raw: unknown, code: string): z.output<S> {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400, code);
  return parsed.data;
}

/** Parse the one input format. A bad payload is a 400 that names each problem. */
export const parsePartnerPayout = (raw: unknown): PartnerPayoutInput => parseWith(partnerPayoutSchema, raw, 'INVALID_PAYOUT');
export const parseManualPayout = (raw: unknown): ManualPayoutInput => parseWith(manualPayoutSchema, raw, 'INVALID_PAYOUT');
export const parseManualPreview = (raw: unknown): ManualPreviewInput => parseWith(manualPreviewSchema, raw, 'INVALID_PAYOUT');

type SettlementWithLines = PartnerSettlement & { lines: PartnerSettlementLine[] };
type FindingRef = { id: number; type: string };

/** What the settlement keeps in `payload`: the input as received (a paid list) and the Findings the call opened, so a repeat can return them. */
/** `owedOrders`: a manual payout keeps how many orders the partner owed for, beside `expectedNet` (what they owed). */
interface SettlementPayload { input?: unknown; findings: FindingRef[]; owedOrders?: number }

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

const unappliedWarning = (currency: string, amount: Money.Money, verb: string) =>
  `${currency} ${Money.toApi(amount)} ${verb} held as unapplied (account 2040)`;

/** One settlement as the API and the tool return it. The Findings come from the stored payload. */
export function settlementView(s: SettlementWithLines, extra: { replayed?: boolean; warnings?: string[] } = {}) {
  return {
    id: s.id,
    partnerId: s.partnerId,
    reference: s.reference,
    payoutDate: ymdOfUtc(s.payoutDate),
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
    findings: ((s.payload as unknown as SettlementPayload | null)?.findings ?? []),
    warnings: extra.warnings ?? [],
    replayed: extra.replayed ?? false,
  };
}

export type SettlementView = ReturnType<typeof settlementView>;

const findExisting = (partnerId: number, reference: string) =>
  prisma.partnerSettlement.findFirst({ where: { partnerId, reference }, include: { lines: { orderBy: { id: 'asc' } } } });

/** The first result again, for a repeated reference. */
function replayView(s: SettlementWithLines, currency: string) {
  const unapplied = Money.parse(s.unappliedAmount);
  return settlementView(s, { replayed: true, warnings: unapplied.gt(0) ? [unappliedWarning(currency, unapplied, 'of the payout matched no open order and is')] : [] });
}

// ---- Reading the candidate orders ----

/** Add `value` to the list under `key`, starting the list when there is none. */
function pushTo<V>(map: Map<string, V[]>, key: string, value: V): void {
  const list = map.get(key);
  if (list) list.push(value); else map.set(key, [value]);
}

/** The partner's orders the lines may point at, in the shape the pure matcher wants. */
async function loadMatchIndex(tx: TransactionClient, partnerId: number, lines: PartnerPayoutInput['lines']): Promise<MatchIndex> {
  const ids = new Set<number>();
  for (const line of lines) {
    if (line.orderId !== undefined) ids.add(line.orderId);
    const number = parseOrderNumber(line.externalOrderRef);
    if (number !== null) ids.add(number);
  }
  const orders = await loadOrdersByRefs(
    tx,
    { ids, externalIds: lines.map((l) => l.externalOrderRef.trim()), phones: lines.map((l) => l.externalOrderRef) },
    { externalPartnerId: partnerId, phoneStatuses: ['delivered'], phonePartnerId: partnerId },
  );

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
    if (o.externalOrderId) pushTo(index.byExternalId, o.externalOrderId, candidate);
    if (candidate.phone) {
      for (const v of phoneLookupVariants(candidate.phone)) pushTo(index.byPhone, v, candidate);
    }
  }
  return index;
}

// ---- The shared money path ----

/**
 * The FIFO plan of a payout: the partner's open collections oldest first (limited to `orderIds` when given), what `amount`
 * covers, what is left. The one planner behind the manual preview, the manual payout and a paid list. Reads only.
 */
async function planPayout(db: Pick<TransactionClient, 'agentCollection'>, partnerId: number, amount: Money.Money, orderIds?: number[]) {
  const open = await agentReconciliationService.loadOpenCollections(db, partnerId, orderIds);
  const orderOf = new Map(open.map((c) => [c.id, c.orderId!]));
  const unpaid = Money.sum(open.map((c) => outstandingOf(c)));
  const plan = planCover(open.map((c): OpenCollection => ({ ...c })), amount);
  return { unpaid, owedOrders: new Set(open.map((c) => c.orderId)).size, plan, orderOf };
}
type PayoutPlan = Awaited<ReturnType<typeof planPayout>>;

/**
 * Take the partner's balance row for this transaction by applying the real deposit to it (as verifying a deposit does):
 * the row lock makes two payouts or deposits of one partner run one after the other. `settle` corrects the part that
 * matched no collection.
 */
async function lockBalance(tx: TransactionClient, partnerId: number, amount: Money.Money) {
  const balance = await agentReconciliationService.getOrCreateBalance(partnerId, tx);
  await tx.agentBalance.update({
    where: { id: balance.id },
    data: { totalDeposited: { increment: amount }, currentBalance: { decrement: amount }, lastSettlementDate: new Date() },
  });
  return balance as { id: number };
}

interface SettleParams {
  settlement: PartnerSettlement;
  balanceId: number;
  partnerId: number;
  amount: Money.Money;
  depositDate: Date;
  method: 'partner_payout' | 'manual';
  actorId: number;
  planned: PayoutPlan;
  /** The settlement line that paid each order, to link its collection. */
  lineOfOrder: Map<number, number>;
  /** Sum of fee true-ups already applied to collections (a paid list); 0 for a manual payout. */
  trueUp?: Money.Money;
}

/**
 * The tail of every payout: one verified deposit for the amount, its entry (DR 1010, CR 1015, excess CR 2040) and cover
 * claims through the verified-deposit path, collections paid in full reconciled, the partner balance corrected for the
 * excess and the fee true-up, the short_pay Findings this clears closed.
 */
async function settle(tx: TransactionClient, p: SettleParams) {
  const { plan, orderOf } = p.planned;
  const deposit = await tx.agentDeposit.create({
    data: {
      tenantId: p.settlement.tenantId, agentId: p.partnerId, amount: p.amount, status: 'verified', depositDate: p.depositDate,
      depositMethod: p.method, referenceNumber: `PS${p.settlement.id}-${p.settlement.reference}`,
      verifiedAt: new Date(), verifiedById: p.actorId, settlementId: p.settlement.id,
    },
  });
  const { deposit: saved, excessFindingId } = await agentReconciliationService.settleDeposit(tx, deposit, p.actorId, plan);

  const full = plan.covers.filter((c) => c.allocated.plus(c.take).gte(c.amount));
  await agentReconciliationService.reconcileCollectionRows(
    tx,
    full.map((c) => ({ collectionId: c.id, orderId: orderOf.get(c.id)!, settlementLineId: p.lineOfOrder.get(orderOf.get(c.id)!) })),
    p.actorId,
  );

  const trueUp = p.trueUp ?? Money.ZERO;
  if (!plan.remaining.isZero() || !trueUp.isZero()) {
    await tx.agentBalance.update({
      where: { id: p.balanceId },
      data: {
        totalCollected: { decrement: trueUp },
        totalDeposited: { decrement: plan.remaining },
        currentBalance: { decrement: trueUp.minus(plan.remaining) },
      },
    });
  }
  await closeClearedShortPays(tx, p.partnerId, p.settlement.reference);
  return { deposit: saved, excessFindingId };
}

/** Run one payout in a transaction; announce it after commit; a repeated reference at once goes to `onDuplicate` with the first settlement. */
async function runSettlement<T>(
  partnerId: number,
  reference: string,
  work: (tx: TransactionClient) => Promise<T>,
  onDuplicate: (first: SettlementWithLines) => T,
): Promise<T> {
  try {
    const result = await prisma.$transaction(work, TRANSACTION_CONFIG);
    appEvents.emit(AppEvent.AGENT_COLLECTION_RECONCILED);
    return result;
  } catch (error) {
    // Two calls with one reference: the loser's insert waits for the winner, then hits the unique key
    if (isUniqueViolation(error)) {
      const winner = await findExisting(partnerId, reference);
      if (winner) return onDuplicate(winner);
    }
    throw error;
  }
}

/** One audit row per call, in the shape `runTool` writes for the same tool, so API and MCP calls read alike. */
const auditPayoutCall = (actor: SettlementActor, input: { partnerId: number; reference: string; lines: number }, view: SettlementView) =>
  auditService.record({
    actorId: actor.id, actorKind: 'person', channel: actor.auditChannel,
    action: 'tool_call', resource: 'tool', resourceId: 'partner_payout_record', tool: 'partner_payout_record', status: 'ok',
    input, after: { status: view.status, replayed: view.replayed },
  });

// ---- Record partner payout (the paid-order list) ----

interface PayoutContext { tenantId: string; currency: string; actor: SettlementActor; input: PartnerPayoutInput }

/** Batched true-up: the collections' cash and the orders' fee change to the real charge, each in one statement, row counts compared. */
async function applyTrueUps(
  tx: TransactionClient,
  items: Array<{ collection: NonNullable<OrderCandidate['collection']>; orderId: number; charge: Money.Money; diff: Money.Money }>,
): Promise<void> {
  if (items.length === 0) return;
  const tenantId = resolveTenantId();
  const collectionRows = Prisma.join(items.map((i) =>
    Prisma.sql`(${i.collection.id}::int, ${i.collection.amount.toFixed(4)}::numeric, ${i.collection.allocatedAmount.toFixed(4)}::numeric, ${i.collection.amount.minus(i.diff).toFixed(4)}::numeric)`));
  const claimed: Array<{ id: number }> = await tx.$queryRaw`
    UPDATE agent_collections AS c
    SET amount = v.new_amount, updated_at = now()
    FROM (VALUES ${collectionRows}) AS v(id, old_amount, alloc, new_amount)
    WHERE c.id = v.id AND c.tenant_id = ${tenantId} AND c.amount = v.old_amount AND c.allocated_amount = v.alloc
      AND c.status::text IN (${Prisma.join([...OPEN_COLLECTION_STATUSES])})
    RETURNING c.id`;
  if (claimed.length !== items.length) throw new AppError('Collections were changed by someone else. Reload and try again.', 409, 'COLLECTIONS_CHANGED');

  const orderRows = Prisma.join(items.map((i) => Prisma.sql`(${i.orderId}::int, ${i.charge.toFixed(4)}::numeric)`));
  await tx.$executeRaw`
    UPDATE orders AS o
    SET delivery_fee = v.fee, delivery_fee_source = 'settlement'::"DeliveryFeeSource", updated_at = now()
    FROM (VALUES ${orderRows}) AS v(id, fee)
    WHERE o.id = v.id AND o.tenant_id = ${tenantId}`;
}

async function applyPayout(tx: TransactionClient, { tenantId, currency, actor, input }: PayoutContext): Promise<SettlementView> {
  const { partnerId } = input;
  const settlement = await tx.partnerSettlement.create({
    data: {
      tenantId, partnerId, payoutDate: input.payoutDate, payoutAmount: input.payoutAmount, currency, reference: input.reference,
      status: 'unmatched', recordedById: actor.id, notes: input.notes,
    },
  });
  const balance = await lockBalance(tx, partnerId, input.payoutAmount);

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
  const changes: Parameters<typeof applyTrueUps>[1] = [];
  for (const { line, order } of matched) {
    const booked = order.deliveryFee ?? Money.ZERO;
    const charge = Money.parse(line.charge);
    feeBooked = feeBooked.plus(booked);
    feeCharged = feeCharged.plus(charge);
    if (isChargeVariance(booked, charge)) variances.push({ lineId: line.id, orderId: order.id, booked, charge });
    const diff = charge.minus(booked);
    if (diff.isZero()) continue;
    changes.push({ collection: order.collection!, orderId: order.id, charge, diff });
    trueUp = trueUp.plus(diff);
  }
  await applyTrueUps(tx, changes);
  await GLAutomationService.createFeeTrueUpEntry(tx as unknown as Prisma.TransactionClient, settlement, trueUp, actor.id, input.payoutDate);

  // 3. Cover the matched collections FIFO with the payout (read again after the true-up), reconcile, post one deposit
  const planned = await planPayout(tx, partnerId, input.payoutAmount, matched.map((m) => m.order.id));
  const { plan } = planned;
  const lineOfOrder = new Map(matched.map((m) => [m.order.id, m.line.id]));
  const { deposit, excessFindingId } = await settle(tx, {
    settlement, balanceId: balance.id, partnerId, amount: input.payoutAmount, depositDate: input.payoutDate,
    method: 'partner_payout', actorId: actor.id, planned, lineOfOrder, trueUp,
  });

  // 4. Status, and a Finding for every gap
  // What the list expects from this payout: each line's net less what an earlier payout already paid on its collection
  const expectedNet = Money.sum(matched.map((m) => Prisma.Decimal.max(Money.sub(Money.sub(m.line.expAmount, m.line.charge), m.order.collection!.allocatedAmount), Money.ZERO)));
  const unmatchedLines = lines.filter((l) => !l.matched);
  const outcome = settlementOutcome({ unmatchedLines: unmatchedLines.length, payout: input.payoutAmount, expectedNet });
  const needsReview = isChargeVariance(feeBooked, feeCharged);

  const wanted: Array<Prisma.FindingUncheckedCreateInput> = [];
  const want = (type: Prisma.FindingUncheckedCreateInput['type'], subjectType: string, subjectId: number, amount: Money.Money, note: string) =>
    wanted.push({ tenantId, type, subjectType, subjectId: String(subjectId), amount, note });
  if (outcome.shortAmount.gt(0)) {
    want('short_pay', 'partner_settlement', settlement.id, outcome.shortAmount,
      `Settlement ${input.reference}: the payout of ${Money.toApi(input.payoutAmount)} is ${Money.toApi(outcome.shortAmount)} less than the ${Money.toApi(expectedNet)} the list expects.`);
  }
  // Cash above the open collections is already reported by the deposit entry as excess_deposit
  if (outcome.overAmount.gt(0) && plan.remaining.isZero()) {
    want('over_pay', 'partner_settlement', settlement.id, outcome.overAmount,
      `Settlement ${input.reference}: the payout of ${Money.toApi(input.payoutAmount)} is ${Money.toApi(outcome.overAmount)} more than the ${Money.toApi(expectedNet)} the list expects.`);
  }
  for (const line of unmatchedLines) {
    want('unmatched_line', 'settlement_line', line.id, Money.sub(line.expAmount, line.charge),
      `Settlement ${input.reference}, line "${line.externalOrderRef}": ${line.note ?? 'no order matches'}.`);
  }
  for (const v of variances) {
    want('charge_variance', 'settlement_line', v.lineId, v.charge.minus(v.booked).abs(),
      `Settlement ${input.reference}, order #${v.orderId}: the partner charged ${Money.toApi(v.charge)}, the fee booked was ${Money.toApi(v.booked)}.`);
  }
  const ids = await openFindingsOnce(wanted, tx);
  const findings: FindingRef[] = wanted.map((w, i) => ({ type: w.type, id: ids[i] }));
  if (excessFindingId !== null) findings.push({ type: 'excess_deposit', id: excessFindingId });
  findings.sort((a, b) => a.id - b.id);

  const payload: SettlementPayload = { input, findings };
  const updated = await tx.partnerSettlement.update({
    where: { id: settlement.id },
    data: {
      expectedNet, shortAmount: outcome.shortAmount, unappliedAmount: plan.remaining, status: outcome.status, needsReview,
      depositId: deposit.id, payload: payload as unknown as Prisma.InputJsonValue,
    },
    include: { lines: { orderBy: { id: 'asc' } } },
  });
  return settlementView(updated, { warnings: plan.remaining.gt(0) ? [unappliedWarning(currency, plan.remaining, 'of the payout matched no open order and is')] : [] });
}

/**
 * Record a partner payout from a paid-order list (already parsed with `partnerPayoutSchema`). Checks the currency and the
 * partner, then runs `applyPayout` in one transaction. A repeat of (partner, reference) returns the first result with
 * `replayed: true` and changes nothing. One audit row per call when the actor carries an audit channel (the API route).
 */
export async function recordPartnerPayout(actor: SettlementActor, input: PartnerPayoutInput): Promise<SettlementView> {
  const tenantId = resolveTenantId();
  const currency = await getCurrency();
  if (input.currency && input.currency !== currency) {
    throw new AppError(`This store is paid in ${currency}. A payout in ${input.currency} cannot be recorded.`, 400, 'CURRENCY_MISMATCH');
  }
  await loadPartner(input.partnerId);

  const first = await findExisting(input.partnerId, input.reference);
  const view = first
    ? replayView(first, currency)
    : await runSettlement(input.partnerId, input.reference, (tx) => applyPayout(tx, { tenantId, currency, actor, input }), (winner) => replayView(winner, currency));
  if (actor.auditChannel) await auditPayoutCall(actor, { partnerId: input.partnerId, reference: input.reference, lines: input.lines.length }, view);
  return view;
}

// ---- Manual partner payout (F-908): FIFO to the oldest unpaid orders ----

/** What a manual payout of `amount` would do, with no write: the orders covered FIFO, the amount applied, the amount held as unapplied (F-908, T37). */
export async function previewManualPayout(input: ManualPreviewInput) {
  const currency = await getCurrency();
  await loadPartner(input.partnerId);
  const { unpaid, plan, orderOf } = await planPayout(prisma, input.partnerId, input.amount);
  return {
    partnerId: input.partnerId,
    amount: Money.toApi(input.amount),
    unpaidTotal: Money.toApi(unpaid),
    appliedAmount: Money.toApi(plan.matched),
    unappliedAmount: Money.toApi(plan.remaining),
    leftUnpaid: Money.toApi(Prisma.Decimal.max(unpaid.minus(plan.matched), Money.ZERO)),
    orders: plan.covers.map((c) => ({
      orderId: orderOf.get(c.id)!,
      applied: Money.toApi(c.take),
      clearsOrder: c.allocated.plus(c.take).gte(c.amount),
    })),
    warnings: plan.remaining.gt(0) ? [unappliedWarning(currency, plan.remaining, 'will be')] : [],
  };
}

/**
 * Money from a partner with no paid-order list. The amount clears the partner's oldest unpaid orders first (FIFO); what is
 * left is held in 2040 and the response says how much. Same postings as a payout list: one verified deposit, collections
 * paid in full become reconciled. A reference already used for the partner is 409 with the date it was used.
 */
export async function recordManualPayout(actor: SettlementActor, input: ManualPayoutInput): Promise<SettlementView> {
  const tenantId = resolveTenantId();
  const { partnerId, amount, reference } = input;
  const payoutDate = input.payoutDate ?? new Date();
  const currency = await getCurrency();
  await loadPartner(partnerId);

  const view = await runSettlement(partnerId, reference, async (tx) => {
    const settlement = await tx.partnerSettlement.create({
      data: { tenantId, partnerId, payoutDate, payoutAmount: amount, currency, reference, status: 'matched', isManual: true, recordedById: actor.id, notes: input.notes },
    });
    const balance = await lockBalance(tx, partnerId, amount);

    // FIFO over the partner's open collections, read after the lock: the plan the preview shows
    const planned = await planPayout(tx, partnerId, amount);
    const { unpaid, owedOrders, plan, orderOf } = planned;
    await tx.partnerSettlementLine.createMany({
      data: plan.covers.map((c) => ({
        tenantId, settlementId: settlement.id, orderId: orderOf.get(c.id)!, externalOrderRef: `#${orderOf.get(c.id)}`,
        expAmount: c.take, charge: Money.ZERO, matched: true, matchedBy: 'fifo', outcome: 'delivered' as const,
      })),
    });
    const lines = await tx.partnerSettlementLine.findMany({ where: { settlementId: settlement.id }, orderBy: { id: 'asc' } });
    const { deposit, excessFindingId } = await settle(tx, {
      settlement, balanceId: balance.id, partnerId, amount, depositDate: payoutDate, method: 'manual', actorId: actor.id,
      planned, lineOfOrder: new Map(lines.map((l) => [l.orderId!, l.id])),
    });

    const payload: SettlementPayload = { findings: excessFindingId === null ? [] : [{ type: 'excess_deposit', id: excessFindingId }], owedOrders };
    const updated = await tx.partnerSettlement.update({
      where: { id: settlement.id },
      data: { expectedNet: unpaid, unappliedAmount: plan.remaining, status: plan.remaining.gt(0) ? 'over' : 'matched', depositId: deposit.id, payload: payload as unknown as Prisma.InputJsonValue },
      include: { lines: { orderBy: { id: 'asc' } } },
    });
    return settlementView(updated, { warnings: plan.remaining.gt(0) ? [unappliedWarning(currency, plan.remaining, 'will be')] : [] });
  }, (winner) => {
    throw new AppError(`This reference was used on ${ymdOfUtc(winner.payoutDate)}`, 409, 'REFERENCE_USED');
  });

  await auditService.record({
    actorId: actor.id, actorKind: 'person', channel: 'app',
    action: 'create', resource: 'partner_settlement', resourceId: String(view.id),
    input: { partnerId, reference, amount: view.payoutAmount },
    after: { status: view.status, unappliedAmount: view.unappliedAmount },
  });
  return view;
}
