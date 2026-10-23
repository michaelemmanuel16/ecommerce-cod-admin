import React from 'react';
import { Input } from '../../ui/Input';
import { useCheckoutBuilder } from './checkoutBuilderContextValue';

export const SettingsTab: React.FC = () => {
  const ctx = useCheckoutBuilder();

  // Payment-method matrix (MAN-58). At most two methods may be enabled, so the
  // public checkout never shows more than two buttons. Once two are on, the
  // remaining unchecked toggle is disabled until one is turned off.
  const codEnabled = ctx.watch('codEnabled');
  const depositEnabled = ctx.watch('paystackDepositEnabled');
  const fullEnabled = ctx.watch('paystackFullEnabled');
  const enabledCount = [codEnabled, depositEnabled, fullEnabled].filter(Boolean).length;
  const atMax = enabledCount >= 2;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Payment Methods <span className="font-normal text-gray-400">(Nigeria only)</span></h3>
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-3">
          <p className="text-xs text-gray-500">
            Choose which payment buttons appear on the checkout. Enable up to two.
          </p>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              {...ctx.register('codEnabled')}
              disabled={!codEnabled && atMax}
              className="h-4 w-4 rounded border-gray-300 text-gray-900 disabled:opacity-40"
            />
            <span className="text-sm text-gray-700">Cash on Delivery</span>
          </label>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              {...ctx.register('paystackDepositEnabled')}
              disabled={!depositEnabled && atMax}
              className="h-4 w-4 rounded border-gray-300 text-gray-900 disabled:opacity-40"
            />
            <span className="text-sm text-gray-700">Pay a Deposit (Paystack)</span>
          </label>

          {depositEnabled && (
            <div className="ml-7">
              <label className="block text-xs font-medium text-gray-700 mb-1">Deposit percentage</label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={99}
                  className="w-24"
                  {...ctx.register('depositPercent', { valueAsNumber: true })}
                />
                <span className="text-sm text-gray-500">% paid online; balance collected on delivery</span>
              </div>
            </div>
          )}

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              {...ctx.register('paystackFullEnabled')}
              disabled={!fullEnabled && atMax}
              className="h-4 w-4 rounded border-gray-300 text-gray-900 disabled:opacity-40"
            />
            <span className="text-sm text-gray-700">Pay in Full (Paystack)</span>
          </label>

          {atMax && (
            <p className="text-xs text-amber-600">
              Two methods are enabled. Turn one off to switch to another.
            </p>
          )}
          {(depositEnabled || fullEnabled) && (
            <p className="text-xs text-gray-500">
              Paystack methods require your Paystack keys under{' '}
              <a href="/settings/integrations" className="underline">Settings → Integrations</a>.
            </p>
          )}
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

          <div className="border-t border-gray-200 pt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Meta Conversion API Access Token</label>
            <Input
              type="password"
              autoComplete="off"
              {...ctx.register('metaCapiAccessToken')}
              placeholder="Paste your Meta CAPI access token"
            />
            <p className="text-xs text-gray-500 mt-1">
              Sends server-side <code>Purchase</code> events (paired with the Facebook Pixel ID above)
              so conversions survive iOS / in-app-browser blockers. Stored encrypted; leave the dots in
              place to keep the saved token.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Meta CAPI Test Event Code (dev only)</label>
            <Input
              {...ctx.register('metaCapiTestEventCode')}
              placeholder="e.g. TEST12345"
            />
            <p className="text-xs text-gray-500 mt-1">
              Optional. Routes events to Meta&apos;s Test Events tool for debugging. Remove before going live.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
