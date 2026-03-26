import React, { useState, useEffect } from 'react';
import { Save, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { adminService, SystemConfig } from '../../../services/admin.service';
import api from '../../../services/api';

interface SmsIntegrationProps {
  systemConfig: SystemConfig | null;
  onConfigSaved: () => void;
}

export const SmsIntegration: React.FC<SmsIntegrationProps> = ({ systemConfig, onConfigSaved }) => {
  const [form, setForm] = useState({
    provider: 'arkesel',
    authToken: '',
    senderId: '',
    isEnabled: true,
  });
  const [saving, setSaving] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (systemConfig?.smsProvider) {
      setForm({
        provider: systemConfig.smsProvider.provider || 'arkesel',
        authToken: systemConfig.smsProvider.authToken || '',
        senderId: systemConfig.smsProvider.senderId || '',
        isEnabled: systemConfig.smsProvider.isEnabled !== false,
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

  const handleTestSms = async () => {
    if (!testPhone) {
      toast.error('Enter a phone number to test');
      return;
    }
    setTesting(true);
    try {
      await api.post('/api/sms/test', { phoneNumber: testPhone });
      toast.success('Test SMS sent!');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to send test SMS');
    } finally {
      setTesting(false);
    }
  };

  const webhookUrl = `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/sms/webhook`;

  return (
    <Card>
      <form onSubmit={handleSave}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Arkesel SMS Settings</h3>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-sm text-gray-600">{form.isEnabled ? 'Enabled' : 'Disabled'}</span>
              <input
                type="checkbox"
                checked={form.isEnabled}
                onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })}
                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">API Key</label>
              <input
                type="password"
                value={form.authToken}
                onChange={(e) => setForm({ ...form, authToken: e.target.value })}
                placeholder="Your Arkesel API key"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">Found in Arkesel Dashboard &gt; API Keys</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Sender ID</label>
              <input
                type="text"
                value={form.senderId}
                onChange={(e) => setForm({ ...form, senderId: e.target.value.substring(0, 11) })}
                placeholder="CODAdmin"
                maxLength={11}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">Max 11 characters. Must be registered with Arkesel.</p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">Delivery Report Webhook URL</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={webhookUrl}
                  readOnly
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-600 text-sm"
                />
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success('Copied!'); }}
                >
                  Copy
                </Button>
              </div>
              <p className="text-xs text-gray-500 mt-1">Paste this URL in your Arkesel Dashboard for delivery reports.</p>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input
                type="tel"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="+233241234567"
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Button type="button" variant="ghost" onClick={handleTestSms} disabled={testing}>
                <Send className="w-4 h-4 mr-1" />
                {testing ? 'Sending...' : 'Test SMS'}
              </Button>
            </div>
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
