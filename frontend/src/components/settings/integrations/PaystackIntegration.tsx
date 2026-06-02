import React, { useState, useEffect } from 'react';
import { Save, Copy, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { adminService, SystemConfig } from '../../../services/admin.service';

interface PaystackIntegrationProps {
  systemConfig: SystemConfig | null;
  onConfigSaved: () => void;
}

type PaystackMode = 'test' | 'live';

export const PaystackIntegration: React.FC<PaystackIntegrationProps> = ({ systemConfig, onConfigSaved }) => {
  const [form, setForm] = useState({
    publicKey: '',
    secretKey: '',
    webhookSecret: '',
    mode: 'test' as PaystackMode,
    isEnabled: true,
  });
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (systemConfig?.paystackProvider) {
      setForm({
        publicKey: systemConfig.paystackProvider.publicKey || '',
        secretKey: systemConfig.paystackProvider.secretKey || '',
        webhookSecret: systemConfig.paystackProvider.webhookSecret || '',
        mode: systemConfig.paystackProvider.mode === 'live' ? 'live' : 'test',
        isEnabled: systemConfig.paystackProvider.isEnabled !== false,
      });
    }
  }, [systemConfig]);

  const tenantSlug = systemConfig?.tenantSlug ?? null;
  const webhookUrl = tenantSlug
    ? `${window.location.origin}/api/paystack/webhook/${tenantSlug}`
    : null;

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

  const handleCopyWebhookUrl = async () => {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy URL');
    }
  };

  return (
    <Card>
      <form onSubmit={handleSave}>
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Paystack Payment Settings</h3>
          <p className="text-sm text-gray-500 mb-6">
            Each tenant uses their own Paystack account. Buyer payments settle into the bank attached to these keys.
          </p>
          <div className="grid grid-cols-1 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Mode</label>
              <select
                value={form.mode}
                onChange={(e) => setForm({ ...form, mode: e.target.value as PaystackMode })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="test">Test</option>
                <option value="live">Live</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Use Test keys (<code className="bg-gray-100 px-1 rounded">pk_test_*</code>) before going live.
              </p>
            </div>
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

          {webhookUrl && (
            <div className="mt-8 border-t border-gray-200 pt-6">
              <h4 className="text-sm font-medium text-gray-900 mb-2">Your Webhook URL</h4>
              <p className="text-xs text-gray-600 mb-3">
                Open your Paystack dashboard → Settings → API Keys & Webhooks → paste this URL into the Webhook URL field → save.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-gray-100 px-3 py-2 rounded text-sm font-mono break-all">
                  {webhookUrl}
                </code>
                <Button type="button" variant="secondary" onClick={handleCopyWebhookUrl}>
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span className="ml-1.5">{copied ? 'Copied' : 'Copy'}</span>
                </Button>
              </div>
            </div>
          )}

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
