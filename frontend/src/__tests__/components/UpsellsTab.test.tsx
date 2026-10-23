import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { UpsellsTab } from '../../components/forms/builder/UpsellsTab';
import type { UpsellStats } from '../../services/checkout-forms.service';
import { BuilderHarness } from '../fixtures/builderHarness';
import { snapshot } from '../fixtures/readSnapshot';
import type { Upsell } from '../../types/checkout-form';

const pens: Upsell = { id: 7, name: 'Refill pens', price: 40, quantity: 1, isPopular: false, isActive: true };

const renderTab = (upsells: Upsell[] = [pens], upsellStats: UpsellStats | null = null) =>
  render(
    <BuilderHarness options={{ upsells, formId: 5, ctx: { upsellStats } }}>
      <UpsellsTab />
    </BuilderHarness>,
  );

describe('UpsellsTab hint (F-415)', () => {
  it('shows no hint at 29 orders', () => {
    renderTab([pens], { ordersTotal: 29, upsells: [{ upsellId: 7, orders: 15 }] });
    expect(screen.queryByTestId('upsell-hint')).toBeNull();
  });

  it('shows the whole-percent hint at 30 orders', () => {
    renderTab([pens], { ordersTotal: 30, upsells: [{ upsellId: 7, orders: 9 }] });
    expect(screen.getByText('30% of buyers also buy this.')).toBeInTheDocument();
  });

  it('shows no hint for an upsell the numbers do not cover, or before they load', () => {
    renderTab([pens], { ordersTotal: 100, upsells: [] });
    expect(screen.queryByTestId('upsell-hint')).toBeNull();
    cleanup();
    renderTab([pens], null);
    expect(screen.queryByTestId('upsell-hint')).toBeNull();
  });
});

describe('UpsellsTab editing (F-415)', () => {
  it('Add upsell adds a card with the fields', () => {
    renderTab([]);
    fireEvent.click(screen.getByRole('button', { name: /Add upsell/ }));
    expect(screen.getAllByTestId('upsell-card')).toHaveLength(1);
    ['Source', 'Quantity', 'Headline', 'Description', 'Discount'].forEach((l) => expect(screen.getByLabelText(new RegExp(`^${l}`))).toBeInTheDocument());
    expect(screen.getByLabelText(/^Price/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Mark as popular/)).toBeInTheDocument();
  });

  it('a discount works out the final price', () => {
    renderTab();
    fireEvent.change(screen.getByLabelText('Discount'), { target: { value: 'percentage' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '25' } });
    expect(screen.getByText(/Final price:/).textContent).toContain('30');
  });

  it('the switch turns an upsell off and the card says so', () => {
    renderTab();
    fireEvent.click(screen.getByLabelText('Show Refill pens on the form'));
    expect(screen.getByText(/Refill pens \(off\)/)).toBeInTheDocument();
  });

  it('refuses an image over 5 MB', () => {
    renderTab();
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'a.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Image for Refill pens'), { target: { files: [big] } });
    expect(screen.getByText('Use a JPG, PNG, WebP or GIF image of 5 MB or less.')).toBeInTheDocument();
    expect(snapshot<unknown>(screen, 'packages-snapshot')).toEqual([]);
  });
});
