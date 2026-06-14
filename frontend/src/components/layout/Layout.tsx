import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { cn } from '../../utils/cn';
import { AnnouncementBanner } from '../announcements/AnnouncementBanner';
import { PendingPlanBanner } from '../billing/PendingPlanBanner';
import { useSidebarCollapse } from '../../hooks/useSidebarCollapse';

export const Layout: React.FC = () => {
  const [isCollapsed, setIsCollapsed] = useSidebarCollapse('sidebarCollapsed');

  const toggleSidebar = () => setIsCollapsed(!isCollapsed);

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar isCollapsed={isCollapsed} onToggle={toggleSidebar} />
      <div
        className={cn(
          "flex-1 flex flex-col overflow-hidden transition-all duration-300 ease-in-out",
          isCollapsed ? "ml-20" : "ml-64"
        )}
      >
        <Header />
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-6">
          <AnnouncementBanner />
          <PendingPlanBanner />
          <Outlet />
        </main>
      </div>
    </div>
  );
};
