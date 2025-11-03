import React, { useState, useEffect } from 'react';
import { Save, Search, RotateCcw, Shield, AlertCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Select } from '../ui/Select';
import { Input } from '../ui/Input';
import { Tooltip } from '../ui/Tooltip';
import { adminService } from '../../services/admin.service';
import { Loading } from '../ui/Loading';

const ROLES = [
  { key: 'super_admin', label: 'Super Admin' },
  { key: 'admin', label: 'Admin' },
  { key: 'manager', label: 'Manager' },
  { key: 'sales_rep', label: 'Sales Rep' },
  { key: 'inventory_manager', label: 'Inventory Manager' },
  { key: 'delivery_agent', label: 'Delivery Agent' },
  { key: 'accountant', label: 'Accountant' },
];

const RESOURCES = [
  { key: 'users', label: 'Users', description: 'Manage system users and staff accounts' },
  { key: 'orders', label: 'Orders', description: 'Handle customer orders and fulfillment' },
  { key: 'customers', label: 'Customers', description: 'Manage customer information and relationships' },
  { key: 'products', label: 'Products', description: 'Manage product catalog and inventory' },
  { key: 'financial', label: 'Financial', description: 'Access financial records and reconciliation' },
  { key: 'analytics', label: 'Analytics', description: 'View reports and analytics dashboards' },
  { key: 'workflows', label: 'Workflows', description: 'Configure automated workflows and triggers' },
  { key: 'settings', label: 'Settings', description: 'System configuration and preferences' },
];

// Resource-specific actions - only show relevant actions per resource
const RESOURCE_ACTIONS: Record<string, Array<{key: string; label: string; description: string}>> = {
  users: [
    { key: 'create', label: 'CREATE', description: 'Create new users' },
    { key: 'view', label: 'VIEW', description: 'View user details' },
    { key: 'update', label: 'UPDATE', description: 'Edit user information' },
    { key: 'delete', label: 'DELETE', description: 'Deactivate or remove users' },
  ],
  orders: [
    { key: 'create', label: 'CREATE', description: 'Create new orders' },
    { key: 'view', label: 'VIEW', description: 'View order details' },
    { key: 'update', label: 'UPDATE', description: 'Edit orders and status' },
    { key: 'delete', label: 'DELETE', description: 'Cancel or delete orders' },
    { key: 'bulk_import', label: 'BULK_IMPORT', description: 'Import multiple orders at once' },
    { key: 'assign', label: 'ASSIGN', description: 'Assign orders to agents' },
  ],
  customers: [
    { key: 'create', label: 'CREATE', description: 'Add new customers' },
    { key: 'view', label: 'VIEW', description: 'View customer details' },
    { key: 'update', label: 'UPDATE', description: 'Edit customer information' },
    { key: 'delete', label: 'DELETE', description: 'Remove customers' },
  ],
  products: [
    { key: 'create', label: 'CREATE', description: 'Add new products' },
    { key: 'view', label: 'VIEW', description: 'View product catalog' },
    { key: 'update', label: 'UPDATE', description: 'Edit product details' },
    { key: 'delete', label: 'DELETE', description: 'Remove products' },
    { key: 'update_stock', label: 'UPDATE_STOCK', description: 'Adjust inventory levels' },
  ],
  financial: [
    { key: 'create', label: 'CREATE', description: 'Record transactions' },
    { key: 'view', label: 'VIEW', description: 'View financial records' },
    { key: 'update', label: 'UPDATE', description: 'Edit financial entries' },
    { key: 'delete', label: 'DELETE', description: 'Delete financial records' },
  ],
  analytics: [
    { key: 'view', label: 'VIEW', description: 'Access analytics and reports' },
  ],
  workflows: [
    { key: 'create', label: 'CREATE', description: 'Create new workflows' },
    { key: 'view', label: 'VIEW', description: 'View workflows' },
    { key: 'update', label: 'UPDATE', description: 'Edit workflows' },
    { key: 'delete', label: 'DELETE', description: 'Remove workflows' },
    { key: 'execute', label: 'EXECUTE', description: 'Manually trigger workflows' },
  ],
  settings: [
    { key: 'view', label: 'VIEW', description: 'View system settings' },
    { key: 'update', label: 'UPDATE', description: 'Modify system settings' },
  ],
};

