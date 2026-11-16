import { z } from 'zod';

/** GET /api/conversations */
export const conversationListSchema = z.object({
  status: z.enum(['open', 'done']).optional(),
  unanswered: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  assignedTo: z.union([z.enum(['me', 'none']), z.string().regex(/^\d+$/, 'assignedTo is me, none or a user id')]).optional(),
  channel: z.enum(['sms', 'whatsapp', 'email']).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** POST /api/conversations/:id/reply: free text, or an approved template from the templates list */
export const conversationReplySchema = z.object({
  body: z.string().trim().min(1).max(4096).optional(),
  templateId: z.number().int().positive().optional(),
  variables: z.array(z.string().max(1024)).max(20).optional(),
}).refine((v) => !!v.body !== !!v.templateId, { message: 'Send either body or a template' });

/** PATCH /api/conversations/:id */
export const conversationPatchSchema = z.object({
  assignedToId: z.number().int().positive().nullable().optional(),
  status: z.enum(['open', 'done']).optional(),
}).refine((v) => v.assignedToId !== undefined || v.status !== undefined, { message: 'Nothing to change' });

/** POST /api/conversations/start: the first message to the customer of an order */
export const conversationStartSchema = z.object({
  orderId: z.number().int().positive(),
  body: z.string().trim().min(1).max(4096).optional(),
  templateId: z.number().int().positive().optional(),
  variables: z.array(z.string().max(1024)).max(20).optional(),
}).refine((v) => !!v.body !== !!v.templateId, { message: 'Send either body or a template' });
