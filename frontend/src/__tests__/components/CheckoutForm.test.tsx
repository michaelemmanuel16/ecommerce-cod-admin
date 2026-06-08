import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CheckoutForm } from '../../components/public/CheckoutForm';
import type { PublicCheckoutForm } from '../../services/public-orders.service';

const baseForm = (overrides: Partial<PublicCheckoutForm> = {}): PublicCheckoutForm => ({
  id: 1,
  name: 'Magic Groove',
  slug: 'magic-groove',
  description: 'Children handwriting copybooks',
  fields: [],
  product: {
    name: 'Copybook Set',
    description: 'Reusable handwriting practice',
    price: 200,
    imageUrl: null,
    inStock: true,
    productType: 'physical',
  } as any,
  packages: [
    {
      id: 11,
      name: 'Starter Pack',
      description: '1 set',
      price: 200,
      quantity: 1,
      isPopular: false,
      isDefault: true,
      showHighlight: false,
      highlightText: null,
      showDiscount: true,
      originalPrice: null,
      discountType: 'none',
      discountValue: 0,
    } as any,
    {
      id: 12,
      name: 'Family Pack',
      description: '3 sets',
      price: 540,
      quantity: 3,
      isPopular: true,
      isDefault: false,
      showHighlight: false,
      highlightText: null,
      showDiscount: true,
      originalPrice: 600,
      discountType: 'none',
      discountValue: 0,
    } as any,
  ],
  upsells: [],
  country: 'Ghana',
  currency: 'GHS',
  regions: ['Greater Accra'],
  design: {},
  formType: 'physical',
  ...overrides,
});

describe('CheckoutForm — render + design + CTA (R5)', () => {
  it('renders Place Order CTA for a physical product', () => {
    render(<CheckoutForm formData={baseForm()} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Place Order/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Proceed to Payment/i })).toBeNull();
  });

  it('renders Proceed to Payment CTA for a digital product', () => {
    const form = baseForm({
      product: {
        name: 'PCOS Freedom Protocol',
        description: 'Digital ebook',
        price: 10000,
        imageUrl: null,
        inStock: true,
        productType: 'digital',
      } as any,
      formType: 'digital',
    });
    render(<CheckoutForm formData={form} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Proceed to Payment/i })).toBeInTheDocument();
  });

  it('flows design.colors.cta through to the order CTA backgroundColor', () => {
    const form = baseForm({
      design: { colors: { cta: '#dc2626', surface: '#0f172a' } },
      packages: [
        { ...baseForm().packages[0], isDefault: true } as any,
      ],
    });
    const { container } = render(<CheckoutForm formData={form} onSubmit={vi.fn()} />);
    const cta = screen.getByRole('button', { name: /Place Order/i }) as HTMLButtonElement;
    // Default package is selected → button is enabled and styled with the
    // design token. JSDOM normalizes hex colors to rgb(...) — assert both.
    expect(cta).not.toBeDisabled();
    expect(cta.style.backgroundColor).toMatch(/#dc2626|rgb\(\s*220,\s*38,\s*38\s*\)/);
    // Total surface color should be the accent token.
    const total = container.querySelector('.text-2xl.font-bold') as HTMLElement;
    expect(total).toBeTruthy();
    expect(total.style.color).toMatch(/#0f172a|rgb\(\s*15,\s*23,\s*42\s*\)/);
  });

  it('disables the CTA when no package is selected (no default)', () => {
    const form = baseForm({
      packages: [
        { ...baseForm().packages[0], isDefault: false } as any,
        { ...baseForm().packages[1], isDefault: false } as any,
      ],
    });
    render(<CheckoutForm formData={form} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Place Order/i })).toBeDisabled();
  });

  it('renders all packages and the upsell section when upsells exist', () => {
    const form = baseForm({
      upsells: [
        {
          id: 99,
          name: 'Bonus Stickers',
          description: 'Add 1 sticker pack',
          imageUrl: null,
          price: 30,
          items: { quantity: 1 },
          originalPrice: null,
          discountType: 'none',
          discountValue: 0,
        } as any,
      ],
    });
    render(<CheckoutForm formData={form} onSubmit={vi.fn()} />);
    // Package names appear in PackageSelector and in OrderSummary, so allow >=1.
    expect(screen.getAllByText('Starter Pack').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Family Pack').length).toBeGreaterThan(0);
    expect(screen.getByText('Bonus Stickers')).toBeInTheDocument();
  });

  it('does not render the upsell section when upsells is empty', () => {
    render(<CheckoutForm formData={baseForm()} onSubmit={vi.fn()} />);
    // Order summary header is always present; upsell section header is not.
    expect(screen.getByText(/Order Summary/i)).toBeInTheDocument();
    // No add-on entries.
    expect(screen.queryByText(/Bonus/i)).toBeNull();
  });
});
