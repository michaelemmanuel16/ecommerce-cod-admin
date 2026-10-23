import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { checkoutFormsService } from '../../services/checkout-forms.service';
import { DesignTab } from '../../components/forms/builder/DesignTab';
import { CheckoutBuilderContext, CheckoutBuilderContextValue } from '../../components/forms/builder/checkoutBuilderContextValue';
import { CheckoutFormDesign } from '../../types/checkout-form';
import { BRAND_PALETTE } from '../../lib/checkoutPalette';

const Harness: React.FC<{ initial?: CheckoutFormDesign }> = ({ initial = {} }) => {
  const [design, setDesign] = useState<CheckoutFormDesign>(initial);
  const ctx: CheckoutBuilderContextValue = {
    register: (() => ({})) as any,
    watch: (() => undefined) as any,
    setValue: (() => undefined) as any,
    errors: {} as any,
    fields: [],
    setFields: () => undefined,
    packages: [],
    setPackages: () => undefined,
    upsells: [],
    setUpsells: () => undefined,
    upsellImages: new Map(),
    setUpsellImages: () => undefined,
    pixelConfig: {},
    setPixelConfig: () => undefined,
    design,
    setDesign,
    products: [],
    addField: () => undefined,
    updateField: () => undefined,
    deleteField: () => undefined,
    handleFieldDragEnd: () => undefined,
    addPackage: () => undefined,
    updatePackage: () => undefined,
    deletePackage: () => undefined,
    addUpsell: () => undefined,
    updateUpsell: () => undefined,
    deleteUpsell: () => undefined,
    handleUpsellImageSelect: () => undefined,
    handleRemoveUpsellImage: () => undefined,
  };
  return (
    <CheckoutBuilderContext.Provider value={ctx}>
      <DesignTab />
      <pre data-testid="design-snapshot">{JSON.stringify(design)}</pre>
    </CheckoutBuilderContext.Provider>
  );
};

const readSnapshot = (): CheckoutFormDesign =>
  JSON.parse(screen.getByTestId('design-snapshot').textContent || '{}');

afterEach(() => vi.restoreAllMocks());

