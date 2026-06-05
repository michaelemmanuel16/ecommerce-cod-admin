import React from 'react';
import { Input } from '../../ui/Input';
import { Select } from '../../ui/Select';
import { useCheckoutBuilder } from './checkoutBuilderContextValue';
import { getSupportedCountries } from '../../../utils/countries';

export const SettingsTab: React.FC = () => {
  const ctx = useCheckoutBuilder();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Form Settings</h3>
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <label className="block text-sm font-medium text-gray-700 mb-2">Default Country</label>
          <Select
            {...ctx.register('defaultCountry')}
            options={getSupportedCountries().map((country) => ({ value: country, label: country }))}
          />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Tracking &amp; Pixels</h3>
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Facebook Pixel ID</label>
            <Input
              value={ctx.pixelConfig.facebookPixelId || ''}
              onChange={(e) =>
                ctx.setPixelConfig((p) => ({ ...p, facebookPixelId: e.target.value || undefined }))
              }
              placeholder="e.g. 1234567890123456"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Google Analytics 4 ID</label>
            <Input
              value={ctx.pixelConfig.googleAnalyticsId || ''}
              onChange={(e) =>
                ctx.setPixelConfig((p) => ({ ...p, googleAnalyticsId: e.target.value || undefined }))
              }
              placeholder="e.g. G-XXXXXXXXXX"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">TikTok Pixel ID</label>
            <Input
              value={ctx.pixelConfig.tiktokPixelId || ''}
              onChange={(e) =>
                ctx.setPixelConfig((p) => ({ ...p, tiktokPixelId: e.target.value || undefined }))
              }
              placeholder="e.g. ABCDEFGHIJKLMNOP"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Google Tag Manager ID</label>
            <Input
              value={ctx.pixelConfig.googleTagManagerId || ''}
              onChange={(e) =>
                ctx.setPixelConfig((p) => ({ ...p, googleTagManagerId: e.target.value || undefined }))
              }
              placeholder="e.g. GTM-XXXXXXX"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
