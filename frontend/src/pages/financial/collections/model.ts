import type { AgingBucket, PartnerDeposit } from '../../../services/collections.service';
import type { TagTone } from '../../../components/ui-v2';
import { AVATAR_TONES } from '../../../utils/people';
import { plural } from '../../dashboard/format';

export const daysText = (n: number): string => plural(n, 'day');
export const ordersText = (n: number): string => `${n.toLocaleString('en-GB')} ${n === 1 ? 'order' : 'orders'}`;

/** What the late buckets (the server's `late` flag: 8 days and older) of a bucket list hold: a partner's `buckets` or the summary's `bucketTotals`. */
export const lateOf = (buckets: AgingBucket[]): { amount: number; orders: number } =>
  buckets.filter((b) => b.late).reduce((t, b) => ({ amount: t.amount + b.amount, orders: t.orders + b.orders }), { amount: 0, orders: 0 });

/** Bar colour per age bucket, as the mockup: fresh is mint, then gold, the late ones coral. */
export const bucketColor = (b: Pick<AgingBucket, 'key' | 'late'>): string => (b.late ? 'var(--coral)' : b.key === '4-7' ? 'var(--gold)' : 'var(--mint)');

export const toneOf = (id: number): (typeof AVATAR_TONES)[number] => AVATAR_TONES[id % AVATAR_TONES.length];

/** Oldest unpaid order older than the partner's days to pay. */
export const isLateOldest = (oldest: number | null, daysToPay: number): boolean => oldest !== null && oldest > daysToPay;

/** The pay-ins that still wait to be verified. */
export const pendingOf = (deposits: PartnerDeposit[]): PartnerDeposit[] => deposits.filter((d) => d.status === 'pending');

export const DEPOSIT_TONE: Record<'pending' | 'verified' | 'rejected', TagTone> = { pending: 'warn', verified: 'ok', rejected: 'bad' };
export const depositLabel = (status: string): string => status.charAt(0).toUpperCase() + status.slice(1);

/** The reasons the review modal offers for a rejected pay-in (the mockup's list). Sent to the server as the reason text. */
export const REJECT_REASONS = [
  'Amount does not match the order list',
  'Receipt is unclear or edited',
  'No receipt attached',
  'Payment not found in MoMo or bank',
  'Other',
] as const;

/** The reason sent to the server: the picked sentence, with the note after it when there is one. */
export const rejectText = (reason: string, note: string): string => (note.trim() ? `${reason}: ${note.trim()}` : reason);

/** Orders a verified pay-in covered; null while pending (nothing is matched until it is verified). */
export const ordersCovered = (allocations: Array<{ collectionId: number }> | null | undefined): number | null =>
  allocations ? new Set(allocations.map((a) => a.collectionId)).size : null;

/** The file type shown beside the paperclip: "PDF", "JPG". */
export const receiptKind = (url: string): string => (url.split('?')[0].split('.').pop() ?? 'FILE').slice(0, 4).toUpperCase();

/** The file name of a receipt, from the end of its address. */
export const receiptName = (url: string): string => decodeURIComponent(url.split('?')[0].split('/').pop() ?? '') || 'Receipt';

/** Who paid a pay-in in: the name the server sent, or the partner's number when it sent none. */
export const partnerName = (d: { agentId: number; agent?: { firstName: string; lastName: string } }): string =>
  (d.agent ? `${d.agent.firstName} ${d.agent.lastName}`.trim() : '') || `Partner #${d.agentId}`;
