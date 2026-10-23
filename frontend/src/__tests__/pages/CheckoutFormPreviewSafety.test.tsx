/**
 * F-419: the preview never creates an order and never starts a pixel, GA, TikTok or GTM script or a server event.
 * The real public CheckoutForm is rendered here (the sibling test mocks it).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

vi.mock('react-router-dom', () => ({ useParams: () => ({ id: 'new' }) }));

const tracking = {
  initPixels: vi.fn(),
  trackInitiateCheckout: vi.fn(),
  fireInitiateCheckoutWithCapi: vi.fn(),
  trackPurchase: vi.fn(),
};
vi.mock('../../utils/pixelTracking', () => ({ ...tracking, getFbCookies: () => ({}) }));

const submitOrder = vi.fn();
const trackInitiate = vi.fn();
vi.mock('../../services/public-orders.service', () => ({
  publicOrdersService: { submitOrder: (...a: unknown[]) => submitOrder(...a), trackInitiateCheckout: (...a: unknown[]) => trackInitiate(...a) },
}));
vi.mock('../../services/checkout-forms.service', () => ({ checkoutFormsService: { getCheckoutFormPreviewConfig: vi.fn() } }));

import { CheckoutFormPreview } from '../../pages/CheckoutFormPreview';

const draft = {
  name: 'Magic Groove',
  currency: 'GHS',
  product: { name: 'Copybook', price: 200, productType: 'physical' },
  packages: [{ id: 1, name: 'Starter', price: 200, quantity: 1, isPopular: false, isDefault: true, originalPrice: 200, discountType: 'none' }],
  pixelConfig: { facebookPixelId: '123456', googleAnalyticsId: 'G-ABC123', tiktokPixelId: 'TT1', googleTagManagerId: 'GTM-ABC12' },
  metaCapiAccessToken: 'secret',
};

beforeEach(() => vi.clearAllMocks());

describe('CheckoutFormPreview safety (F-419)', () => {
  it('with a full pixel config in the draft: no tracking call, no tracking script, no request, no order', () => {
    const scriptsBefore = document.querySelectorAll('script').length;
    render(<CheckoutFormPreview />);
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'checkout-preview-update', patch: draft }, origin: window.location.origin, source: window }));
    });

    fireEvent.click(screen.getByRole('button', { name: /Place Order/i }));
    expect(screen.getByText('Preview only.')).toBeInTheDocument();

    Object.values(tracking).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    expect(submitOrder).not.toHaveBeenCalled();
    expect(trackInitiate).not.toHaveBeenCalled();
    expect(document.querySelectorAll('script').length).toBe(scriptsBefore);
    expect(document.querySelector('script[src*="facebook"], script[src*="googletagmanager"], script[src*="tiktok"], script[src*="google-analytics"]')).toBeNull();
    expect((window as unknown as { fbq?: unknown }).fbq).toBeUndefined();
  });

  it('shows the store currency of the draft, not a fixed default', () => {
    render(<CheckoutFormPreview />);
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'checkout-preview-update', patch: { ...draft, currency: 'NGN' } }, origin: window.location.origin, source: window }));
    });
    expect(screen.getAllByText(/NGN 200\.00/).length).toBeGreaterThan(0);
  });

  it('ignores a draft from another origin', () => {
    render(<CheckoutFormPreview />);
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'checkout-preview-update', patch: { name: 'Evil' } }, origin: 'https://evil.example.org', source: window }));
    });
    expect(screen.queryByText('Evil')).toBeNull();
  });
});
