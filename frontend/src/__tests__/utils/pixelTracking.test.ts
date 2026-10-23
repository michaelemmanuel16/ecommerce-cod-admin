// COD-37 (M3b-T19, F-407): regression tests for the pixel helpers. The helpers are not changed by M3b; these tests pin
// what they do now so a restyle of the public page cannot break tracking without a red test.
// The module keeps a `sentBeacons` set, so every test loads a fresh copy.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type Mod = typeof import('../../utils/pixelTracking');
const load = async (): Promise<Mod> => {
  vi.resetModules();
  return import('../../utils/pixelTracking');
};

/** The facebook.com/tr image beacons the helpers put in the page. jsdom loads no images, so nothing leaves the test. */
const beacons = () =>
  Array.from(document.querySelectorAll('img')).map((img) => new URL(img.getAttribute('src') ?? img.src));

const clearCookies = () => {
  for (const c of document.cookie.split('; ')) {
    const name = c.split('=')[0];
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
};

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  delete (window as any).fbq;
  delete (window as any)._fbq;
  delete (window as any).gtag;
  delete (window as any).ttq;
  delete (window as any).dataLayer;
  clearCookies();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PIXEL_PATTERNS', () => {
  it('accepts the four id shapes and nothing else', async () => {
    const { PIXEL_PATTERNS: P } = await load();
    expect(P.facebook.test('482915073361842')).toBe(true);
    expect(P.facebook.test('48x')).toBe(false);
    expect(P.ga4.test('G-ABC123')).toBe(true);
    expect(P.ga4.test('UA-123')).toBe(false);
    expect(P.gtm.test('GTM-ABC12')).toBe(true);
    expect(P.gtm.test('G-ABC')).toBe(false);
    expect(P.tiktok.test('C9ABCDEF123')).toBe(true);
    expect(P.tiktok.test('has space')).toBe(false);
  });
});

describe('initPixels', () => {
  it('Facebook id: injects the standard snippet with an init and a PageView carrying an eventID, plus one image beacon with the same id', async () => {
    const { initPixels } = await load();
    initPixels({ facebookPixelId: '482915073361842' });

    const snippet = Array.from(document.head.querySelectorAll('script')).map((s) => s.textContent ?? '').join('\n');
    expect(snippet).toContain("fbq('init','482915073361842')");
    expect(snippet).toContain("fbq('track','PageView'");
    expect(snippet).toContain('https://connect.facebook.net/en_US/fbevents.js');
    const snippetEventId = snippet.match(/eventID:'([^']+)'/)?.[1];

    const [beacon] = beacons();
    expect(beacons()).toHaveLength(1);
    expect(beacon.origin + beacon.pathname).toBe('https://www.facebook.com/tr');
    expect(beacon.searchParams.get('id')).toBe('482915073361842');
    expect(beacon.searchParams.get('ev')).toBe('PageView');
    // fbq and the beacon share one id so Meta counts one PageView
    expect(beacon.searchParams.get('eid')).toBe(snippetEventId);
  });

  it('Facebook id: fbq already on the page (GTM parent) gets init and PageView directly', async () => {
    const fbq = vi.fn();
    (window as any).fbq = fbq;
    const { initPixels } = await load();
    initPixels({ facebookPixelId: '111' });
    expect(fbq).toHaveBeenCalledWith('init', '111');
    expect(fbq).toHaveBeenCalledWith('track', 'PageView', {}, expect.objectContaining({ eventID: expect.any(String) }));
    expect(document.head.querySelectorAll('script')).toHaveLength(0);
  });

  it('Facebook id: a second call for the same pixel sends nothing more (StrictMode / remount guard)', async () => {
    const { initPixels } = await load();
    initPixels({ facebookPixelId: '111' });
    initPixels({ facebookPixelId: '111' });
    expect(beacons()).toHaveLength(1);
    expect(document.head.querySelectorAll('script')).toHaveLength(1);
  });

  it('Facebook id that is not digits loads nothing', async () => {
    const { initPixels } = await load();
    initPixels({ facebookPixelId: '12ab' });
    expect(document.head.querySelectorAll('script')).toHaveLength(0);
    expect(beacons()).toHaveLength(0);
  });

  it('GA4 id: loads gtag.js once and configures it', async () => {
    const { initPixels } = await load();
    initPixels({ googleAnalyticsId: 'G-ABC123' });
    initPixels({ googleAnalyticsId: 'G-ABC123' });
    const script = document.getElementById('ga4-script') as HTMLScriptElement;
    expect(script.src).toBe('https://www.googletagmanager.com/gtag/js?id=G-ABC123');
    expect(document.querySelectorAll('#ga4-script')).toHaveLength(1);
    const calls = (window.dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>)[0]);
    expect(calls).toEqual(['js', 'config']);
  });

  it('TikTok id: loads the events script once and registers the pixel', async () => {
    const { initPixels } = await load();
    initPixels({ tiktokPixelId: 'C9ABCDEF123' });
    initPixels({ tiktokPixelId: 'C9ABCDEF123' });
    expect((document.getElementById('tiktok-pixel') as HTMLScriptElement).src).toBe('https://analytics.tiktok.com/i18n/pixel/events.js');
    expect(document.querySelectorAll('#tiktok-pixel')).toHaveLength(1);
    expect((window.ttq as any)._i).toEqual([['C9ABCDEF123'], ['page']]);
  });

  it('GTM id: loads gtm.js once and pushes gtm.start', async () => {
    const { initPixels } = await load();
    initPixels({ googleTagManagerId: 'GTM-ABC12' });
    initPixels({ googleTagManagerId: 'GTM-ABC12' });
    expect((document.getElementById('gtm-script') as HTMLScriptElement).src).toBe('https://www.googletagmanager.com/gtm.js?id=GTM-ABC12');
    expect(document.querySelectorAll('#gtm-script')).toHaveLength(1);
    expect(window.dataLayer?.[0]).toMatchObject({ event: 'gtm.js' });
  });

  it('an empty config, or ids with the wrong shape, load nothing', async () => {
    const { initPixels } = await load();
    initPixels({});
    initPixels({ googleAnalyticsId: 'UA-1', googleTagManagerId: 'G-1', tiktokPixelId: 'bad id' });
    expect(document.head.querySelectorAll('script')).toHaveLength(0);
    expect(beacons()).toHaveLength(0);
  });
});

