import { z } from 'zod';
import { LOG_STATUS_FILTERS } from '../services/messaging/messageStats';

/** A date (2026-11-01) or a full ISO time. A date given as `to` covers that whole day. */
const dateInput = z.string().trim().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Use a date like 2026-11-01');

const base = {
  channel: z.enum(['sms', 'whatsapp', 'email']).optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
};

const parseRange = <T extends { from?: string; to?: string }>(v: T) => {
  const from = v.from ? new Date(v.from) : undefined;
  let to = v.to ? new Date(v.to) : undefined;
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(v.to!)) to = new Date(to.getTime() + 24 * 3600_000);
  return { from, to };
};

/** GET /api/messages/overview */
export const messageOverviewSchema = z.object(base).transform((v) => ({ channel: v.channel, ...parseRange(v) }));

/** GET /api/messages/log */
export const messageLogSchema = z.object({
  ...base,
  status: z.enum(LOG_STATUS_FILTERS).optional(),
  recipient: z.string().trim().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).transform((v) => ({ channel: v.channel, status: v.status, recipient: v.recipient, cursor: v.cursor, limit: v.limit, ...parseRange(v) }));
