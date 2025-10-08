import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ShoppingBag,
  Users,
  Package,
  Truck,
  UserCog,
  DollarSign,
  BarChart3,
  Workflow,
  Settings,
} from 'lucide-react';
import { cn } from '../../utils/cn';

const menuItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/orders', icon: ShoppingBag, label: 'Orders Kanban' },
  { path: '/orders/list', icon: ShoppingBag, label: 'Orders List' },
  { path: '/customers', icon: Users, label: 'Customers' },
  { path: '/products', icon: Package, label: 'Products' },
  { path: '/delivery-agents', icon: Truck, label: 'Delivery Agents' },
  { path: '/customer-reps', icon: UserCog, label: 'Customer Reps' },
  { path: '/financial', icon: DollarSign, label: 'Financial' },
  { path: '/analytics', icon: BarChart3, label: 'Analytics' },
  { path: '/workflows', icon: Workflow, label: 'Workflows' },
  { path: '/settings', icon: Settings, label: 'Settings' },
];

export const Sidebar: React.FC = () => {
  return (
    <aside className="fixed left-0 top-0 h-full w-64 bg-gray-900 text-white p-4">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">COD Admin</h1>
        <p className="text-gray-400 text-sm">E-commerce Dashboard</p>
      </div>
      <nav className="space-y-1">
        {menuItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-4 py-3 rounded-lg transition-colors',
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800'
              )
            }
          >
            <item.icon className="w-5 h-5" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
};
