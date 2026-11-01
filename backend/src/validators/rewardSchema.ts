import { z } from 'zod';
import * as Money from '../utils/money';
import { MONTH_RE } from '../services/kpi/dates';

/** Input of the rewards routes (M6-T09, F-1231, F-1110). */

const MAX_AMOUNT = 1_000_000_000;

/** A money amount from a number or a string; kept as given and parsed with Money in the service. */
const amount = z.union([z.number(), z.string()])
  .refine((v) => { const m = Money.tryParse(v); return m !== null && m.gte(0) && m.lte(MAX_AMOUNT); }, 'Amount must be a number from 0 to 1,000,000,000');

const tier = z.object({ amount, dayOff: z.boolean().optional() }).strict();

const percent = (max: number) => z.union([z.number(), z.string()])
  .refine((v) => { const m = Money.tryParse(v); return m !== null && m.gte(0) && m.lte(max); }, `Must be a number from 0 to ${max}`);

export const rewardSettingsSchema = z.object({
  /** Cash tiers of roles: the 100 percent and the 120 percent reward, both together. */
  tiers: z.array(z.object({ roleId: z.number().int().positive(), tier100: tier, tier120: tier }).strict()).max(100).optional(),
  /** Call rep pay: per delivered order the rep confirmed by call, and the share of the extra value they added. */
  repPay: z.object({ baseCommission: percent(MAX_AMOUNT), upsellPercent: percent(100) }).strict().optional(),
  /** Show the result badges (F-1109) on the screens. */
  badgesDisplay: z.boolean().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export type RewardSettingsInput = z.infer<typeof rewardSettingsSchema>;

export const attainmentQuerySchema = z.object({
  period: z.string().regex(MONTH_RE, 'Period must be a month like 2026-10').optional(),
  userId: z.coerce.number().int().positive().optional(),
  roleId: z.coerce.number().int().positive().optional(),
});

/** M6-T11: `GET /api/leaderboard`. `period`: today, week, month (default), year or a month like 2026-10. */
export const leaderboardQuerySchema = z.object({
  role: z.enum(['call_rep', 'delivery']),
  period: z.union([z.enum(['today', 'week', 'month', 'year']), z.string().regex(MONTH_RE, 'Period must be today, week, month, year or a month like 2026-10')]).optional(),
});

/** M6-T11: `GET /api/badges`. */
export const badgesQuerySchema = z.object({
  userId: z.coerce.number().int().positive().optional(),
  period: z.string().regex(MONTH_RE, 'Period must be a month like 2026-10').optional(),
});

/** F-1108: `GET /api/rewards/progress`. A person's attainment this month (or `period`). */
export const progressQuerySchema = z.object({
  userId: z.coerce.number().int().positive().optional(),
  period: z.string().regex(MONTH_RE, 'Period must be a month like 2026-10').optional(),
});
