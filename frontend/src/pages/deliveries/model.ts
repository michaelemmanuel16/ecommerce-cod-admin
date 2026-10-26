import type { TagTone } from '../../components/ui-v2';
import type { FeeBasis, FeeOutcome, FeeRule, FeeRulesResponse, PartnerDataSource, PartnerRow, PartnerTab, PartnerType, RateResult } from '../../services/delivery-partners.service';
import type { OrderStatus } from '../../types';
import { formatCurrency } from '../../utils/format';
import { AVATAR_TONES } from '../../utils/people';

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

/** True when the partner has a fee rule with at least one fee set. */
export const hasFeeRule = (rule: FeeRule | null | undefined): rule is FeeRule =>
  !!rule && (rule.delivered !== null || rule.failed !== null || rule.returned !== null);

/** "GH₵35 · GH₵0 · GH₵0" (delivered · failed · returned). null: the partner has no fee rule yet. */
export function feeRuleText(rule: FeeRule | null | undefined): string | null {
  if (!hasFeeRule(rule)) return null;
  return [rule.delivered, rule.failed, rule.returned].map((v) => formatCurrency(v ?? 0)).join(' · ');
}

/** Avatar tint of a partner. */
export const toneOf = (id: number): (typeof AVATAR_TONES)[number] => AVATAR_TONES[id % AVATAR_TONES.length];

/** The small tags after a partner name: trial, inactive, unavailable (F-709). */
export const rowTags = (row: Pick<PartnerRow, 'isActive' | 'isAvailable' | 'isTrial'>): Array<{ tone: TagTone; text: string }> => [
  ...(row.isTrial ? [{ tone: 'warn' as const, text: 'Trial' }] : []),
  ...(!row.isActive ? [{ tone: 'n' as const, text: 'Inactive' }] : []),
  ...(row.isActive && !row.isAvailable ? [{ tone: 'bad' as const, text: 'Unavailable' }] : []),
];

/** The order statuses a partner's closed work ends in: they can have a delivery proof and attempts. */
export const CLOSED_STATUSES: OrderStatus[] = ['delivered', 'failed_delivery', 'returned'];
export const isClosed = (status: OrderStatus): boolean => CLOSED_STATUSES.includes(status);

/** The one name of the fee on every screen (decision F1). */
export const DELIVERY_FEE = 'Delivery fee';

/** The fee per outcome as the table row carries it, read from the rules in force. */
export const feeRuleOf = (current: FeeRulesResponse['current']): FeeRule => ({
  delivered: current.delivered?.amount ?? null,
  failed: current.failed?.amount ?? null,
  returned: current.returned?.amount ?? null,
});

export const FEE_OUTCOMES: FeeOutcome[] = ['delivered', 'failed', 'returned'];
export const FEE_OUTCOME_LABEL: Record<FeeOutcome, string> = { delivered: 'Delivered', failed: 'Failed', returned: 'Returned' };

/** "GH₵25" for a flat delivery fee, "10%" for a percent of the order total. */
export const feeAmountText = (rule: { basis: FeeBasis; amount: string }): string =>
  rule.basis === 'percent' ? `${Number(rule.amount).toLocaleString('en-GB', { maximumFractionDigits: 2 })}%` : formatCurrency(rule.amount);
