import { z } from 'zod';
import { defineTool, registerToolDef } from './registry';
import { partnerPayoutSchema } from '../validators/partnerPayoutSchema';
import { recordPartnerPayout } from '../services/partnerSettlementService';

registerToolDef(defineTool({
  name: 'partner_payout_record',
  description:
    'Record a payout from a delivery partner (any 3PL company or agent) with its paid-order list. Matches each line to an order, ' +
    'reconciles the matched collections, posts one deposit for the payout, trues up each order\'s delivery fee from the line charge ' +
    'and opens a Finding for every gap. Idempotent: the same partnerId and reference again returns the first result. ' +
    'Input: partnerId, payoutDate (YYYY-MM-DD), payoutAmount (the lump sum received: cash collected minus charges), reference ' +
    '(the partner\'s payment reference), optional currency (must be the store currency) and notes, and lines (1 to 500): ' +
    '{ externalOrderRef, orderId?, expAmount (cash collected on the order), charge? (the fee the partner kept, 0 or more) }. ' +
    'Lines match by orderId, else by the order number in externalOrderRef, else by customer phone and expAmount. Money is a number or a decimal string.',
  input: partnerPayoutSchema as z.ZodType<z.infer<typeof partnerPayoutSchema>>,
  kind: 'write',
  money: true,
  handler: async (input, ctx, trace) => {
    const settlement = await recordPartnerPayout({ id: ctx.actorId }, input);
    trace.resourceId = String(settlement.id);
    trace.after = { status: settlement.status, replayed: settlement.replayed, payoutAmount: settlement.payoutAmount };
    return settlement;
  },
}));
