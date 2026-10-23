import React, { createRef } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({ default: { error: (m: string) => toastError(m), success: vi.fn() } }));

import { CheckoutFormBuilder, CheckoutFormBuilderHandle } from '../../components/forms/CheckoutFormBuilder';
import { useConfigStore } from '../../stores/configStore';
import { getRegionsForCountry } from '../../utils/countries';
import type { CheckoutForm } from '../../types/checkout-form';
import type { Product } from '../../types';

const product = (over: Partial<Product>): Product =>
  ({ id: 1, name: 'Magic Groove copybook', price: 249, isActive: true, productType: 'physical', ...over }) as Product;

const PRODUCTS = [
  product({ id: 1, name: 'Magic Groove copybook' }),
  product({ id: 2, name: 'Home study guide', productType: 'digital' }),
  product({ id: 3, name: 'Old pens', isActive: false }),
];

const onSave = vi.fn(async () => undefined);

function renderBuilder(initialData?: CheckoutForm, products: Product[] = PRODUCTS, readOnly = false) {
  const ref = createRef<CheckoutFormBuilderHandle>();
  render(
    <MemoryRouter>
      <CheckoutFormBuilder ref={ref} initialData={initialData} products={products} onSave={onSave} readOnly={readOnly} />
    </MemoryRouter>,
  );
  return ref;
}

