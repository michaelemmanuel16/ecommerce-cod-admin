import { z } from 'zod';
import * as Money from '../utils/money';

/**
 * Input of "record partner payout" (F-906), one format for the API route and the MCP tool `partner_payout_record`.
 * It carries no partner-specific field: any outside agent can send it for any delivery partner.
 *
 *   { partnerId, payoutDate, payoutAmount, reference, currency?, notes?,
 *     lines: [{ externalOrderRef, orderId?, expAmount, charge? }] }
 *
 * - `payoutAmount`: the lump sum the partner paid (cash collected minus its charges). Above 0.
 * - `lines`: the paid-order list, 1 to MAX_PAYOUT_LINES rows. `expAmount` is the cash the partner collected on the order,
 *   `charge` what it kept as its fee (0 or more, default 0).
 * - Matching: by `orderId`, else by the order number in `externalOrderRef` (`1042`, `#1042`), else by the order's external
 *   id, else by customer phone and `expAmount` (a phone in `externalOrderRef`). The CodAdmin order id is the safest key.
 * - `reference`: the partner's payment reference. The same reference for the same partner returns the first result.
 * - `currency`: optional; when sent it must be the store currency.
 * Money is a number or a plain decimal string.
 */
export const MAX_PAYOUT_LINES = 500;

const money = (label: string, opts: { min: 'positive' | 'zero' }) =>
  z.union([z.number(), z.string()]).transform((v, ctx) => {
    const m = Money.tryParse(typeof v === 'string' ? v.trim() : v);
    if (!m) { ctx.addIssue({ code: 'custom', message: `${label} must be a number` }); return z.NEVER; }
    if (opts.min === 'positive' ? m.lte(0) : m.lt(0)) {
      ctx.addIssue({ code: 'custom', message: opts.min === 'positive' ? `${label} must be above 0` : `${label} cannot be negative` });
      return z.NEVER;
    }
    return m;
  });

/** A calendar day (YYYY-MM-DD) or a full ISO timestamp. */
const payoutDate = z.string().trim().refine(
  (v) => /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) && !Number.isNaN(new Date(v).getTime())
    && (v.length > 10 || new Date(`${v}T00:00:00.000Z`).toISOString().slice(0, 10) === v),
  'payoutDate must be a real date written YYYY-MM-DD',
).transform((v) => new Date(v.length === 10 ? `${v}T00:00:00.000Z` : v));

export const payoutLineSchema = z.object({
  externalOrderRef: z.string().trim().min(1, 'externalOrderRef is required').max(120),
  orderId: z.number().int().positive().optional(),
  expAmount: money('expAmount', { min: 'positive' }),
  charge: money('charge', { min: 'zero' }).optional(),
});

export const partnerPayoutSchema = z.object({
  partnerId: z.number().int().positive(),
  payoutDate,
  payoutAmount: money('payoutAmount', { min: 'positive' }),
  reference: z.string().trim().min(1, 'reference is required').max(120),
  currency: z.string().trim().length(3).transform((v) => v.toUpperCase()).optional(),
  notes: z.string().trim().max(500).optional(),
  lines: z.array(payoutLineSchema)
    .min(1, 'Send at least one line')
    .max(MAX_PAYOUT_LINES, `A payout takes at most ${MAX_PAYOUT_LINES} lines; send the rest as a second payout`),
}).superRefine((value, ctx) => {
  const seenOrders = new Set<number>();
  const seenRefs = new Set<string>();
  value.lines.forEach((line, index) => {
    if (line.orderId !== undefined) {
      if (seenOrders.has(line.orderId)) ctx.addIssue({ code: 'custom', path: ['lines', index, 'orderId'], message: `Order ${line.orderId} is listed twice` });
      seenOrders.add(line.orderId);
    }
    const ref = line.externalOrderRef.toLowerCase();
    if (seenRefs.has(ref)) ctx.addIssue({ code: 'custom', path: ['lines', index, 'externalOrderRef'], message: `${line.externalOrderRef} is listed twice` });
    seenRefs.add(ref);
  });
});

export type PartnerPayoutInput = z.infer<typeof partnerPayoutSchema>;
