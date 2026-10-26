import type { BucketKey } from '../../../services/collections.service';
import { AVATAR_TONES } from '../../../utils/people';

export const daysText = (n: number): string => `${n.toLocaleString('en-GB')} ${n === 1 ? 'day' : 'days'}`;
export const ordersText = (n: number): string => `${n.toLocaleString('en-GB')} ${n === 1 ? 'order' : 'orders'}`;

/** Bar colour per age bucket, as the mockup: fresh is mint, then gold, the two oldest coral. */
export const BUCKET_COLOR: Record<BucketKey, string> = {
  '0-3': 'var(--mint)',
  '4-7': 'var(--gold)',
  '8-14': 'var(--coral)',
  '15+': 'var(--coral)',
};

export const toneOf = (id: number): (typeof AVATAR_TONES)[number] => AVATAR_TONES[id % AVATAR_TONES.length];

/** Oldest unpaid order older than the partner's days to pay. */
export const isLateOldest = (oldest: number | null, daysToPay: number): boolean => oldest !== null && oldest > daysToPay;
