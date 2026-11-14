import { z } from 'zod';

const channel = z.enum(['sms', 'whatsapp', 'email']);
const status = z.enum(['approved', 'pending', 'rejected', 'paused']);
const category = z.enum(['UTILITY', 'MARKETING', 'AUTHENTICATION']);

/** The body limit of each channel: Meta body 1024, SMS 10 segments, email 100 KB (the bulk send limit). */
export const BODY_LIMIT = { whatsapp: 1024, sms: 1600, email: 100 * 1024 } as const;

const fields = {
  name: z.string().trim().min(1).max(120),
  /** What the code finds the template by, for example auto_confirm. */
  key: z.string().trim().min(1).max(60).regex(/^[a-z0-9_]+$/, 'key is lower case letters, digits and underscores').nullable(),
  subject: z.string().trim().min(1).max(150).nullable(),
  body: z.string().trim().min(1),
  variables: z.array(z.string().trim().min(1).max(60)).max(30),
  // WhatsApp only
  language: z.string().trim().min(2).max(10),
  category,
  status,
  metaTemplateName: z.string().trim().min(1).max(512),
  components: z.array(z.record(z.string(), z.unknown())).max(10),
  quickReplies: z.array(z.string().trim().min(1).max(25)).max(3),
};

/** POST /api/message-templates */
export const templateCreateSchema = z.object({
  channel,
  name: fields.name,
  key: fields.key.optional(),
  subject: fields.subject.optional(),
  body: fields.body,
  variables: fields.variables.optional(),
  language: fields.language.optional(),
  category: fields.category.optional(),
  status: fields.status.optional(),
  metaTemplateName: fields.metaTemplateName.optional(),
  components: fields.components.optional(),
  quickReplies: fields.quickReplies.optional(),
}).superRefine((v, ctx) => {
  if (v.channel === 'email' && !v.subject) ctx.addIssue({ code: 'custom', path: ['subject'], message: 'An email template needs a subject' });
  if (v.channel !== 'whatsapp') {
    for (const f of ['language', 'category', 'status', 'metaTemplateName', 'components', 'quickReplies'] as const) {
      if (v[f] !== undefined) ctx.addIssue({ code: 'custom', path: [f], message: `${f} is for WhatsApp templates only` });
    }
  }
  if (v.channel !== 'email' && v.subject) ctx.addIssue({ code: 'custom', path: ['subject'], message: 'subject is for email templates only' });
  if (v.body.length > BODY_LIMIT[v.channel]) ctx.addIssue({ code: 'custom', path: ['body'], message: `The body is over ${BODY_LIMIT[v.channel]} characters` });
});

/** PUT /api/message-templates/:id (the channel never changes) */
export const templateUpdateSchema = z.object({
  name: fields.name.optional(),
  key: fields.key.optional(),
  subject: fields.subject.optional(),
  body: fields.body.optional(),
  variables: fields.variables.optional(),
  language: fields.language.optional(),
  category: fields.category.optional(),
  status: fields.status.optional(),
  metaTemplateName: fields.metaTemplateName.optional(),
  components: fields.components.optional(),
  quickReplies: fields.quickReplies.optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });

export const templateListSchema = z.object({
  channel: channel.optional(),
  status: status.optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
