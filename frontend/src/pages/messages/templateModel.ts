// What the template form shows: the merge tags the API fills in, sample values for the preview, and the body limits.
// The tag list is EMAIL_MERGE_TAGS of backend emailTemplateService.ts: only an email is filled in by the API. A WhatsApp
// body has numbered variables ({{1}}) that Meta checks. SMS text goes out as written.
import type { Channel } from './types';

export const MERGE_TAGS: Array<{ tag: string; label: string; sample: string }> = [
  { tag: 'customer_name', label: 'Customer name', sample: 'Ama Mensah' },
  { tag: 'customer_email', label: 'Customer email', sample: 'ama.mensah@example.com' },
  { tag: 'store_name', label: 'Store name', sample: 'Your Store' },
  { tag: 'order_number', label: 'Order number', sample: '1042' },
  { tag: 'order_total', label: 'Order total', sample: 'GHS 249.00' },
  { tag: 'download_url', label: 'Download link', sample: 'https://example.com/download' },
  { tag: 'unsubscribe_url', label: 'Unsubscribe link', sample: 'https://example.com/unsubscribe' },
];

/** The body limit of each channel, from backend messageTemplateSchema BODY_LIMIT. */
export const BODY_LIMIT: Record<Channel, number> = { whatsapp: 1024, sms: 1600, email: 100 * 1024 };

const WHATSAPP_SAMPLES = ['Ama', 'Copybook set', '1042', 'GHS 249.00'];

/** The body with sample data in the place of its tags, for the live preview. A tag with no sample stays as written. */
export function previewText(channel: Channel, text: string): string {
  if (channel === 'sms') return text;
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, name: string) => {
    if (channel === 'whatsapp') {
      const n = Number(name);
      return Number.isInteger(n) && n > 0 ? (WHATSAPP_SAMPLES[n - 1] ?? `Sample ${n}`) : whole;
    }
    return MERGE_TAGS.find((t) => t.tag === name)?.sample ?? whole;
  });
}

/** The next free WhatsApp variable number of a body: {{1}}, {{2}} used, so 3. */
export function nextVariable(body: string): number {
  const used = Array.from(body.matchAll(/\{\{\s*(\d+)\s*\}\}/g), (m) => Number(m[1]));
  return used.length ? Math.max(...used) + 1 : 1;
}

export const STATUS_TEXT: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'n' }> = {
  approved: { label: 'Approved', tone: 'ok' },
  pending: { label: 'Pending', tone: 'warn' },
  rejected: { label: 'Rejected', tone: 'bad' },
  paused: { label: 'Paused', tone: 'n' },
};
