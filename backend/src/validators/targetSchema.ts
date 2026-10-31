import { z } from 'zod';

/** Input of the target routes (M6-T08, F-1100 to F-1103, F-1111 to F-1113). Strict: an unknown field is refused. */

const num = z.coerce.number().finite();
const year = z.coerce.number().int().min(2000).max(2100);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const metric = z.string().trim().min(1).max(60);
const unit = z.string().trim().min(1).max(20);

export const treeQuerySchema = z.object({ year, month: month.optional(), metric: metric.optional() }).strict();
export const poolQuerySchema = z.object({ month }).strict();
export const dailyQuerySchema = z.object({ metric, date: day, userId: z.coerce.number().int().positive().optional() }).strict();

/** Save one target: North Star, role, person or daily. A quarter or month is saved with PUT /:id/children. */
export const saveTargetSchema = z.object({
  scope: z.enum(['north_star', 'role', 'person', 'daily']),
  metric,
  unit,
  value: num.min(0),
  period: z.string().trim().max(10).optional(),
  roleId: z.number().int().positive().optional(),
  userId: z.number().int().positive().optional(),
}).strict();

export const updateTargetSchema = z.object({ value: num.min(0), unit: unit.optional() }).strict();

export const childrenSchema = z.object({
  children: z.array(z.object({ period: z.string().trim().max(10), value: num.min(0) }).strict()).min(1).max(12),
}).strict();

export const northStarSchema = z.object({
  year,
  annual: num,
  mode: z.enum(['even', 'grow', 'custom']),
  customQuarters: z.array(num.min(0)).length(4).optional(),
  plannedAov: num.optional(),
}).strict();

export const driversSchema = z.object({
  year,
  plannedAov: num.nullable().optional(),
  confirmationRate: num.optional(),
  deliverySuccessRate: num.optional(),
  netMargin: num.optional(),
}).strict();

export const driversQuerySchema = z.object({ year }).strict();

export const calculatorsQuerySchema = z.object({
  month: month.optional(),
  aov: num.optional(),
  confirmationRate: num.optional(),
  deliverySuccessRate: num.optional(),
  revenueTarget: num.optional(),
  profitPerOrder: num.optional(),
}).strict();