const goTo = (tab: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${tab}`) }));

beforeEach(() => {
  toastError.mockReset();
  onSave.mockClear();
  useConfigStore.setState({ currency: 'GHS', loaded: true });
});

describe('CheckoutFormBuilder, Basics (F-411, F-422)', () => {
  it('shows the country and currency as read-only text from the store', () => {
    renderBuilder();
    const country = screen.getByLabelText('Country') as HTMLInputElement;
    expect(country.readOnly).toBe(true);
    expect(country.value).toBe('Ghana (from your store)');
    const currency = screen.getByLabelText('Currency') as HTMLInputElement;
    expect(currency.readOnly).toBe(true);
    expect(currency.value).toBe('GHS');
    expect(screen.queryByRole('combobox', { name: /country/i })).toBeNull();
  });

  it('builds the read-only link from the name on a new form', () => {
    renderBuilder();
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Summer Sale 2026' } });
    const link = screen.getByLabelText('Link') as HTMLInputElement;
    expect(link.readOnly).toBe(true);
    expect(link.value).toBe(`${window.location.origin}/form/summer-sale-2026`);
  });

  it('keeps the link of a saved form when the name changes', () => {
    renderBuilder({ id: 5, name: 'Old name', slug: 'old-name', productId: 1, isActive: true } as CheckoutForm);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'New name' } });
    expect((screen.getByLabelText('Link') as HTMLInputElement).value).toMatch(/\/form\/old-name$/);
  });

  it('lists active products with their type, and the form type follows the choice', () => {
    renderBuilder();
    const select = screen.getByLabelText('Product');
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Choose a product', 'Magic Groove copybook (Physical)', 'Home study guide (Digital)']);

    fireEvent.change(select, { target: { value: '1' } });
    expect(screen.getByText('Physical product (delivered)')).toBeInTheDocument();
    fireEvent.change(select, { target: { value: '2' } });
    expect(screen.getByText('Digital product (download link)')).toBeInTheDocument();
  });

  it('warns before a product change on a form with orders', () => {
    renderBuilder({ id: 5, name: 'F', slug: 'f', productId: 1, isActive: true, _count: { submissions: 12 } } as CheckoutForm);
    expect(screen.queryByText(/New orders use the new product/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: '2' } });
    expect(screen.getByText('New orders use the new product. Past orders do not change.')).toBeInTheDocument();
  });

  it('gives no product warning on a form without orders', () => {
    renderBuilder({ id: 5, name: 'F', slug: 'f', productId: 1, isActive: true, _count: { submissions: 0 } } as CheckoutForm);
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: '2' } });
    expect(screen.queryByText(/New orders use the new product/)).toBeNull();
  });

  it('rejects an http thank-you page and allows an empty one', () => {
    renderBuilder();
    const input = screen.getByLabelText(/Thank-you page/);
    expect(screen.getByText('Empty shows the built-in thank-you screen.')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'http://shop.example.com/thanks' } });
    expect(screen.getByText('Thank-you page must start with https://')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'https://shop.example.com/thanks' } });
    expect(screen.queryByText('Thank-you page must start with https://')).toBeNull();
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.queryByText('Thank-you page must start with https://')).toBeNull();
  });

  it('checks every line of Allowed domains the way the server does', () => {
    renderBuilder();
    const box = screen.getByLabelText(/Allowed domains/);
    expect(screen.getByText('One per line. Empty means the form cannot be embedded on other sites.')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'shop.example.com\nhttps://www.example.com\nhttp://insecure.example.com\nexample.com/path\n*.example.com\n' } });
    const errors = screen.getAllByText(/is not a valid domain/).map((e) => e.textContent);
    expect(errors).toEqual([
      'Line 3: "http://insecure.example.com" is not a valid domain. Use a host such as shop.example.com.',
      'Line 4: "example.com/path" is not a valid domain. Use a host such as shop.example.com.',
      'Line 5: "*.example.com" is not a valid domain. Use a host such as shop.example.com.',
    ]);
    fireEvent.change(box, { target: { value: 'shop.example.com\nhttps://www.example.com' } });
    expect(screen.queryByText(/is not a valid domain/)).toBeNull();
  });

  it('does not save while the thank-you page or a domain is wrong', async () => {
    const ref = renderBuilder({ id: 5, name: 'F', slug: 'f', productId: 1, isActive: false, packages: [{ id: 1, name: 'One', price: 1, quantity: 1 }] } as unknown as CheckoutForm);
    fireEvent.change(screen.getByLabelText(/Thank-you page/), { target: { value: 'http://x.com' } });
    await act(async () => ref.current?.submit());
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Thank-you page must start with https://'));
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('CheckoutFormBuilder, read-only (COD-37)', () => {
  it('disables the inputs of every tab and keeps the tabs usable', () => {
    renderBuilder({ id: 5, name: 'F', slug: 'f', productId: 1, isActive: true } as CheckoutForm, PRODUCTS, true);
    expect(screen.getByLabelText('Form name')).toBeDisabled();
    expect(screen.getByLabelText('Product')).toBeDisabled();
    goTo('Packages');
    expect(screen.getByRole('button', { name: 'Add package' })).toBeDisabled();
  });

  it('leaves the inputs on when the role may edit', () => {
    renderBuilder();
    expect(screen.getByLabelText('Form name')).toBeEnabled();
  });
});

describe('CheckoutFormBuilder, Fields and regions (F-411, F-413)', () => {
  it('starts a new form with every region of the store country selected', () => {
    renderBuilder();
    goTo('Fields');
    const all = getRegionsForCountry('Ghana');
    expect(all.length).toBeGreaterThan(1);
    const boxes = within(screen.getByRole('group', { name: /states selected/i })).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((b) => b.parentElement?.textContent)).toEqual(all);
    expect(boxes.every((b) => b.checked)).toBe(true);
  });

  it('uses the regions of the store country when the store is in Nigeria', () => {
    useConfigStore.setState({ currency: 'NGN', loaded: true });
    renderBuilder();
    goTo('Fields');
    const boxes = within(screen.getByRole('group', { name: /states selected/i })).getAllByRole('checkbox');
    expect(boxes).toHaveLength(getRegionsForCountry('Nigeria').length);
  });

  it('cannot remove the last region', () => {
    renderBuilder();
    goTo('Fields');
    const group = screen.getByRole('group', { name: /states selected/i });
    const boxes = () => within(group).getAllByRole('checkbox') as HTMLInputElement[];
    const total = boxes().length;
    for (let i = 0; i < total - 1; i++) fireEvent.click(boxes().find((b) => b.checked)!);
    const left = boxes().filter((b) => b.checked);
    expect(left).toHaveLength(1);
    expect(left[0]).toBeDisabled();
    expect(screen.getByText('Keep at least one state.')).toBeInTheDocument();
  });

  it('keeps the regions a saved form offers', () => {
    renderBuilder({ id: 5, name: 'F', slug: 'f', productId: 1, isActive: true, country: 'Ghana', regions: { available: ['Ashanti', 'Volta'] } } as unknown as CheckoutForm);
    goTo('Fields');
    const boxes = within(screen.getByRole('group', { name: /states selected/i })).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.filter((b) => b.checked).map((b) => b.parentElement?.textContent)).toEqual(['Ashanti', 'Volta']);
  });

  it('starts a new form with the fields an order needs, so it can be saved on', () => {
    renderBuilder();
    goTo('Fields');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Street address')).toBeInTheDocument();
  });

  it('blocks saving an active form that lost its street address, with the server sentence', async () => {
    const fields = [
      { id: 'a', label: 'Full Name', type: 'text', required: true, enabled: true, standardKey: 'fullName' },
      { id: 'b', label: 'Phone', type: 'phone', required: true, enabled: true, standardKey: 'phone' },
      { id: 'c', label: 'Region', type: 'state', required: true, enabled: true, standardKey: 'region' },
    ];
    const ref = renderBuilder({ id: 5, name: 'F', slug: 'f', productId: 1, isActive: true, fields, packages: [{ id: 1, name: 'One', price: 1, quantity: 1 }] } as unknown as CheckoutForm);
    goTo('Fields');
    expect(screen.getByRole('alert')).toHaveTextContent("This form can't take orders yet. Add: Street address.");
    await act(async () => ref.current?.submit());
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("This form can't take orders yet. Add: Street address."));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('lets a switched-off form save with a missing field', async () => {
    window.alert = vi.fn();
    const fields = [{ id: 'a', label: 'Full Name', type: 'text', required: true, enabled: true, standardKey: 'fullName' }];
    const ref = renderBuilder({ id: 5, name: 'F', slug: 'f', productId: 1, isActive: false, fields, packages: [{ id: 1, name: 'One', price: 1, quantity: 1 }] } as unknown as CheckoutForm);
    await act(async () => ref.current?.submit());
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const sent = (onSave.mock.calls[0] as unknown[])[0] as { regions: { available: string[] }; country?: string; currency: string };
    expect(sent.country).toBeUndefined();
    expect(sent.currency).toBe('GHS');
    expect(sent.regions.available.length).toBeGreaterThan(1);
  });
});

describe('CheckoutFormBuilder tabs (M3b-T13)', () => {
  it('lists Basics, Fields, Packages, Upsells, Payment, Tracking, Design in that order, with no Settings tab', () => {
    renderBuilder();
    const labels = screen
      .getAllByRole('button')
      .map((b) => b.textContent?.replace(/\d+$/, '').trim())
      .filter((t) => ['Basics', 'Fields', 'Packages', 'Upsells', 'Payment', 'Tracking', 'Design', 'Settings'].includes(t ?? ''));
    expect(labels).toEqual(['Basics', 'Fields', 'Packages', 'Upsells', 'Payment', 'Tracking', 'Design']);
  });
});

describe('CheckoutFormBuilder upsell ids (COD-35)', () => {
  it('sends the id of a saved upsell, takes the real id of a new one after a save, and sends both on the next save', async () => {
    window.alert = vi.fn();
    const saved = {
      id: 5, name: 'F', slug: 'f', productId: 1, isActive: false,
      packages: [{ id: 1, name: 'One', price: 249, quantity: 1, isDefault: true }],
      upsells: [{ id: 70, name: 'Pens', price: 40, items: { quantity: 1 }, isPopular: true, isActive: true }],
    } as unknown as CheckoutForm;
    // The server's answer to the first save: the new upsell now has a real id.
    onSave.mockImplementationOnce(async () => ({ ...saved, upsells: [...saved.upsells, { id: 71, name: 'Grip', price: 5, items: { quantity: 1 }, isPopular: false, isActive: true }] }) as never);
    const ref = renderBuilder(saved);
    goTo('Upsells');
    fireEvent.click(screen.getByRole('button', { name: /Add upsell/ }));
    fireEvent.change(screen.getAllByLabelText('Headline')[1], { target: { value: 'Grip' } });

    await act(async () => ref.current?.submit());
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const first = (onSave.mock.calls[0] as unknown as [{ upsells: Array<{ id?: number; name: string; isPopular: boolean }> }])[0].upsells;
    expect(first.map((u) => [u.id, u.name])).toEqual([[70, 'Pens'], [undefined, 'Grip']]);
    expect(first[0].isPopular).toBe(true);

    await act(async () => ref.current?.submit());
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    const second = (onSave.mock.calls[1] as unknown as [{ upsells: Array<{ id?: number }> }])[0].upsells;
    expect(second.map((u) => u.id)).toEqual([70, 71]);
  });
});
