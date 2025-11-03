import { useAuthStore } from '../stores/authStore';

type Resource = 'users' | 'orders' | 'customers' | 'products' | 'financial' | 'analytics' | 'workflows' | 'settings';
type Action = 'create' | 'view' | 'update' | 'delete' | 'bulk_import' | 'assign' | 'update_stock' | 'execute';

const defaultPermissions: Record<string, Record<Resource, Action[]>> = {
  super_admin: {
    users: ['create', 'view', 'update', 'delete'],
    orders: ['create', 'view', 'update', 'delete', 'bulk_import', 'assign'],
    customers: ['create', 'view', 'update', 'delete'],
    products: ['create', 'view', 'update', 'delete', 'update_stock'],
    financial: ['view', 'create', 'update', 'delete'],
    analytics: ['view'],
    workflows: ['create', 'view', 'update', 'delete', 'execute'],
    settings: ['view', 'update'],
  },
  admin: {
    users: ['create', 'view', 'update', 'delete'],
    orders: ['create', 'view', 'update', 'delete', 'bulk_import', 'assign'],
    customers: ['create', 'view', 'update', 'delete'],
    products: ['create', 'view', 'update', 'delete'],
    financial: ['view', 'create'],
    analytics: ['view'],
    workflows: ['create', 'view', 'update', 'delete', 'execute'],
    settings: ['view'],
  },
  manager: {
    users: [],
    orders: ['view', 'update', 'bulk_import', 'assign'],
    customers: ['create', 'view', 'update', 'delete'],
    products: ['view'],
    financial: ['view'],
    analytics: ['view'],
    workflows: ['view', 'execute'],
    settings: [],
  },
  sales_rep: {
    users: [],
    orders: ['create', 'view', 'update'],
    customers: ['create', 'view', 'update', 'delete'],
    products: ['view'],
    financial: [],
    analytics: [],
    workflows: [],
    settings: [],
  },
  inventory_manager: {
    users: [],
    orders: ['view'],
    customers: ['view'],
    products: ['create', 'view', 'update', 'delete', 'update_stock'],
    financial: [],
    analytics: ['view'],
    workflows: [],
    settings: [],
  },
  delivery_agent: {
    users: [],
    orders: ['view', 'update'],
    customers: ['view'],
    products: ['view'],
    financial: ['create'],
    analytics: ['view'],
    workflows: [],
    settings: [],
  },
  accountant: {
    users: [],
    orders: ['view'],
    customers: ['view'],
    products: ['view'],
    financial: ['view', 'create'],
    analytics: ['view'],
    workflows: [],
    settings: [],
  },
};

export const usePermissions = () => {
  const { user } = useAuthStore();

  const isSuperAdmin = user?.role === 'super_admin';
  const isAdmin = user?.role === 'admin' || isSuperAdmin;
  const isManager = user?.role === 'manager' || isAdmin;

  const can = (resource: Resource, action: Action): boolean => {
    if (!user) return false;

    const rolePermissions = defaultPermissions[user.role];
    if (!rolePermissions) return false;

    const resourcePermissions = rolePermissions[resource];
    if (!resourcePermissions) return false;

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
        return can('products', 'view');
      case 'delivery-agents':
        return isManager; // Manager and above
      case 'customer-reps':
        return isManager; // Manager and above
      case 'financial':
        return can('financial', 'view');
      case 'analytics':
        return can('analytics', 'view');
      case 'workflows':
        return can('workflows', 'view');
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
