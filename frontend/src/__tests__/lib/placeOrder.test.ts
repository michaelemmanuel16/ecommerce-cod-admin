// COD-36: the submit sequence the hosted checkout and the embed widget share.
import { describe, it, expect, vi } from 'vitest';
import { placeOrder } from '../../lib/orderPayload';
import type { PublicCheckoutForm } from '../../services/public-orders.service';
import type { CheckoutFormData } from '../../components/public/CheckoutForm';

const form = (over: Partial<PublicCheckoutForm> = {}) =>
  ({
    id: 1, slug: 's', currency: 'GHS', fields: [], upsells: [],
    packages: [{ id: 11, name: 'Starter', price: 200, quantity: 1, isPopular: false }],
    ...over,
  }) as unknown as PublicCheckoutForm;
const data = (over: Partial<CheckoutFormData> = {}): CheckoutFormData =>
  ({ fullName: 'Ama', phone: '0241234567', region: 'Accra', town: 'Osu', landmark: 'x', selectedPackageId: 11, selectedAddonIds: [], paymentMethod: 'cod', ...over });

describe('placeOrder', () => {
  it('refuses a package the form does not have, without sending anything', async () => {
    const submit = vi.fn();
    await expect(placeOrder(form(), data({ selectedPackageId: 99 }), submit)).rejects.toThrow('Please choose a package.');
    expect(submit).not.toHaveBeenCalled();
  });

  it('COD: placed, with the order number and the total', async () => {
    const r = await placeOrder(form(), data(), async () => ({ success: true, orderId: 5, orderNumber: '#5' }));
    expect(r).toEqual({ kind: 'placed', orderId: 5, orderNumber: '#5', total: 200 });
  });

  it('COD with a thank-you page: redirect with the same details, and the order for the cooldown', async () => {
    const r = await placeOrder(form({ redirectUrl: 'https://shop.example.com/t' }), data(), async () => ({ success: true, orderId: 5, paymentReference: undefined }));
    expect(r.kind).toBe('redirect');
    if (r.kind === 'redirect') {
      expect(Object.fromEntries(new URL(r.url).searchParams)).toEqual({ order_id: '5', total: '200', currency: 'GHS', package: '11' });
      expect(r.order).toEqual({ orderId: 5, orderNumber: undefined, total: 200 });
    }
  });

  it('online payment: redirect to the provider, no order yet', async () => {
    const r = await placeOrder(form(), data({ paymentMethod: 'paystack_full' }), async () => ({ success: true, authorization_url: 'https://pay.test/x' }));
    expect(r).toEqual({ kind: 'redirect', url: 'https://pay.test/x' });
  });

  it('a repeat submit is a repeat, even when the form has a thank-you page', async () => {
    const r = await placeOrder(form({ redirectUrl: 'https://shop.example.com/t' }), data(), async () => ({ success: true, deduplicated: true, orderId: 5 }));
    expect(r).toMatchObject({ kind: 'repeat', orderId: 5, total: 200 });
  });

  it('throws what the server said when it refuses, and when COD returns no order', async () => {
    await expect(placeOrder(form(), data(), async () => ({ success: false, message: 'This product is sold out' }))).rejects.toThrow('This product is sold out');
    await expect(placeOrder(form(), data(), async () => ({ success: true }))).rejects.toThrow(/could not complete/);
  });
});
