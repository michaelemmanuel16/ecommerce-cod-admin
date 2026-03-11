import { PixelConfig } from '../types/checkout-form';

declare global {
  interface Window {
    fbq?: (...args: any[]) => void;
    _fbq?: any;
    gtag?: (...args: any[]) => void;
    dataLayer?: any[];
    ttq?: {
      track: (event: string, data?: object) => void;
      load: (pixelId: string) => void;
      page: () => void;
    };
  }
}

function loadFacebookPixel(pixelId: string): void {
  if (document.getElementById('fb-pixel')) return;

  // Set up fbq stub
  if (!window.fbq) {
    const fbq: any = function (...args: any[]) {
      (fbq.q = fbq.q || []).push(args);
    };
    fbq.q = [];
    fbq.loaded = true;
    fbq.version = '2.0';
    window.fbq = fbq;
    window._fbq = fbq;
  }

  const script = document.createElement('script');
  script.id = 'fb-pixel';
  script.async = true;
  script.src = 'https://connect.facebook.net/en_US/fbevents.js';
  document.head.appendChild(script);

  window.fbq!('init', pixelId);
  window.fbq!('track', 'PageView');
}

function loadGA4(measurementId: string): void {
  if (document.getElementById('ga4-script')) return;

  const script = document.createElement('script');
  script.id = 'ga4-script';
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  if (!window.gtag) {
    window.gtag = function (...args: any[]) {
      window.dataLayer!.push(args);
    };
  }
  window.gtag('js', new Date());
  window.gtag('config', measurementId);
}

function loadTikTokPixel(pixelId: string): void {
  if (document.getElementById('tiktok-pixel')) return;

  // Set up ttq stub
  if (!window.ttq) {
    const ttq: any = {
      _i: [],
      load: function (id: string) { this._i.push([id]); },
      track: function (event: string, data?: object) { this._i.push(['track', event, data]); },
      page: function () { this._i.push(['page']); },
    };
    window.ttq = ttq;
  }

  const script = document.createElement('script');
  script.id = 'tiktok-pixel';
  script.async = true;
  script.src = 'https://analytics.tiktok.com/i18n/pixel/events.js';
  document.head.appendChild(script);

  window.ttq!.load(pixelId);
  window.ttq!.page();
}

function loadGTM(containerId: string): void {
  if (document.getElementById('gtm-script')) return;

  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });

  const script = document.createElement('script');
  script.id = 'gtm-script';
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${containerId}`;
  document.head.appendChild(script);
}

export function initPixels(config: PixelConfig): void {
  if (config.facebookPixelId) loadFacebookPixel(config.facebookPixelId);
  if (config.googleAnalyticsId) loadGA4(config.googleAnalyticsId);
  if (config.tiktokPixelId) loadTikTokPixel(config.tiktokPixelId);
  if (config.googleTagManagerId) loadGTM(config.googleTagManagerId);
}

export function trackPurchase(config: PixelConfig, value: number, currency: string, orderId?: number | string): void {
  if (config.facebookPixelId && window.fbq) {
    window.fbq('track', 'Purchase', { value, currency });
  }

  if (config.googleAnalyticsId && window.gtag) {
    window.gtag('event', 'purchase', {
      currency,
      value,
      transaction_id: orderId ? String(orderId) : Date.now().toString(),
    });
  }

  if (config.tiktokPixelId && window.ttq) {
    window.ttq.track('CompletePayment', { value, currency });
  }

  if (config.googleTagManagerId) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: 'purchase',
      ecommerce: { value, currency },
    });
  }
}
