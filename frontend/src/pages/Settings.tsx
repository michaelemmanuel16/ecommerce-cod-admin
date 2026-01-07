import React, { useState, useEffect } from 'react';
import { User, Bell, Lock, Building2, Save, Mail, Phone, MapPin, Users as UsersIcon, Shield, MessageSquare, FileText, Webhook } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useAuthStore } from '../stores/authStore';
import { usePermissions } from '../hooks/usePermissions';
import { UserManagementTable } from '../components/admin/UserManagementTable';
import { RolePermissionsMatrix } from '../components/admin/RolePermissionsMatrix';
import { adminService, SystemConfig } from '../services/admin.service';
import { apiClient } from '../services/api';
import { useConfigStore } from '../stores/configStore';
import { getCurrencySymbol } from '../utils/countries';

type SettingsTab = 'profile' | 'notifications' | 'security' | 'users' | 'business' | 'permissions' | 'notifications-config' | 'checkout-forms' | 'webhooks';

export const Settings: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const { user } = useAuthStore();
  const { isSuperAdmin, isAdmin } = usePermissions();
  const isSalesRep = user?.role === 'sales_rep';

  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);
  const [businessForm, setBusinessForm] = useState({
    businessName: '',
    businessEmail: '',
    businessPhone: '',
    businessAddress: '',
    taxId: '',
    currency: 'USD',
  });

  useEffect(() => {
    if (isSuperAdmin) {
      loadSystemConfig();
    }
  }, [isSuperAdmin]);

  const loadSystemConfig = async () => {
    try {
      const config = await adminService.getSystemConfig();
      setSystemConfig(config);
      setBusinessForm({
        businessName: config.businessName || '',
        businessEmail: config.businessEmail || '',
        businessPhone: config.businessPhone || '',
        businessAddress: config.businessAddress || '',
        taxId: config.taxId || '',
        currency: config.currency || 'USD',
      });
    } catch (error) {
      console.error('Failed to load system config:', error);
    }
  };

  const handleSaveBusinessSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await adminService.updateSystemConfig(businessForm);
      alert('Business settings saved successfully');
      loadSystemConfig();
      // Update global store
      useConfigStore.getState().fetchConfig();
    } catch (error) {
      console.error('Failed to save business settings:', error);
      alert('Failed to save business settings');
    }
  };

  const tabs = [
    { id: 'profile' as SettingsTab, label: 'Profile', icon: User, adminOnly: false },
    { id: 'security' as SettingsTab, label: 'Security', icon: Lock, adminOnly: false },
    { id: 'notifications' as SettingsTab, label: 'My Notifications', icon: Bell, adminOnly: false },
    { id: 'users' as SettingsTab, label: 'User Management', icon: UsersIcon, adminOnly: true },
    { id: 'business' as SettingsTab, label: 'Business Settings', icon: Building2, adminOnly: true },
    { id: 'checkout-forms' as SettingsTab, label: 'Checkout Forms', icon: FileText, adminOnly: true },
    { id: 'webhooks' as SettingsTab, label: 'Webhooks', icon: Webhook, adminOnly: true },
    { id: 'notifications-config' as SettingsTab, label: 'Notification Config', icon: MessageSquare, adminOnly: true },
    { id: 'permissions' as SettingsTab, label: 'Role Permissions', icon: Shield, adminOnly: true },
  ];

  const visibleTabs = tabs.filter(tab => !tab.adminOnly || isSuperAdmin);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600 mt-1">Manage your account and application preferences</p>
      </div>

      {/* Tabs */}
      <div className="mb-6">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8 overflow-x-auto">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors whitespace-nowrap ${activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                >
                  <div className="flex items-center">
                    <Icon className="w-4 h-4 mr-2" />
                    {tab.label}
                  </div>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'profile' && (
        <div className="space-y-6">
          <Card>
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Personal Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    First Name
                  </label>
                  <input
                    type="text"
                    defaultValue={user?.firstName || ''}
                    disabled={isSalesRep}
                    readOnly={isSalesRep}
                    className={`w-full px-4 py-2 border border-gray-300 rounded-lg ${isSalesRep
                      ? 'bg-gray-50 text-gray-500 cursor-not-allowed'
                      : 'focus:outline-none focus:ring-2 focus:ring-blue-500'
                      }`}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Last Name
                  </label>
                  <input
                    type="text"
                    defaultValue={user?.lastName || ''}
                    disabled={isSalesRep}
                    readOnly={isSalesRep}
                    className={`w-full px-4 py-2 border border-gray-300 rounded-lg ${isSalesRep
                      ? 'bg-gray-50 text-gray-500 cursor-not-allowed'
                      : 'focus:outline-none focus:ring-2 focus:ring-blue-500'
                      }`}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                      type="email"
                      defaultValue={user?.email || ''}
                      disabled={isSalesRep}
                      readOnly={isSalesRep}
                      className={`w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg ${isSalesRep
                        ? 'bg-gray-50 text-gray-500 cursor-not-allowed'
                        : 'focus:outline-none focus:ring-2 focus:ring-blue-500'
                        }`}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Phone Number
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                      type="tel"
                      placeholder="+1 (555) 000-0000"
                      disabled={isSalesRep}
                      readOnly={isSalesRep}
                      className={`w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg ${isSalesRep
                        ? 'bg-gray-50 text-gray-500 cursor-not-allowed'
                        : 'focus:outline-none focus:ring-2 focus:ring-blue-500'
                        }`}
                    />
                  </div>
                </div>
              </div>
              {!isSalesRep && (
                <div className="mt-6 flex justify-end">
                  <Button variant="primary">
                    <Save className="w-4 h-4 mr-2" />
                    Save Changes
                  </Button>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Role & Permissions</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Current Role
                  </label>
                  <input
                    type="text"
                    value={user?.role.replace('_', ' ').toUpperCase() || 'N/A'}
                    disabled
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Member Since
                  </label>
                  <input
                    type="text"
                    value={user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}
                    disabled
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500"
                  />
                </div>
              </div>
            </div>
          </Card>

          {!isSalesRep && (
            <Card>
              <div className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Display Preferences</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between py-4 border-b border-gray-200">
                    <div>
                      <h4 className="font-medium text-gray-900">Default Orders View</h4>
                      <p className="text-sm text-gray-600">Choose your preferred view for the Orders page</p>
                    </div>
                    <select
                      value={user?.preferences?.ordersDefaultView || 'kanban'}
                      onChange={(e) => {
                        const { updatePreferences } = useAuthStore.getState();
                        updatePreferences({ ordersDefaultView: e.target.value as 'kanban' | 'list' });
                      }}
                      className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="kanban">Kanban Board</option>
                      <option value="list">List View</option>
                    </select>
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {activeTab === 'notifications' && (
        <Card>
          <div className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Notification Preferences</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-4 border-b border-gray-200">
                <div>
                  <h4 className="font-medium text-gray-900">Order Updates</h4>
                  <p className="text-sm text-gray-600">Receive notifications when orders are created or updated</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" defaultChecked />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
              {!isSalesRep && (
                <div className="flex items-center justify-between py-4 border-b border-gray-200">
                  <div>
                    <h4 className="font-medium text-gray-900">Payment Notifications</h4>
                    <p className="text-sm text-gray-600">Get notified about payment confirmations and failures</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" defaultChecked />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
              )}
            </div>
            <div className="mt-6 flex justify-end">
              <Button variant="primary">
                <Save className="w-4 h-4 mr-2" />
                Save Preferences
              </Button>
            </div>
          </div>
        </Card>
      )}

      {activeTab === 'security' && (
        <div className="space-y-6">
          <Card>
            <div className="p-6">
              {(isSuperAdmin || isAdmin) ? (
                <>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Change Password</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Current Password
                      </label>
                      <input
                        type="password"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        New Password
                      </label>
                      <input
                        type="password"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Confirm New Password
                      </label>
                      <input
                        type="password"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <div className="mt-6 flex justify-end">
                    <Button variant="primary">
                      <Save className="w-4 h-4 mr-2" />
                      Update Password
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Security Settings</h3>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-start">
                      <Shield className="w-5 h-5 text-blue-600 mr-3 mt-0.5" />
                      <div>
                        <h4 className="font-medium text-blue-900 mb-1">Password Changes Restricted</h4>
                        <p className="text-sm text-blue-700">
                          For security reasons, password changes must be requested from your administrator.
                          Please contact a Super Admin or Admin to reset your password.
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Super Admin Only - User Management */}
      {activeTab === 'users' && isSuperAdmin && (
        <UserManagementTable />
      )}

      {/* Super Admin Only - Business Settings */}
      {activeTab === 'business' && isSuperAdmin && (
        <div className="space-y-6">
          <Card>
            <form onSubmit={handleSaveBusinessSettings}>
              <div className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Business Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Business Name
                    </label>
                    <input
                      type="text"
                      value={businessForm.businessName}
                      onChange={(e) => setBusinessForm({ ...businessForm, businessName: e.target.value })}
                      placeholder="Your Business Name"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Business Email
                    </label>
                    <input
                      type="email"
                      value={businessForm.businessEmail}
                      onChange={(e) => setBusinessForm({ ...businessForm, businessEmail: e.target.value })}
                      placeholder="contact@business.com"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Business Phone
                    </label>
                    <input
                      type="tel"
                      value={businessForm.businessPhone}
                      onChange={(e) => setBusinessForm({ ...businessForm, businessPhone: e.target.value })}
                      placeholder="+1 (555) 000-0000"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Tax ID / VAT Number
                    </label>
                    <input
                      type="text"
                      value={businessForm.taxId}
                      onChange={(e) => setBusinessForm({ ...businessForm, taxId: e.target.value })}
                      placeholder="XX-XXXXXXX"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Global Currency
                    </label>
                    <select
                      value={businessForm.currency}
                      onChange={(e) => setBusinessForm({ ...businessForm, currency: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="USD">USD - US Dollar ($)</option>
                      <option value="GHS">GHS - Ghanaian Cedi (₵)</option>
                      <option value="NGN">NGN - Nigerian Naira (₦)</option>
                      <option value="KES">KES - Kenyan Shilling (KSh)</option>
                      <option value="EUR">EUR - Euro (€)</option>
                      <option value="GBP">GBP - British Pound (£)</option>
                      <option value="INR">INR - Indian Rupee (₹)</option>
                      <option value="CAD">CAD - Canadian Dollar ($)</option>
                      <option value="AUD">AUD - Australian Dollar ($)</option>
                      <option value="JPY">JPY - Japanese Yen (¥)</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Business Address
                    </label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-3 text-gray-400 w-5 h-5" />
                      <textarea
                        value={businessForm.businessAddress}
                        onChange={(e) => setBusinessForm({ ...businessForm, businessAddress: e.target.value })}
                        rows={3}
                        placeholder="123 Business St, State, ZIP"
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-6 flex justify-end">
                  <Button variant="primary" type="submit">
                    <Save className="w-4 h-4 mr-2" />
                    Save Business Settings
                  </Button>
                </div>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Super Admin Only - Notification Configuration */}
      {activeTab === 'notifications-config' && isSuperAdmin && (
        <div className="space-y-6">
          <Card>
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">SMS Provider Settings</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Provider
                  </label>
                  <select className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="twilio">Twilio</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Account SID
                  </label>
                  <input
                    type="text"
                    placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Auth Token
                  </label>
                  <input
                    type="password"
                    placeholder="••••••••••••••••••••••••••••••••"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    placeholder="+1 (555) 000-0000"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Email Provider Settings</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Provider
                  </label>
                  <select className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="sendgrid">SendGrid</option>
                    <option value="smtp">SMTP</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    API Key / Password
                  </label>
                  <input
                    type="password"
                    placeholder="••••••••••••••••••••••••••••••••"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    From Email
                  </label>
                  <input
                    type="email"
                    placeholder="noreply@business.com"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    From Name
                  </label>
                  <input
                    type="text"
                    placeholder="Your Business Name"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Notification Templates</h3>
              <p className="text-sm text-gray-600 mb-4">
                Available variables: <code className="bg-gray-100 px-2 py-1 rounded">{'{customerName}'}</code>,
                <code className="bg-gray-100 px-2 py-1 rounded ml-2">{'{orderNumber}'}</code>,
                <code className="bg-gray-100 px-2 py-1 rounded ml-2">{'{totalAmount}'}</code>
              </p>
              <div className="space-y-6">
                <div>
                  <h4 className="font-medium text-gray-900 mb-3">Order Confirmation</h4>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">SMS Template</label>
                      <textarea
                        rows={2}
                        placeholder="Hi {customerName}, your order {orderNumber} has been confirmed!"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <Button variant="primary">
                  <Save className="w-4 h-4 mr-2" />
                  Save Templates
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Super Admin Only - Checkout Forms */}
      {activeTab === 'checkout-forms' && isSuperAdmin && (
        <Card>
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Checkout Forms</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Create and manage custom checkout forms for your products
                </p>
              </div>
              <Button
                variant="primary"
                onClick={() => window.location.href = '/checkout-forms'}
              >
                <FileText className="w-4 h-4 mr-2" />
                Manage Forms
              </Button>
            </div>
            <div className="space-y-4">
              <div className="border border-gray-200 rounded-lg p-4 bg-blue-50">
                <h4 className="font-medium text-gray-900 mb-2">🚀 Quick Start</h4>
                <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
                  <li>Click "Manage Forms" to open the Checkout Forms page</li>
                  <li>Click "+ Create Checkout Form" button</li>
                  <li>Select a product and configure pricing packages</li>
                  <li>Add optional upsells for extra revenue</li>
                  <li>Customize colors to match your brand</li>
                  <li>Share the public URL with customers!</li>
                </ol>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Super Admin Only - Webhooks */}
      {activeTab === 'webhooks' && isSuperAdmin && (
        <Card>
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Webhooks</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Import orders automatically from external systems via webhooks
                </p>
              </div>
              <Button
                variant="primary"
                onClick={() => window.location.href = '/webhooks'}
              >
                <Webhook className="w-4 h-4 mr-2" />
                Manage Webhooks
              </Button>
            </div>
            <div className="space-y-4">
              <div className="border border-gray-200 rounded-lg p-4 bg-blue-50">
                <h4 className="font-medium text-gray-900 mb-2">🚀 Quick Start</h4>
                <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
                  <li>Click "Manage Webhooks" to open the Webhooks page</li>
                  <li>Click "+ Add Webhook" button</li>
                  <li>Enter your webhook details (name, URL, secret key)</li>
                  <li>Map external field names to internal fields</li>
                  <li>Test your field mapping with sample data</li>
                  <li>Activate the webhook to start importing orders!</li>
                </ol>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Super Admin Only - Role Permissions */}
      {activeTab === 'permissions' && isSuperAdmin && (
        <RolePermissionsMatrix />
      )}
    </div>
  );
};
