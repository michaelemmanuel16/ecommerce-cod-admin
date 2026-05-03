import React, { useState, useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  Megaphone,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { UserMenu } from '../common/UserMenu';

const navItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { path: '/tenants', icon: Building2, label: 'Tenants', end: false },
  { path: '/announcements', icon: Megaphone, label: 'Announcements', end: false },
];

export const PlatformLayout: React.FC = () => {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem('platformSidebarCollapsed');
    return saved ? JSON.parse(saved) : false;
  });

  useEffect(() => {
    localStorage.setItem('platformSidebarCollapsed', JSON.stringify(isCollapsed));
  }, [isCollapsed]);

  return (
    <div className="flex h-screen bg-gray-50">
      <aside
        className={cn(
          'fixed left-0 top-0 h-full bg-gray-900 text-white p-4 transition-all duration-300 ease-in-out',
          isCollapsed ? 'w-20' : 'w-64'
        )}
      >
        <div className="mb-8 relative">
          <div className={cn('flex items-center', isCollapsed ? 'flex-col gap-4' : 'justify-between')}>
            <div className={cn('overflow-hidden', isCollapsed ? 'text-center' : '')}>
              <h1 className={cn('font-bold transition-all', isCollapsed ? 'text-lg' : 'text-2xl')}>
                {isCollapsed ? 'PA' : 'Platform Admin'}
              </h1>
              {!isCollapsed && <p className="text-gray-400 text-sm">Manage all tenants</p>}
            </div>

            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className={cn(
                'p-1 rounded-md hover:bg-gray-800 transition-colors',
                isCollapsed ? '' : 'absolute top-0 right-0'
              )}
              aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {isCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
            </button>
          </div>
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center rounded-lg transition-colors',
                  isCollapsed ? 'justify-center px-2 py-3' : 'gap-3 px-4 py-3',
                  isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'
                )
              }
              title={isCollapsed ? item.label : undefined}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {!isCollapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div
        className={cn(
          'flex-1 flex flex-col overflow-hidden transition-all duration-300 ease-in-out',
          isCollapsed ? 'ml-20' : 'ml-64'
        )}
      >
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Platform Admin</h2>
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
