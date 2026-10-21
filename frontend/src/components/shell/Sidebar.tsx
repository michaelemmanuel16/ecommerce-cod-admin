import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { PanelLeftClose, PanelLeftOpen, Zap } from 'lucide-react';
import { Country } from 'country-state-city';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import { useShellStore } from '../../stores/shellStore';
import { getCurrencySymbol } from '../../utils/countries';
import { Skeleton } from '../ui-v2';
import { PLATFORM_GROUP, isActive, visibleGroups, type NavGroup, type NavItem } from './navModel';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Under 760 px the sidebar is a drawer. */
  mobileOpen: boolean;
  onNavigate: () => void;
}

const initials = (text: string) =>
  text.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/** The country that uses this currency, or '' when several do (USD, EUR): the config API does not return the country yet. */
function countryOf(currency: string): string {
  const names = Country.getAllCountries().filter((c) => c.currency === currency).map((c) => c.name);
  return names.length === 1 ? names[0] : '';
}

export function Sidebar({ collapsed, onToggleCollapsed, mobileOpen, onNavigate }: SidebarProps) {
  const { pathname } = useLocation();
  const user = useAuthStore((s) => s.user);
  const menu = useAuthStore((s) => s.menu);
  const roles = useAuthStore((s) => s.roles);
  const counts = useShellStore((s) => s.counts);
  const { businessName, currency, loaded } = useConfigStore();

  const groups = useMemo<NavGroup[] | null>(() => {
    if (user?.isPlatformAdmin) return [PLATFORM_GROUP];
    return menu && user ? visibleGroups(menu, user.role) : null;
  }, [user, menu]);

  const country = useMemo(() => countryOf(currency), [currency]);
  const fullName = user ? `${user.firstName} ${user.lastName}`.trim() : '';
  const roleNames = roles?.map((r) => r.name).join(' · ') ?? '';

  const link = (item: NavItem) => {
    const active = isActive(item.to as string, pathname) && (!item.exact || pathname === item.to);
    const n = item.count && counts ? counts[item.count] : 0;
    return (
      <Link
        key={item.key}
        to={item.to as string}
        className={clsx('nav', active && 'on')}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? item.label : undefined}
        onClick={onNavigate}
      >
        <item.icon />
        <span className="lbl">{item.label}</span>
        {n > 0 && <span className="pill" aria-label={`${n} waiting`}>{n > 99 ? '99+' : n}</span>}
      </Link>
    );
  };

  return (
    <aside className={clsx('side', mobileOpen && 'open')} id="app-sidebar" aria-label="Main menu">
      <div className="brand">
        <div className="logo"><Zap /></div>
        <b>CodAdmin</b>
        <button
          type="button"
          className="ibtn sm sidetoggle"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </button>
      </div>

      <div className="store" title={collapsed ? businessName : undefined}>
        <div className="av">{loaded ? initials(businessName) : ''}</div>
        <div className="txt">
          {loaded ? (
            <>
              <b>{businessName}</b>
              <small>{[country, getCurrencySymbol(currency)].filter(Boolean).join(' · ')}</small>
            </>
          ) : (
            <Skeleton width={110} height={12} />
          )}
        </div>
      </div>

      {groups
        ? groups.map((g, i) => (
            <div className="navgroup" key={g.label ?? i}>
              {g.label && <p>{g.label}</p>}
              {g.items.map(link)}
            </div>
          ))
        : (
          <div className="navgroup" aria-busy="true">
            {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} height={34} className="navskel" />)}
          </div>
        )}

      <div className="me">
        <div className="row">
          <div className="avatar">{initials(fullName)}</div>
          <div className="txt">
            <b>{user?.firstName}</b>
            <div className="lv">{roleNames}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
