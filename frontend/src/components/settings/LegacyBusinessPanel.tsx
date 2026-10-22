import React, { useEffect, useState } from 'react';
import { MapPin, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { adminService, type SystemConfig } from '../../services/admin.service';
import { useConfigStore } from '../../stores/configStore';
import { SUPPORTED_CURRENCIES, getCurrencyOptionLabel } from '../../utils/countries';

/**
 * The old Business Settings form, moved out of pages/Settings.tsx unchanged (M3-T63). M3-T65 replaces it with the
 * new Business details tab.
 */
export const LegacyBusinessPanel: React.FC<{ systemConfig: SystemConfig | null; onSaved: () => void }> = ({ systemConfig, onSaved }) => {
  const [businessForm, setBusinessForm] = useState({
    businessName: '',
    businessEmail: '',
    businessPhone: '',
    businessAddress: '',
    taxId: '',
    currency: 'USD',
  });

  useEffect(() => {
    if (!systemConfig) return;
    setBusinessForm({
      businessName: systemConfig.businessName || '',
      businessEmail: systemConfig.businessEmail || '',
      businessPhone: systemConfig.businessPhone || '',
      businessAddress: systemConfig.businessAddress || '',
      taxId: systemConfig.taxId || '',
      currency: systemConfig.currency || 'USD',
    });
  }, [systemConfig]);

  const handleSaveBusinessSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await adminService.updateSystemConfig(businessForm);
      toast.success('Business settings saved successfully');
      onSaved();
      useConfigStore.getState().fetchConfig();
    } catch (error) {
      console.error('Failed to save business settings:', error);
      toast.error('Failed to save business settings');
    }
  };

  return (
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
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option key={c} value={c}>{getCurrencyOptionLabel(c)}</option>
                  ))}
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
  );
};
