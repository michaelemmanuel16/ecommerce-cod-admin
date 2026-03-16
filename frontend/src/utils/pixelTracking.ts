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

function generateEventId(): string | undefined {
  return typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : undefined;
}

// Tracks which pixel+event combinations have already been sent to prevent
// duplicate beacons from React StrictMode, component remounts, etc.
const sentBeacons = new Set<string>();

function sendFbPixelBeacon(pixelId: string, event: string, params?: Record<string, string | number>, eventId?: string): void {
  const url = new URL('https://www.facebook.com/tr');
  url.searchParams.set('id', pixelId);
  url.searchParams.set('ev', event);
  url.searchParams.set('noscript', '1');
  if (eventId) {
    url.searchParams.set('eid', eventId);
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
  }
  const img = new Image(1, 1);
  img.style.display = 'none';
  img.onload = () => img.remove();
  img.onerror = () => img.remove();
  img.src = url.toString();
  (document.body ?? document.documentElement).appendChild(img);
}

function loadFacebookPixel(pixelId: string): void {
  if (!/^\d+$/.test(pixelId)) return;

  // Dedup: checkout is a single page with no SPA navigation, so one
  // PageView per pixel per module lifetime is correct.
  const beaconKey = `pageview-${pixelId}`;
  if (sentBeacons.has(beaconKey)) return;
  sentBeacons.add(beaconKey);

  const eventId = generateEventId();

  if (!window.fbq) {
    // Inject Facebook's exact standard pixel snippet via inline script.
    // This must run as a single inline script to ensure fbevents.js
    // fully initializes its internal pipeline (plugins, beacon sender).
    const script = document.createElement('script');
    script.textContent = eventId
      ? `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixelId}');fbq('track','PageView',{},{eventID:'${eventId}'});`
      : `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixelId}');fbq('track','PageView');`;
    document.head.appendChild(script);
  } else {
    // fbq already exists (e.g. GTM on WordPress parent page) —
    // still need to register our pixel ID so trackPurchase events route correctly
    window.fbq('init', pixelId);
    window.fbq('track', 'PageView', {}, eventId ? { eventID: eventId } : {});
  }

  // NOTE: Both fbq and the image beacon always fire together.
  // Facebook deduplicates via the shared eventID.
  // Intentional: fbevents.js can silently drop beacons even when fbq exists,
  // and fbq may have been pre-loaded by a parent page (e.g. GTM on WordPress).
  sendFbPixelBeacon(pixelId, 'PageView', undefined, eventId);
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

export function trackInitiateCheckout(config: PixelConfig): void {
  if (config.facebookPixelId && window.fbq) {
    window.fbq('track', 'InitiateCheckout');
  }

  if (config.googleAnalyticsId && window.gtag) {
    window.gtag('event', 'begin_checkout');
  }

  if (config.tiktokPixelId && window.ttq) {
    window.ttq.track('InitiateCheckout');
  }

  if (config.googleTagManagerId) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: 'begin_checkout' });
  }
}

export function trackPurchase(config: PixelConfig, value: number, currency: string, orderId?: number | string): void {
  if (config.facebookPixelId && /^\d+$/.test(config.facebookPixelId)) {
    // Dedup by orderId when available; skip dedup if no orderId (can't reliably dedup)
    const purchaseKey = orderId != null ? `purchase-${config.facebookPixelId}-${orderId}` : null;
    if (!purchaseKey || !sentBeacons.has(purchaseKey)) {
      if (purchaseKey) sentBeacons.add(purchaseKey);
      const eventId = generateEventId();
      if (window.fbq) {
        window.fbq('track', 'Purchase', { value, currency }, eventId ? { eventID: eventId } : {});
      }
      // NOTE: Both fbq and the image beacon always fire together.
      // Facebook deduplicates via the shared eventID.
      // Intentional: fbevents.js can silently drop beacons even when fbq exists.
      sendFbPixelBeacon(config.facebookPixelId, 'Purchase', { 'cd[value]': value, 'cd[currency]': currency }, eventId);
    }
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
