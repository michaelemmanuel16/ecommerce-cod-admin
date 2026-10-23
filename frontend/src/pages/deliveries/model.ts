import type { TagTone } from '../../components/ui-v2';
import type { FeeRule, PartnerDataSource, PartnerRow, PartnerTab, PartnerType, RateResult } from '../../services/delivery-partners.service';
import { formatCurrency } from '../../utils/format';

export const PARTNER_TABS: Array<{ id: PartnerTab; label: string }> = [
  { id: 'all', label: 'All partners' },
  { id: 'agent', label: 'Agents' },
  { id: '3pl', label: '3PLs' },
];

export const isPartnerTab = (v: string | null): v is PartnerTab => PARTNER_TABS.some((t) => t.id === v);

export const TYPE_LABEL: Record<PartnerType, string> = { agent: 'Agent', '3pl': '3PL' };
export const TYPE_TONE: Record<PartnerType, TagTone> = { agent: 'n', '3pl': 'v' };

/** F-700 / F-712: where a partner's delivery results come from. */
export const DATA_SOURCE_LABEL: Record<PartnerDataSource, string> = { app: 'Agent app', connector: 'Connector', csv: 'CSV upload' };
export const DATA_SOURCES: PartnerDataSource[] = ['app', 'connector', 'csv'];

/** F-707: the vehicle types of the Staff person modal. The API maps the old values (Motorcycle, Van, Truck) to these. */
export const VEHICLE_TYPES = ['Motorbike', 'Car', 'Tricycle', 'Bicycle', 'On foot'] as const;

/** The success bar and its figure: at or above the target is good, within 10 points under is a warning, below that is bad (F-702). */
export type RateTone = 'mint' | 'gold' | 'coral';
export const rateTone = (value: number, target: number): RateTone => (value >= target ? 'mint' : value >= target - 10 ? 'gold' : 'coral');

/** "48%": the API sends one decimal, the page shows whole percents (NUMBERS.md). null: no closed order yet. */
export const wholePercent = (rate: RateResult): string | null => (rate.value === null ? null : `${Math.round(rate.value)}%`);

/** "1.4 days", "—" for none. */
export const days = (n: number | null): string => (n === null ? '—' : `${n.toLocaleString('en-GB', { maximumFractionDigits: 1 })} ${n === 1 ? 'day' : 'days'}`);

export const count = (n: number | undefined): string => (n === undefined ? '—' : n.toLocaleString('en-GB'));

/** "GH₵35 · GH₵0 · GH₵0" (delivered · failed · returned). null: the partner has no fee rule yet. */
export function feeRuleText(rule: FeeRule | null | undefined): string | null {
  if (!rule || (rule.delivered === null && rule.failed === null && rule.returned === null)) return null;
  return [rule.delivered, rule.failed, rule.returned].map((v) => formatCurrency(v ?? 0)).join(' · ');
}

/** Initials and avatar tint of a partner. */
export const TONES = ['pine', 'gold', 'violet', 'coral', 'mint'] as const;
export const toneOf = (id: number): (typeof TONES)[number] => TONES[id % TONES.length];

/** The small tags after a partner name: trial, inactive, unavailable (F-709). */
export const rowTags = (row: Pick<PartnerRow, 'isActive' | 'isAvailable' | 'isTrial'>): Array<{ tone: TagTone; text: string }> => [
  ...(row.isTrial ? [{ tone: 'warn' as const, text: 'Trial' }] : []),
  ...(!row.isActive ? [{ tone: 'n' as const, text: 'Inactive' }] : []),
  ...(row.isActive && !row.isAvailable ? [{ tone: 'bad' as const, text: 'Unavailable' }] : []),
];

/** The order statuses a partner's closed work ends in. */
export const CLOSED_STATUSES = ['delivered', 'failed_delivery', 'returned'] as const;
