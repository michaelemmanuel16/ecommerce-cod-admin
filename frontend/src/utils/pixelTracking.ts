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
  if (window.fbq) return;

  // Use Facebook's exact standard pixel base code
  const n: any = (window.fbq = function (...args: any[]) {
    n.callMethod ? n.callMethod.apply(n, args) : n.queue.push(args);
  });
  if (!window._fbq) window._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = '2.0';
  n.queue = [];

  const t = document.createElement('script');
  t.async = true;
  t.src = 'https://connect.facebook.net/en_US/fbevents.js';
  const s = document.getElementsByTagName('script')[0];
  s.parentNode!.insertBefore(t, s);

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

const PIXEL_PATTERNS: Record<string, RegExp> = {
  facebook: /^\d+$/,
  ga4: /^G-[A-Z0-9]+$/,
  tiktok: /^[A-Z0-9]+$/i,
  gtm: /^GTM-[A-Z0-9]+$/,
};

export function initPixels(config: PixelConfig): void {
  if (config.facebookPixelId && PIXEL_PATTERNS.facebook.test(config.facebookPixelId))
    loadFacebookPixel(config.facebookPixelId);
  if (config.googleAnalyticsId && PIXEL_PATTERNS.ga4.test(config.googleAnalyticsId))
    loadGA4(config.googleAnalyticsId);
  if (config.tiktokPixelId && PIXEL_PATTERNS.tiktok.test(config.tiktokPixelId))
    loadTikTokPixel(config.tiktokPixelId);
  if (config.googleTagManagerId && PIXEL_PATTERNS.gtm.test(config.googleTagManagerId))
    loadGTM(config.googleTagManagerId);
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
