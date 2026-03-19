import React, { useState, useEffect, useCallback } from 'react';
import { Save, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { adminService, SystemConfig, WABAPhoneNumber } from '../../../services/admin.service';
import { WhatsAppOAuthButton } from './WhatsAppOAuthButton';
import { WhatsAppPhonePickerModal } from './WhatsAppPhonePickerModal';

interface WhatsAppIntegrationProps {
  systemConfig: SystemConfig | null;
  onConfigSaved: () => void;
}

type TabMode = 'oauth' | 'manual';

export const WhatsAppIntegration: React.FC<WhatsAppIntegrationProps> = ({ systemConfig, onConfigSaved }) => {
  const [searchParams, setSearchParams] = useSearchParams();

  const [form, setForm] = useState({
    accessToken: '',
    phoneNumberId: '',
    appSecret: '',
    webhookVerifyToken: '',
    isEnabled: false,
  });
  const [status, setStatus] = useState<{
    configured?: boolean;
    enabled?: boolean;
    verifiedName?: string;
    displayPhoneNumber?: string;
    qualityRating?: string;
    error?: string;
  } | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // OAuth state
  const [oauthEnabled, setOauthEnabled] = useState(false);
  const [oauthConnecting, setOauthConnecting] = useState(false);
  const [oauthDisconnecting, setOauthDisconnecting] = useState(false);
  const [showPhonePicker, setShowPhonePicker] = useState(false);
  const [phonePickerPhones, setPhonePickerPhones] = useState<WABAPhoneNumber[]>([]);
  const [phonePickerLoading, setPhonePickerLoading] = useState(false);

  // Determine active tab — default to 'oauth' (preferred), switch to 'manual' only if OAuth unavailable
  const isOAuthConnected = systemConfig?.whatsappProvider?.authMode === 'oauth';
  const [activeTab, setActiveTab] = useState<TabMode>('oauth');

  useEffect(() => {
    if (systemConfig?.whatsappProvider) {
      setForm({
        accessToken: systemConfig.whatsappProvider.accessToken || '',
        phoneNumberId: systemConfig.whatsappProvider.phoneNumberId || '',
        appSecret: systemConfig.whatsappProvider.appSecret || '',
        webhookVerifyToken: systemConfig.whatsappProvider.webhookVerifyToken || '',
        isEnabled: systemConfig.whatsappProvider.isEnabled ?? false,
      });
    }
  }, [systemConfig]);

  // Check if OAuth is available
  useEffect(() => {
    adminService.checkWhatsAppOAuthEnabled()
      .then(({ enabled }) => setOauthEnabled(enabled))
      .catch(() => setOauthEnabled(false));
  }, []);

  // Handle OAuth callback redirect
  useEffect(() => {
    const oauthStatus = searchParams.get('oauth');
    if (!oauthStatus) return;

    if (oauthStatus === 'success') {
      toast.success('WhatsApp OAuth authorized! Fetching phone numbers...');
      handleOAuthSuccess();
    } else if (oauthStatus === 'error') {
      const message = searchParams.get('message') || 'OAuth failed';
      toast.error(message);
    }

    // Clean up URL params
    searchParams.delete('oauth');
    searchParams.delete('message');
    setSearchParams(searchParams, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const data = await adminService.getWhatsAppStatus();
      setStatus(data);
    } catch {
      setStatus({ error: 'Failed to check status' });
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    if (systemConfig?.whatsappProvider?.accessToken) {
      checkStatus();
    }
  }, [systemConfig?.whatsappProvider?.accessToken, checkStatus]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await adminService.updateSystemConfig({ whatsappProvider: { ...form, authMode: 'manual' } });
      toast.success('WhatsApp settings saved');
      onConfigSaved(); // triggers config re-fetch → useEffect fires checkStatus()
    } catch {
      toast.error('Failed to save WhatsApp settings');
    } finally {
      setSaving(false);
    }
  };

  const handleConnectOAuth = async () => {
    setOauthConnecting(true);
    try {
      const { authUrl } = await adminService.initiateWhatsAppOAuth();
      window.open(authUrl, '_blank', 'noopener,noreferrer');
      setOauthConnecting(false);
    } catch {
      toast.error('Failed to initiate OAuth');
      setOauthConnecting(false);
    }
  };

  const handleOAuthSuccess = async () => {
    try {
      const { phones } = await adminService.getWhatsAppOAuthPhones();
      if (phones.length === 0) {
        toast.error('No WhatsApp phone numbers found on your Meta Business account');
        return;
      }
      if (phones.length === 1) {
        // Auto-select single phone
        await handlePhoneSelect(phones[0]);
      } else {
        setPhonePickerPhones(phones);
        setShowPhonePicker(true);
      }
    } catch {
      toast.error('Failed to fetch phone numbers. Please try again.');
    }
  };

  const handlePhoneSelect = async (phone: WABAPhoneNumber) => {
    setPhonePickerLoading(true);
    try {
      await adminService.selectWhatsAppOAuthPhone({
        phoneNumberId: phone.id,
        displayPhone: phone.display_phone_number,
        verifiedName: phone.verified_name,
      });
      toast.success(`Connected: ${phone.verified_name} (${phone.display_phone_number})`);
      setShowPhonePicker(false);
      setActiveTab('oauth');
      onConfigSaved();
    } catch {
      toast.error('Failed to save phone selection');
    } finally {
      setPhonePickerLoading(false);
    }
  };

  const handleDisconnectOAuth = async () => {
    setOauthDisconnecting(true);
    try {
      await adminService.disconnectWhatsAppOAuth();
      toast.success('WhatsApp OAuth disconnected');
      setActiveTab('manual');
      onConfigSaved();
    } catch {
      toast.error('Failed to disconnect');
    } finally {
      setOauthDisconnecting(false);
    }
  };

  return (
    <>
      <Card>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">WhatsApp Business API</h3>
            <div className="flex items-center gap-2">
              {statusLoading ? (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  Checking...
                </span>
              ) : status?.configured && !status?.error ? (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Connected
                </span>
              ) : status?.configured && status?.error ? (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                  <XCircle className="w-3 h-3 mr-1" />
                  Not Connected
                </span>
              ) : (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                  Not Configured
                </span>
              )}
            </div>
          </div>

          {status?.verifiedName && activeTab === 'manual' && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
              <strong>{status.verifiedName}</strong>
              {status.displayPhoneNumber && ` (${status.displayPhoneNumber})`}
              {status.qualityRating && ` — Quality: ${status.qualityRating}`}
            </div>
          )}

          {status?.error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
              {status.error}
            </div>
          )}

          {/* Tab Switcher */}
          <div className="flex border-b border-gray-200 mb-6">
            <button
              type="button"
              onClick={() => setActiveTab('oauth')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'oauth'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Connect with Meta
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('manual')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'manual'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Manual Setup
            </button>
          </div>

          {/* OAuth Tab */}
          {activeTab === 'oauth' && (
            <WhatsAppOAuthButton
              oauthEnabled={oauthEnabled}
              isConnected={isOAuthConnected}
              verifiedName={systemConfig?.whatsappProvider?.oauthVerifiedName}
              displayPhone={systemConfig?.whatsappProvider?.oauthDisplayPhone}
              tokenExpiry={systemConfig?.whatsappProvider?.oauthTokenExpiry}
              onConnect={handleConnectOAuth}
              onDisconnect={handleDisconnectOAuth}
              connecting={oauthConnecting}
              disconnecting={oauthDisconnecting}
            />
          )}

          {/* Manual Tab */}
          {activeTab === 'manual' && (
            <form onSubmit={handleSave}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Access Token</label>
                  <input
                    type="password"
                    value={form.accessToken}
                    onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
                    placeholder="EAAx..."
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Phone Number ID</label>
                  <input
                    type="text"
                    value={form.phoneNumberId}
                    onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })}
                    placeholder="123456789"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">App Secret</label>
                  <input
                    type="password"
                    value={form.appSecret}
                    onChange={(e) => setForm({ ...form, appSecret: e.target.value })}
                    placeholder="abc123..."
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Webhook Verify Token</label>
                  <input
                    type="text"
                    value={form.webhookVerifyToken}
                    onChange={(e) => setForm({ ...form, webhookVerifyToken: e.target.value })}
                    placeholder="my-verify-token"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex items-center">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={form.isEnabled}
                      onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })}
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    <span className="ml-3 text-sm font-medium text-gray-700">Enable WhatsApp</span>
                  </label>
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={checkStatus}
                  disabled={statusLoading}
                >
                  {statusLoading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle className="w-4 h-4 mr-2" />
                  )}
                  Test Connection
                </Button>
                <Button variant="primary" type="submit" disabled={saving}>
                  <Save className="w-4 h-4 mr-2" />
                  {saving ? 'Saving...' : 'Save WhatsApp Settings'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </Card>

      {showPhonePicker && (
        <WhatsAppPhonePickerModal
          phones={phonePickerPhones}
          onSelect={handlePhoneSelect}
          onClose={() => setShowPhonePicker(false)}
          loading={phonePickerLoading}
        />
      )}
    </>
  );
};
