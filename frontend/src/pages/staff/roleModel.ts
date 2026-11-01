import { AVATAR_TONES } from '../../utils/people';
import type { TagTone } from '../../components/ui-v2';
import type { RoleCard } from '../../services/roles.service';
import type { Attainment, Tree } from '../../services/targets.service';
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

/** "view_orders" -> "View orders": the keys of the tool switches, in words, until the switches (M6-T21) bring their own labels. */
export const toolLabel = (key: string): string => {
  const words = key.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** The avatar of a holder: a tint per person, square for a company, violet for an AI agent. */
export const avatarClass = (kind: string, id: number): string =>
  `a ${AVATAR_TONES[id % AVATAR_TONES.length]}${kind === 'company' ? ' co' : kind === 'ai_agent' ? ' ai' : ''}`;
