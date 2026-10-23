import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    const total = container.querySelector('[data-testid="order-total"]') as HTMLElement;
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

  // Regression: an email-typed field whose label isn't a literal "email" alias
  // (the builder's default label is "Email Address") must still register under
  // the standard `email` key — otherwise the value leaks into customFields and
  // the buyer's email is silently dropped from the order/customer.
  it('maps an email-typed field labeled "Email Address" to the standard email key', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const form = baseForm({
      fields: [
        { id: 'e1', type: 'email', label: 'Email Address', required: true, enabled: true },
      ] as any,
    });
    render(<CheckoutForm formData={form} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByPlaceholderText(/enter email address/i), 'buyer@example.com');
    await userEvent.click(screen.getByRole('button', { name: /Place Order/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted.email).toBe('buyer@example.com');
    expect(submitted.customFields?.['Email Address']).toBeUndefined();
  });

  // MAN-82: email is now a standard default checkout field (present on every form
  // that hasn't customized its fields) so the funnel grows the owned email list.
  // On physical COD it is present but NOT required (phone-first market); digital
  // products force it required via the existing isDigital path.
  // Find a field's <label> by its leading text (the required asterisk lives in a
  // child <span>, so match on the element, not an exact string).
  const labelStartingWith = (text: string) =>
    screen.getByText(
      (_, el) => el?.tagName === 'LABEL' && new RegExp(`^${text}`).test((el.textContent || '').trim()),
    );

  it('leaves email and street address off in the default fields, and a seller can turn them on', () => {
    // baseForm() has fields: [] → the component falls back to DEFAULT_FIELDS.
    const { unmount } = render(<CheckoutForm formData={baseForm()} onSubmit={vi.fn()} />);
    expect(screen.queryByPlaceholderText(/enter email address/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/enter street address/i)).toBeNull();
    unmount();

    // Turned on, email is present but not required (phone-first market): its label has no asterisk.
    const on = baseForm({
      fields: [
        { id: 'n', type: 'text', label: 'Full Name', required: true, enabled: true, standardKey: 'fullName' },
        { id: 'e', type: 'email', label: 'Email Address', required: false, enabled: true, standardKey: 'email' },
      ] as any,
    });
    render(<CheckoutForm formData={on} onSubmit={vi.fn()} />);
    expect(screen.getByPlaceholderText(/enter email address/i)).toBeInTheDocument();
    expect(labelStartingWith('Email Address').querySelector('.text-red-500')).toBeNull();
    expect(labelStartingWith('Full Name').querySelector('.text-red-500')).not.toBeNull();
  });

  it('forces the default email field required for a digital product (MAN-82)', () => {
    const digital = baseForm({ product: { ...baseForm().product, productType: 'digital' } as any });
    render(<CheckoutForm formData={digital} onSubmit={vi.fn()} />);

    expect(labelStartingWith('Email Address').querySelector('.text-red-500')).not.toBeNull();
  });
});

