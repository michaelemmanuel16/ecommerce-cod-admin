import { describe, it, expect } from 'vitest';
import { buildOrderPayload, buildRedirectUrl } from '../../lib/orderPayload';
import type { PublicCheckoutForm } from '../../services/public-orders.service';
import type { CheckoutFormData } from '../../components/public/CheckoutForm';

const form = {
  packages: [
    { id: 1, name: 'Buy 1', price: 200, quantity: 1, isPopular: false },
    { id: 2, name: 'Buy 2', price: 360, quantity: 2, isPopular: true },
  ],
  upsells: [
    { id: 9, name: 'Cream', price: 50, productId: 77, items: { quantity: 1 }, isPopular: false },
  ],
} as unknown as PublicCheckoutForm;

const data: CheckoutFormData = {
  fullName: '  Ama  ',
  phone: '233200000000',
  region: 'Greater Accra',
  streetAddress: '12 High St',
  selectedPackageId: 2,
  selectedAddonIds: [9],
};

describe('buildOrderPayload', () => {
  it('sums package + upsell prices and trims the name', () => {
    const { payload, totalAmount } = buildOrderPayload(form, data);
    expect(totalAmount).toBe(410); // 360 + 50
    expect(payload.totalAmount).toBe(410);
    expect(payload.formData.name).toBe('Ama');
    expect(payload.selectedPackage.id).toBe(2);
    expect(payload.selectedUpsells[0]).toMatchObject({ id: 9, productId: 77, quantity: 1 });
  });

  it('throws when the selected package is not on the form', () => {
    expect(() => buildOrderPayload(form, { ...data, selectedPackageId: 999 })).toThrow(
      'Please select a package',
    );
  });

  it('omits empty addons and defaults email to empty string', () => {
    const { payload, totalAmount } = buildOrderPayload(form, {
      ...data,
      selectedPackageId: 1,
      selectedAddonIds: [],
    });
    expect(totalAmount).toBe(200);
    expect(payload.selectedUpsells).toEqual([]);
    expect(payload.formData.email).toBe('');
  });
});

describe('buildRedirectUrl', () => {
  it('appends order_id, total and currency', () => {
    const out = buildRedirectUrl('https://brand.com/thanks', { orderId: 5, total: 410, currency: 'GHS' });
    expect(out).toBe('https://brand.com/thanks?order_id=5&total=410&currency=GHS');
  });

  it('returns null when no URL is set', () => {
    expect(buildRedirectUrl(undefined, { orderId: 5, total: 1, currency: 'GHS' })).toBeNull();
  });

  it('returns null for a malformed URL', () => {
    expect(buildRedirectUrl('not a url', { orderId: 5, total: 1, currency: 'GHS' })).toBeNull();
  });
});
