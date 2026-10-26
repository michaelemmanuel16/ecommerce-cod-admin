import { Response } from 'express';
import { AuthRequest } from '../types';
import {
  parseManualPayout, parseManualPreview, parsePartnerPayout, previewManualPayout, recordManualPayout, recordPartnerPayout,
} from '../services/partnerSettlementService';

/**
 * POST /api/partner-settlements: record a partner payout from a paid-order list (F-906). Any outside agent with a key
 * that holds `payouts:create` can call it for any delivery partner. 201 when created, 200 for a repeated reference.
 * The input format is written in `validators/partnerPayoutSchema.ts` and docs/features/m5-settlement-and-finance.md.
 * The service writes the audit row of the call.
 */
export const record = async (req: AuthRequest, res: Response): Promise<void> => {
  const settlement = await recordPartnerPayout({ id: req.user!.id, auditChannel: 'connector' }, parsePartnerPayout(req.body));
  res.status(settlement.replayed ? 200 : 201).json({ settlement });
};

/**
 * POST /api/partner-settlements/manual { partnerId, amount, payoutDate?, reference, notes? }: money from a partner with
 * no paid-order list (F-908). FIFO to the partner's oldest unpaid orders; what is left over is held in 2040 and the
 * response says how much (`unappliedAmount`, `warnings`). 201 when saved; a used reference is 409.
 */
export const recordManual = async (req: AuthRequest, res: Response): Promise<void> => {
  res.status(201).json({ settlement: await recordManualPayout({ id: req.user!.id }, parseManualPayout(req.body)) });
};

/** POST /api/partner-settlements/manual/preview { partnerId, amount }: the FIFO plan the manual payout would follow, with no write. */
export const previewManual = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json({ preview: await previewManualPayout(parseManualPreview(req.body)) });
};
