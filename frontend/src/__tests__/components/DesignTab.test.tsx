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
  it('renders the color section labels (Primary, CTA, Surface, Text, Background)', () => {
    render(<Harness />);
    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByText('CTA / Button')).toBeInTheDocument();
    expect(screen.getByText('Surface / Accent')).toBeInTheDocument();
    expect(screen.getByText('Text')).toBeInTheDocument();
    expect(screen.getByText('Background')).toBeInTheDocument();
  });

  it('selecting a swatch in the CTA grid updates design.colors.cta', () => {
    render(<Harness />);
    // Pick the second swatch's hex (deterministic across runs).
    const target = BRAND_PALETTE[1];
    // There are multiple grids; query all buttons with that swatch hex.
    const swatches = screen
      .getAllByRole('button', { name: target.name })
      .filter((b) => b.getAttribute('title') === target.name);
    expect(swatches.length).toBeGreaterThan(0);
    // The 2nd grid is CTA / Button — its swatches are the 2nd batch of 12.
    // Click the 2nd-grid swatch matching target.name.
    fireEvent.click(swatches[1] || swatches[0]);
    const snap = readSnapshot();
    expect(snap.colors?.cta).toBe(target.hex);
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

  it('marks the banner URL as invalid when it does not start with https://', () => {
    render(<Harness />);
    const banner = screen.getByPlaceholderText(/cdn\.example\.com\/banner\.png/i) as HTMLInputElement;
    fireEvent.change(banner, { target: { value: 'http://insecure.example.com/banner.png' } });
    expect(screen.getByText(/must start with https:\/\//i)).toBeInTheDocument();
  });

  it('accepts a banner URL that starts with https://', () => {
    render(<Harness />);
    const banner = screen.getByPlaceholderText(/cdn\.example\.com\/banner\.png/i) as HTMLInputElement;
    fireEvent.change(banner, { target: { value: 'https://cdn.example.com/banner.png' } });
    expect(screen.queryByText(/must start with https:\/\//i)).toBeNull();
    const snap = readSnapshot();
    expect(snap.page?.productBanner).toBe('https://cdn.example.com/banner.png');
  });
});
