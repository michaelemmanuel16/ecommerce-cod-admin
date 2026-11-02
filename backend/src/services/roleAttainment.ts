import type { TargetStatus } from './targetStatus';

/**
 * How far a role is toward its month target, from the attainment rows of its holders (M6-T25, was `buildGroups` and
 * `roleProgress` in the frontend). Pure: the one place this is summed, so the Targets page and the role cards show the same numbers.
 *
 *  - Only a holder with a target of the same kind as the role target (a rate against a rate, a count or money against a count) and a
 *    measured actual counts. A holder who has none is left out.
 *  - A rate target (delivery success) is met by the holders' rates, so the role's rate is their average; a count adds up.
 *  - No role target, or no counted holder: no figure (null).
 *  - The status is the holders' own words: "behind" wins when any holder is behind, else the first holder's word.
 */

export interface RoleAttainment {
  /** The sum of the holders' actuals, or their average for a rate. A whole number. */
  done: number;
  /** The role target. */
  target: number;
  /** done / target, whole percent. Not capped. */
  percent: number;
  /** The target is a rate (percent), so `done` and `target` are percents. */
  rate: boolean;
  status: { key: TargetStatus; label: string } | null;
}

export interface AttainmentLine {
  userId: number;
  /** The target of the row, as the attainment gives it ("723.00"), or null. */
  target: string | null;
  unit: string | null;
  actual: number | null;
  status: { key: TargetStatus; label: string } | null;
}

export function roleAttainmentOf(
  roleTarget: { unit: string; value: number } | null,
  holderIds: readonly number[],
  rows: ReadonlyMap<number, AttainmentLine>,
): RoleAttainment | null {
  if (!roleTarget || !roleTarget.value) return null;
  const lines = holderIds.map((id) => rows.get(id)).filter((r): r is AttainmentLine => r !== undefined);
  const rate = roleTarget.unit === 'percent';
  const counted = lines.filter((r) => Number(r.target) > 0 && (r.unit === 'percent') === rate && r.actual !== null);
  if (counted.length === 0) return null;
  const total = counted.reduce((n, r) => n + (r.actual ?? 0), 0);
  const done = rate ? Math.round(total / counted.length) : total;
  const statuses = lines.flatMap((r) => (r.status ? [r.status] : []));
  return {
    done, target: roleTarget.value, percent: Math.round((done / roleTarget.value) * 100), rate,
    status: statuses.find((s) => s.key === 'behind') ?? statuses[0] ?? null,
  };
}