describe('getFbCookies', () => {
  it('reads _fbp and _fbc, URL-decoded', async () => {
    document.cookie = '_fbp=fb.1.123.456';
    document.cookie = '_fbc=fb.1.123.AB%3DCD';
    const { getFbCookies } = await load();
    expect(getFbCookies()).toEqual({ fbp: 'fb.1.123.456', fbc: 'fb.1.123.AB=CD' });
  });

  it('builds _fbc from the fbclid in the URL when the cookie is missing', async () => {
    window.history.replaceState({}, '', '/form/x?fbclid=CLICK1');
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const { getFbCookies } = await load();
    expect(getFbCookies()).toEqual({ fbc: 'fb.1.1700000000000.CLICK1' });
  });

  it('returns an empty object with no cookie and no fbclid', async () => {
    const { getFbCookies } = await load();
    expect(getFbCookies()).toEqual({});
  });
});

describe('fireInitiateCheckoutWithCapi', () => {
  it('fires the browser event and forwards the SAME eventId, the page URL and the fb cookies to the CAPI transport', async () => {
    const fbq = vi.fn();
    (window as any).fbq = fbq;
    document.cookie = '_fbp=fb.1.9.p';
    const send = vi.fn().mockResolvedValue({});
    const { fireInitiateCheckoutWithCapi } = await load();
    fireInitiateCheckoutWithCapi({ facebookPixelId: '111' }, send);

    const [, event, , opts] = fbq.mock.calls.find((c) => c[1] === 'InitiateCheckout')!;
    expect(event).toBe('InitiateCheckout');
    const browserEventId = opts.eventID as string;
    expect(browserEventId).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ eventId: browserEventId, eventSourceUrl: window.location.href, fbp: 'fb.1.9.p' });
    // the image beacon carries the same id
    const beacon = beacons().find((b) => b.searchParams.get('ev') === 'InitiateCheckout')!;
    expect(beacon.searchParams.get('eid')).toBe(browserEventId);
  });

  it('fires once per page lifetime: a second call sends no CAPI call', async () => {
    const send = vi.fn().mockResolvedValue({});
    const { fireInitiateCheckoutWithCapi } = await load();
    fireInitiateCheckoutWithCapi({ facebookPixelId: '111' }, send);
    fireInitiateCheckoutWithCapi({ facebookPixelId: '111' }, send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends no CAPI call when no Facebook pixel is set', async () => {
    const send = vi.fn().mockResolvedValue({});
    const { fireInitiateCheckoutWithCapi } = await load();
    fireInitiateCheckoutWithCapi({ googleAnalyticsId: 'G-ABC123' }, send);
    fireInitiateCheckoutWithCapi({}, send);
    expect(send).not.toHaveBeenCalled();
  });

  it('a CAPI transport that rejects never throws into checkout', async () => {
    const send = vi.fn().mockRejectedValue(new Error('network'));
    const { fireInitiateCheckoutWithCapi } = await load();
    expect(() => fireInitiateCheckoutWithCapi({ facebookPixelId: '111' }, send)).not.toThrow();
    await Promise.resolve();
  });
});

