import type { TagTone } from '../../components/ui-v2';
import type { PermissionGrid, RoleCard, RoleTool } from '../../services/roles.service';
import type { RewardSettings, Tree } from '../../services/targets.service';
import { STATUS_TONE, barClass, progressText, targetWords } from '../targets/model';

/** Display rules of the role cards (M6-T19, F-1151). Nothing here calculates a KPI: progress is the API's `roleAttainment` of the targets tree. */

/** A role card lists this many holders; more are behind "Show all". */
export const HOLDERS_SHOWN = 10;

/** What a card shows for the target: the role's target in words, or null when none is set for the month. */
export const targetOf = (card: RoleCard, currency: string): string | null => (card.target ? targetWords(card.target, currency) : null);

export interface RoleProgress {
  /** 0 to 100, for the bar. */
  percent: number;
  /** "376 of 723 · 52% of role target". */
  text: string;
  /** The bar colour class of the status ('' = default). */
  tone: string;
  status: { label: string; tone: TagTone } | null;
}

/** The progress of each role that has one, from the tree of the month (its `roleAttainment`): the bar, the words and the status tag. */
export function roleProgress(tree: Tree | null): Map<number, RoleProgress> {
  const out = new Map<number, RoleProgress>();
  for (const role of tree?.roles ?? []) {
    const ra = role.roleAttainment;
    if (!ra) continue;
    const tone = ra.status ? STATUS_TONE[ra.status.key] : undefined;
    out.set(role.roleId, {
      percent: Math.min(ra.percent, 100), text: progressText(ra.done, ra.target, ra.percent, ra.rate), tone: barClass(tone),
      status: ra.status && tone ? { label: ra.status.label, tone } : null,
    });
  }
  return out;
}

/** The switches after one is flipped, in the order of the API's tool list. */
export const flipTool = (on: readonly string[], key: string, catalog: readonly RoleTool[]): string[] => {
  const next = new Set(on);
  if (!next.delete(key)) next.add(key);
  return catalog.map((t) => t.key).filter((k) => next.has(k));
};

/** The cash tiers of a role's reward rule, 100% then 120%: a tier with an amount of 0 (a day off only) is not cash and is left out. */
export function cashTiers(row: RewardSettings['tiers'][number] | undefined): Array<{ key: '100' | '120'; amount: number }> {
  if (!row) return [];
  return ([['100', row.tier100], ['120', row.tier120]] as const)
    .flatMap(([key, tier]) => (tier && tier.amount > 0 ? [{ key, amount: tier.amount }] : []));
}

// ---- The Advanced permissions grid (F-1154) ----------------------------------------------------------------------------------

/** The grid with one cell flipped. A resource with no cell left stays as an empty list (an explicit "none"). */
export function toggleCell(grid: PermissionGrid, resource: string, action: string): PermissionGrid {
  const have = grid[resource] ?? [];
  return { ...grid, [resource]: have.includes(action) ? have.filter((a) => a !== action) : [...have, action] };
}

/** Every cell of the catalog. */
export const fullAccess = (catalog: PermissionGrid): PermissionGrid =>
  Object.fromEntries(Object.entries(catalog).map(([resource, actions]) => [resource, [...actions]]));

/** Only the viewing cells: "view" and "view_all". */
export const readOnly = (catalog: PermissionGrid): PermissionGrid =>
  Object.fromEntries(Object.entries(catalog).map(([resource, actions]) => [resource, actions.filter((a) => a === 'view' || a === 'view_all')]));

/** Same cells, whatever the order. */
export const sameGrid = (a: PermissionGrid, b: PermissionGrid): boolean => {
  const norm = (g: PermissionGrid) => JSON.stringify(Object.entries(g).filter(([, v]) => v.length).sort(([x], [y]) => x.localeCompare(y)).map(([r, v]) => [r, [...v].sort()]));
  return norm(a) === norm(b);
};

/** "bulk_import" -> "bulk import". */
export const actionLabel = (action: string): string => action.replace(/_/g, ' ');
