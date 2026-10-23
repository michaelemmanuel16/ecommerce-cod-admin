import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { roleAppRoute } from '../../config/features';
import { Skeleton } from '../ui-v2';
import { NoAccess } from '../../pages/NoAccess';
import { canOpenPath } from './navModel';

/**
 * Route guard and role home (M3-T33, F-102, F-103). The answer comes from /api/auth/me (`menu`, `homeRoute`) through
 * navModel, so there is no role list here. A page the person may not open shows "no access" and keeps the URL.
 */
export function AccessGate({ as }: { /** Check this path instead of the current URL (legacy routes that no nav item owns). */ as?: string }) {
  const { pathname } = useLocation();
  const user = useAuthStore((s) => s.user);
  const menu = useAuthStore((s) => s.menu);
  const homeRoute = useAuthStore((s) => s.homeRoute);

  if (!user) return null;
  // Platform admins have no store menu; their routes use PlatformGuard.
  if (user.isPlatformAdmin) return <Outlet />;

  // Role home: "/" sends the person to their app (flag on) or their home route (finance clerk, stock keeper).
  if (pathname === '/') {
    const app = roleAppRoute(user.role);
    if (app) return <Navigate to={app} replace />;
    if (homeRoute && homeRoute !== '/') return <Navigate to={homeRoute} replace />;
  }

  // The first /api/auth/me answer is not in yet.
  if (!menu) {
    return (
      <div aria-busy="true" aria-label="Loading">
        <Skeleton width={260} height={34} />
        <Skeleton height={120} className="skelcard" />
      </div>
    );
  }

  return canOpenPath(as ?? pathname, menu, user.role, homeRoute) ? <Outlet /> : <NoAccess />;
}
