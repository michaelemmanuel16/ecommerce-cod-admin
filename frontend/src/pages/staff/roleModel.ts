import { AVATAR_TONES } from '../../utils/people';
import type { TagTone } from '../../components/ui-v2';
import type { PermissionGrid, RoleCard } from '../../services/roles.service';
import type { Attainment, RewardSettings, Tree } from '../../services/targets.service';
import { barClass, buildGroups, targetWords } from '../targets/model';

/** Display rules of the role cards (M6-T19, F-1151). Nothing here calculates a KPI: progress comes from the targets API through `buildGroups`, the one place that sums it. */

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

/**
 * The progress of each role that has a target and holders with numbers, from the tree of the month and its attainment.
 * The status is the tree's own word: "Behind" wins when any holder is behind, else the first holder's word.
 */
export function roleProgress(tree: Tree | null, attainment: Attainment | null, currency: string): Map<number, RoleProgress> {
  const out = new Map<number, RoleProgress>();
  if (!tree?.roles) return out;
  for (const g of buildGroups(tree.roles, attainment, null, currency)) {
    if (!g.bar) continue;
    const statuses = g.lines.flatMap((l) => (l.status ? [l.status] : []));
    const status = statuses.find((s) => s.key === 'behind') ?? statuses[0] ?? null;
    out.set(g.role.roleId, {
      percent: Math.min(g.bar.percent, 100), text: g.bar.text, tone: barClass(status?.tone),
      status: status && { label: status.label, tone: status.tone },
    });
  }
  return out;
}

export interface ToolDef { key: string; label: string; kind: 'read' | 'write' }

/** The 16 tool switches of a role (F-1153), in the order of the mockup. The keys are the ones `Role.tools` and `PUT /api/roles/:id/tools` use. */
export const TOOLS: readonly ToolDef[] = [
  { key: 'view_orders', label: 'View orders', kind: 'read' },
  { key: 'view_customers', label: 'View customers', kind: 'read' },
  { key: 'view_stock', label: 'View stock', kind: 'read' },
  { key: 'view_payouts', label: 'View payouts', kind: 'read' },
  { key: 'view_reports', label: 'View reports', kind: 'read' },
  { key: 'view_targets', label: 'View targets', kind: 'read' },
  { key: 'export_data', label: 'Export data', kind: 'read' },
  { key: 'update_order_status', label: 'Update order status', kind: 'write' },
  { key: 'assign_orders', label: 'Assign orders', kind: 'write' },
  { key: 'call_customers', label: 'Call customers', kind: 'write' },
  { key: 'message_customers', label: 'Message customers', kind: 'write' },
  { key: 'edit_products', label: 'Edit products', kind: 'write' },
  { key: 'adjust_stock', label: 'Adjust stock', kind: 'write' },
  { key: 'record_payout', label: 'Record payout', kind: 'write' },
  { key: 'edit_targets', label: 'Edit targets', kind: 'write' },
  { key: 'manage_team', label: 'Manage team', kind: 'write' },
];

/** The switches after one is flipped, in table order. */
export const flipTool = (on: readonly string[], key: string): string[] => {
  const next = new Set(on);
  if (!next.delete(key)) next.add(key);
  return TOOLS.map((t) => t.key).filter((k) => next.has(k));
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

/** The avatar of a holder: a tint per person, square for a company, violet for an AI agent. */
export const avatarClass = (kind: string, id: number): string =>
  `a ${AVATAR_TONES[id % AVATAR_TONES.length]}${kind === 'company' ? ' co' : kind === 'ai_agent' ? ' ai' : ''}`;
