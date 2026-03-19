import React, { useState, useEffect } from 'react';
import { Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { adminService, SystemConfig } from '../../../services/admin.service';

interface SmsIntegrationProps {
  systemConfig: SystemConfig | null;
  onConfigSaved: () => void;
}

export const SmsIntegration: React.FC<SmsIntegrationProps> = ({ systemConfig, onConfigSaved }) => {
  const [form, setForm] = useState({
    provider: 'twilio',
    accountSid: '',
    authToken: '',
    phoneNumber: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (systemConfig?.smsProvider) {
      setForm({
        provider: systemConfig.smsProvider.provider || 'twilio',
        accountSid: systemConfig.smsProvider.accountSid || '',
        authToken: systemConfig.smsProvider.authToken || '',
        phoneNumber: systemConfig.smsProvider.phoneNumber || '',
      });
    }
  }, [systemConfig]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await adminService.updateSystemConfig({ smsProvider: form });
      toast.success('SMS settings saved');
      onConfigSaved();
    } catch {
      toast.error('Failed to save SMS settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <form onSubmit={handleSave}>
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">SMS Provider Settings</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">Provider</label>
              <select
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="twilio">Twilio</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Account SID</label>
              <input
                type="text"
                value={form.accountSid}
                onChange={(e) => setForm({ ...form, accountSid: e.target.value })}
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Auth Token</label>
              <input
                type="password"
                value={form.authToken}
                onChange={(e) => setForm({ ...form, authToken: e.target.value })}
                placeholder="••••••••••••••••••••••••••••••••"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">Phone Number</label>
              <input
                type="tel"
                value={form.phoneNumber}
                onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
                placeholder="+1 (555) 000-0000"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <Button variant="primary" type="submit" disabled={saving}>
              <Save className="w-4 h-4 mr-2" />
              {saving ? 'Saving...' : 'Save SMS Settings'}
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
};
