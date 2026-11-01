import type { Actuals, Attainment, AttainmentRow, Holder, RewardSettings, RoleRow, StatusKey, TreeNode } from '../../services/targets.service';
import type { TagTone } from '../../components/ui-v2';
import { MONTHS, compactMoney, initials, plural, wholeMoney } from '../dashboard/format';

// Display rules of the Targets page (M6-T15, F-1101 to F-1103). Nothing here calculates a KPI: the API sends the numbers and the
// status keys; this file turns them into the words of the mockup.

export const NO_PAYOUT = 'No payout';
export const VACANT = 'Vacant';
export const NO_DATA = 'No data for this metric';
export const SET_A_TARGET = 'Set a target';

export const monthName = (ym: string): string => MONTHS[Number(ym.slice(5, 7)) - 1];
export const shortMonth = (ym: string): string => monthName(ym).slice(0, 3);

export const STATUS_TONE: Record<StatusKey, TagTone> = {
  revenue_hit: 'ok', hit_margin_missed: 'warn', ahead: 'ok', on_track: 'ok', behind: 'warn',
};

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

/** The tag of the North Star card: "77% done · 3 pts behind · margin 12% of 35%". */
export function northStarTag(node: TreeNode, marginTarget: number): { text: string; tone: TagTone } | null {
  const a = node.actuals;
  if (!a || a.state === 'future' || a.percent === null) return null;
  const parts = [`${Math.round(a.percent)}% done`, chipText(a.chip), `margin ${marginText(a.marginPct, marginTarget)}`].filter(Boolean);
  return { text: parts.join(' · '), tone: a.status ? STATUS_TONE[a.status.key] : 'n' };
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

/** The ymd bounds of a month node, for the Finance date control. */
export const monthBounds = (node: Pick<TreeNode, 'periodStart' | 'periodEnd'>) => ({ from: node.periodStart, to: node.periodEnd });

// ---- Role groups -------------------------------------------------------------------------------------------------------

export interface HolderLine {
  holder: Holder;
  initials: string;
  /** Their target in words ("423 confirmed and delivered"), or null when none is set. */
  targetText: string | null;
  row: AttainmentRow | null;
  /** Bar width, percent (capped at 100); null = no bar. */
  bar: number | null;
  detail: string;
  status: { label: string; tone: TagTone } | null;
  reward: string;
  targetId: number | null;
}

export interface RoleGroup {
  role: RoleRow;
  holderCount: string;
  vacant: boolean;
  roleTargetText: string | null;
  /** The group bar: sum of the holders' actuals against the role target; only for count targets. */
  bar: { percent: number; text: string } | null;
  lines: HolderLine[];
}

const unitWords = (metric: string | null, unit: string | null): string => {
  if (metric === 'delivery_success_rate' || unit === 'percent') return '% delivery success';
  if (metric === 'revenue' || unit === 'money') return '';
  return ' confirmed and delivered';
};

/** "423 confirmed and delivered", "60% delivery success", "GH₵100,000". */
export function targetWords(t: { metric: string; unit: string; value: number }, currency: string): string {
  if (t.metric === 'revenue' || t.unit === 'money' || t.unit === 'currency') return wholeMoney(t.value, currency);
  return `${new Intl.NumberFormat('en-GB').format(t.value)}${unitWords(t.metric, t.unit)}`;
}

/** Ahead / On track / Behind against how much of the month is gone (the same 3-point split as the Dashboard). */
export function attainmentStatus(percent: number | null, pace: number | null): { label: string; tone: TagTone } | null {
  if (percent === null) return null;
  if (percent >= 100) return { label: 'Hit', tone: 'ok' };
  if (pace === null) return { label: 'On track', tone: 'n' };
  const gap = percent - pace;
  if (gap >= 3) return { label: 'Ahead', tone: 'ok' };
  return gap >= 0 ? { label: 'On track', tone: 'ok' } : { label: 'Behind', tone: percent < pace - 3 ? 'bad' : 'warn' };
}

const rewardLine = (role: RoleRow, holder: Holder, row: AttainmentRow | null, settings: RewardSettings | null, currency: string): string => {
  if (holder.kind !== 'person' || (row && !row.payout)) return NO_PAYOUT;
  const tier = settings?.tiers.find((t) => t.roleId === role.roleId)?.tier100;
  if (!tier || !tier.payout) return '—';
  return `${wholeMoney(tier.amount, currency)} bonus`;
};

/**
 * One group per role that has a role target or a holder. Progress and status come from the attainment (T09), the reward at 100% from
 * the Rewards setting: nothing is typed here. A role with no holder reads "Vacant". An AI agent or a company sits in its role's group
 * and shows "No payout".
 */
export function buildGroups(roles: RoleRow[], attainment: Attainment | null, settings: RewardSettings | null, pace: number | null, currency: string): RoleGroup[] {
  return roles
    .filter((r) => r.target !== null || r.holders.length > 0)
    .map((role) => {
      const rows = new Map((attainment?.results ?? []).filter((a) => a.roleId === role.roleId).map((a) => [a.userId, a]));
      const lines = role.holders.map((holder): HolderLine => {
        const row = rows.get(holder.userId) ?? null;
        const mine = holder.target;
        const percent = row?.percent ?? null;
        const noData = row?.warning === NO_DATA;
        const detail = !mine ? ''
          : noData ? NO_DATA
            : row && row.actual !== null && row.target !== null ? `${row.actual} of ${row.target}${row.unit === 'percent' ? '%' : ''}` : '—';
        return {
          holder, initials: initials(holder.name), targetText: mine ? targetWords(mine, currency) : null, row,
          bar: percent === null ? null : Math.min(percent, 100), detail,
          status: noData ? null : attainmentStatus(percent, pace), reward: rewardLine(role, holder, row, settings, currency), targetId: mine?.id ?? null,
        };
      });
      const counted = lines.filter((l) => l.row?.target && l.row.unit !== 'percent' && l.row.actual !== null);
      const roleTarget = role.target?.value ?? null;
      const bar = roleTarget && counted.length > 0
        ? (() => {
          const done = counted.reduce((n, l) => n + (l.row!.actual ?? 0), 0);
          const percent = Math.round((done / roleTarget) * 100);
          return { percent, text: `${done} of ${roleTarget} · ${percent}% of role target` };
        })()
        : null;
      return {
        role, holderCount: plural(role.holders.length, 'holder'), vacant: role.holders.length === 0,
        roleTargetText: role.target ? `Role target: ${targetWords(role.target, currency)}` : null, bar, lines,
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

/** The metrics the form offers: those of a role or person target, and the daily activity metrics (F-1103). */
export const METRICS: Record<TargetScopeChoice, Array<{ key: string; label: string; unit: string }>> = {
  role: [{ key: 'revenue', label: 'Delivered revenue', unit: 'money' }, { key: 'delivered_orders', label: 'Confirmed orders that get delivered', unit: 'count' }, { key: 'delivery_success_rate', label: 'Delivery success rate', unit: 'percent' }],
  person: [{ key: 'revenue', label: 'Delivered revenue', unit: 'money' }, { key: 'delivered_orders', label: 'Confirmed orders that get delivered', unit: 'count' }, { key: 'delivery_success_rate', label: 'Delivery success rate', unit: 'percent' }],
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
