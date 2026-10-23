// COD-37 (M3b-T19, F-407): the browser Purchase for a COD order uses the raw order id as eventID, the same id the server
// puts in the CAPI event_id (backend/src/__tests__/unit/capiEventParity.test.ts proves the server half). The "#<id>" display
// number never feeds the event id, and a repeat order fires nothing.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrderSuccess } from '../../components/public/OrderSuccess';

const fbq = vi.fn();

beforeEach(() => {
  fbq.mockClear();
  (window as any).fbq = fbq;
  document.body.querySelectorAll('img').forEach((i) => i.remove());
});

describe('OrderSuccess tracking', () => {
  it('fires the Purchase with eventID = the raw order id, not the "#<id>" display number', () => {
    render(<OrderSuccess orderId={24118} orderNumber="#24118" orderTotal={289} currency="GHS" pixelConfig={{ facebookPixelId: '482915073361842' }} />);
    expect(screen.getByTestId('order-number')).toHaveTextContent('#24118');
    expect(fbq).toHaveBeenCalledWith('track', 'Purchase', { value: 289, currency: 'GHS' }, { eventID: '24118' });
    const eids = Array.from(document.querySelectorAll('img')).map((i) => new URL(i.src).searchParams.get('eid'));
    expect(eids).toEqual(['24118']);
  });

  it('a repeat order (cooldown reload) fires no Purchase and no beacon', () => {
    render(<OrderSuccess orderId={24119} orderNumber="#24119" repeatOrder orderTotal={289} currency="GHS" pixelConfig={{ facebookPixelId: '482915073361842' }} />);
    expect(fbq).not.toHaveBeenCalled();
    expect(document.querySelectorAll('img')).toHaveLength(0);
  });

  it('no pixel config, no tracking', () => {
    render(<OrderSuccess orderId={24120} orderNumber="#24120" orderTotal={289} currency="GHS" />);
    expect(fbq).not.toHaveBeenCalled();
  });
});
