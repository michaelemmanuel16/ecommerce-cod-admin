import { Link } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { Card, EmptyState } from '../components/ui-v2';
import { useV2Page } from '../components/shell/useV2Page';
import { NAV_GROUPS } from '../components/shell/navModel';

/** "You do not have access" (F-102). Shown in place of a page the role may not open; the URL stays. */
export function NoAccess() {
  useV2Page();
  const homeRoute = useAuthStore((s) => s.homeRoute) ?? '/';
  const home = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.to === homeRoute);

  return (
    <Card>
      <EmptyState
        icon={<ShieldOff aria-hidden="true" />}
        title="You do not have access to this page"
        text="Your role cannot open it. Ask the owner if you need it."
        action={<Link className="btn pri" to={homeRoute}>Go to {home?.label ?? 'Dashboard'}</Link>}
      />
    </Card>
  );
}