describe('DesignTab', () => {
  it('renders the colour fields, including label colour, price colour and page background', () => {
    render(<Harness />);
    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByText('CTA / Button')).toBeInTheDocument();
    expect(screen.getByText('Surface / Accent')).toBeInTheDocument();
    expect(screen.getByText('Text')).toBeInTheDocument();
    expect(screen.getByText('Label colour')).toBeInTheDocument();
    expect(screen.getByText('Price colour')).toBeInTheDocument();
    expect(screen.getByText('Page background')).toBeInTheDocument();
  });

  it('exposes exactly 5 preset swatches per colour field', () => {
    render(<Harness />);
    // 5 presets × 7 colour fields. Each preset button is named by its swatch name.
    BRAND_PALETTE.forEach((swatch) => {
      const matches = screen
        .getAllByRole('button', { name: swatch.name })
        .filter((b) => b.getAttribute('title') === swatch.name);
      expect(matches.length).toBe(7);
    });
  });

  it('selecting a preset in the CTA grid updates design.colors.cta', () => {
    render(<Harness />);
    const target = BRAND_PALETTE[1];
    const swatches = screen
      .getAllByRole('button', { name: target.name })
      .filter((b) => b.getAttribute('title') === target.name);
    // Field order: Primary[0], CTA[1], Surface[2], Text[3].
    fireEvent.click(swatches[1]);
    const snap = readSnapshot();
    expect(snap.colors?.cta).toBe(target.hex);
  });

  it('typing a valid hex in a colour field commits it', () => {
    render(<Harness />);
    // First hex input belongs to the Primary field.
    const hexInputs = screen.getAllByPlaceholderText('#0f172a') as HTMLInputElement[];
    fireEvent.change(hexInputs[0], { target: { value: '#abcdef' } });
    const snap = readSnapshot();
    expect(snap.colors?.primary).toBe('#abcdef');
  });

  it('clicking a button shape pill updates design.button.shape', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Pill' }));
    const snap = readSnapshot();
    expect(snap.button?.shape).toBe('pill');
  });

  it('clicking a button size pill updates design.button.size', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'L' }));
    const snap = readSnapshot();
    expect(snap.button?.size).toBe('lg');
  });

  it('clicking an input style pill updates design.input.style', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Outlined' }));
    const snap = readSnapshot();
    expect(snap.input?.style).toBe('outlined');
  });

  it('enforces 60-char maxLength on the button label override', () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText(/Place Order/i) as HTMLInputElement;
    expect(input.maxLength).toBe(60);
  });

  it('renders the Layout controls (hide product, offer position, banner upload) and no banner URL box', () => {
    render(<Harness />);
    expect(screen.getByText(/Hide product name/i)).toBeInTheDocument();
    expect(screen.getByText('Offer position')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload banner/i })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/cdn\.example\.com\/banner\.png/i)).toBeNull();
  });

  it('names the input style control "Field style"', () => {
    render(<Harness />);
    expect(screen.getByText('Field style')).toBeInTheDocument();
  });

  it('label colour, price colour and page background save into design.input and design.page', () => {
    render(<Harness />);
    const hex = (label: string) => screen.getByLabelText(`${label} hex`);
    fireEvent.change(hex('Label colour'), { target: { value: '#dc2626' } });
    fireEvent.change(hex('Price colour'), { target: { value: '#059669' } });
    fireEvent.change(hex('Page background'), { target: { value: '#2563eb' } });
    const snap = readSnapshot();
    expect(snap.input?.labelColor).toBe('#dc2626');
    expect(snap.input?.priceColor).toBe('#059669');
    expect(snap.page?.background).toBe('#2563eb');
  });

  it('warns when the button colour is too light for white text, and not for a dark one', () => {
    const { unmount } = render(<Harness initial={{ colors: { cta: '#fde047' } }} />);
    expect(screen.getByText('Button text may be hard to read on this colour.')).toBeInTheDocument();
    unmount();
    render(<Harness initial={{ colors: { cta: '#0f172a' } }} />);
    expect(screen.queryByText('Button text may be hard to read on this colour.')).toBeNull();
  });

  describe('product banner', () => {
    const file = (type: string, size: number) => new File([new Uint8Array(size)], 'b.img', { type });
    const choose = (f: File) => fireEvent.change(screen.getByLabelText('Product banner file'), { target: { files: [f] } });

    it('refuses a type or a size outside the rule, before any upload', () => {
      const upload = vi.spyOn(checkoutFormsService, 'uploadImage');
      render(<Harness />);
      choose(file('image/gif', 100));
      expect(screen.getByText('Use a JPEG, PNG or WebP image up to 1 MB.')).toBeInTheDocument();
      choose(file('image/png', 1024 * 1024 + 1));
      expect(screen.getByText('Use a JPEG, PNG or WebP image up to 1 MB.')).toBeInTheDocument();
      expect(upload).not.toHaveBeenCalled();
    });

    it('uploads a good image, saves its address in design.page.productBanner, and Remove clears it', async () => {
      vi.spyOn(checkoutFormsService, 'uploadImage').mockResolvedValue('https://img.example.com/products/t/b.webp');
      render(<Harness />);
      choose(file('image/webp', 5000));
      await waitFor(() => expect(readSnapshot().page?.productBanner).toBe('https://img.example.com/products/t/b.webp'));
      fireEvent.click(screen.getByRole('button', { name: /Remove banner/i }));
      expect(readSnapshot().page?.productBanner).toBeUndefined();
    });
  });

  it('clicking an offer-position pill updates design.page.offerPosition', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Top' }));
    const snap = readSnapshot();
    expect(snap.page?.offerPosition).toBe('top');
  });

  it('order-summary toggle defaults to checked and unchecking sets showOrderSummary=false', () => {
    render(<Harness />);
    const toggle = screen.getByLabelText(/Show order summary/i) as HTMLInputElement;
    expect(toggle.checked).toBe(true); // shown by default
    fireEvent.click(toggle);
    expect(readSnapshot().page?.showOrderSummary).toBe(false);
  });
});
