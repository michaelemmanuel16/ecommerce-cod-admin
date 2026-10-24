import { Banknote, ClipboardCheck, type LucideIcon } from 'lucide-react';
import { PLATFORM_GROUP, visibleGroups, type NavItem } from './navModel';

// What the command palette (M3-T35, F-105) offers besides search. Pure functions, so the rules are testable without a screen.

/**
 * "G then a letter" shortcuts, keyed by the letter, valued by the nav key they open.
 * A shortcut works only when its page exists and the person may see it: it resolves through the same list as the
 * "Go to" rows. Leaderboard and Targets have no page yet (`to: null` in navModel), so `G L` and `G T` do nothing
 * until those pages ship; `G O` opens Orders now.
 */
const GO_SHORTCUTS: Record<string, string> = { o: 'orders', l: 'leaderboard', t: 'targets' };

/** The hint printed on a row: "G O". */
export const shortcutHint = (navKey: string): string | null => {
  const letter = Object.keys(GO_SHORTCUTS).find((l) => GO_SHORTCUTS[l] === navKey);
  return letter ? `G ${letter.toUpperCase()}` : null;
};

/** Pages the person may open from the palette: the sidebar's items (menu keys, existing pages), flat. */
export function goPages(menu: string[] | null, role: string, isPlatformAdmin: boolean): NavItem[] {
  if (isPlatformAdmin) return PLATFORM_GROUP.items;
  return visibleGroups(menu ?? [], role).flatMap((g) => g.items);
}

/** The page a shortcut letter opens, or null when it has none for this person. */
export function shortcutTarget(letter: string, pages: NavItem[]): string | null {
  const key = GO_SHORTCUTS[letter.toLowerCase()];
  return pages.find((p) => p.key === key)?.to ?? null;
}

export interface PaletteAction {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Route of the screen. `null` while the screen does not exist: the action stays hidden, like a sidebar item. */
  to: string | null;
  /** The `menu` key the person needs; an action is a shortcut into that area, never a way around it. */
  menuKey: string;
}

export const ACTIONS: PaletteAction[] = [
  { key: 'payout', label: 'Record a 3PL payout', icon: Banknote, to: null, menuKey: 'finance' }, // the payout screen is not built yet
  { key: 'stockCount', label: 'Start a stock count', icon: ClipboardCheck, to: '/inventory?action=count', menuKey: 'inventory' },
];

export function visibleActions(menu: string[] | null, actions: PaletteAction[] = ACTIONS): PaletteAction[] {
  const allowed = new Set(menu ?? []);
  return actions.filter((a) => a.to !== null && allowed.has(a.menuKey));
}
