import type { BucketKey } from '../../../services/collections.service';
import type { TagTone } from '../../../components/ui-v2';
import { AVATAR_TONES } from '../../../utils/people';
import { plural } from '../../dashboard/format';

export const daysText = (n: number): string => plural(n, 'day');
export const ordersText = (n: number): string => `${n.toLocaleString('en-GB')} ${n === 1 ? 'order' : 'orders'}`;

/** The buckets that count as late: 8 days and older are coral in the card bars and in the partner table. */
const LATE_BUCKETS: readonly BucketKey[] = ['8-14', '15+'];
export const isLateBucket = (key: BucketKey): boolean => LATE_BUCKETS.includes(key);

/** Bar colour per age bucket, as the mockup: fresh is mint, then gold, the late ones coral. */
export const bucketColor = (key: BucketKey): string => (isLateBucket(key) ? 'var(--coral)' : key === '4-7' ? 'var(--gold)' : 'var(--mint)');

export const toneOf = (id: number): (typeof AVATAR_TONES)[number] => AVATAR_TONES[id % AVATAR_TONES.length];

/** Oldest unpaid order older than the partner's days to pay. */
export const isLateOldest = (oldest: number | null, daysToPay: number): boolean => oldest !== null && oldest > daysToPay;

export const DEPOSIT_TONE: Record<'pending' | 'verified' | 'rejected', TagTone> = { pending: 'warn', verified: 'ok', rejected: 'bad' };
export const depositLabel = (status: string): string => status.charAt(0).toUpperCase() + status.slice(1);
