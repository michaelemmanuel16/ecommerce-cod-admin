import React, { useState, useEffect } from 'react';
import { Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { adminService, SystemConfig } from '../../../services/admin.service';

interface PaystackIntegrationProps {
  systemConfig: SystemConfig | null;
  onConfigSaved: () => void;
}

export const PaystackIntegration: React.FC<PaystackIntegrationProps> = ({ systemConfig, onConfigSaved }) => {
  const [form, setForm] = useState({
    publicKey: '',
    secretKey: '',
    webhookSecret: '',
    isEnabled: true,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (systemConfig?.paystackProvider) {
      setForm({
        publicKey: systemConfig.paystackProvider.publicKey || '',
        secretKey: systemConfig.paystackProvider.secretKey || '',
        webhookSecret: systemConfig.paystackProvider.webhookSecret || '',
        isEnabled: systemConfig.paystackProvider.isEnabled !== false,
      });
    }
  }, [systemConfig]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await adminService.updateSystemConfig({ paystackProvider: form });
      toast.success('Paystack settings saved');
      onConfigSaved();
    } catch {
      toast.error('Failed to save Paystack settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <form onSubmit={handleSave}>
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Paystack Payment Settings</h3>
          <p className="text-sm text-gray-500 mb-6">
            Configure Paystack for accepting online payments on digital products.
          </p>
          <div className="grid grid-cols-1 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Public Key</label>
              <input
                type="text"
                value={form.publicKey}
                onChange={(e) => setForm({ ...form, publicKey: e.target.value })}
                placeholder="pk_live_xxxxxxxxxx or pk_test_xxxxxxxxxx"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Secret Key</label>
              <input
                type="password"
                value={form.secretKey}
                onChange={(e) => setForm({ ...form, secretKey: e.target.value })}
                placeholder="Your Paystack secret key"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Webhook Secret</label>
              <input
                type="password"
                value={form.webhookSecret}
                onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })}
                placeholder="Paystack webhook secret for signature verification"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Set your webhook URL in Paystack dashboard to: <code className="bg-gray-100 px-1 rounded">{window.location.origin}/api/paystack/webhook</code>
              </p>
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                id="paystackEnabled"
                checked={form.isEnabled}
                onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="paystackEnabled" className="ml-2 block text-sm text-gray-900">
                Enable Paystack payments
              </label>
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <Button variant="primary" type="submit" disabled={saving}>
              <Save className="w-4 h-4 mr-2" />
              {saving ? 'Saving...' : 'Save Paystack Settings'}
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
};
