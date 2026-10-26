import { Response } from 'express';
import { AuthRequest } from '../types';
import { auditService } from '../services/auditService';
import { parsePartnerPayout, recordPartnerPayout } from '../services/partnerSettlementService';

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
