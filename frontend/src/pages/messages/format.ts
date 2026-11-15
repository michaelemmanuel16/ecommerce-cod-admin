// Display-only helpers for Messages. Nothing here calculates a figure: it turns API values into words.
import type { Channel, MessageStatus } from './types';

export const CHANNEL_LABEL: Record<Channel, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' };

export const STATUS_LABEL: Record<MessageStatus, string> = {
  pending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Failed',
  replied: 'Replied',
  skipped: 'Not sent',
};

export const initials = (name: string): string => {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '#';
};

/** 94 -> "94%", null -> a dash (nothing was sent). */
export const rateText = (n: number | null | undefined): string => (n === null || n === undefined ? '-' : `${n}%`);

export const countText = (n: number): string => n.toLocaleString('en-US');

/** "14 Oct, 09:42" for a log row or a bubble time. */
export function stamp(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
