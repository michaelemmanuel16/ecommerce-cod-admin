import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import { useShellStore } from '../../stores/shellStore';
import { useSidebarCollapse } from '../../hooks/useSidebarCollapse';
import { Skeleton, ToastProvider } from '../ui-v2';
import { AnnouncementBanner } from './AnnouncementBanner';
import { PlanBanner } from './PlanBanner';
import { PreviewBanner } from './PreviewBanner';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { V2PageContext } from './useV2Page';

// Roles whose app is not the admin shell: no platform or plan banners for them (F-108).
const NO_BANNER_ROLES = ['sales_rep', 'delivery_agent'];

/**
 * The admin shell (M3-T32, F-100): sidebar, top bar, page area, toast area and the mount points for the
 * command palette (M3-T35) and the AI drawer (M11). Pages render in <Outlet/> once the store config has loaded,
 * because the money formatter shows USD until then.
 */
export function Shell() {
  const { pathname } = useLocation();
  const user = useAuthStore((s) => s.user);
  const configLoaded = useConfigStore((s) => s.loaded);
  const fetchCounts = useShellStore((s) => s.fetchCounts);
  const [collapsed, setCollapsed] = useSidebarCollapse('sidebarCollapsed');
  const [mobileOpen, setMobileOpen] = useState(false);
  // true while a restyled v2 page is on screen (see useV2Page); old pages render inside .legacy-light
  const [v2Page, setV2Page] = useState(false);

  useEffect(() => {
    if (!user?.isPlatformAdmin) fetchCounts();
  }, [fetchCounts, user?.isPlatformAdmin]);

  // A page change closes the mobile drawer.
  useEffect(() => setMobileOpen(false), [pathname]);

  const showBanners = !!user && !NO_BANNER_ROLES.includes(user.role);

  return (
    <ToastProvider>
      <div className="v2">
        <div className={clsx('app', collapsed && 'collapsed')}>
          <Sidebar
            collapsed={collapsed}
            onToggleCollapsed={() => setCollapsed(!collapsed)}
            mobileOpen={mobileOpen}
            onNavigate={() => setMobileOpen(false)}
          />
          {mobileOpen && <div className="side-scrim" onClick={() => setMobileOpen(false)} aria-hidden="true" />}

          <div className="main">
            <TopBar mobileOpen={mobileOpen} onToggleMobileMenu={() => setMobileOpen((o) => !o)} />
            <main className="content">
              <PreviewBanner />
              {showBanners && <AnnouncementBanner />}
              {showBanners && user?.role === 'super_admin' && !user.isPlatformAdmin && <PlanBanner />}
              {configLoaded ? (
                <V2PageContext.Provider value={setV2Page}>
                  <div className={v2Page ? undefined : 'legacy-light'}>
                    <Outlet />
                  </div>
                </V2PageContext.Provider>
              ) : (
                <div aria-busy="true" aria-label="Loading">
                  <Skeleton width={260} height={34} />
                  <Skeleton width={420} height={14} className="skelgap" />
                  <div className="grid kpis">
                    {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={120} className="skelcard" />)}
                  </div>
                </div>
              )}
            </main>
          </div>
        </div>
        <div id="command-palette-root" />
        <div id="ai-drawer-root" />
      </div>
    </ToastProvider>
  );
}
