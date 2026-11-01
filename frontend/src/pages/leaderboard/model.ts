// Display helpers of the Leaderboard page. Nothing here ranks or calculates a target: rank, percent, tier and distance come from the API.
import type { BoardPeriod, BoardRow } from '../../services/leaderboard.service';
import { MONTHS } from '../dashboard/format';

export const ROLE_TABS = [
  { id: 'call_rep', label: 'Call reps' },
  { id: 'delivery', label: 'Delivery' },
] as const;

const KIND_TAG: Record<string, string> = { ai_agent: 'AI agent', company: 'Company' };
export const kindTag = (kind: string): string | null => KIND_TAG[kind] ?? null;
export const avatarTone = (kind: string, index: number): string =>
  kind === 'ai_agent' ? 'violet' : kind === 'company' ? 'gold' : (['pine', 'coral', 'mint'] as const)[index % 3];

/** The period choices: Today, This week, this month by name, this year, and the three months before this one. */
export function periodOptions(today: string): Array<{ value: BoardPeriod; label: string }> {
  const [year, month] = today.split('-').map(Number);
  const past = [1, 2, 3].map((back) => {
    const d = new Date(Date.UTC(year, month - 1 - back, 1));
    return { value: d.toISOString().slice(0, 7), label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
  });
  return [
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'This week' },
    { value: 'month', label: MONTHS[month - 1] },
    { value: 'year', label: String(year) },
    ...past,
  ];
}

export const isPeriod = (value: string | null, options: Array<{ value: string }>): value is string => !!value && options.some((o) => o.value === value);

/** What an unranked row says instead of a rank: the API's reason in plain words. */
export function reasonLabel(row: BoardRow): string {
  if (row.reason === 'Set a target') return 'No target';
  return row.reason ?? '';
}

/** The ranked rows first, in the API's order; the others after them. The API sends them in this order already; kept as a guard. */
export function ranksFirst(rows: BoardRow[]): BoardRow[] {
  return [...rows.filter((r) => r.rank !== null), ...rows.filter((r) => r.rank === null)];
}

export const ordinal = (rank: number): string => {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;
  return `${rank}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[rank % 10] ?? 'th'}`;
};

/** Whole percent or one decimal, as the API sends it ("60", "91.6"). */
export const pct = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : `${v}%`);
