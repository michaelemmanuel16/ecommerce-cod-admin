import { z } from 'zod';
import { normalizeInternationalPhone, normalizePhone } from '../utils/phone';

const channel = z.enum(['sms', 'whatsapp', 'email']);

/** GET /api/messages/opt-outs */
export const optOutListSchema = z.object({
  channel: channel.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** PUT /api/messages/opt-outs: add or remove one opt-out by phone (SMS, WhatsApp) or by email address (email). */
export const optOutWriteSchema = z.object({
  channel,
  optedOut: z.boolean(),
  phone: z.string().trim().min(1).max(40).optional(),
  email: z.string().trim().email('That email address is not valid').max(254).optional(),
}).superRefine((v, ctx) => {
  if (v.channel === 'email') {
    if (!v.email) ctx.addIssue({ code: 'custom', path: ['email'], message: 'An email opt-out needs an email address' });
    return;
  }
  if (!v.phone) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Enter a phone number' });
  else if (!normalizePhone(v.phone) && !normalizeInternationalPhone(v.phone)) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'That phone number is not valid. Use the full number, for example 024 555 0182 or +233 24 555 0182.' });
});
