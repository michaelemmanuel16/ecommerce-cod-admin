import type { Actuals, Attainment, AttainmentRow, Holder, RewardSettings, RoleRow, StatusKey, TreeNode } from '../../services/targets.service';
import type { TagTone } from '../../components/ui-v2';
import { MONTHS, compactMoney, initials, monthName as monthOfDay, plural, wholeMoney } from '../dashboard/format';

// Display rules of the Targets page (M6-T15, F-1101 to F-1103). Nothing here calculates a KPI: the API sends the numbers and the
// status keys; this file turns them into the words of the mockup. One status key gives one tone, for the pill and the bar alike.

export const NO_PAYOUT = 'No payout';
export const VACANT = 'Vacant';
export const NO_DATA = 'No data for this metric';
export const SET_A_TARGET = 'Set a target';
export const NEEDS_SETTINGS = 'Needs Settings access';

const NUMBER = new Intl.NumberFormat('en-GB');
export const formatCount = (n: number): string => NUMBER.format(n);

/** "October" from 'YYYY-MM'. */
export const monthName = (ym: string): string => monthOfDay(`${ym}-01`);
export const shortMonth = (ym: string): string => MONTHS[Number(ym.slice(5, 7)) - 1].slice(0, 3);

export const STATUS_TONE: Record<StatusKey, TagTone> = {
  revenue_hit: 'ok', hit_margin_missed: 'warn', ahead: 'ok', on_track: 'ok', behind: 'warn',
};
/** The bar of a progress cell has the tone of its status: ok is the default mint, warn is gold. */
export const barClass = (tone: TagTone | undefined): string => (tone === 'warn' ? 'gold' : tone === 'bad' ? 'coral' : '');

/** "12% of 35%" for a margin; "n/a" when the books hold nothing for the period. */
export const marginText = (pct: number | null, target: number): string => (pct === null ? 'n/a' : `${Math.round(pct)}% of ${target}%`);

/** The margin tag is red when the margin is under its target, green at or above, neutral when there is no data. */
export const marginTone = (pct: number | null, target: number): TagTone => (pct === null ? 'n' : pct < target ? 'bad' : 'ok');

/** "3 pts behind" / "1 pt ahead" / "on pace". */
export function chipText(chip: Actuals['chip']): string | null {
  if (!chip) return null;
  if (chip.tag === 'on_pace') return 'on pace';
  return `${chip.points} ${chip.points === 1 ? 'pt' : 'pts'} ${chip.tag}`;
}

/** The tag of the North Star card: "77% done · 3 pts behind · margin 12% of 35%". Its colour is the pace chip's: behind is gold. */
export function northStarTag(node: TreeNode, marginTarget: number): { text: string; tone: TagTone } | null {
  const a = node.actuals;
  if (!a || a.state === 'future' || a.percent === null) return null;
  const parts = [`${Math.round(a.percent)}% done`, chipText(a.chip), `margin ${marginText(a.marginPct, marginTarget)}`].filter(Boolean);
  return { text: parts.join(' · '), tone: a.chip?.tag === 'behind' ? 'warn' : 'ok' };
}

export const northStarTitle = (node: TreeNode, marginTarget: number, currency: string): string =>
  `${node.periodStart.slice(0, 4)} North Star: ${wholeMoney(node.value, currency)} delivered revenue at ${marginTarget}% margin`;

/** What a quarter or month shows under its name: "GH₵372k of 360k" once it has started, "GH₵360k target" before. */
export function progressLine(node: TreeNode, currency: string): string {
  const a = node.actuals;
  if (!a || a.state === 'future' || a.actual === null) return `${compactMoney(node.value, currency)} target`;
  return `${compactMoney(a.actual, currency)} of ${compactMoney(node.value, currency).replace(/^\D+/, '')}`;
}

/** The class of a month cell: hit / miss (past), cur (this month), plain (future: target only). */
export function monthClass(a: Actuals | undefined): 'hit' | 'miss' | 'cur' | '' {
  if (!a || a.state === 'future') return '';
  if (a.state === 'current') return 'cur';
  return a.status?.key === 'revenue_hit' || a.status?.key === 'hit_margin_missed' ? 'hit' : 'miss';
}

// ---- Role groups -------------------------------------------------------------------------------------------------------

export interface HolderLine {
  holder: Holder;
  initials: string;
  /** Their target in words ("423 confirmed and delivered"), or null when none is set. */
  targetText: string | null;
  row: AttainmentRow | null;
  /** Bar width, percent (capped at 100); null = no bar. */
  bar: number | null;
  /** The metric has no data source (T09 says so). */
  noData: boolean;
  detail: string;
  status: { key: StatusKey; label: string; tone: TagTone } | null;
  reward: string;
  /** Why the reward cell is a dash, when it is one. */
  rewardTitle?: string;
  targetId: number | null;
}

export interface RoleGroup {
  role: RoleRow;
  holderCount: string;
  vacant: boolean;
  roleTargetText: string;
  /** The group bar: sum of the holders' actuals against the role target; only for count targets. */
  bar: { percent: number; text: string } | null;
  lines: HolderLine[];
}

const unitWords = (metric: string | null, unit: string | null): string => {
  if (metric === 'delivery_success_rate' || unit === 'percent') return '% delivery success';
  return ' confirmed and delivered';
};

/** "423 confirmed and delivered", "60% delivery success", "GH₵100,000". */
export function targetWords(t: { metric: string; unit: string; value: number }, currency: string): string {
  if (t.metric === 'revenue' || t.unit === 'money' || t.unit === 'currency') return wholeMoney(t.value, currency);
  return `${formatCount(t.value)}${unitWords(t.metric, t.unit)}`;
}

