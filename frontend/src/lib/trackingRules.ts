// Tracking id rules (F-416). Same checks and words as backend/src/utils/checkoutFormRules.ts `pixelConfigError`.
import type { PixelConfig } from '../types/checkout-form';
import { PIXEL_PATTERNS } from '../utils/pixelTracking';

// The patterns are the ones the pixel loaders use; the server checks the same three (TikTok is not checked there).
const RULES: Array<{ key: keyof PixelConfig; ok: RegExp; message: string }> = [
  { key: 'facebookPixelId', ok: PIXEL_PATTERNS.facebook, message: 'Facebook Pixel ID must be digits only.' },
  { key: 'googleAnalyticsId', ok: PIXEL_PATTERNS.ga4, message: 'Google Analytics ID must start with G-.' },
  { key: 'googleTagManagerId', ok: PIXEL_PATTERNS.gtm, message: 'Google Tag Manager ID must start with GTM-.' },
];

/** The error for one id, or null. An empty id is allowed. */
export function trackingIdError(key: keyof PixelConfig, value: string | undefined): string | null {
  const rule = RULES.find((r) => r.key === key);
  return rule && value && !rule.ok.test(value) ? rule.message : null;
}

/** The first error in the tracking ids, or null. */
export function pixelConfigError(config: PixelConfig): string | null {
  for (const rule of RULES) {
    const message = trackingIdError(rule.key, config[rule.key]);
    if (message) return message;
  }
  return null;
}

/** The write-only token shows as this mask when a token is stored (backend `SECRET_MASK`). It is never shown on screen. */
export const CAPI_MASK = '••••••••';
