import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UpsellsTab } from '../../components/forms/builder/UpsellsTab';
import { checkoutFormsService } from '../../services/checkout-forms.service';
import { BuilderHarness } from '../fixtures/builderHarness';
import { snapshot } from '../fixtures/readSnapshot';
import type { Upsell } from '../../types/checkout-form';

afterEach(() => vi.restoreAllMocks());

const pens: Upsell = { id: 7, name: 'Refill pens', price: 40, quantity: 1, isPopular: false, isActive: true };

const renderTab = (upsells: Upsell[] = [pens], formId: number | null = 5) =>
  render(
    <BuilderHarness options={{ upsells, formId }}>
      <UpsellsTab />
    </BuilderHarness>,
  );

describe('UpsellsTab hint (F-415)', () => {
  it('shows no hint at 29 orders', async () => {
    const stats = vi.spyOn(checkoutFormsService, 'getUpsellStats').mockResolvedValue({ ordersTotal: 29, upsells: [{ upsellId: 7, orders: 15 }] });
    renderTab();
    await waitFor(() => expect(stats).toHaveBeenCalledWith(5));
    await Promise.resolve();
    expect(screen.queryByTestId('upsell-hint')).toBeNull();
  });

  it('shows the whole-percent hint at 30 orders', async () => {
    vi.spyOn(checkoutFormsService, 'getUpsellStats').mockResolvedValue({ ordersTotal: 30, upsells: [{ upsellId: 7, orders: 9 }] });
    renderTab();
    expect(await screen.findByText('30% of buyers also buy this.')).toBeInTheDocument();
  });

  it('matches by name when the saved id has changed', async () => {
    vi.spyOn(checkoutFormsService, 'getUpsellStats').mockResolvedValue({ ordersTotal: 100, upsells: [{ upsellId: 99, name: 'Refill pens', orders: 35 }] });
    renderTab();
    expect(await screen.findByText('35% of buyers also buy this.')).toBeInTheDocument();
  });

  it('shows no hint for an upsell the server could not count', async () => {
    vi.spyOn(checkoutFormsService, 'getUpsellStats').mockResolvedValue({ ordersTotal: 100, upsells: [] });
    renderTab();
    await waitFor(() => expect(checkoutFormsService.getUpsellStats).toHaveBeenCalled());
    expect(screen.queryByTestId('upsell-hint')).toBeNull();
  });

  it('does not ask for stats on a form that is not saved', () => {
    const stats = vi.spyOn(checkoutFormsService, 'getUpsellStats');
    renderTab([pens], null);
    expect(stats).not.toHaveBeenCalled();
  });
});

describe('UpsellsTab editing (F-415)', () => {
  it('Add upsell adds a card with the fields', () => {
    vi.spyOn(checkoutFormsService, 'getUpsellStats').mockResolvedValue({ ordersTotal: 0, upsells: [] });
    renderTab([]);
    fireEvent.click(screen.getByRole('button', { name: /Add upsell/ }));
    expect(screen.getAllByTestId('upsell-card')).toHaveLength(1);
    ['Source', 'Quantity', 'Headline', 'Description', 'Discount'].forEach((l) => expect(screen.getByLabelText(new RegExp(`^${l}`))).toBeInTheDocument());
    expect(screen.getByLabelText(/^Price/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Mark as popular/)).toBeInTheDocument();
  });

  it('a discount works out the final price', () => {
    vi.spyOn(checkoutFormsService, 'getUpsellStats').mockResolvedValue({ ordersTotal: 0, upsells: [] });
    renderTab();
    fireEvent.change(screen.getByLabelText('Discount'), { target: { value: 'percentage' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '25' } });
    expect(screen.getByText(/Final price:/).textContent).toContain('30');
  });

  it('the switch turns an upsell off and the card says so', () => {
    vi.spyOn(checkoutFormsService, 'getUpsellStats').mockResolvedValue({ ordersTotal: 0, upsells: [] });
    renderTab();
    fireEvent.click(screen.getByLabelText('Show Refill pens on the form'));
    expect(screen.getByText(/Refill pens \(off\)/)).toBeInTheDocument();
  });

  it('refuses an image over 5 MB', () => {
    vi.spyOn(checkoutFormsService, 'getUpsellStats').mockResolvedValue({ ordersTotal: 0, upsells: [] });
    renderTab();
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'a.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Image for Refill pens'), { target: { files: [big] } });
    expect(screen.getByText('Use an image of 5 MB or less.')).toBeInTheDocument();
    expect(snapshot<unknown>(screen, 'packages-snapshot')).toEqual([]);
  });
});
