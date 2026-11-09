import React from 'react';
import { NavLink, Link, Outlet, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import {
  Zap,
  LayoutGrid,
  Phone,
  ShoppingBag,
  Wallet,
  BarChart3,
  Moon,
  Sun,
  Bell,
  ArrowLeft,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { isManagerUp } from '../../components/shell/navModel';
import { useTheme } from '../../hooks/useTheme';
import { UserMenu } from '../../components/shell/UserMenu';
import { ToastProvider } from '../../components/ui-v2';
import { useRepSummary } from './useRepSummary';

export const RepShell: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [theme, toggleTheme] = useTheme();
  const { summary, refetch } = useRepSummary();
  const location = useLocation();

  const isManager = user ? isManagerUp(user.role) : false;
  const fullName = user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() : '';

  const navItems = [
    { to: '/rep/today', label: 'Today', icon: LayoutGrid, count: null },
    { to: '/rep/queue', label: 'Queue', icon: Phone, count: summary.queue },
    { to: '/rep/orders', label: 'My orders', icon: ShoppingBag, count: null },
    { to: '/rep/earnings', label: 'Earnings', icon: Wallet, count: null },
    { to: '/rep/numbers', label: 'My numbers', icon: BarChart3, count: null },
  ];

  return (
    <ToastProvider>
      <div className="v2">
        <div className="rep-shell">
          <div className="app-layout">
            {/* Desktop left rail */}
            <aside className="side" aria-label="Main" data-testid="rep-desktop-rail">
              <div className="brand">
                <div className="logo">
                  <Zap size={16} />
                </div>
                <b>CodAdmin</b>
              </div>

              <div className="navgroup">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    item.to === '/rep/today'
                      ? location.pathname === '/rep/today' || location.pathname === '/rep'
                      : location.pathname.startsWith(item.to);

                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={clsx('nav', isActive && 'on')}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <Icon size={18} />
                      <span>{item.label}</span>
                      {typeof item.count === 'number' && item.count > 0 && (
                        <span className="pill" data-testid="queue-pill">
                          {item.count > 99 ? '99+' : item.count}
                        </span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </aside>

            {/* Main area */}
            <div className="main">
              <header className="bar2" data-testid="rep-topbar">
                <div className="logo">
                  <Zap size={18} />
                </div>
                <div className="who2">
                  <b>CodAdmin</b>
                  <small>Call rep · {fullName || 'Call Rep'}</small>
                </div>

                <div className="sp" />

                {isManager && (
                  <Link
                    to="/"
                    className="back"
                    data-testid="back-to-codadmin"
                    title="Back to CodAdmin"
                  >
                    <ArrowLeft size={15} />
                    <span>Back to CodAdmin</span>
                  </Link>
                )}

                <button
                  type="button"
                  className="ibtn"
                  onClick={toggleTheme}
                  aria-label="Toggle dark mode"
                  data-testid="theme-toggle"
                >
                  {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
                </button>

                <Link
                  to="/rep/inbox"
                  className="ibtn bell-btn"
                  aria-label="Inbox"
                  data-testid="rep-inbox-bell"
                >
                  <Bell size={17} />
                  {summary.inbox > 0 && (
                    <span className="bcnt" data-testid="rep-inbox-badge">
                      {summary.inbox > 99 ? '99+' : summary.inbox}
                    </span>
                  )}
                </Link>

                <UserMenu />
              </header>

              <main className="content">
                <Outlet context={{ summary, refetch }} />
              </main>
            </div>
          </div>

          {/* Mobile bottom tab bar */}
          <nav className="ptab" aria-label="Pages" data-testid="rep-phone-tabs">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.to === '/rep/today'
                  ? location.pathname === '/rep/today' || location.pathname === '/rep'
                  : location.pathname.startsWith(item.to);

              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={clsx(isActive && 'on')}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon size={18} />
                  <span>{item.label === 'My orders' ? 'Orders' : item.label === 'My numbers' ? 'Numbers' : item.label}</span>
                  {typeof item.count === 'number' && item.count > 0 && (
                    <span className="pill" data-testid="phone-queue-pill">
                      {item.count > 99 ? '99+' : item.count}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </nav>
        </div>
      </div>
    </ToastProvider>
  );
};

export default RepShell;