const rewardLine = (role: RoleRow, holder: Holder, row: AttainmentRow | null, settings: RewardSettings | null, currency: string): Pick<HolderLine, 'reward' | 'rewardTitle'> => {
  if (holder.kind !== 'person' || (row && !row.payout)) return { reward: NO_PAYOUT };
  if (!settings) return { reward: '—', rewardTitle: NEEDS_SETTINGS };
  const tier = settings.tiers.find((t) => t.roleId === role.roleId)?.tier100;
  return !tier || !tier.payout ? { reward: '—' } : { reward: `${wholeMoney(tier.amount, currency)} bonus` };
};

/**
 * One group per role that has a role target or a holder. Progress and status come from the attainment (T09, the tree's status
 * words), the reward at 100% from the Rewards setting: nothing is typed here. A role with no holder reads "Vacant" once, in its header.
 * An AI agent or a company sits in its role's group and shows "No payout". A month that has not started has targets and no progress
 * (pass `attainment` null).
 */
export function buildGroups(roles: RoleRow[], attainment: Attainment | null, settings: RewardSettings | null, currency: string): RoleGroup[] {
  return roles
    .filter((r) => r.target !== null || r.holders.length > 0)
    .map((role) => {
      const rows = new Map((attainment?.results ?? []).filter((a) => a.roleId === role.roleId).map((a) => [a.userId, a]));
      const lines = role.holders.map((holder): HolderLine => {
        const row = rows.get(holder.userId) ?? null;
        const mine = holder.target;
        const noData = row?.warning === NO_DATA;
        const percent = row?.percent ?? null;
        const detail = !mine ? '' : noData ? NO_DATA : row && row.actual !== null && row.target !== null ? `${row.actual} of ${row.target}${row.unit === 'percent' ? '%' : ''}` : '—';
        return {
          holder, initials: initials(holder.name), targetText: mine ? targetWords(mine, currency) : null, row,
          bar: percent === null || noData ? null : Math.min(percent, 100), noData, detail,
          status: row?.status ? { ...row.status, tone: STATUS_TONE[row.status.key] } : null,
          ...rewardLine(role, holder, row, settings, currency), targetId: mine?.id ?? null,
        };
      });
      // A rate target (delivery success) is met by the holders' rates, so the role's rate is their average; a count or money target adds up
      const rate = role.target?.unit === 'percent';
      const counted = lines.filter((l) => l.row?.target && (l.row.unit === 'percent') === rate && l.row.actual !== null);
      const roleTarget = role.target?.value ?? null;
      const total = counted.reduce((n, l) => n + (l.row?.actual ?? 0), 0);
      const done = rate && counted.length > 0 ? Math.round(total / counted.length) : total;
      const percent = roleTarget ? Math.round((done / roleTarget) * 100) : 0;
      return {
        role, holderCount: plural(role.holders.length, 'holder'), vacant: role.holders.length === 0,
        roleTargetText: role.target ? `Role target: ${targetWords(role.target, currency)}` : `${SET_A_TARGET} for this role`,
        bar: roleTarget && counted.length > 0 ? { percent, text: `${done}${rate ? '%' : ''} of ${roleTarget}${rate ? '%' : ''} · ${percent}% of role target` } : null, lines,
      };
    });
}

// ---- Add and edit target ---------------------------------------------------------------------------------------------

export type TargetScopeChoice = 'role' | 'person' | 'daily';

export interface TargetForm {
  scope: TargetScopeChoice;
  roleId: string;
  userId: string;
  metric: string;
  /** 'YYYY-MM' for a role or person target, 'YYYY-MM-DD' for a daily one. */
  period: string;
  value: string;
}

const ROLE_METRICS = [
  { key: 'revenue', label: 'Delivered revenue', unit: 'money' },
  { key: 'delivered_orders', label: 'Confirmed orders that get delivered', unit: 'count' },
  { key: 'delivery_success_rate', label: 'Delivery success rate', unit: 'percent' },
];

/** The metrics the form offers: those of a role or person target (all sit under the revenue month), and the daily activity metrics (F-1103). */
export const METRICS: Record<TargetScopeChoice, Array<{ key: string; label: string; unit: string }>> = {
  role: ROLE_METRICS,
  person: ROLE_METRICS,
  daily: [{ key: 'failed_delivery_calls_per_day', label: 'Failed delivery calls', unit: 'count' }, { key: 'calls_made_per_day', label: 'Calls made', unit: 'count' }],
};

export const unitOf = (scope: TargetScopeChoice, metric: string): string => METRICS[scope].find((m) => m.key === metric)?.unit ?? 'count';

/** Field errors of the form; empty when it can be saved. The value must be more than 0. */
export function validateTarget(f: TargetForm): Partial<Record<keyof TargetForm, string>> {
  const errors: Partial<Record<keyof TargetForm, string>> = {};
  if (f.scope !== 'daily' && !f.roleId) errors.roleId = 'Choose a role';
  if (f.scope === 'person' && !f.userId) errors.userId = 'Choose a person';
  if (!METRICS[f.scope].some((m) => m.key === f.metric)) errors.metric = 'Choose a metric';
  const periodOk = f.scope === 'daily' ? /^\d{4}-\d{2}-\d{2}$/.test(f.period) : /^\d{4}-(0[1-9]|1[0-2])$/.test(f.period);
  if (!periodOk) errors.period = f.scope === 'daily' ? 'Choose a day' : 'Choose a month';
  const value = Number(f.value);
  if (f.value.trim() === '' || !Number.isFinite(value) || value <= 0) errors.value = 'Enter a value greater than 0';
  return errors;
}
