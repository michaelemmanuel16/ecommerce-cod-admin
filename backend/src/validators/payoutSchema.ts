import { z } from 'zod';
import { MONTH_RE } from '../services/kpi/dates';
import { MAX_PAYOUT_ENTRIES } from './partnerPayoutSchema';

/** Input of the payout routes for people (F-913, M5-T19): POST /api/payouts, GET /api/payouts and GET /api/payouts/owed. */

// Money in a request: "2034", "2034.50" or a number. The service parses it with the money helper.
const moneyInput = z.union([z.string().regex(/^\d+(\.\d{1,4})?$/, 'Amount must be a plain number'), z.number().finite()]);

// Strict on purpose: a payout never carries a delivery fee line (decision F4), so any unknown field is refused.
export const recordPayoutSchema = z.object({
  payeeId: z.number().int().positive(),
  amount: moneyInput.optional(),
  method: z.string().trim().min(1, 'Method is required').max(40),
  reference: z.string().trim().max(120).nullish(),
  payoutDate: z.coerce.date().optional(),
  notes: z.string().trim().max(500).nullish(),
  entryIds: z.array(z.number().int().positive()).max(MAX_PAYOUT_ENTRIES).optional(),
}).strict();

export const listPayoutsSchema = z.object({
  payeeId: z.coerce.number().int().positive().optional(),
  kind: z.enum(['rep', 'agent']).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export const owedQuerySchema = z.object({
  month: z.string().regex(MONTH_RE, 'Month must be written YYYY-MM').optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
});
