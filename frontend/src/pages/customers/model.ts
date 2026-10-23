import type { TagTone } from '../../components/ui-v2';
import { phoneOk } from '../../utils/phone';
import { personName } from '../../utils/people';
import type { CustomerRisk, CustomerRow, CustomerSegment } from '../../services/customers.service';

export const customerName = (c: Pick<CustomerRow, 'firstName' | 'lastName'>): string => personName(c);

/** Tabs of docs/mockups/v2/customers.html, in order. The ids are the URL values of `?segment=` (F-351). */
export const SEGMENT_TABS: Array<{ id: CustomerSegment; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'repeat', label: 'Repeat' },
  { id: 'first_time', label: 'First-time' },
  { id: 'refused_before', label: 'Refused before' },
  { id: 'not_reachable', label: 'Not reachable' },
];

export const isSegment = (v: string | null): v is CustomerSegment => SEGMENT_TABS.some((t) => t.id === v);

export const RISKS: CustomerRisk[] = ['low', 'watch', 'high'];
export const isRisk = (v: string | null): v is CustomerRisk => RISKS.includes(v as CustomerRisk);

export const RISK_LABEL: Record<CustomerRisk, string> = { low: 'Low', watch: 'Watch', high: 'High' };
export const RISK_TONE: Record<CustomerRisk, TagTone> = { low: 'ok', watch: 'warn', high: 'bad' };

/** F-350 footer sentence. */
export const RISK_RULE = 'Low means no refusals, watch means 1, high means 2 or more. At 3 refusals cash on delivery is off.';

/** "17 Oct", with the year when it is not this year. null: no order yet. */
export function lastOrderDate(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** Same rule as the API (validators.ts customerPhone): letters are an error, fewer than 9 digits is too short. */
export function phoneProblem(label: string, value: string): string | null {
  const text = value.trim();
  if (/[a-z]/i.test(text)) return `${label} can only have digits, spaces, + and dashes`;
  if (!phoneOk(text)) return `${label} needs at least 9 digits`;
  return null;
}