export const RolePermissionsMatrix: React.FC = () => {
  const [permissions, setPermissions] = useState<any>({});
  const [originalPermissions, setOriginalPermissions] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedRole, setSelectedRole] = useState('super_admin');
  const [searchQuery, setSearchQuery] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    fetchPermissions();
  }, []);

  useEffect(() => {
    // Check if there are unsaved changes
    const hasChanges = JSON.stringify(permissions) !== JSON.stringify(originalPermissions);
    setHasUnsavedChanges(hasChanges);
  }, [permissions, originalPermissions]);

  const fetchPermissions = async () => {
    try {
      setLoading(true);
      const data = await adminService.getRolePermissions();
      setPermissions(data);
      setOriginalPermissions(JSON.parse(JSON.stringify(data))); // Deep clone
    } catch (error) {
      console.error('Failed to fetch permissions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await adminService.updateRolePermissions(permissions);
      setOriginalPermissions(JSON.parse(JSON.stringify(permissions))); // Update original
      alert('Permissions updated successfully');
    } catch (error) {
      console.error('Failed to update permissions:', error);
      alert('Failed to update permissions');
    } finally {
      setSaving(false);
    }
  };

  const togglePermission = (role: string, resource: string, action: string) => {
    setPermissions((prev: any) => {
      const rolePerms = prev[role] || {};
      const resourcePerms = rolePerms[resource] || [];

      const newResourcePerms = resourcePerms.includes(action)
        ? resourcePerms.filter((a: string) => a !== action)
        : [...resourcePerms, action];

      return {
        ...prev,
        [role]: {
          ...rolePerms,
          [resource]: newResourcePerms,
        },
      };
    });
  };

  const hasPermission = (role: string, resource: string, action: string): boolean => {
    return permissions[role]?.[resource]?.includes(action) || false;
  };

  // Template actions
  const applyFullAccess = () => {
    setPermissions((prev: any) => {
      const rolePerms = { ...prev[selectedRole] };
      RESOURCES.forEach(resource => {
        rolePerms[resource.key] = RESOURCE_ACTIONS[resource.key].map(action => action.key);
      });
      return { ...prev, [selectedRole]: rolePerms };
    });
  };

  const applyReadOnly = () => {
    setPermissions((prev: any) => {
      const rolePerms = { ...prev[selectedRole] };
      RESOURCES.forEach(resource => {
        const hasViewPermission = RESOURCE_ACTIONS[resource.key].some(action => action.key === 'view');
        rolePerms[resource.key] = hasViewPermission ? ['view'] : [];
      });
      return { ...prev, [selectedRole]: rolePerms };
    });
  };

  const resetToDefault = () => {
    setPermissions((prev: any) => ({
      ...prev,
      [selectedRole]: originalPermissions[selectedRole] || {},
    }));
  };

  // Bulk toggle for entire resource row
  const toggleResourceAll = (resource: string, enable: boolean) => {
    setPermissions((prev: any) => {
      const rolePerms = { ...prev[selectedRole] };
      rolePerms[resource] = enable ? RESOURCE_ACTIONS[resource].map(action => action.key) : [];
      return { ...prev, [selectedRole]: rolePerms };
    });
  };

  // Bulk toggle for entire action column across all resources
  const toggleActionAll = (action: string, enable: boolean) => {
    setPermissions((prev: any) => {
      const rolePerms = { ...prev[selectedRole] };
      RESOURCES.forEach(resource => {
        const resourceHasAction = RESOURCE_ACTIONS[resource.key].some(a => a.key === action);
        if (resourceHasAction) {
          const currentPerms = rolePerms[resource.key] || [];
          if (enable && !currentPerms.includes(action)) {
            rolePerms[resource.key] = [...currentPerms, action];
          } else if (!enable && currentPerms.includes(action)) {
            rolePerms[resource.key] = currentPerms.filter((a: string) => a !== action);
          }
        }
      });
      return { ...prev, [selectedRole]: rolePerms };
    });
  };

  // Get count of enabled permissions for selected role
  const getPermissionCount = () => {
    let count = 0;
    const rolePerms = permissions[selectedRole] || {};
    Object.values(rolePerms).forEach((resourcePerms: any) => {
      count += Array.isArray(resourcePerms) ? resourcePerms.length : 0;
    });
    return count;
  };

  // Filter resources based on search query
  const filteredResources = RESOURCES.filter(resource =>
    resource.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
    resource.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) return <Loading />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Role Permissions Matrix</h3>
          <p className="text-sm text-gray-600 mt-1">Configure what each role can do across different resources</p>
        </div>
        <Button variant="primary" onClick={handleSave} disabled={saving || !hasUnsavedChanges}>
          <Save className="w-4 h-4 mr-2" />
          {saving ? 'Saving...' : 'Save Permissions'}
        </Button>
      </div>

      {/* Unsaved Changes Warning */}
      {hasUnsavedChanges && (
        <div className="flex items-center gap-2 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <AlertCircle className="w-5 h-5 text-yellow-600" />
          <p className="text-sm text-yellow-800">
            You have unsaved changes. Click "Save Permissions" to apply them.
          </p>
        </div>
      )}

      <Card>
        <div className="p-6 space-y-6">
          {/* Role Selector and Stats */}
          <div className="flex items-center justify-between gap-4 pb-4 border-b border-gray-200">
            <div className="flex items-center gap-4">
              <Shield className="w-6 h-6 text-blue-600" />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Role
                </label>
                <Select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                  options={ROLES.map(role => ({ value: role.key, label: role.label }))}
                  className="w-64"
                />
              </div>
              <Badge variant="success" className="ml-4">
                {getPermissionCount()} permissions enabled
              </Badge>
            </div>

            {/* Search */}
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search resources..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg">
            <span className="text-sm font-medium text-gray-700">Quick Actions:</span>
            <Button variant="outline" size="sm" onClick={applyFullAccess}>
              Full Access
            </Button>
            <Button variant="outline" size="sm" onClick={applyReadOnly}>
              Read Only
            </Button>
            <Button variant="outline" size="sm" onClick={resetToDefault}>
              <RotateCcw className="w-3 h-3 mr-1" />
              Reset to Saved
            </Button>
          </div>

          {/* Permissions Table */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50 border-y border-gray-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase w-48">
                    Resource
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                    Permissions
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 uppercase w-32">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredResources.map(resource => {
                  const actions = RESOURCE_ACTIONS[resource.key];
                  const enabledCount = actions.filter(action =>
                    hasPermission(selectedRole, resource.key, action.key)
                  ).length;
                  const allEnabled = enabledCount === actions.length;

                  return (
                    <tr key={resource.key} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-4">
                        <Tooltip content={resource.description}>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">{resource.label}</span>
                            <Badge variant={enabledCount > 0 ? 'success' : 'default'}>
                              {enabledCount}/{actions.length}
                            </Badge>
                          </div>
                        </Tooltip>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          {actions.map(action => (
                            <Tooltip key={action.key} content={action.description}>
                              <button
                                onClick={() => togglePermission(selectedRole, resource.key, action.key)}
                                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                                  hasPermission(selectedRole, resource.key, action.key)
                                    ? 'bg-blue-100 text-blue-700 border-2 border-blue-300 hover:bg-blue-200'
                                    : 'bg-gray-100 text-gray-600 border-2 border-gray-200 hover:bg-gray-200'
                                }`}
                              >
                                {action.label}
                              </button>
                            </Tooltip>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleResourceAll(resource.key, !allEnabled)}
                          className="text-xs"
                        >
                          {allEnabled ? 'Disable All' : 'Enable All'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {filteredResources.length === 0 && (
              <div className="py-12 text-center">
                <p className="text-sm text-gray-500">No resources found matching "{searchQuery}"</p>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};
