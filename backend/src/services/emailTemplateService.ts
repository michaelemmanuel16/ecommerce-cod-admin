import sanitizeHtml from 'sanitize-html';
import prisma from '../utils/prisma';
import { tenantStorage } from '../utils/tenantContext';
import { escapeHtml } from '../utils/sanitizer';

/**
 * EmailTemplate rendering + sanitization (MAN-78).
 *
 * One reusable email object (subject + HTML body + merge tags) is shared by both
 * workflow send_email actions (MAN-79) and bulk campaigns (P2). This service owns:
 *  - sanitizing admin-authored HTML bodies on save (allowlist),
 *  - rendering the six merge tags into a final subject + HTML, escaping every value.
 */

// The six supported merge tags (mirrors Salesgee Variables).
export const EMAIL_MERGE_TAGS = [
  'customer_name',
  'customer_email',
  'store_name',
  'order_number',
  'order_total',
  'download_url',
] as const;

export type EmailMergeTag = (typeof EMAIL_MERGE_TAGS)[number];

export type EmailMergeContext = Partial<Record<EmailMergeTag, string | number | null | undefined>>;

// Precompiled once — rendering runs per email (and per recipient in bulk), so we
// don't recompile these on every call. `String.replace` resets `lastIndex`, so a
// shared global regex is safe to reuse across renders.
const MERGE_TAG_PATTERNS: Record<EmailMergeTag, RegExp> = Object.fromEntries(
  EMAIL_MERGE_TAGS.map((tag) => [tag, new RegExp(`{{\\s*${tag}\\s*}}`, 'g')]),
) as Record<EmailMergeTag, RegExp>;

// Accepted CSS color values (hex / rgb() / named) — shared by color + background-color.
const COLOR_VALUE_PATTERNS = [/^#(0x)?[0-9a-f]+$/i, /^rgb\(/i, /^[a-z-]+$/i];

// Allowlist for admin-authored bodies. No script/style/iframe/event-handlers — those
// are stripped. Formatting, links, images, lists and simple tables are kept.
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'hr', 'span', 'div', 'strong', 'b', 'em', 'i', 'u', 's',
    'a', 'img', 'ul', 'ol', 'li', 'blockquote',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
    '*': ['style'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  // Force safe link behaviour; drop disallowed style props at the parser level.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
  allowedStyles: {
    '*': {
      color: COLOR_VALUE_PATTERNS,
      'background-color': COLOR_VALUE_PATTERNS,
      'text-align': [/^left$|^right$|^center$|^justify$/],
      'font-weight': [/^\d+$|^bold$|^normal$/],
      'font-size': [/^\d+(?:px|em|rem|%)$/],
      padding: [/^[\d.]+(?:px|em|rem|%)(?:\s+[\d.]+(?:px|em|rem|%)){0,3}$/],
      margin: [/^[\d.]+(?:px|em|rem|%)(?:\s+[\d.]+(?:px|em|rem|%)){0,3}$/],
    },
  },
};

/** Sanitize an admin-authored HTML email body on save (H3). */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html ?? '', SANITIZE_OPTIONS);
}

/**
 * Substitute `{{tag}}` (any inner whitespace) for the six known merge tags.
 * Every value is HTML-escaped at substitution — safe even inside the HTML body.
 * Unknown/unsupported `{{...}}` tokens are left untouched so authors can spot typos.
 */
function renderMergeTags(input: string, context: EmailMergeContext): string {
  let out = input ?? '';
  for (const tag of EMAIL_MERGE_TAGS) {
    const value = context[tag];
    const escaped = escapeHtml(value === null || value === undefined ? '' : String(value));
    out = out.replace(MERGE_TAG_PATTERNS[tag], escaped);
  }
  return out;
}

/**
 * Render a stored template into a final subject + HTML body. Merge tags work in
 * the subject too. No re-sanitize here: stored bodies are already sanitized on save
 * (createEmailTemplate/updateEmailTemplate) and every merge value is HTML-escaped at
 * substitution, so substitution cannot reintroduce markup — re-parsing the whole body
 * per email would be pure cost.
 */
export function renderEmailTemplate(
  template: { subject: string; body: string },
  context: EmailMergeContext = {},
): { subject: string; html: string } {
  return {
    subject: renderMergeTags(template.subject, context),
    html: renderMergeTags(template.body, context),
  };
}

/**
 * Default starting templates, seeded as editable rows per tenant (see seed script).
 * Bodies use the {{merge_tag}} syntax and are kept deliberately simple HTML.
 */
export const DEFAULT_EMAIL_TEMPLATES: { name: string; subject: string; body: string }[] = [
  {
    name: 'Order Confirmation',
    subject: 'Order {{order_number}} confirmed — {{store_name}}',
    body: [
      '<p>Hi {{customer_name}},</p>',
      '<p>Thank you for your order with <strong>{{store_name}}</strong>.</p>',
      '<p>Your order <strong>{{order_number}}</strong> totalling <strong>{{order_total}}</strong> has been received and is being processed.</p>',
      '<p>We\'ll let you know as soon as it ships.</p>',
    ].join('\n'),
  },
  {
    name: 'Digital Delivery',
    subject: 'Your download is ready — {{store_name}}',
    body: [
      '<p>Hi {{customer_name}},</p>',
      '<p>Your purchase is complete. You can download your product using the link below:</p>',
      '<p><a href="{{download_url}}">Download now</a></p>',
      '<p>Thank you for buying from {{store_name}}.</p>',
    ].join('\n'),
  },
  {
    name: 'Status Update',
    subject: 'Update on your order {{order_number}}',
    body: [
      '<p>Hi {{customer_name}},</p>',
      '<p>There\'s an update on your order <strong>{{order_number}}</strong> from {{store_name}}.</p>',
      '<p>If you have any questions, just reply to this email.</p>',
    ].join('\n'),
  },
];

/**
 * Seed the default templates as editable rows for one tenant. Idempotent:
 * `skipDuplicates` is backed by the unique `(name, tenantId)` index, so re-running
 * never creates duplicates. Runs inside the tenant context so the Prisma extension
 * stamps the tenantId. Returns the number of rows actually inserted.
 */
export async function seedDefaultEmailTemplates(tenantId: string): Promise<number> {
  return tenantStorage.run({ tenantId }, async () => {
    const result = await prisma.emailTemplate.createMany({
      data: DEFAULT_EMAIL_TEMPLATES.map((t) => ({
        name: t.name,
        subject: t.subject,
        body: sanitizeEmailHtml(t.body),
      })),
      skipDuplicates: true,
    });
    return result.count;
  });
}
