// Display-only helpers for Messages. Nothing here calculates a figure: it turns API values into words.
import type { TagTone } from '../../components/ui-v2';
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

export const STATUS_TONE: Record<MessageStatus, TagTone> = { pending: 'warn', sent: 'n', delivered: 'ok', read: 'ok', failed: 'bad', replied: 'v', skipped: 'n' };

export const initials = (name: string): string => {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '#';
};

/** 94 -> "94%", null -> a dash (nothing was sent). */
export const rateText = (n: number | null | undefined): string => (n === null || n === undefined ? '-' : `${n}%`);