describe('trackPurchase', () => {
  it('uses the raw order id as eventID on fbq and on the beacon (matches the server CAPI event_id for COD)', async () => {
    const fbq = vi.fn();
    (window as any).fbq = fbq;
    const { trackPurchase } = await load();
    trackPurchase({ facebookPixelId: '111' }, 289, 'GHS', 24118);

    expect(fbq).toHaveBeenCalledWith('track', 'Purchase', { value: 289, currency: 'GHS' }, { eventID: '24118' });
    const beacon = beacons().find((b) => b.searchParams.get('ev') === 'Purchase')!;
    expect(beacon.searchParams.get('eid')).toBe('24118');
    expect(beacon.searchParams.get('cd[value]')).toBe('289');
    expect(beacon.searchParams.get('cd[currency]')).toBe('GHS');
  });

  it('a second call for the same order sends nothing more', async () => {
    const fbq = vi.fn();
    (window as any).fbq = fbq;
    const { trackPurchase } = await load();
    trackPurchase({ facebookPixelId: '111' }, 289, 'GHS', 24118);
    trackPurchase({ facebookPixelId: '111' }, 289, 'GHS', 24118);
    expect(fbq).toHaveBeenCalledTimes(1);
    expect(beacons()).toHaveLength(1);
  });

  it('a different order for the same pixel does fire', async () => {
    const fbq = vi.fn();
    (window as any).fbq = fbq;
    const { trackPurchase } = await load();
    trackPurchase({ facebookPixelId: '111' }, 289, 'GHS', 1);
    trackPurchase({ facebookPixelId: '111' }, 289, 'GHS', 2);
    expect(fbq).toHaveBeenCalledTimes(2);
  });

  it('sends the other pixels their purchase event too', async () => {
    const gtag = vi.fn();
    const track = vi.fn();
    (window as any).gtag = gtag;
    (window as any).ttq = { track, load: vi.fn(), page: vi.fn() };
    const { trackPurchase } = await load();
    trackPurchase({ googleAnalyticsId: 'G-ABC123', tiktokPixelId: 'C9ABC', googleTagManagerId: 'GTM-ABC12' }, 100, 'NGN', 7);
    expect(gtag).toHaveBeenCalledWith('event', 'purchase', { currency: 'NGN', value: 100, transaction_id: '7' });
    expect(track).toHaveBeenCalledWith('CompletePayment', { value: 100, currency: 'NGN' });
    expect(window.dataLayer).toContainEqual({ event: 'purchase', ecommerce: { value: 100, currency: 'NGN' } });
  });

  it('sends nothing for a Facebook id that is not digits', async () => {
    const fbq = vi.fn();
    (window as any).fbq = fbq;
    const { trackPurchase } = await load();
    trackPurchase({ facebookPixelId: 'abc' }, 1, 'GHS', 5);
    expect(fbq).not.toHaveBeenCalled();
    expect(beacons()).toHaveLength(0);
  });
});
