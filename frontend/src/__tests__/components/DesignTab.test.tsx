import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('DesignTab', () => {
  it('renders the four colour fields (Primary, CTA, Surface, Text) — no Background', () => {
    render(<Harness />);
    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByText('CTA / Button')).toBeInTheDocument();
    expect(screen.getByText('Surface / Accent')).toBeInTheDocument();
    expect(screen.getByText('Text')).toBeInTheDocument();
    // Page background control was removed.
    expect(screen.queryByText('Background')).toBeNull();
  });

  it('exposes exactly 5 preset swatches per colour field', () => {
    render(<Harness />);
    // 5 presets × 4 fields. Each preset button is named by its swatch name.
    BRAND_PALETTE.forEach((swatch) => {
      const matches = screen
        .getAllByRole('button', { name: swatch.name })
        .filter((b) => b.getAttribute('title') === swatch.name);
      expect(matches.length).toBe(4);
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

  it('renders the Layout controls (hide product + offer position) and no banner field', () => {
    render(<Harness />);
    expect(screen.getByText(/Hide product name/i)).toBeInTheDocument();
    expect(screen.getByText('Offer position')).toBeInTheDocument();
    // Product banner URL control was removed.
    expect(screen.queryByPlaceholderText(/cdn\.example\.com\/banner\.png/i)).toBeNull();
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
