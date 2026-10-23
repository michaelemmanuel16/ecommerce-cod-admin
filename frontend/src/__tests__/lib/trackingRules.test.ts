import { describe, it, expect } from 'vitest';
import { pixelConfigError, trackingIdError } from '../../lib/trackingRules';

describe('tracking id rules (same words as the server)', () => {
  it('Facebook pixel id is digits only', () => {
    expect(trackingIdError('facebookPixelId', '12ab')).toBe('Facebook Pixel ID must be digits only.');
    expect(trackingIdError('facebookPixelId', '482915073361842')).toBeNull();
  });

  it('GA4 starts with G- and GTM with GTM-', () => {
    expect(trackingIdError('googleAnalyticsId', 'UA-1')).toBe('Google Analytics ID must start with G-.');
    expect(trackingIdError('googleAnalyticsId', 'G-ABC123')).toBeNull();
    expect(trackingIdError('googleTagManagerId', 'G-1')).toBe('Google Tag Manager ID must start with GTM-.');
    expect(trackingIdError('googleTagManagerId', 'GTM-ABC12')).toBeNull();
  });

  it('empty ids and TikTok ids are not checked', () => {
    expect(pixelConfigError({ facebookPixelId: '', tiktokPixelId: 'anything' })).toBeNull();
    expect(pixelConfigError({})).toBeNull();
  });

  it('pixelConfigError returns the first problem', () => {
    expect(pixelConfigError({ facebookPixelId: 'x', googleAnalyticsId: 'y' })).toBe('Facebook Pixel ID must be digits only.');
  });
});
