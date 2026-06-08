import React from 'react';
import { Check, Code2 } from 'lucide-react';
import { Input } from '../../ui/Input';
import { Select } from '../../ui/Select';
import { Textarea } from '../../ui/Textarea';
import { Button } from '../../ui/Button';
import { useCheckoutBuilder } from './checkoutBuilderContextValue';
import { getSupportedCountries } from '../../../utils/countries';
import { buildWidgetSnippet } from '../../../lib/embedSnippet';
import { useCopyToClipboard } from '../CopyActions';

export const SettingsTab: React.FC = () => {
  const ctx = useCheckoutBuilder();
  const slug = ctx.watch('slug');
  const name = ctx.watch('name');
  const { copied, copy } = useCopyToClipboard();
  const widgetSnippet = slug ? buildWidgetSnippet({ slug, name }) : '';

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
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Thank You Page</h3>
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <label className="block text-sm font-medium text-gray-700 mb-2">Custom Redirect URL</label>
          <Input
            {...ctx.register('redirectUrl')}
            placeholder="https://yourbrand.com/thank-you"
          />
          <p className="text-xs text-gray-500 mt-2">
            After a successful order, customers are sent here instead of the built-in confirmation
            screen. Order details are appended as <code>?order_id=</code>, <code>total=</code> &amp;{' '}
            <code>currency=</code>. Leave blank to keep the default confirmation page. Your page must
            fire its own purchase pixel.
          </p>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Embed on Your Site</h3>
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Allowed Domains</label>
            <Textarea
              {...ctx.register('allowedOrigins')}
              rows={3}
              placeholder={'https://yourbrand.com\nhttps://shop.yourbrand.com'}
            />
            <p className="text-xs text-gray-500 mt-2">
              One domain per line (including <code>https://</code>). When set, only these sites may
              embed this checkout. Leave blank to allow any site.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Embed Snippet</label>
            {widgetSnippet ? (
              <>
                <pre className="text-xs bg-white border border-gray-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all text-gray-800">
                  {widgetSnippet}
                </pre>
                <div className="mt-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => copy(widgetSnippet)}>
                    {copied ? <Check className="w-4 h-4" /> : <Code2 className="w-4 h-4" />}
                    <span className="ml-1">{copied ? 'Copied' : 'Copy snippet'}</span>
                  </Button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Paste this where you want the checkout to appear. The form renders inline on your
                  page — no iframe.
                </p>
              </>
            ) : (
              <p className="text-xs text-gray-500">Save the form (it needs a slug) to get the embed snippet.</p>
            )}
          </div>
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
