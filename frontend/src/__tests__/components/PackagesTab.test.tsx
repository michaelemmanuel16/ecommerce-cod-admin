import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PackagesTab } from '../../components/forms/builder/PackagesTab';
import { BuilderHarness } from '../fixtures/builderHarness';
import { snapshot } from '../fixtures/readSnapshot';
import type { ProductPackage } from '../../types/checkout-form';

const pkg = (over: Partial<ProductPackage>): ProductPackage =>
  ({ id: 1, name: '1 set', price: 249, quantity: 1, isPopular: false, isDefault: false, discountType: 'none', discountValue: 0, ...over }) as ProductPackage;

const PACKAGES = [
  pkg({ id: 1, name: '1 set', isDefault: false }),
  pkg({ id: 2, name: '2 sets', quantity: 2, discountType: 'fixed', discountValue: 49, isDefault: true }),
  pkg({ id: 3, name: '3 sets', quantity: 3, discountType: 'fixed', discountValue: 118 }),
];

const renderTab = (packages = PACKAGES, currency = 'GHS') =>
  render(
    <BuilderHarness options={{ packages, currency, productPrice: 249 }}>
      <PackagesTab />
    </BuilderHarness>,
  );

describe('PackagesTab (F-414)', () => {
  it('shows the mockup columns and the live final prices', () => {
    renderTab();
    ['Sets', 'Name', 'Final price', 'Badge', 'Default'].forEach((h) => expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument());
    expect(screen.getByRole('columnheader', { name: /^Discount \(/ })).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('GH₵249');
    expect(rows[1]).toHaveTextContent('GH₵449');
    expect(rows[2]).toHaveTextContent('GH₵629');
  });

  it('shows the store currency symbol, not a fixed one', () => {
    renderTab(PACKAGES, 'NGN');
    expect(screen.getByRole('columnheader', { name: 'Discount (₦)' })).toBeInTheDocument();
    expect(screen.queryByText(/GH₵/)).toBeNull();
  });

  it('a percent discount shows its computed money amount', () => {
    renderTab([pkg({ quantity: 2, discountType: 'percentage', discountValue: 10 })]);
    expect(screen.getByText(/49\.80 off/)).toBeInTheDocument();
    expect(screen.getByText(/448\.20/)).toBeInTheDocument();
  });

  it('editing the discount updates the final price at once', () => {
    renderTab();
    fireEvent.change(screen.getByLabelText('Discount, package 2'), { target: { value: '98' } });
    expect(screen.getAllByRole('row')[2]).toHaveTextContent('GH₵400');
  });

  it('exactly one package is the default: choosing another moves it', () => {
    renderTab();
    fireEvent.click(screen.getByLabelText('Default, package 3'));
    const saved = snapshot<ProductPackage[]>(screen, 'packages-snapshot');
    expect(saved.filter((p) => p.isDefault).map((p) => p.id)).toEqual([3]);
  });

  it('says "Final price cannot be below zero." when the discount is bigger than the price', () => {
    renderTab([pkg({ discountType: 'fixed', discountValue: 300 })]);
    expect(screen.getByText('Final price cannot be below zero.')).toBeInTheDocument();
  });

  it('says so when sets are below 1', () => {
    renderTab([pkg({ quantity: 0 })]);
    expect(screen.getByText('Sets must be at least 1.')).toBeInTheDocument();
  });

  it('Add package adds a row and Remove takes one away', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Add package/ }));
    expect(screen.getAllByRole('row').length).toBe(1 + 4);
    fireEvent.click(screen.getByRole('button', { name: 'Remove package 1' }));
    expect(screen.getAllByRole('row').length).toBe(1 + 3);
  });

  it('a badge text turns the badge on', () => {
    renderTab();
    fireEvent.change(screen.getByLabelText('Badge text, package 2'), { target: { value: 'Best deal' } });
    const two = snapshot<ProductPackage[]>(screen, 'packages-snapshot')[1];
    expect(two.highlightText).toBe('Best deal');
    expect(two.showHighlight).toBe(true);
    expect(within(screen.getAllByRole('row')[2]).getByLabelText('Badge text, package 2')).toHaveValue('Best deal');
  });
});
