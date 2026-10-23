import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CheckoutForm } from '../../components/public/CheckoutForm';
import type { PublicCheckoutForm } from '../../services/public-orders.service';

const form = (over: Partial<PublicCheckoutForm> = {}): PublicCheckoutForm =>
  ({
    id: 1, name: 'Magic Groove', slug: 'mg', productId: 1,
    fields: [{ id: 'a', label: 'Full name', type: 'text', required: true, enabled: true, standardKey: 'fullName' }],
    product: { name: 'Copybook', price: 200, productType: 'physical' } as never,
    packages: [{ id: 11, name: 'Starter', price: 200, quantity: 1, isPopular: false, isDefault: true, originalPrice: 200, discountType: 'none' }],
    upsells: [{ id: 21, name: 'Refill pens', price: 40, items: { quantity: 1, popular: true }, isPopular: true }],
    country: 'Ghana', currency: 'GHS', regions: { available: [] }, formType: 'physical', design: {},
    ...over,
  }) as PublicCheckoutForm;

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

describe('public form reads the Design options (F-418)', () => {
  it('label colour changes the field labels', () => {
    render(<CheckoutForm formData={form({ design: { input: { labelColor: '#dc2626' } } })} onSubmit={vi.fn()} />);
    expect(screen.getByText('Full name', { selector: 'label' })).toHaveStyle({ color: rgb('#dc2626') });
  });

  it('label colour wins over the text colour; the text colour is the fallback', () => {
    const { unmount } = render(<CheckoutForm formData={form({ design: { colors: { text: '#2563eb' }, input: { labelColor: '#dc2626' } } })} onSubmit={vi.fn()} />);
    expect(screen.getByText('Full name', { selector: 'label' })).toHaveStyle({ color: rgb('#dc2626') });
    unmount();
    render(<CheckoutForm formData={form({ design: { colors: { text: '#2563eb' } } })} onSubmit={vi.fn()} />);
    expect(screen.getByText('Full name', { selector: 'label' })).toHaveStyle({ color: rgb('#2563eb') });
  });

  it('price colour changes the package, add-on and total prices', () => {
    render(<CheckoutForm formData={form({ design: { input: { priceColor: '#059669' } } })} onSubmit={vi.fn()} />);
    const green = rgb('#059669');
    expect(screen.getAllByText(/GHS 200\.00/).some((el) => el.style.color === green)).toBe(true);
    expect(screen.getAllByText('GHS 40.00').some((el) => el.style.color === green)).toBe(true);
    expect(screen.getAllByText(/GHS 200\.00/).filter((el) => el.style.color === green).length).toBeGreaterThan(1);
  });

  it('page background changes the page; "transparent" and empty keep the default', () => {
    const { unmount } = render(<CheckoutForm formData={form({ design: { page: { background: '#4f46e5' } } })} onSubmit={vi.fn()} />);
    expect(screen.getByTestId('public-form-root')).toHaveStyle({ backgroundColor: rgb('#4f46e5') });
    unmount();
    render(<CheckoutForm formData={form({ design: { page: { background: 'transparent' } } })} onSubmit={vi.fn()} />);
    expect(screen.getByTestId('public-form-root').style.backgroundColor).toBe('');
  });

  it('shows the banner above the form only when it is on the storage host', () => {
    const banner = 'https://img.example.com/products/t/b.webp';
    const { unmount } = render(<CheckoutForm formData={form({ storageHost: 'img.example.com', design: { page: { productBanner: banner } } })} onSubmit={vi.fn()} />);
    expect(screen.getByTestId('form-banner')).toHaveAttribute('src', banner);
    unmount();
    const { unmount: u2 } = render(<CheckoutForm formData={form({ storageHost: 'img.example.com', design: { page: { productBanner: 'https://evil.example.org/b.png' } } })} onSubmit={vi.fn()} />);
    expect(screen.queryByTestId('form-banner')).toBeNull();
    u2();
    render(<CheckoutForm formData={form({ design: { page: { productBanner: banner } } })} onSubmit={vi.fn()} />);
    expect(screen.queryByTestId('form-banner')).toBeNull();
  });

  it('empty options keep today\'s defaults', () => {
    render(<CheckoutForm formData={form()} onSubmit={vi.fn()} />);
    expect(screen.getByText('Full name', { selector: 'label' }).style.color).toBe('');
    expect(screen.queryByTestId('form-banner')).toBeNull();
  });

  it('keeps its own colours whatever the admin theme: light colour scheme, no admin classes', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    render(<CheckoutForm formData={form()} onSubmit={vi.fn()} />);
    const root = screen.getByTestId('public-form-root');
    expect(root.style.colorScheme).toBe('light');
    expect(root.closest('.v2')).toBeNull();
    expect(root.className).not.toMatch(/v2|legacy-light/);
    document.documentElement.removeAttribute('data-theme');
  });

  it('shows a Popular badge on a popular add-on', () => {
    render(<CheckoutForm formData={form()} onSubmit={vi.fn()} />);
    expect(screen.getByText('Popular')).toBeInTheDocument();
  });
});

describe('preview mode (F-419)', () => {
  it('"Place Order" says "Preview only." and sends nothing, even with empty fields', () => {
    const onSubmit = vi.fn();
    render(<CheckoutForm preview formData={form()} onSubmit={onSubmit} />);
    expect(screen.queryByText('Preview only.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Place Order/i }));
    expect(screen.getByText('Preview only.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
