import { useAuthStore } from '../stores/authStore';
import { Resource, Action } from '../types';

export const usePermissions = () => {
  const { user, permissions } = useAuthStore();

  const isSuperAdmin = user?.role === 'super_admin';
  const isAdmin = user?.role === 'admin' || isSuperAdmin;
  const isManager = user?.role === 'manager' || isAdmin;

  const can = (resource: Resource, action: Action): boolean => {
    if (!user) return false;

    // Super admin has all permissions
    if (isSuperAdmin) return true;

    // Use dynamic permissions from auth store (fetched from database)
    if (!permissions) return false;

    const resourcePermissions = permissions[resource];
    if (!resourcePermissions || !Array.isArray(resourcePermissions)) return false;

    return resourcePermissions.includes(action);
  };

  const canAccessMenu = (menuItem: string): boolean => {
    if (!user) return false;

    switch (menuItem) {
      case 'dashboard':
        return true; // All roles can access dashboard
      case 'orders':
        return can('orders', 'view');
      case 'customers':
        return can('customers', 'view');
      case 'products':
        return can('products', 'view') && user?.role !== 'sales_rep';
      case 'delivery-agents':
        return isManager; // Manager and above
      case 'customer-reps':
        return isManager; // Manager and above
      case 'financial':
        return can('financial', 'view');
      case 'analytics':
        return isManager || user?.role === 'accountant';
      case 'workflows':
        return can('workflows', 'view');
      case 'earnings-history':
        return user?.role === 'sales_rep'; // Only sales reps can access earnings history
      case 'settings':
        return true; // All users can access their own settings
      default:
        return false;
    }
  };

  return {
    user,
    isSuperAdmin,
    isAdmin,
    isManager,
    can,
    canAccessMenu,
  };
};
