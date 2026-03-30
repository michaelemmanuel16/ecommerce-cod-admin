import React, { useState, useEffect } from 'react';
import { Save, SendHorizontal } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { adminService, SystemConfig } from '../../../services/admin.service';
import apiClient from '../../../services/api';

interface EmailIntegrationProps {
  systemConfig: SystemConfig | null;
  onConfigSaved: () => void;
}

export const EmailIntegration: React.FC<EmailIntegrationProps> = ({ systemConfig, onConfigSaved }) => {
  const [form, setForm] = useState({
    provider: 'sendgrid',
    apiKey: '',
    fromEmail: '',
    fromName: '',
  });
  const [saving, setSaving] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (systemConfig?.emailProvider) {
      setForm({
        provider: systemConfig.emailProvider.provider || 'sendgrid',
        apiKey: systemConfig.emailProvider.apiKey || '',
        fromEmail: systemConfig.emailProvider.fromEmail || '',
        fromName: systemConfig.emailProvider.fromName || '',
      });
    }
  }, [systemConfig]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await adminService.updateSystemConfig({ emailProvider: form });
      toast.success('Email settings saved');
      onConfigSaved();
    } catch {
      toast.error('Failed to save email settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testEmail) {
      toast.error('Enter an email address to send the test to');
      return;
    }
    setTesting(true);
    try {
      await apiClient.post('/api/email/test', { email: testEmail });
      toast.success(`Test email sent to ${testEmail}`);
    } catch (error: any) {
      const msg = error.response?.data?.error || error.message || 'Failed to send test email';
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <form onSubmit={handleSave}>
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Email Provider Settings</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">Provider</label>
              <select
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="sendgrid">SendGrid</option>
                <option value="resend">Resend</option>
                <option value="smtp">SMTP</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">API Key / Password</label>
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder="••••••••••••••••••••••••••••••••"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">From Email</label>
              <input
                type="email"
                value={form.fromEmail}
                onChange={(e) => setForm({ ...form, fromEmail: e.target.value })}
                placeholder="noreply@business.com"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">From Name</label>
              <input
                type="text"
                value={form.fromName}
                onChange={(e) => setForm({ ...form, fromName: e.target.value })}
                placeholder="Your Business Name"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Test Email Section */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <h4 className="text-sm font-medium text-gray-700 mb-3">Test Email</h4>
            <div className="flex gap-3">
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="Enter email to send test"
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={handleTest}
                disabled={testing || !testEmail}
              >
                <SendHorizontal className="w-4 h-4 mr-2" />
                {testing ? 'Sending...' : 'Send Test'}
              </Button>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Save your settings first, then send a test email to verify the configuration works.
            </p>
          </div>

          <div className="mt-6 flex justify-end">
            <Button variant="primary" type="submit" disabled={saving}>
              <Save className="w-4 h-4 mr-2" />
              {saving ? 'Saving...' : 'Save Email Settings'}
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
};
