import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Tip } from './blocks/Frame';
import type { Info } from './copy';
import { useAuthStore } from '../../stores/authStore';
import { canOpenPath } from '../../components/shell/navModel';

/**
 * A link to another page only when this person may open it (the same rule as the route guard, F-102), so a manager never
 * sees a link to Finance that leads to "no access". Pages that do not exist yet (Targets) are passed as null: plain text.
 */
export function PageLink({ to, children, className, tip }: { to: string | null; children: ReactNode; className?: string; /** the label's tooltip */ tip?: Info }) {
  const user = useAuthStore((s) => s.user);
  const menu = useAuthStore((s) => s.menu);
  const homeRoute = useAuthStore((s) => s.homeRoute);
  const allowed = to !== null && !!user && !!menu && canOpenPath(to, menu, user.role, homeRoute);
  const content = allowed && to !== null ? <Link to={to} className={className}>{children}</Link> : <>{children}</>;
  return tip ? <Tip info={tip} linked={allowed}>{content}</Tip> : content;
}