// COD-138: State, City/Town (a dropdown of the state's towns) and Nearest landmark.
describe('CheckoutForm — State, City/Town and Nearest landmark (COD-138)', () => {
  const withTowns = (overrides: Partial<PublicCheckoutForm> = {}) =>
    baseForm({
      regions: { available: ['Ashanti', 'Greater Accra'] },
      towns: { Ashanti: ['Adum', 'Kejetia'], 'Greater Accra': ['Madina', 'Tema'] },
      ...overrides,
    });
  const labels = () =>
    Array.from(document.querySelectorAll('form label'))
      .map((l) => (l.textContent || '').replace('*', '').trim())
      .filter((t) => ['Full Name', 'Phone', 'State', 'City/Town', 'Nearest landmark', 'Email Address', 'Street Address', 'Alt Phone'].includes(t));
  const asterisk = (text: string) =>
    screen.getByText((_, el) => el?.tagName === 'LABEL' && (el.textContent || '').replace('*', '').trim() === text).querySelector('.text-red-500');

  it('the default fields are Full name, Phone, State, City/Town, Nearest landmark; Email and Street address are off', () => {
    render(<CheckoutForm formData={withTowns()} onSubmit={vi.fn()} />);
    expect(labels()).toEqual(['Full Name', 'Phone', 'State', 'City/Town', 'Nearest landmark']);
    expect(asterisk('State')).not.toBeNull();
    expect(asterisk('City/Town')).not.toBeNull();
    expect(asterisk('Nearest landmark')).not.toBeNull();
    expect(screen.getByPlaceholderText('e.g. Opposite Kasoa Total station')).toBeInTheDocument();
    expect(screen.queryByText(/Region/)).toBeNull();
  });

  it('a form saved before this change gets City/Town and Nearest landmark right after State, both required', () => {
    const old = withTowns({
      fields: [
        { id: '1', label: 'Full Name', type: 'text', required: true, enabled: true, standardKey: 'fullName' },
        { id: '2', label: 'Phone', type: 'phone', required: true, enabled: true, standardKey: 'phone' },
        { id: '3', label: 'Street Address', type: 'textarea', required: true, enabled: true, standardKey: 'streetAddress' },
        { id: '4', label: 'State', type: 'state', required: true, enabled: true, standardKey: 'region' },
        { id: '5', label: 'Email Address', type: 'email', required: false, enabled: true, standardKey: 'email' },
      ] as any,
    });
    render(<CheckoutForm formData={old} onSubmit={vi.fn()} />);
    expect(labels()).toEqual(['Full Name', 'Phone', 'Street Address', 'State', 'City/Town', 'Nearest landmark', 'Email Address']);
    expect(asterisk('City/Town')).not.toBeNull();
    expect(asterisk('Nearest landmark')).not.toBeNull();
  });

  it('a seller who switched the town off keeps it off', () => {
    const off = withTowns({
      fields: [
        { id: '1', label: 'Full Name', type: 'text', required: true, enabled: true, standardKey: 'fullName' },
        { id: '4', label: 'State', type: 'state', required: true, enabled: true, standardKey: 'region' },
        { id: '6', label: 'City/Town', type: 'text', required: false, enabled: false, standardKey: 'town' },
      ] as any,
    });
    render(<CheckoutForm formData={off} onSubmit={vi.fn()} />);
    expect(labels()).toEqual(['Full Name', 'State', 'Nearest landmark']);
  });

  it('City/Town waits for a state, lists that state\'s towns, and the order carries town and landmark', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CheckoutForm formData={withTowns()} onSubmit={onSubmit} />);
    const [stateSelect, townSelect] = screen.getAllByRole('combobox');
    expect(townSelect).toBeDisabled();
    await userEvent.selectOptions(stateSelect, 'Ashanti');
    expect(townSelect).toBeEnabled();
    expect(Array.from((townSelect as HTMLSelectElement).options).map((o) => o.text)).toEqual(['Choose city/town', 'Adum', 'Kejetia', 'Other – type it']);
    await userEvent.selectOptions(townSelect, 'Adum');
    await userEvent.type(screen.getByPlaceholderText(/enter full name/i), 'Kofi Mensah');
    await userEvent.type(screen.getByPlaceholderText(/enter phone/i), '0245550182');
    await userEvent.type(screen.getByPlaceholderText('e.g. Opposite Kasoa Total station'), 'Opposite Kejetia market');
    await userEvent.click(screen.getByRole('button', { name: /Place Order/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ region: 'Ashanti', town: 'Adum', landmark: 'Opposite Kejetia market' });
  });

  it('will not submit without a town or a landmark', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CheckoutForm formData={withTowns()} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByPlaceholderText(/enter full name/i), 'Kofi Mensah');
    await userEvent.type(screen.getByPlaceholderText(/enter phone/i), '0245550182');
    await userEvent.selectOptions(screen.getAllByRole('combobox')[0], 'Ashanti');
    await userEvent.click(screen.getByRole('button', { name: /Place Order/i }));
    expect(await screen.findByText('City/Town is required')).toBeInTheDocument();
    expect(screen.getByText('Nearest landmark is required')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

