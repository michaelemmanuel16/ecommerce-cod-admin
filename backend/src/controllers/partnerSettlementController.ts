import { Response } from 'express';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { auditService } from '../services/auditService';
import { parsePartnerPayout, previewManualPayout, recordManualPayout, recordPartnerPayout } from '../services/partnerSettlementService';

/**
 * POST /api/partner-settlements: record a partner payout from a paid-order list (F-906). Any outside agent with a key
 * that holds `payouts:create` can call it for any delivery partner. 201 when created, 200 for a repeated reference.
 * The input format is written in `validators/partnerPayoutSchema.ts` and docs/features/m5-settlement-and-finance.md.
 */
export const record = async (req: AuthRequest, res: Response): Promise<void> => {
  const input = parsePartnerPayout(req.body);
  const settlement = await recordPartnerPayout({ id: req.user!.id }, input);
  // One audit row per call, like a tool call. The MCP path gets its row from runTool.
  await auditService.record({
    actorId: req.user!.id, actorKind: 'person', channel: 'connector',
    action: 'tool_call', resource: 'partner_settlement', resourceId: String(settlement.id), tool: 'partner_payout_record',
    status: 'ok',
    input: { partnerId: input.partnerId, reference: input.reference, lines: input.lines.length },
    after: { status: settlement.status, replayed: settlement.replayed },
  });
  res.status(settlement.replayed ? 200 : 201).json({ settlement });
};

/**
 * POST /api/partner-settlements/manual { partnerId, amount, payoutDate?, reference, notes? }: money from a partner with
 * no paid-order list (F-908). FIFO to the partner's oldest unpaid orders; what is left over is held in 2040 and the
 * response says how much (`unappliedAmount`, `warnings`). 201 when saved; a used reference is 409.
 */
export const recordManual = async (req: AuthRequest, res: Response): Promise<void> => {
  const body = req.body ?? {};
  const partnerId = Number(body.partnerId);
  if (!Number.isInteger(partnerId) || partnerId <= 0) throw new AppError('partnerId must be a delivery partner id', 400, 'INVALID_PARTNER');
  const settlement = await recordManualPayout({ id: req.user!.id }, { partnerId, amount: body.amount, payoutDate: body.payoutDate, reference: body.reference, notes: body.notes });
  await auditService.record({
    actorId: req.user!.id, actorKind: 'person', channel: 'app',
    action: 'create', resource: 'partner_settlement', resourceId: String(settlement.id),
    input: { partnerId, reference: settlement.reference, amount: settlement.payoutAmount },
    after: { status: settlement.status, unappliedAmount: settlement.unappliedAmount },
  });
  res.status(201).json({ settlement });
};

/** POST /api/partner-settlements/manual/preview { partnerId, amount }: the FIFO plan the manual payout would follow, with no write. */
export const previewManual = async (req: AuthRequest, res: Response): Promise<void> => {
  const partnerId = Number(req.body?.partnerId);
  if (!Number.isInteger(partnerId) || partnerId <= 0) throw new AppError('partnerId must be a delivery partner id', 400, 'INVALID_PARTNER');
  res.json({ preview: await previewManualPayout({ partnerId, amount: req.body?.amount }) });
};
