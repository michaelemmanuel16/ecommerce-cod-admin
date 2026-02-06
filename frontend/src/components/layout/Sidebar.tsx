import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ShoppingBag,
  Users,
  Package,
  Truck,
  UserCog,
  Phone,
  DollarSign,
  BarChart3,
  Workflow,
  Settings,
  ChevronLeft,
  ChevronRight,
  History,
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { usePermissions } from '../../hooks/usePermissions';

const menuItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard', key: 'dashboard' },
  { path: '/orders', icon: ShoppingBag, label: 'Orders', key: 'orders' },
  { path: '/customers', icon: Users, label: 'Customers', key: 'customers' },
  { path: '/products', icon: Package, label: 'Products', key: 'products' },
  { path: '/delivery-agents', icon: Truck, label: 'Delivery Agents', key: 'delivery-agents' },
  { path: '/customer-reps', icon: UserCog, label: 'Customer Reps', key: 'customer-reps' },
  { path: '/financial', icon: DollarSign, label: 'Financial', key: 'financial' },
  { path: '/earnings-history', icon: History, label: 'Earnings History', key: 'earnings-history' },
  { path: '/analytics', icon: BarChart3, label: 'Analytics', key: 'analytics' },
  { path: '/workflows', icon: Workflow, label: 'Workflows', key: 'workflows' },
  { path: '/settings', icon: Settings, label: 'Settings', key: 'settings' },
];

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isCollapsed, onToggle }) => {
  const { canAccessMenu } = usePermissions();

  const visibleMenuItems = menuItems.filter(item => canAccessMenu(item.key));

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 h-full bg-gray-900 text-white p-4 transition-all duration-300 ease-in-out",
        isCollapsed ? "w-20" : "w-64"
      )}
    >
      {/* Header with toggle button */}
      <div className="mb-8 relative">
        <div className={cn("flex items-center", isCollapsed ? "flex-col gap-4" : "justify-between")}>
          <div className={cn("overflow-hidden", isCollapsed ? "text-center" : "")}>
            <h1 className={cn("font-bold transition-all", isCollapsed ? "text-lg" : "text-2xl")}>
              {isCollapsed ? "COD" : "COD Admin"}
            </h1>
            {!isCollapsed && <p className="text-gray-400 text-sm">E-commerce Dashboard</p>}
          </div>

          <button
            onClick={onToggle}
            className={cn(
              "p-1 rounded-md hover:bg-gray-800 transition-colors",
              isCollapsed ? "" : "absolute top-0 right-0"
            )}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? (
              <ChevronRight className="w-5 h-5" />
            ) : (
              <ChevronLeft className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>

      {/* Navigation */}
      <nav className="space-y-1">
        {visibleMenuItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              cn(
                'flex items-center rounded-lg transition-colors',
                isCollapsed ? 'justify-center px-2 py-3' : 'gap-3 px-4 py-3',
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800'
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
  );
};
