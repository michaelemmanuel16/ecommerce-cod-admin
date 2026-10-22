import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { roleAppRoute } from '../config/features';
import { Card, EmptyState } from '../components/ui-v2';
import { useV2Page } from '../components/shell/useV2Page';

/** Where the person lands after login: platform admins on /platform, a role with its own app there, else the home route. */
function roleHome(user: { role: string; isPlatformAdmin?: boolean } | null, homeRoute: string | null): string {
  if (user?.isPlatformAdmin) return '/platform';
  return roleAppRoute(user?.role) ?? homeRoute ?? '/';
}

/** 404 (F-109). Shown inside the shell for a path no route owns; the link goes to the role home. */
export function NotFound() {
  useV2Page();
  const user = useAuthStore((s) => s.user);
  const homeRoute = useAuthStore((s) => s.homeRoute);

  return (
    <Card>
      <EmptyState
        icon={<Compass aria-hidden="true" />}
        title="Page not found"
        text="This page does not exist or has moved."
        action={<Link className="btn pri" to={roleHome(user, homeRoute)}>Go to your home page</Link>}
      />
    </Card>
  );
}
