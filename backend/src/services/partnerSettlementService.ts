/**
 * Partner settlements (M5-T10; F-906): the one generic "record partner payout" action.
 *
 * An outside agent (or a person) sends the paid-order list and the payout for any delivery partner. The same service
 * runs behind `POST /api/partner-settlements` and the MCP tool `partner_payout_record`. There is no partner-specific
 * code here: a partner is a user with the delivery_agent role, nothing more.
 * Idempotent on (partner, reference): the same reference again returns the first result and changes nothing.
 */
import { Prisma, PartnerSettlement, PartnerSettlementLine } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { resolveTenantId } from '../utils/tenantContext';
import { getCurrency } from '../utils/currency';
import * as Money from '../utils/money';
import { loadPartner } from './deliveryPartnerAdminService';
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
export function settlementView(s: SettlementWithLines, extra: { replayed?: boolean; findings?: Array<{ id: number; type: string }>; warnings?: string[] } = {}) {
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

/**
 * Record a partner payout from a paid-order list (already parsed with `partnerPayoutSchema`). Checks the currency and the partner, then stores the settlement and its lines. A repeat of
 * (partner, reference) returns the first result with `replayed: true`.
 */
export async function recordPartnerPayout(actor: SettlementActor, input: PartnerPayoutInput): Promise<SettlementView> {
  const tenantId = resolveTenantId();

  const currency = await getCurrency();
  if (input.currency && input.currency !== currency) {
    throw new AppError(`This store is paid in ${currency}. A payout in ${input.currency} cannot be recorded.`, 400, 'CURRENCY_MISMATCH');
  }
  await loadPartner(input.partnerId);

  const first = await findExisting(input.partnerId, input.reference);
  if (first) return settlementView(first, { replayed: true });

  try {
    const stored = await prisma.$transaction(async (tx) => {
      const expectedNet = Money.sum(input.lines.map((l) => Money.sub(l.expAmount, l.charge ?? Money.ZERO)));
      const settlement = await tx.partnerSettlement.create({
        data: {
          tenantId,
          partnerId: input.partnerId,
          payoutDate: input.payoutDate,
          payoutAmount: input.payoutAmount,
          currency,
          reference: input.reference,
          expectedNet,
          status: 'unmatched',
          recordedById: actor.id,
          notes: input.notes,
          payload: input as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.partnerSettlementLine.createMany({
        data: input.lines.map((l) => ({
          tenantId,
          settlementId: settlement.id,
          orderId: null,
          externalOrderRef: l.externalOrderRef,
          expAmount: l.expAmount,
          charge: l.charge ?? Money.ZERO,
        })),
      });
      return tx.partnerSettlement.findUniqueOrThrow({ where: { id: settlement.id }, include: { lines: { orderBy: { id: 'asc' } } } });
    });
    return settlementView(stored);
  } catch (error) {
    // Two calls with one reference: the loser's insert hits the unique key after the winner commits. It gets the winner's result.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const winner = await findExisting(input.partnerId, input.reference);
      if (winner) return settlementView(winner, { replayed: true });
    }
    throw error;
  }
}
